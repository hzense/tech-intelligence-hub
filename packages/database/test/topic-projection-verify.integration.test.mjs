import { randomUUID } from 'node:crypto';
import process from 'node:process';
import { URL } from 'node:url';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { validateConnectionTarget } from '../src/connection-policy.mjs';
import { runMigrations } from '../src/migrate.mjs';
import { runTopicProjectionVerification } from '../src/topic-projection-verify.mjs';
import { topicProjectionFingerprint } from '../src/topic-sync.mjs';

const { Client } = pg;
const adminUrl = process.env.MIGRATION_TEST_ADMIN_URL;
if (adminUrl) validateConnectionTarget({ connectionString: adminUrl, profile: 'local-test' });
const integrationSuite = adminUrl ? describe : describe.skip;
const suffix = randomUUID().replaceAll('-', '').slice(0, 12);
const databaseName = `hzense_topic_verify_${suffix}`;
const migratorRole = `hzense_verify_owner_${suffix}`;
const verifierRole = `hzense_verify_reader_${suffix}`;
const migratorPassword = `migrator-${suffix}`;
const verifierPassword = `verifier-${suffix}`;

const expectedTopics = Array.from({ length: 62 }, (_, index) => ({
  id: `topic-verify-${String(index + 1).padStart(3, '0')}`,
  title: `Topic ${index + 1}`,
  parentId: null,
  status: index < 5 ? 'active' : 'watching',
  runtimeEnabled: index < 5,
}));
const expectedFingerprint = topicProjectionFingerprint(expectedTopics);

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

integrationSuite('PostgreSQL read-only Topic projection verification', () => {
  let adminClient;

  beforeAll(async () => {
    adminClient = new Client({ connectionString: adminUrl });
    await adminClient.connect();
    await adminClient.query(
      `CREATE ROLE ${quotedIdentifier(migratorRole)}
       LOGIN NOINHERIT PASSWORD '${migratorPassword}'
       NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`,
    );
    await adminClient.query(
      `CREATE ROLE ${quotedIdentifier(verifierRole)}
       LOGIN NOINHERIT PASSWORD '${verifierPassword}' CONNECTION LIMIT 2
       NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`,
    );
    await adminClient.query(
      `CREATE DATABASE ${quotedIdentifier(databaseName)} OWNER ${quotedIdentifier(migratorRole)}`,
    );
    await withClient(adminDatabaseUrl(), (client) => client.query('CREATE EXTENSION vector'));
    await runMigrations({ connectionString: databaseUrl(migratorRole, migratorPassword) });
    await withClient(databaseUrl(migratorRole, migratorPassword), async (client) => {
      await client.query(
        `INSERT INTO public.topics (id, title, parent_id, status, runtime_enabled)
         SELECT input.id, input.title, input.parent_id, input.status, input.runtime_enabled
         FROM unnest(
           $1::text[],
           $2::text[],
           $3::text[],
           $4::public.topic_status[],
           $5::boolean[]
         ) AS input(id, title, parent_id, status, runtime_enabled)`,
        [
          expectedTopics.map((topic) => topic.id),
          expectedTopics.map((topic) => topic.title),
          expectedTopics.map((topic) => topic.parentId),
          expectedTopics.map((topic) => topic.status),
          expectedTopics.map((topic) => topic.runtimeEnabled),
        ],
      );
      await client.query(
        `REVOKE CONNECT, CREATE, TEMPORARY ON DATABASE ${quotedIdentifier(databaseName)} FROM PUBLIC`,
      );
      await client.query(
        `GRANT CONNECT ON DATABASE ${quotedIdentifier(databaseName)} TO ${quotedIdentifier(verifierRole)}`,
      );
      await client.query('REVOKE ALL ON SCHEMA public FROM PUBLIC');
      await client.query(`GRANT USAGE ON SCHEMA public TO ${quotedIdentifier(verifierRole)}`);
      await client.query('REVOKE ALL ON TYPE public.topic_status FROM PUBLIC');
      await client.query(
        `GRANT USAGE ON TYPE public.topic_status TO ${quotedIdentifier(verifierRole)}`,
      );
      await client.query('REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC');
      await client.query(
        `GRANT SELECT ON TABLE public.topics TO ${quotedIdentifier(verifierRole)}`,
      );
    });
  }, 30_000);

  afterAll(async () => {
    if (!adminClient) return;
    await adminClient.query(
      `SELECT pg_terminate_backend(pid)
       FROM pg_stat_activity
       WHERE datname = $1 AND pid <> pg_backend_pid()`,
      [databaseName],
    );
    await adminClient.query(`DROP DATABASE IF EXISTS ${quotedIdentifier(databaseName)}`);
    await adminClient.query(`DROP ROLE IF EXISTS ${quotedIdentifier(verifierRole)}`);
    await adminClient.query(`DROP ROLE IF EXISTS ${quotedIdentifier(migratorRole)}`);
    await adminClient.end();
  }, 30_000);

  it('verifies all 62 rows through a separate SELECT-only role in READ ONLY mode', async () => {
    const ownerUrl = databaseUrl(migratorRole, migratorPassword);
    const before = await withClient(ownerUrl, (client) =>
      client.query('SELECT id, xmin::text FROM public.topics ORDER BY id'),
    );

    await expect(
      runTopicProjectionVerification({
        connectionString: databaseUrl(verifierRole, verifierPassword),
        expectedTopics,
        expectedFingerprint,
        beforeRead: async (client) => {
          const identity = await client.query(
            `SELECT current_user AS role,
                    current_database() AS database,
                    current_setting('transaction_read_only') AS read_only`,
          );
          expect(identity.rows[0]).toEqual({
            role: verifierRole,
            database: databaseName,
            read_only: 'on',
          });
        },
      }),
    ).resolves.toEqual({
      verified: true,
      topicCount: 62,
      unknownTopicCount: 0,
      fingerprint: expectedFingerprint,
    });

    const after = await withClient(ownerUrl, (client) =>
      client.query('SELECT id, xmin::text FROM public.topics ORDER BY id'),
    );
    expect(after.rows).toEqual(before.rows);
  }, 30_000);

  it('fails closed on an unknown database Topic and leaves it untouched', async () => {
    const ownerUrl = databaseUrl(migratorRole, migratorPassword);
    await withClient(ownerUrl, (client) =>
      client.query(
        `INSERT INTO public.topics (id, title, status, runtime_enabled)
         VALUES ('topic-unknown', 'Unknown', 'watching', false)`,
      ),
    );

    try {
      await expect(
        runTopicProjectionVerification({
          connectionString: databaseUrl(verifierRole, verifierPassword),
          expectedTopics,
          expectedFingerprint,
        }),
      ).rejects.toThrow(/outside authoritative Taxonomy: topic-unknown/);
      const unknown = await withClient(ownerUrl, (client) =>
        client.query("SELECT title FROM public.topics WHERE id = 'topic-unknown'"),
      );
      expect(unknown.rows).toEqual([{ title: 'Unknown' }]);
    } finally {
      await withClient(ownerUrl, (client) =>
        client.query("DELETE FROM public.topics WHERE id = 'topic-unknown'"),
      );
    }
  }, 30_000);
});
