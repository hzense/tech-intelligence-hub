import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import process from 'node:process';
import { URL } from 'node:url';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadMigrations, runMigrations } from '../src/migrate.mjs';

const { Client } = pg;
const adminUrl = process.env.MIGRATION_TEST_ADMIN_URL;
const integrationSuite = adminUrl ? describe.sequential : describe.skip;
const runSuffix = `${process.pid}_${Date.now()}`;
const databaseNames = {
  fresh: `hzense_migration_fresh_${runSuffix}`,
  legacy: `hzense_migration_legacy_${runSuffix}`,
  missingEdge: `hzense_migration_missing_${runSuffix}`,
  rollback: `hzense_migration_rollback_${runSuffix}`,
};

function quotedDatabaseName(name) {
  if (!/^hzense_migration_[a-z]+_[0-9_]+$/.test(name)) {
    throw new Error(`Unsafe migration-test database name: ${name}`);
  }
  return `"${name}"`;
}

function connectionUrl(databaseName) {
  if (!adminUrl) throw new Error('MIGRATION_TEST_ADMIN_URL is required');
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

async function applyFoundation(connectionString) {
  const foundationSql = await readFile(
    resolve(process.cwd(), '../../db/migrations/0000_foundation.sql'),
    'utf8',
  );
  await withClient(connectionString, (client) => client.query(foundationSql));
}

async function foundationChecksum() {
  const migrations = await loadMigrations(resolve(process.cwd(), '../../db/migrations'));
  const foundation = migrations.find((migration) => migration.name === '0000_foundation.sql');
  if (!foundation) throw new Error('0000_foundation.sql is missing');
  return foundation.checksum;
}

integrationSuite('PostgreSQL migration integration', () => {
  let adminClient;

  beforeAll(async () => {
    adminClient = new Client({ connectionString: adminUrl });
    await adminClient.connect();
    for (const name of Object.values(databaseNames)) {
      await adminClient.query(`CREATE DATABASE ${quotedDatabaseName(name)}`);
    }
  }, 30_000);

  afterAll(async () => {
    if (!adminClient) return;
    for (const name of Object.values(databaseNames)) {
      await adminClient.query(
        `SELECT pg_terminate_backend(pid)
         FROM pg_stat_activity
         WHERE datname = $1 AND pid <> pg_backend_pid()`,
        [name],
      );
      await adminClient.query(`DROP DATABASE IF EXISTS ${quotedDatabaseName(name)}`);
    }
    await adminClient.end();
  }, 30_000);

  it('migrates a fresh pgvector database and reruns idempotently', async () => {
    const databaseUrl = connectionUrl(databaseNames.fresh);

    await runMigrations({ connectionString: databaseUrl });
    await runMigrations({ connectionString: databaseUrl });

    await withClient(databaseUrl, async (client) => {
      const history = await client.query('SELECT name FROM hzense_schema_migrations ORDER BY name');
      expect(history.rows.map((row) => row.name)).toEqual([
        '0000_foundation.sql',
        '0001_radar_evidence.sql',
      ]);
      await expect(client.query('SELECT source_url FROM signals LIMIT 0')).resolves.toBeDefined();
      await expect(
        client.query('SELECT position FROM radar_snapshot_signals LIMIT 0'),
      ).resolves.toBeDefined();
    });
  }, 30_000);

  it('upgrades a populated 0000 database to the current evidence seed', async () => {
    const databaseUrl = connectionUrl(databaseNames.legacy);
    await applyFoundation(databaseUrl);

    await withClient(databaseUrl, (client) =>
      client.query(`
        INSERT INTO topics (id, title, status) VALUES
          ('topic-foundation-models', 'Foundation Models', 'strategic'),
          ('topic-ai-security', 'AI Security', 'active');

        INSERT INTO sources (id, name, type, trust_score, active)
        VALUES ('source-anthropic', 'Anthropic', 'company_blog', 95, true);

        INSERT INTO signals (
          id, title, type, status, occurred_at, captured_at, source_id,
          summary, importance, strength, confidence, novelty
        ) VALUES
          (
            'signal-20240620-claude35', 'Anthropic announced Claude 3.5 Sonnet',
            'product', 'accepted', '2024-06-20T00:00:00Z', '2026-08-20T00:00:00Z',
            'source-anthropic', 'Legacy Claude seed', 4, 4, 1, 0.8
          ),
          (
            'signal-20241125-mcp', 'Anthropic introduced Model Context Protocol',
            'technology', 'accepted', '2024-11-25T00:00:00Z', '2026-08-20T00:00:00Z',
            'source-anthropic', 'Legacy MCP seed', 5, 5, 1, 0.9
          );

        INSERT INTO signal_topics (signal_id, topic_id) VALUES
          ('signal-20240620-claude35', 'topic-foundation-models'),
          ('signal-20241125-mcp', 'topic-ai-security');

        INSERT INTO radar_snapshots (
          id, topic_id, snapshot_date, attention, trend, maturity,
          strategic_value, confidence
        ) VALUES (
          'radar-20260827-ai-security', 'topic-ai-security', '2026-08-27',
          85, 'rapid_growth', 'emerging', 'high', 0.9
        );
      `),
    );

    const baselineChecksum = await foundationChecksum();
    await runMigrations({
      connectionString: databaseUrl,
      baselineChecksum,
    });
    await runMigrations({ connectionString: databaseUrl });

    await withClient(databaseUrl, async (client) => {
      const source = await client.query(
        "SELECT allowed_hosts FROM sources WHERE id = 'source-anthropic'",
      );
      expect(source.rows[0].allowed_hosts).toEqual(['anthropic.com']);

      const signal = await client.query(
        `SELECT source_url, occurred_at
         FROM signals WHERE id = 'signal-20240620-claude35'`,
      );
      expect(signal.rows[0].source_url).toBe('https://www.anthropic.com/news/claude-3-5-sonnet');
      expect(signal.rows[0].occurred_at.toISOString()).toBe('2024-06-21T00:00:00.000Z');

      const radar = await client.query(
        `SELECT domain, attention, trend, maturity, strategic_value, confidence, reasoning
         FROM radar_snapshots WHERE id = 'radar-20260827-ai-security'`,
      );
      expect(radar.rows[0]).toMatchObject({
        domain: 'security',
        attention: 55,
        trend: 'growth',
        maturity: 'emerging',
        strategic_value: 'medium',
        confidence: 0.4,
      });
      expect(radar.rows[0].reasoning.trim().length).toBeGreaterThan(0);

      const evidence = await client.query(
        `SELECT signal_id, position
         FROM radar_snapshot_signals
         WHERE snapshot_id = 'radar-20260827-ai-security'
         ORDER BY position`,
      );
      expect(evidence.rows).toEqual([{ signal_id: 'signal-20241125-mcp', position: 0 }]);
    });
  }, 30_000);

  it('rolls back 0001 when legacy provenance cannot be backfilled', async () => {
    const databaseUrl = connectionUrl(databaseNames.rollback);
    await applyFoundation(databaseUrl);
    await withClient(databaseUrl, (client) =>
      client.query(`
        INSERT INTO sources (id, name, type, trust_score, active)
        VALUES ('source-legacy-unknown', 'Unknown', 'website', 50, true)
      `),
    );

    await expect(
      runMigrations({
        connectionString: databaseUrl,
        baselineChecksum: await foundationChecksum(),
      }),
    ).rejects.toThrow(/unresolved source IDs: source-legacy-unknown/);

    await withClient(databaseUrl, async (client) => {
      const column = await client.query(
        `SELECT 1
         FROM information_schema.columns
         WHERE table_schema = 'public'
           AND table_name = 'sources'
           AND column_name = 'allowed_hosts'`,
      );
      expect(column.rowCount).toBe(0);

      const radarDomain = await client.query("SELECT to_regtype('public.radar_domain') AS type");
      expect(radarDomain.rows[0].type).toBeNull();

      const history = await client.query('SELECT name FROM hzense_schema_migrations ORDER BY name');
      expect(history.rows).toEqual([{ name: '0000_foundation.sql' }]);
    });
  }, 30_000);

  it('rolls back when a legacy Radar snapshot is missing an expected evidence Signal', async () => {
    const databaseUrl = connectionUrl(databaseNames.missingEdge);
    await applyFoundation(databaseUrl);
    await withClient(databaseUrl, (client) =>
      client.query(`
        INSERT INTO topics (id, title, status)
        VALUES ('topic-ai-security', 'AI Security', 'active');

        INSERT INTO radar_snapshots (
          id, topic_id, snapshot_date, attention, trend, maturity,
          strategic_value, confidence
        ) VALUES (
          'radar-20260827-ai-security', 'topic-ai-security', '2026-08-27',
          85, 'rapid_growth', 'emerging', 'high', 0.9
        );
      `),
    );

    await expect(
      runMigrations({
        connectionString: databaseUrl,
        baselineChecksum: await foundationChecksum(),
      }),
    ).rejects.toThrow(/could not persist every expected evidence edge/);

    await withClient(databaseUrl, async (client) => {
      const evidenceTable = await client.query(
        "SELECT to_regclass('public.radar_snapshot_signals') AS table_name",
      );
      expect(evidenceTable.rows[0].table_name).toBeNull();

      const history = await client.query('SELECT name FROM hzense_schema_migrations ORDER BY name');
      expect(history.rows).toEqual([{ name: '0000_foundation.sql' }]);
    });
  }, 30_000);
});
