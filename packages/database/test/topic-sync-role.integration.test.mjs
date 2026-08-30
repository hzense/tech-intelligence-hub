import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import process from 'node:process';
import { URL } from 'node:url';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { validateConnectionTarget } from '../src/connection-policy.mjs';
import { runMigrations } from '../src/migrate.mjs';
import { inspectTopicSyncPreflight } from '../src/topic-sync-preflight.mjs';

const { Client } = pg;
const adminUrl = process.env.MIGRATION_TEST_ADMIN_URL;
if (adminUrl) validateConnectionTarget({ connectionString: adminUrl, profile: 'local-test' });
const integrationSuite = adminUrl ? describe.sequential : describe.skip;
const suffix = randomUUID().replaceAll('-', '').slice(0, 12);
const databaseName = `hzense_role_contract_${suffix}`;
const ownerRole = `hzense_role_owner_${suffix}`;
const syncRole = 'hzense_topic_sync';
const ownerPassword = `owner-${suffix}`;
const syncPassword = `sync-${suffix}`;
const roleSqlPath = resolve(process.cwd(), '../../db/roles/configure_topic_sync.sql');

function quotedIdentifier(value) {
  if (!/^[a-z][a-z0-9_]+$/.test(value)) throw new Error(`Unsafe test identifier: ${value}`);
  return `"${value}"`;
}

function databaseUrl(role, password) {
  const url = new URL(adminUrl);
  url.username = role;
  url.password = password;
  url.pathname = `/${databaseName}`;
  return url.toString();
}

function adminDatabaseUrl() {
  const url = new URL(adminUrl);
  url.pathname = `/${databaseName}`;
  return url.toString();
}

async function withClient(connectionString, callback) {
  const client = new Client({ connectionString });
  await client.connect();
  try {
    return await callback(client);
  } finally {
    await client.end();
  }
}

function strictSyncPreflight(client) {
  return inspectTopicSyncPreflight(client, {
    expectedDatabase: databaseName,
    expectedUser: syncRole,
    expectedPostgresMajor: 18,
    expectedConnectionLimit: 2,
    profile: 'local-test',
  });
}

integrationSuite('PostgreSQL Topic sync role provisioning integration', () => {
  let adminClient;
  let databaseCreated = false;
  let ownerRoleCreated = false;
  let syncRoleCreated = false;
  let roleSql;

  beforeAll(async () => {
    adminClient = new Client({ connectionString: adminUrl });
    await adminClient.connect();
    const preexistingSyncRole = await adminClient.query(
      'SELECT 1 FROM pg_roles WHERE rolname = $1',
      [syncRole],
    );
    if (preexistingSyncRole.rowCount !== 0) {
      throw new Error(
        'Integration admin cluster already contains hzense_topic_sync; refusing to alter or delete it',
      );
    }

    roleSql = await readFile(roleSqlPath, 'utf8');
    await adminClient.query(
      `CREATE ROLE ${quotedIdentifier(ownerRole)}
       LOGIN NOINHERIT PASSWORD '${ownerPassword}'
       NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`,
    );
    ownerRoleCreated = true;
    await adminClient.query(
      `CREATE ROLE ${quotedIdentifier(syncRole)}
       LOGIN NOINHERIT PASSWORD '${syncPassword}' CONNECTION LIMIT 2
       NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`,
    );
    syncRoleCreated = true;
    await adminClient.query(
      `CREATE DATABASE ${quotedIdentifier(databaseName)} OWNER ${quotedIdentifier(ownerRole)}`,
    );
    databaseCreated = true;

    await withClient(adminDatabaseUrl(), (client) => client.query('CREATE EXTENSION vector'));
    await runMigrations({
      connectionString: databaseUrl(ownerRole, ownerPassword),
    });
  }, 30_000);

  afterAll(async () => {
    if (!adminClient) return;
    if (databaseCreated) {
      await adminClient.query(
        `SELECT pg_terminate_backend(pid)
         FROM pg_stat_activity
         WHERE datname = $1 AND pid <> pg_backend_pid()`,
        [databaseName],
      );
      await adminClient.query(`DROP DATABASE ${quotedIdentifier(databaseName)}`);
    }
    if (syncRoleCreated) {
      await adminClient.query(`DROP ROLE ${quotedIdentifier(syncRole)}`);
    }
    if (ownerRoleCreated) {
      await adminClient.query(`DROP ROLE ${quotedIdentifier(ownerRole)}`);
    }
    await adminClient.end();
  }, 30_000);

  it('removes ambient PUBLIC database privileges and passes the strict preflight', async () => {
    const ownerUrl = databaseUrl(ownerRole, ownerPassword);
    await withClient(ownerUrl, (client) => client.query(roleSql));

    const publicDatabasePrivileges = await withClient(adminDatabaseUrl(), (client) =>
      client.query(
        `SELECT acl_info.privilege_type
         FROM pg_database AS database_info
         CROSS JOIN LATERAL aclexplode(
           COALESCE(database_info.datacl, acldefault('d', database_info.datdba))
         ) AS acl_info
         WHERE database_info.datname = $1
           AND acl_info.grantee = 0
         ORDER BY acl_info.privilege_type`,
        [databaseName],
      ),
    );
    expect(publicDatabasePrivileges.rows).toEqual([]);

    await expect(
      withClient(databaseUrl(syncRole, syncPassword), strictSyncPreflight),
    ).resolves.toMatchObject({
      database: databaseName,
      user: syncRole,
      connectionLimit: 2,
      migrationCount: 3,
      tlsEvidence: 'local',
    });
    await withClient(databaseUrl(syncRole, syncPassword), async (client) => {
      await expect(client.query('CREATE TEMP TABLE forbidden_temp (id text)')).rejects.toThrow(
        /permission denied/,
      );
      await expect(client.query('DELETE FROM topics')).rejects.toThrow(/permission denied/);
      await expect(
        client.query('SELECT name FROM hzense_schema_migrations ORDER BY name'),
      ).resolves.toMatchObject({ rowCount: 3 });
    });
  }, 30_000);

  it('is idempotent and preserves the same effective ACL contract', async () => {
    const ownerUrl = databaseUrl(ownerRole, ownerPassword);
    const before = await withClient(adminDatabaseUrl(), (client) =>
      client.query(
        `SELECT database_info.datacl::text AS database_acl,
                namespace_info.nspacl::text AS public_schema_acl,
                topics_info.relacl::text AS topics_acl,
                history_info.relacl::text AS history_acl,
                type_info.typacl::text AS topic_status_acl
         FROM pg_database AS database_info
         CROSS JOIN pg_namespace AS namespace_info
         CROSS JOIN pg_class AS topics_info
         CROSS JOIN pg_class AS history_info
         CROSS JOIN pg_type AS type_info
         WHERE database_info.datname = $1
           AND namespace_info.nspname = 'public'
           AND topics_info.oid = 'public.topics'::regclass
           AND history_info.oid = 'public.hzense_schema_migrations'::regclass
           AND type_info.oid = 'public.topic_status'::regtype`,
        [databaseName],
      ),
    );

    await withClient(ownerUrl, (client) => client.query(roleSql));

    const after = await withClient(adminDatabaseUrl(), (client) =>
      client.query(
        `SELECT database_info.datacl::text AS database_acl,
                namespace_info.nspacl::text AS public_schema_acl,
                topics_info.relacl::text AS topics_acl,
                history_info.relacl::text AS history_acl,
                type_info.typacl::text AS topic_status_acl
         FROM pg_database AS database_info
         CROSS JOIN pg_namespace AS namespace_info
         CROSS JOIN pg_class AS topics_info
         CROSS JOIN pg_class AS history_info
         CROSS JOIN pg_type AS type_info
         WHERE database_info.datname = $1
           AND namespace_info.nspname = 'public'
           AND topics_info.oid = 'public.topics'::regclass
           AND history_info.oid = 'public.hzense_schema_migrations'::regclass
           AND type_info.oid = 'public.topic_status'::regtype`,
        [databaseName],
      ),
    );
    expect(after.rows).toEqual(before.rows);
    await expect(
      withClient(databaseUrl(syncRole, syncPassword), strictSyncPreflight),
    ).resolves.toMatchObject({ migrationCount: 3 });
  }, 30_000);
});
