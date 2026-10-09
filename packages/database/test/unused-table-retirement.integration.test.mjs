import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import { URL } from 'node:url';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { validateConnectionTarget } from '../src/connection-policy.mjs';
import { loadMigrations, runMigrations } from '../src/migrate.mjs';
import { runDatabasePreflight } from '../src/preflight.mjs';
import { expectedTableNames, verifyDatabaseContract } from '../src/verify.mjs';

const adminUrl = process.env.MIGRATION_TEST_ADMIN_URL;
if (adminUrl) validateConnectionTarget({ connectionString: adminUrl, profile: 'local-test' });
// Match the existing local-only cutover seam. This proves PostgreSQL DDL and
// rollback behavior without claiming the complete pgvector production contract.
const noVector = process.env.HZENSE_UNIFIED_NO_VECTOR === '1';
if (noVector && process.env.CI) throw new Error('CI requires pgvector');
const suite = adminUrl ? describe.sequential : describe.skip;
const suffix = `${process.pid}_${Date.now()}`;
const database = `hzense_retirement_${suffix}`;
const role = `hzense_retirement_owner_${suffix}`;
const password = 'retirement-local-fixture-only';
const tables = ['content_registry', 'entity_topics', 'radar_snapshots', 'radar_snapshot_signals'];
const name = '0031_retire_unused_tables.sql';
const dir = new URL('../../../db/migrations/', import.meta.url);
const retirementSql = await readFile(new URL(name, dir), 'utf8');
const quote = (identifier) => {
  if (!/^[a-z][a-z0-9_]+$/.test(identifier)) throw new Error('Unsafe retirement fixture name');
  return `"${identifier}"`;
};

suite('empty-only retirement of four unused business tables', () => {
  let admin, client, directory, connectionString;
  let databaseCreated = false;
  let roleCreated = false;
  const options = () => ({
    connectionString,
    profile: 'local-test',
    expectedDatabase: database,
    expectedUser: role,
    expectedPostgresMajor: 18,
    expectedPgvectorVersion: '0.8.6',
  });
  const migrationOptions = () => ({ connectionString, ...(noVector ? { directory } : {}) });
  const catalog = async () =>
    (
      await client.query(
        `SELECT c.relname, c.oid::text FROM pg_catalog.pg_class c
         JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
         WHERE n.nspname='public' AND c.relname=ANY($1::text[]) ORDER BY c.relname`,
        [tables],
      )
    ).rows;
  const ledger = async () =>
    (await client.query('SELECT name, checksum FROM hzense_schema_migrations ORDER BY name')).rows;

  beforeAll(async () => {
    admin = new pg.Client({ connectionString: adminUrl });
    await admin.connect();
    await admin.query(
      `CREATE ROLE ${quote(role)} LOGIN PASSWORD '${password}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`,
    );
    roleCreated = true;
    await admin.query(`CREATE DATABASE ${quote(database)} OWNER ${quote(role)}`);
    databaseCreated = true;
    const url = new URL(adminUrl);
    url.pathname = `/${database}`;
    const databaseAdmin = new pg.Client({ connectionString: url.toString() });
    await databaseAdmin.connect();
    try {
      if (!noVector) await databaseAdmin.query('CREATE EXTENSION vector');
      await databaseAdmin.query('REVOKE CREATE ON SCHEMA public FROM PUBLIC');
    } finally {
      await databaseAdmin.end();
    }
    url.username = role;
    url.password = password;
    connectionString = url.toString();
    directory = await mkdtemp(join(tmpdir(), 'hzense-retirement-migrations-'));
    const migrations = (await loadMigrations(dir.pathname)).filter(
      (m) => m.name < '0031_' && !(noVector && m.name.startsWith('0003_')),
    );
    await Promise.all(
      migrations.map((m) =>
        writeFile(
          join(directory, m.name),
          noVector && m.name.startsWith('0000_')
            ? m.sql
                .replace('CREATE EXTENSION IF NOT EXISTS vector;', '')
                .replace('embedding vector(1536)', 'embedding text')
            : m.sql,
        ),
      ),
    );
    await runMigrations({ connectionString, directory });
    if (noVector) await writeFile(join(directory, name), retirementSql);
    client = new pg.Client({ connectionString });
    await client.connect();
  }, 60_000);

  afterAll(async () => {
    await client?.end();
    if (databaseCreated) await admin.query(`DROP DATABASE ${quote(database)}`);
    if (roleCreated) await admin.query(`DROP ROLE ${quote(role)}`);
    await admin?.end();
    if (directory) await rm(directory, { recursive: true, force: true });
  }, 30_000);

  async function rejectsWithoutDropping({ setup, error, check }) {
    const original = await catalog();
    const history = await ledger();
    await client.query('BEGIN');
    try {
      if (setup) await client.query(setup);
      const expected = await catalog();
      await client.query('SAVEPOINT before_retirement');
      await expect(client.query(retirementSql)).rejects.toMatchObject(error);
      await client.query('ROLLBACK TO SAVEPOINT before_retirement');
      expect(await catalog()).toEqual(expected);
      expect(await ledger()).toEqual(history);
      if (check) await check();
    } finally {
      await client.query('ROLLBACK');
    }
    expect(await catalog()).toEqual(original);
  }

  it.skipIf(noVector)(
    'accepts the intact pre-0031 schema for read-only upgrade preflight',
    async () => {
      expect(await catalog()).toHaveLength(4);
      await expect(runDatabasePreflight(options())).resolves.toMatchObject({
        pendingMigrations: [name],
      });
    },
  );

  it.each(tables)('rejects missing %s without partially dropping the others', async (table) => {
    await rejectsWithoutDropping({
      setup:
        table === 'radar_snapshots'
          ? 'DROP TABLE radar_snapshot_signals; DROP TABLE radar_snapshots'
          : `DROP TABLE ${quote(table)}`,
      error: { code: '42P01' },
    });
  });

  it.each(tables)('rejects a dependent view on %s without CASCADE', async (table) => {
    await rejectsWithoutDropping({
      setup: `CREATE VIEW retirement_dependent_view AS SELECT * FROM ${quote(table)}`,
      error: { code: '2BP01' },
      check: async () => {
        await expect(
          client.query('SELECT * FROM retirement_dependent_view'),
        ).resolves.toMatchObject({
          rowCount: 0,
        });
      },
    });
  });

  it('preserves an external referencing table and its FK on refusal', async () => {
    await rejectsWithoutDropping({
      setup: 'CREATE TABLE retirement_dependent_fk (id text REFERENCES content_registry(id))',
      error: { code: '2BP01' },
      check: async () => {
        expect(
          (
            await client.query(
              "SELECT count(*)::int AS count FROM pg_constraint WHERE conrelid='retirement_dependent_fk'::regclass AND contype='f'",
            )
          ).rows[0].count,
        ).toBe(1);
      },
    });
  });

  it.each([
    ['unlogged table', 'ALTER TABLE content_registry SET UNLOGGED'],
    ['RLS table', 'ALTER TABLE content_registry ENABLE ROW LEVEL SECURITY'],
    ['forced-RLS table', 'ALTER TABLE content_registry FORCE ROW LEVEL SECURITY'],
    ['policy', 'CREATE POLICY retirement_policy ON content_registry USING (true)'],
    [
      'user trigger',
      `CREATE FUNCTION retirement_trigger() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END $$;
      CREATE TRIGGER retirement_trigger BEFORE UPDATE ON content_registry FOR EACH ROW EXECUTE FUNCTION retirement_trigger()`,
    ],
    [
      'rewrite rule',
      'CREATE RULE retirement_rule AS ON UPDATE TO content_registry DO ALSO NOTHING',
    ],
    ['inheritance child', 'CREATE TABLE retirement_child () INHERITS (content_registry)'],
  ])('rejects an unexpected %s instead of bypassing its data visibility', async (_, setup) => {
    await rejectsWithoutDropping({
      setup,
      error: { message: 'unused-table-retirement-unsafe-table: content_registry' },
    });
  });

  const entityFixture = `INSERT INTO entities(id,type,name) VALUES ('retirement-entity','company','Keep entity');
    INSERT INTO topics(id,title) VALUES ('retirement-topic','Keep topic');`;
  const radarFixture = `INSERT INTO topics(id,title) VALUES ('retirement-topic','Keep topic');
    INSERT INTO radar_snapshots(id,topic_id,snapshot_date,attention,trend,maturity,strategic_value,confidence,domain,reasoning)
    VALUES ('retirement-radar','retirement-topic','2026-10-09',50,'stable','research','low',0.5,'security','Historical fixture');`;
  it.each([
    [
      'content_registry',
      "INSERT INTO content_registry(id,content_type,path,status) VALUES ('keep','insight','keep.md','draft')",
    ],
    [
      'entity_topics',
      `${entityFixture} INSERT INTO entity_topics(entity_id,topic_id) VALUES ('retirement-entity','retirement-topic')`,
    ],
    ['radar_snapshots', radarFixture],
    [
      'radar_snapshot_signals',
      `${radarFixture}
      INSERT INTO sources(id,name,type,trust_score,allowed_hosts) VALUES ('retirement-source','Source','website',50,ARRAY['example.com']);
      INSERT INTO signals(id,title,type,occurred_at,source_id,source_url,summary,importance,strength,confidence,novelty)
      VALUES ('retirement-signal','Keep signal','research','2026-10-09','retirement-source','https://example.com/test','Keep summary',3,3,0.5,0.5);
      INSERT INTO radar_snapshot_signals(snapshot_id,signal_id,position) VALUES ('retirement-radar','retirement-signal',0);`,
    ],
  ])('never discards rows from %s', async (table, setup) => {
    await rejectsWithoutDropping({
      setup,
      error: { message: `unused-table-retirement-nonempty: ${table}` },
      check: async () => {
        expect(
          (await client.query(`SELECT count(*)::int AS count FROM ${quote(table)}`)).rows[0].count,
        ).toBe(1);
      },
    });
  });

  it.each(tables)('takes ACCESS EXCLUSIVE locks before retiring %s', async (table) => {
    const holder = new pg.Client({ connectionString });
    await holder.connect();
    const original = await catalog();
    try {
      await holder.query('BEGIN');
      // ACCESS SHARE conflicts only with ACCESS EXCLUSIVE, not weaker locks.
      await holder.query(`SELECT * FROM ${quote(table)} LIMIT 0`);
      await client.query("BEGIN; SET LOCAL lock_timeout = '100ms'");
      await expect(client.query(retirementSql)).rejects.toMatchObject({ code: '55P03' });
    } finally {
      await client.query('ROLLBACK');
      await holder.query('ROLLBACK');
      await holder.end();
    }
    expect(await catalog()).toEqual(original);
  });

  it('does not write the migration ledger when a committed nonempty table blocks retirement', async () => {
    const history = await ledger();
    const original = await catalog();
    await client.query(
      "INSERT INTO content_registry(id,content_type,path,status) VALUES ('keep','insight','keep.md','draft')",
    );
    try {
      await expect(runMigrations(migrationOptions())).rejects.toThrow(
        'unused-table-retirement-nonempty: content_registry',
      );
      expect(await ledger()).toEqual(history);
      expect(await catalog()).toEqual(original);
      expect((await client.query('SELECT id FROM content_registry')).rows).toEqual([
        { id: 'keep' },
      ]);
    } finally {
      await client.query("DELETE FROM content_registry WHERE id='keep'");
    }
  });

  it('retires only the four empty tables, verifies 58 remaining tables and reruns idempotently', async () => {
    await client.query(
      "INSERT INTO topics(id,title) VALUES ('retirement-keep-topic','Retained topic')",
    );
    await runMigrations(migrationOptions());
    const history = await ledger();
    expect(history).toHaveLength(noVector ? 31 : 32);
    expect(history.at(-1).name).toBe(name);
    expect(await catalog()).toEqual([]);
    expect(
      (await client.query("SELECT title FROM topics WHERE id='retirement-keep-topic'")).rows,
    ).toEqual([{ title: 'Retained topic' }]);
    if (!noVector) {
      await expect(verifyDatabaseContract(options())).resolves.toMatchObject({
        migrationCount: 32,
        tableCount: expectedTableNames.size,
      });
      await expect(runDatabasePreflight(options())).resolves.toMatchObject({
        pendingMigrations: [],
      });
    }
    expect(
      (await client.query("SELECT count(*)::int AS count FROM pg_tables WHERE schemaname='public'"))
        .rows[0].count,
    ).toBe(58);
    expect(expectedTableNames.size).toBe(58);
    await runMigrations(migrationOptions());
    expect(await ledger()).toEqual(history);
  }, 30_000);

  it.skipIf(noVector)(
    'rejects a retired table recreated after the migration ledger is current',
    async () => {
      await client.query('CREATE TABLE public.content_registry(id text PRIMARY KEY)');
      try {
        await expect(runDatabasePreflight(options())).rejects.toThrow(
          'Dedicated database contains unexpected public tables: content_registry',
        );
      } finally {
        await client.query('DROP TABLE public.content_registry');
      }
      await expect(runDatabasePreflight(options())).resolves.toMatchObject({
        pendingMigrations: [],
      });
    },
  );
});
