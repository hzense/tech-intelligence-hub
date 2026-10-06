import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath, URL } from 'node:url';
import process from 'node:process';
import pg from 'pg';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { validateConnectionTarget } from '../src/connection-policy.mjs';
import { loadSeedCatalog } from '../../content/src/seed.ts';
import { projectLegacySignalEntries } from '../../../apps/web/lib/legacy-signal-projection.ts';
import {
  applyLegacySignalArchive,
  buildLegacySignalArchivePlan,
} from '../src/legacy-signal-archive.mjs';
import { buildUnifiedSignalPlan } from '../src/unified-signal-plan.mjs';
import { inspectUnifiedSignalMigration } from '../src/unified-signal-preflight.mjs';
import { unifiedStorageChecks } from '../src/unified-signal-storage-catalog.mjs';
import { canonicalPublicationControlCheck } from '../src/signal-publication-control-catalog.mjs';
import { collectSignalImmutabilityProblems } from '../src/signal-immutability-catalog.mjs';

const adminUrl = process.env.MIGRATION_TEST_ADMIN_URL;
if (adminUrl) validateConnectionTarget({ connectionString: adminUrl, profile: 'local-test' });
const suite = adminUrl ? describe.sequential : describe.skip;
const noVector = process.env.HZENSE_UNIFIED_NO_VECTOR === '1';
if (noVector && process.env.CI) throw new Error('CI must test the complete pgvector schema');

suite('unified Signal additive PostgreSQL storage', () => {
  const suffix = `${process.pid}_${Date.now()}`;
  const database = `hzense_unified_${suffix}`;
  const outsider = `hzense_unified_outsider_${suffix}`;
  let admin,
    client,
    fixture,
    archivePlan,
    oldVersion,
    oldMaster,
    oldSeal,
    created = false,
    roleCreated = false;
  const directory = new URL('../../../db/migrations/', import.meta.url);
  async function transaction(callback) {
    await client.query('BEGIN');
    try {
      return await callback();
    } finally {
      await client.query('ROLLBACK');
    }
  }
  async function master(id, latest = 1) {
    return client.query(
      `INSERT INTO signals(id,storage_schema,origin,latest_version,status,captured_at,metadata)
      VALUES($1,'4.0.0','legacy_seed',$2,NULL,NULL,NULL)`,
      [id, latest],
    );
  }
  async function version(id, number = 1, overrides = {}) {
    const row = { ...fixture, signal_id: id, version: number, ...overrides };
    return client.query(
      `INSERT INTO signal_versions(signal_id,version,schema_version,origin,
      content,publication_basis,lifecycle_status,recorded_at,source_record,source_record_hash,
      content_hash,revision_reason)
      VALUES($1,$2,$3,$4,$5::jsonb,$6,$7,$8,$9::jsonb,$10,$11,'Unified fixture import')`,
      [
        row.signal_id,
        row.version,
        row.schema_version,
        row.origin,
        JSON.stringify(row.content),
        row.publication_basis,
        row.status,
        row.recorded_at,
        JSON.stringify(row.source_record),
        row.source_record_hash,
        row.content_hash,
      ],
    );
  }
  beforeAll(async () => {
    admin = new pg.Client({ connectionString: adminUrl });
    await admin.connect();
    await admin.query(`CREATE DATABASE "${database}" TEMPLATE template0`);
    created = true;
    const url = new URL(adminUrl);
    url.pathname = `/${database}`;
    client = new pg.Client({ connectionString: url.toString() });
    await client.connect();
    await client.query("SET timezone='UTC'");
    for (const name of (await readdir(directory))
      .filter((name) => /^00\d\d_.*\.sql$/.test(name) && name < '0029')
      .sort()) {
      if (noVector && name.startsWith('0003_')) continue;
      let sql = await readFile(new URL(name, directory), 'utf8');
      // Local-only structural fixture; not a full FTS/vector verification. CI
      // never takes this branch and applies every original migration verbatim.
      if (noVector && name.startsWith('0000_'))
        sql = sql
          .replace('CREATE EXTENSION IF NOT EXISTS vector;', '')
          .replace('embedding vector(1536)', 'embedding text');
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    }
    await client.query(`BEGIN;
      INSERT INTO sources(id,name,type,trust_score,allowed_hosts) VALUES('old-source','Fixture','website',80,ARRAY['example.com']);
      INSERT INTO topics(id,title) VALUES('old-topic','Fixture topic');
      INSERT INTO signals(id,title,type,occurred_at,captured_at,source_id,source_url,summary,importance,strength,confidence,novelty)
        VALUES('old-signal','Old fixture','research','2026-01-01','2026-01-02','old-source','https://example.com/event','Old summary',3,3,0.8,0.5);
      INSERT INTO signal_versions(signal_id,version,title,type,occurred_at,date_precision,date_basis,captured_at,summary,importance,strength,confidence,novelty,revision_reason,origin,content_hash)
        VALUES('old-signal',1,'Old fixture','research','2026-01-01','day','Original event','2026-01-02','Old summary',3,3,0.8,0.5,'Initial fixture','manual',repeat('a',64));
      COMMIT;`);
    oldVersion = (
      await client.query(
        "SELECT to_jsonb(r) AS row FROM signal_versions r WHERE signal_id='old-signal'",
      )
    ).rows[0].row;
    oldMaster = (
      await client.query("SELECT to_jsonb(r) AS row FROM signals r WHERE id='old-signal'")
    ).rows[0].row;
    oldSeal = (await client.query("SELECT hzense_signal_dependency_seal('old-signal',1) AS seal"))
      .rows[0].seal;
    await client.query('BEGIN');
    await client.query(
      await readFile(new URL('0029_unified_signal_storage.sql', directory), 'utf8'),
    );
    await client.query('COMMIT');
    const catalog = await loadSeedCatalog(
      fileURLToPath(new URL('../../../data/seed/', import.meta.url)),
      fileURLToPath(new URL('../../../data/taxonomy/taxonomy.yaml', import.meta.url)),
    );
    archivePlan = buildLegacySignalArchivePlan(catalog, projectLegacySignalEntries(catalog));
    fixture = buildUnifiedSignalPlan({
      archivePlan,
      editorialRevisions: [],
    }).signal_versions[0];
    await admin.query(`CREATE ROLE "${outsider}" NOLOGIN`);
    roleCreated = true;
    await client.query(
      `GRANT USAGE ON SCHEMA public TO "${outsider}"; GRANT SELECT,INSERT,UPDATE,DELETE ON signals,signal_versions TO "${outsider}"`,
    );
  }, 60_000);
  afterAll(async () => {
    await client?.end();
    if (created) await admin.query(`DROP DATABASE "${database}"`);
    if (roleCreated) await admin.query(`DROP ROLE "${outsider}"`);
    await admin?.end();
  });
  afterEach(async () => {
    await client?.query('ROLLBACK');
  });

  it('previews all real archive rows in a read-only snapshot and flags pre-existing core data', async () => {
    await client.query('BEGIN');
    await applyLegacySignalArchive(client, archivePlan);
    await client.query('COMMIT');
    const result = await inspectUnifiedSignalMigration(client);
    expect(result.summary).toMatchObject({
      status: 'preview_only',
      cutover_ready: false,
      source_counts: { legacy: 110, editorial_revisions: 0 },
      signals: 110,
      versions: 110,
      public_preview: 110,
      existing_core: { signal_count: '1', version_count: '1' },
      lifecycle: { draft: 0, published: 110, withdrawn: 0 },
    });
    expect(result.summary.blockers).toContain('existing_core_signals_require_reconciliation');
    expect(result.plan.signal_versions[0].recorded_at).toBeNull();
    expect((await client.query('SHOW transaction_read_only')).rows[0].transaction_read_only).toBe(
      'off',
    );
  });

  it('matches reviewed constraints, triggers and function bodies exactly', async () => {
    for (const [table, forms] of Object.entries(unifiedStorageChecks)) {
      const rows = (
        await client.query(
          "SELECT pg_get_constraintdef(oid,false) AS definition FROM pg_constraint WHERE conrelid=$1::regclass AND contype='c'",
          [`public.${table}`],
        )
      ).rows;
      const actual = rows.map((row) => canonicalPublicationControlCheck(row.definition));
      expect(actual).toHaveLength(forms.length);
      for (const alternatives of forms)
        expect(actual.some((value) => alternatives.includes(value))).toBe(true);
    }
    const owner = (await client.query('SELECT current_user AS name')).rows[0].name;
    expect(await collectSignalImmutabilityProblems(client, owner)).toEqual([]);
  });
  it('detects disabled guards rather than accepting the table shape alone', async () => {
    await transaction(async () => {
      await client.query('ALTER TABLE signals DISABLE TRIGGER signals_unified_head_trg');
      const owner = (await client.query('SELECT current_user AS name')).rows[0].name;
      expect(
        (await collectSignalImmutabilityProblems(client, owner)).some((problem) =>
          problem.includes('signals_unified_head_trg'),
        ),
      ).toBe(true);
    });
  });
  it('preserves every old column and exact dependency-seal JSON after additive migration', async () => {
    expect(
      (
        await client.query(
          "SELECT to_jsonb(r)-ARRAY['content','publication_basis','lifecycle_status','recorded_at','source_record','source_record_hash'] AS row FROM signal_versions r WHERE signal_id='old-signal'",
        )
      ).rows[0].row,
    ).toEqual(oldVersion);
    expect(
      (
        await client.query(
          "SELECT to_jsonb(r)-ARRAY['storage_schema','origin','latest_version'] AS row FROM signals r WHERE id='old-signal'",
        )
      ).rows[0].row,
    ).toEqual(oldMaster);
    expect(
      (await client.query("SELECT hzense_signal_dependency_seal('old-signal',1) AS seal")).rows[0]
        .seal,
    ).toEqual(oldSeal);
  });
  it('allows the owner to atomically store the real archive contract without public exposure', async () => {
    await client.query('BEGIN');
    await master('unified-committed');
    await version('unified-committed');
    await client.query('COMMIT');
    const row = (
      await client.query(
        "SELECT content,lifecycle_status FROM signal_versions WHERE signal_id='unified-committed'",
      )
    ).rows[0];
    expect(row).toEqual({ content: fixture.content, lifecycle_status: fixture.status });
    expect(
      (
        await client.query(
          "SELECT count(*)::int AS count FROM current_public_signals WHERE signal_id='unified-committed'",
        )
      ).rows[0].count,
    ).toBe(0);
  });
  it.each([
    "UPDATE signal_versions SET revision_reason='changed' WHERE signal_id='unified-committed'",
    "DELETE FROM signal_versions WHERE signal_id='unified-committed'",
    'TRUNCATE signal_versions CASCADE',
  ])('retains committed snapshot immutability: %s', async (sql) => {
    await expect(client.query(sql)).rejects.toMatchObject({ code: '55000' });
  });
  it.each([
    [1, []],
    [2, [1]],
    [2, [2]],
    [1, [1, 2]],
  ])('requires a complete latest head %s / %j', async (latest, versions) => {
    await transaction(async () => {
      await master('incomplete-head', latest);
      for (const n of versions) await version('incomplete-head', n);
      await expect(client.query('SET CONSTRAINTS ALL IMMEDIATE')).rejects.toMatchObject({
        code: expect.stringMatching(/^235(03|14)$/),
      });
    });
  });
  it('allows a complete two-version history but rejects changing storage identity', async () => {
    await transaction(async () => {
      await master('complete-head', 2);
      await version('complete-head', 1);
      await version('complete-head', 2);
      await client.query('SET CONSTRAINTS ALL IMMEDIATE');
      await expect(
        client.query("UPDATE signals SET origin='ai_generation' WHERE id='complete-head'"),
      ).rejects.toMatchObject({ code: '55000' });
    });
  });
  it('blocks a non-owner even when explicit INSERT privileges exist', async () => {
    await transaction(async () => {
      await client.query(`SET LOCAL ROLE "${outsider}"`);
      await expect(master('outsider-master')).rejects.toMatchObject({ code: '42501' });
    });
    await transaction(async () => {
      await master('outsider-version');
      await client.query(`SET LOCAL ROLE "${outsider}"`);
      await expect(version('outsider-version')).rejects.toMatchObject({ code: '42501' });
    });
  });
  it.each([
    'title',
    'type',
    'occurred_at',
    'captured_at',
    'summary',
    'importance',
    'strength',
    'confidence',
    'novelty',
  ])('preserves legacy required master field %s', async (column) => {
    await expect(
      client.query(`UPDATE signals SET ${column}=NULL WHERE id='old-signal'`),
    ).rejects.toMatchObject({ code: '23514' });
  });
  it('rejects a unified version under a legacy master', async () => {
    await expect(version('old-signal', 2)).rejects.toMatchObject({ code: '23514' });
  });
  it.each([
    'title',
    'type',
    'occurred_at',
    'date_precision',
    'date_basis',
    'captured_at',
    'summary',
    'importance',
    'strength',
    'confidence',
    'novelty',
  ])('preserves legacy required snapshot field %s', async (column) => {
    await transaction(async () => {
      await client.query(`INSERT INTO signal_versions(signal_id,version,title,type,occurred_at,date_precision,date_basis,captured_at,summary,importance,strength,confidence,novelty,revision_reason,origin,content_hash)
          VALUES('old-signal',2,'Fixture','research','2026-01-01','day','Original date','2026-01-02','Summary',3,3,0.8,0.5,'Second fixture','manual',repeat('b',64))`);
      await expect(
        client.query(
          `UPDATE signal_versions SET ${column}=NULL WHERE signal_id='old-signal' AND version=2`,
        ),
      ).rejects.toMatchObject({ code: '23514' });
    });
  });
  it('does not allow a unified snapshot to enter a legacy publication state', async () => {
    await transaction(async () => {
      await master('no-publication');
      await version('no-publication');
      await expect(
        client.query("INSERT INTO signal_publication_state(signal_id) VALUES('no-publication')"),
      ).rejects.toMatchObject({ code: '23514' });
    });
  });
  it('rejects a legacy version under a unified master', async () => {
    await transaction(async () => {
      await master('cross-schema');
      await expect(
        client.query(`INSERT INTO signal_versions(signal_id,version,title,type,occurred_at,date_precision,date_basis,captured_at,summary,importance,strength,confidence,novelty,revision_reason,origin,content_hash)
        VALUES('cross-schema',1,'Fixture','research','2026-01-01','day','Original date','2026-01-02','Summary',3,3,0.8,0.5,'Initial fixture','manual',repeat('a',64))`),
      ).rejects.toMatchObject({ code: '23514' });
    });
  });
  it.each(['signal_topics', 'signal_version_topics'])(
    'blocks unified records from legacy edges %s',
    async (table) => {
      await transaction(async () => {
        await master('no-old-edge');
        await version('no-old-edge');
        const sql =
          table === 'signal_topics'
            ? "INSERT INTO signal_topics(signal_id,topic_id) VALUES('no-old-edge','old-topic')"
            : "INSERT INTO signal_version_topics(signal_id,version,topic_id) VALUES('no-old-edge',1,'old-topic')";
        await expect(client.query(sql)).rejects.toMatchObject({ code: '23514' });
      });
    },
  );
  it.each([
    { content: {} },
    { content: { title: 'missing envelope' } },
    { content: null },
    { source_record: { table: 'wrong', key: 'x' } },
    { publication_basis: 'manual_confirmation' },
    { status: null },
  ])('fails closed on malformed unified storage metadata %j', async (overrides) => {
    await transaction(async () => {
      await master('bad-envelope');
      await expect(version('bad-envelope', 1, overrides)).rejects.toMatchObject({ code: '23514' });
    });
  });
});
