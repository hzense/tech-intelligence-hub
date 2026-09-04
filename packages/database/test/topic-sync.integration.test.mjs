import { randomUUID } from 'node:crypto';
import process from 'node:process';
import { URL } from 'node:url';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { validateConnectionTarget } from '../src/connection-policy.mjs';
import { runMigrations, migrationLockKeys } from '../src/migrate.mjs';
import { inspectTopicSyncPreflight } from '../src/topic-sync-preflight.mjs';
import { runTopicSync, syncTopics } from '../src/topic-sync.mjs';

const { Client } = pg;
const adminUrl = process.env.MIGRATION_TEST_ADMIN_URL;
if (adminUrl) validateConnectionTarget({ connectionString: adminUrl, profile: 'local-test' });
const integrationSuite = adminUrl ? describe : describe.skip;
const suffix = randomUUID().replaceAll('-', '').slice(0, 12);
const databaseName = `hzense_topic_sync_${suffix}`;
const migratorRole = `hzense_migrator_${suffix}`;
const syncRole = `hzense_sync_${suffix}`;
const migratorPassword = `migrator-${suffix}`;
const syncPassword = `sync-${suffix}`;

const desiredTopics = [
  {
    id: 'topic-root',
    title: 'Root',
    parentId: null,
    status: 'watching',
    runtimeEnabled: false,
  },
  {
    id: 'topic-child',
    title: 'Child',
    parentId: 'topic-root',
    status: 'active',
    runtimeEnabled: true,
  },
  {
    id: 'topic-archived',
    title: 'Archived',
    parentId: 'topic-root',
    status: 'archived',
    runtimeEnabled: false,
  },
];

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

function syncPreflight(client) {
  return inspectTopicSyncPreflight(client, {
    expectedDatabase: databaseName,
    expectedUser: syncRole,
    expectedPostgresMajor: 18,
    expectedConnectionLimit: 2,
    profile: 'local-test',
  });
}

function runRestrictedSync(topics, dryRun = false, expectedPlanFingerprint) {
  return runTopicSync({
    connectionString: databaseUrl(syncRole, syncPassword),
    desiredTopics: topics,
    dryRun,
    expectedPlanFingerprint,
    beforeSync: syncPreflight,
  });
}

integrationSuite('PostgreSQL Topic sync integration', () => {
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
      `CREATE ROLE ${quotedIdentifier(syncRole)}
       LOGIN NOINHERIT PASSWORD '${syncPassword}' CONNECTION LIMIT 2
       NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`,
    );
    await adminClient.query(
      `CREATE DATABASE ${quotedIdentifier(databaseName)} OWNER ${quotedIdentifier(migratorRole)}`,
    );
    await withClient(adminDatabaseUrl(), async (client) => {
      await client.query('CREATE EXTENSION vector');
      await client.query(
        `REVOKE CONNECT, TEMPORARY ON DATABASE ${quotedIdentifier(databaseName)} FROM PUBLIC`,
      );
      await client.query(
        `GRANT CONNECT ON DATABASE ${quotedIdentifier(databaseName)} TO ${quotedIdentifier(syncRole)}`,
      );
      await client.query('REVOKE ALL ON SCHEMA public FROM PUBLIC');
    });

    await runMigrations({
      connectionString: databaseUrl(migratorRole, migratorPassword),
    });
    await withClient(adminDatabaseUrl(), async (client) => {
      await client.query('REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC');
      await client.query('REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM PUBLIC');
      await client.query('REVOKE USAGE ON TYPE public.topic_status FROM PUBLIC');
      await client.query(`GRANT USAGE ON SCHEMA public TO ${quotedIdentifier(syncRole)}`);
      await client.query(
        `GRANT USAGE ON TYPE public.topic_status TO ${quotedIdentifier(syncRole)}`,
      );
      await client.query(
        `GRANT SELECT, INSERT, UPDATE ON public.topics TO ${quotedIdentifier(syncRole)}`,
      );
      await client.query(
        `GRANT SELECT ON public.hzense_schema_migrations TO ${quotedIdentifier(syncRole)}`,
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
    await adminClient.query(`DROP ROLE IF EXISTS ${quotedIdentifier(syncRole)}`);
    await adminClient.query(`DROP ROLE IF EXISTS ${quotedIdentifier(migratorRole)}`);
    await adminClient.end();
  }, 30_000);

  it('applies, preserves unrelated metadata and reruns as a physical no-op', async () => {
    await expect(
      withClient(databaseUrl(syncRole, syncPassword), syncPreflight),
    ).resolves.toMatchObject({ connectionLimit: 2, migrationCount: 4 });

    const reviewed = await runRestrictedSync(desiredTopics, true);
    expect(reviewed).toMatchObject({ committed: false, inserted: 3, updated: 0 });
    await expect(
      runRestrictedSync(desiredTopics, false, reviewed.planFingerprint),
    ).resolves.toMatchObject({
      committed: true,
      inserted: 3,
      updated: 0,
    });
    await withClient(databaseUrl(migratorRole, migratorPassword), (client) =>
      client.query(
        `UPDATE topics SET metadata = '{"manual":true}'::jsonb WHERE id = 'topic-child'`,
      ),
    );
    const before = await withClient(databaseUrl(migratorRole, migratorPassword), (client) =>
      client.query('SELECT id, xmin::text, metadata FROM topics ORDER BY id'),
    );

    await expect(runRestrictedSync(desiredTopics)).resolves.toMatchObject({
      inserted: 0,
      updated: 0,
      unchanged: 3,
    });
    const after = await withClient(databaseUrl(migratorRole, migratorPassword), (client) =>
      client.query('SELECT id, xmin::text, metadata FROM topics ORDER BY id'),
    );
    expect(after.rows).toEqual(before.rows);
    expect(after.rows.find((row) => row.id === 'topic-child').metadata).toEqual({ manual: true });
  }, 30_000);

  it('updates owned fields and rolls a dry-run back completely', async () => {
    const strategic = desiredTopics.map((topic) =>
      topic.id === 'topic-child' ? { ...topic, status: 'strategic' } : topic,
    );
    await expect(runRestrictedSync(strategic)).resolves.toMatchObject({ updated: 1 });
    const stored = await withClient(databaseUrl(migratorRole, migratorPassword), (client) =>
      client.query("SELECT title, status::text, metadata FROM topics WHERE id = 'topic-child'"),
    );
    expect(stored.rows[0]).toEqual({
      title: 'Child',
      status: 'strategic',
      metadata: { manual: true },
    });

    const dryRun = strategic.map((topic) =>
      topic.id === 'topic-child' ? { ...topic, title: 'Dry Run Title' } : topic,
    );
    await expect(runRestrictedSync(dryRun, true)).resolves.toMatchObject({
      mode: 'dry-run',
      committed: false,
      updated: 1,
    });
    const afterDryRun = await withClient(databaseUrl(migratorRole, migratorPassword), (client) =>
      client.query("SELECT title FROM topics WHERE id = 'topic-child'"),
    );
    expect(afterDryRun.rows[0].title).toBe('Child');

    await runRestrictedSync(desiredTopics);
  }, 30_000);

  it('fails closed on an unknown database row without changing managed rows', async () => {
    const ownerUrl = databaseUrl(migratorRole, migratorPassword);
    await withClient(ownerUrl, (client) =>
      client.query(
        `INSERT INTO topics (id, title, status, runtime_enabled)
         VALUES ('topic-unknown', 'Unknown', 'watching', false)`,
      ),
    );
    const before = await withClient(ownerUrl, (client) =>
      client.query(
        "SELECT id, title, xmin::text FROM topics WHERE id <> 'topic-unknown' ORDER BY id",
      ),
    );
    await expect(runRestrictedSync(desiredTopics)).rejects.toThrow(
      /outside authoritative Taxonomy: topic-unknown/,
    );
    const after = await withClient(ownerUrl, (client) =>
      client.query(
        "SELECT id, title, xmin::text FROM topics WHERE id <> 'topic-unknown' ORDER BY id",
      ),
    );
    expect(after.rows).toEqual(before.rows);
    await withClient(ownerUrl, (client) =>
      client.query("DELETE FROM topics WHERE id = 'topic-unknown'"),
    );
  }, 30_000);

  it('shares the migration advisory lock and fails without waiting', async () => {
    const holder = new Client({
      connectionString: databaseUrl(migratorRole, migratorPassword),
    });
    await holder.connect();
    try {
      await holder.query('BEGIN');
      await holder.query('SELECT pg_advisory_xact_lock($1, $2)', migrationLockKeys);
      await expect(runRestrictedSync(desiredTopics)).rejects.toThrow(
        /migration or Topic sync process currently holds the lock/,
      );
    } finally {
      await holder.query('ROLLBACK');
      await holder.end();
    }
  }, 30_000);

  it('cannot delete, truncate, create DDL or write unrelated tables', async () => {
    await withClient(databaseUrl(syncRole, syncPassword), async (client) => {
      await expect(client.query("DELETE FROM topics WHERE id = 'topic-child'")).rejects.toThrow(
        /permission denied/,
      );
      await expect(client.query('TRUNCATE topics')).rejects.toThrow(/permission denied/);
      await expect(client.query('CREATE TABLE forbidden (id text)')).rejects.toThrow(
        /permission denied/,
      );
      await expect(
        client.query(
          `INSERT INTO sources (id, name, type, trust_score, active, allowed_hosts)
           VALUES ('source-forbidden', 'Forbidden', 'website', 1, true, ARRAY['example.com'])`,
        ),
      ).rejects.toThrow(/permission denied/);
    });
  }, 30_000);

  it('preflight rejects PG18 MAINTAIN, grant options, column ACLs and extra relations', async () => {
    const syncUrl = databaseUrl(syncRole, syncPassword);
    const adminTarget = adminDatabaseUrl();
    await withClient(adminTarget, async (client) => {
      await client.query(`GRANT MAINTAIN ON topics TO ${quotedIdentifier(syncRole)}`);
    });
    try {
      await expect(withClient(syncUrl, syncPreflight)).rejects.toThrow(/MAINTAIN/);
    } finally {
      await withClient(adminTarget, (client) =>
        client.query(`REVOKE MAINTAIN ON topics FROM ${quotedIdentifier(syncRole)}`),
      );
    }

    await withClient(adminTarget, (client) =>
      client.query(`GRANT SELECT ON topics TO ${quotedIdentifier(syncRole)} WITH GRANT OPTION`),
    );
    try {
      await expect(withClient(syncUrl, syncPreflight)).rejects.toThrow(/grant options/);
    } finally {
      await withClient(adminTarget, (client) =>
        client.query(`REVOKE GRANT OPTION FOR SELECT ON topics FROM ${quotedIdentifier(syncRole)}`),
      );
    }

    await withClient(adminTarget, (client) =>
      client.query(`GRANT SELECT (name) ON sources TO ${quotedIdentifier(syncRole)}`),
    );
    try {
      await expect(withClient(syncUrl, syncPreflight)).rejects.toThrow(/column-level privileges/);
    } finally {
      await withClient(adminTarget, (client) =>
        client.query(`REVOKE SELECT (name) ON sources FROM ${quotedIdentifier(syncRole)}`),
      );
    }

    await withClient(adminTarget, (client) =>
      client.query(
        `CREATE TABLE rogue_topic_sync (id text); GRANT SELECT ON rogue_topic_sync TO ${quotedIdentifier(syncRole)}`,
      ),
    );
    try {
      await expect(withClient(syncUrl, syncPreflight)).rejects.toThrow(/rogue_topic_sync/);
    } finally {
      await withClient(adminTarget, (client) => client.query('DROP TABLE rogue_topic_sync'));
    }

    await withClient(adminTarget, (client) =>
      client.query(
        `ALTER DEFAULT PRIVILEGES FOR ROLE ${quotedIdentifier(migratorRole)} GRANT SELECT ON TABLES TO PUBLIC`,
      ),
    );
    try {
      await expect(withClient(syncUrl, syncPreflight)).rejects.toThrow(
        /future table or sequence default privileges/,
      );
    } finally {
      await withClient(adminTarget, (client) =>
        client.query(
          `ALTER DEFAULT PRIVILEGES FOR ROLE ${quotedIdentifier(migratorRole)} REVOKE SELECT ON TABLES FROM PUBLIC`,
        ),
      );
    }

    await withClient(adminTarget, (client) =>
      client.query(`
        CREATE FUNCTION public.hzense_topic_sync_security_definer_test()
        RETURNS integer
        LANGUAGE sql
        SECURITY DEFINER
        AS $$ SELECT 1 $$
      `),
    );
    try {
      await expect(withClient(syncUrl, syncPreflight)).rejects.toThrow(/SECURITY DEFINER/);
    } finally {
      await withClient(adminTarget, (client) =>
        client.query('DROP FUNCTION public.hzense_topic_sync_security_definer_test()'),
      );
    }

    await withClient(adminTarget, (client) =>
      client.query(`
        CREATE RULE hzense_topic_sync_rewrite_test AS
        ON UPDATE TO public.topics DO ALSO NOTHING
      `),
    );
    try {
      await expect(withClient(syncUrl, syncPreflight)).rejects.toThrow(/unexpected rewrite rule/);
    } finally {
      await withClient(adminTarget, (client) =>
        client.query('DROP RULE hzense_topic_sync_rewrite_test ON public.topics'),
      );
    }

    await withClient(adminTarget, (client) =>
      client.query(`
        CREATE SCHEMA rogue_topic_sync_private;
        GRANT USAGE ON SCHEMA rogue_topic_sync_private TO ${quotedIdentifier(syncRole)}
      `),
    );
    try {
      await expect(withClient(syncUrl, syncPreflight)).rejects.toThrow(
        /privileges on extra schemas: rogue_topic_sync_private/,
      );
    } finally {
      await withClient(adminTarget, (client) =>
        client.query('DROP SCHEMA rogue_topic_sync_private'),
      );
    }

    await withClient(adminTarget, (client) =>
      client.query(`
        CREATE SCHEMA rogue_topic_sync_private;
        CREATE TABLE rogue_topic_sync_private.secrets (id text);
        GRANT SELECT ON rogue_topic_sync_private.secrets TO ${quotedIdentifier(syncRole)}
      `),
    );
    try {
      await expect(withClient(syncUrl, syncPreflight)).rejects.toThrow(
        /rogue_topic_sync_private\.secrets:SELECT/,
      );
    } finally {
      await withClient(adminTarget, (client) =>
        client.query('DROP SCHEMA rogue_topic_sync_private CASCADE'),
      );
    }

    await expect(withClient(syncUrl, syncPreflight)).resolves.toBeDefined();
  }, 30_000);

  it('rolls the entire batch back when PostgreSQL rejects one projected row', async () => {
    const ownerUrl = databaseUrl(migratorRole, migratorPassword);
    await withClient(ownerUrl, (client) =>
      client.query(`
        CREATE FUNCTION hzense_reject_topic_sync() RETURNS trigger
        LANGUAGE plpgsql AS $$
        BEGIN
          IF NEW.id = 'topic-child' THEN RAISE EXCEPTION 'forced Topic sync failure'; END IF;
          RETURN NEW;
        END $$;
        CREATE TRIGGER hzense_reject_topic_sync
        BEFORE UPDATE ON topics
        FOR EACH ROW EXECUTE FUNCTION hzense_reject_topic_sync();
      `),
    );
    const before = await withClient(ownerUrl, (client) =>
      client.query('SELECT id, title, xmin::text FROM topics ORDER BY id'),
    );
    const changed = desiredTopics.map((topic) => ({ ...topic, title: `${topic.title} changed` }));
    try {
      await expect(
        withClient(databaseUrl(syncRole, syncPassword), (client) =>
          syncTopics(client, changed, { dryRun: false }),
        ),
      ).rejects.toThrow(/forced Topic sync failure/);
      const after = await withClient(ownerUrl, (client) =>
        client.query('SELECT id, title, xmin::text FROM topics ORDER BY id'),
      );
      expect(after.rows).toEqual(before.rows);
    } finally {
      await withClient(ownerUrl, (client) =>
        client.query(`
          DROP TRIGGER IF EXISTS hzense_reject_topic_sync ON topics;
          DROP FUNCTION IF EXISTS hzense_reject_topic_sync();
        `),
      );
    }
  }, 30_000);
});
