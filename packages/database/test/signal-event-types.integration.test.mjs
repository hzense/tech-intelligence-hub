import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import { URL } from 'node:url';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { validateConnectionTarget } from '../src/connection-policy.mjs';
import { loadMigrations, runMigrations } from '../src/migrate.mjs';
import { cloneSignalSnapshotForPublication } from '../src/signal-publication-qualification.mjs';
import { expectedTableNames, verifyDatabaseContract } from '../src/verify.mjs';
import { publicSignalSearchQuery } from '../src/public-signal-query.mjs';
import { SIGNAL_EVENT_TYPE_LABELS } from '../../ingestion/src/signal-types.mjs';

const adminUrl = process.env.MIGRATION_TEST_ADMIN_URL;
if (adminUrl) validateConnectionTarget({ connectionString: adminUrl, profile: 'local-test' });
const suite = adminUrl ? describe.sequential : describe.skip;
const suffix = `${process.pid}_${Date.now()}`;
const database = `hzense_event_types_${suffix}`;
const role = `hzense_event_type_owner_${suffix}`;
const password = 'event-types-local-fixture-only';
const migrationName = '0033_signal_event_types.sql';
const migrations = await loadMigrations(
  new URL('../../../db/migrations/', import.meta.url).pathname,
);
const quote = (value) => {
  if (!/^[a-z][a-z0-9_]+$/.test(value)) throw new Error('Unsafe event-type fixture identifier');
  return `"${value}"`;
};

suite('event-type enum expansion preserves historical sealed snapshots', () => {
  let admin, client, directory, connectionString, historical;
  let createdDatabase = false;
  let createdRole = false;
  const options = () => ({
    connectionString,
    profile: 'local-test',
    expectedDatabase: database,
    expectedUser: role,
    expectedPgvectorVersion: '0.8.6',
  });
  const labels = async () =>
    (
      await client.query(
        `SELECT e.enumlabel FROM pg_catalog.pg_enum e
         JOIN pg_catalog.pg_type t ON t.oid=e.enumtypid
         JOIN pg_catalog.pg_namespace n ON n.oid=t.typnamespace
         WHERE n.nspname='public' AND t.typname='signal_type' ORDER BY e.enumsortorder`,
      )
    ).rows.map((row) => row.enumlabel);
  const storedSnapshot = async (id) =>
    (
      await client.query(
        'SELECT to_jsonb(v) AS snapshot FROM public.signal_versions v WHERE signal_id=$1 AND version=1',
        [id],
      )
    ).rows[0].snapshot;
  async function insertSnapshot(type) {
    const signalId = `event-types-${type}`;
    const content = {
      signal_id: signalId,
      version: 1,
      schema_version: '3.0.0',
      title: 'Event-type fixture',
      type,
      occurred_at: '2026-11-01T00:00:00.000Z',
      date_precision: 'day',
      date_basis: 'Fixture date',
      captured_at: '2026-11-02T00:00:00.000Z',
      summary: 'Fixture summary',
      analysis: null,
      importance: 3,
      strength: 3,
      confidence: 0.8,
      novelty: 0.6,
      revision_reason: 'Fixture snapshot',
      origin: 'manual',
      legacy_status: null,
    };
    const snapshot = {
      ...content,
      content_hash: createHash('sha256').update(JSON.stringify(content)).digest('hex'),
    };
    // Verify the fixture is an authentic canonical 3.0 snapshot, not an arbitrary digest.
    expect(cloneSignalSnapshotForPublication(snapshot, 2).type).toBe(type);
    await client.query(
      `INSERT INTO public.signals(id,title,type,occurred_at,captured_at,source_id,source_url,
       summary,importance,strength,confidence,novelty)
       VALUES($1,$2,$3,$4,$5,'event-types-source','https://example.com/event',$6,3,3,0.8,0.6)`,
      [signalId, content.title, type, content.occurred_at, content.captured_at, content.summary],
    );
    const keys = Object.keys(snapshot);
    await client.query(
      `INSERT INTO public.signal_versions(${keys.join(',')}) VALUES(${keys.map((_, i) => `$${i + 1}`).join(',')})`,
      Object.values(snapshot),
    );
    return storedSnapshot(signalId);
  }

  beforeAll(async () => {
    admin = new pg.Client({ connectionString: adminUrl });
    await admin.connect();
    await admin.query(
      `CREATE ROLE ${quote(role)} LOGIN PASSWORD '${password}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`,
    );
    createdRole = true;
    await admin.query(`CREATE DATABASE ${quote(database)} OWNER ${quote(role)}`);
    createdDatabase = true;
    const target = new URL(adminUrl);
    target.pathname = `/${database}`;
    const setup = new pg.Client({ connectionString: target.toString() });
    await setup.connect();
    try {
      await setup.query('CREATE EXTENSION vector; REVOKE CREATE ON SCHEMA public FROM PUBLIC');
    } finally {
      await setup.end();
    }
    target.username = role;
    target.password = password;
    connectionString = target.toString();
    directory = await mkdtemp(join(tmpdir(), 'hzense-event-types-migrations-'));
    await Promise.all(
      migrations
        .filter((migration) => migration.name < migrationName)
        .map((migration) => writeFile(join(directory, migration.name), migration.sql)),
    );
    await runMigrations({ connectionString, directory });
    client = new pg.Client({ connectionString });
    await client.connect();
    await client.query(
      `INSERT INTO public.sources(id,name,type,trust_score,allowed_hosts)
       VALUES('event-types-source','Fixture source','website',80,ARRAY['example.com'])`,
    );
    historical = await insertSnapshot('security');
  }, 60_000);

  afterAll(async () => {
    await client?.end();
    if (createdDatabase) await admin.query(`DROP DATABASE ${quote(database)}`);
    if (createdRole) await admin.query(`DROP ROLE ${quote(role)}`);
    await admin?.end();
    if (directory) await rm(directory, { recursive: true, force: true });
  }, 30_000);

  it('upgrades the original 15 labels without rewriting any old snapshot field or hash', async () => {
    const previous = await labels();
    expect(previous).toHaveLength(15);
    expect(previous).toContain('security');
    await expect(verifyDatabaseContract(options())).rejects.toThrow(
      'Database contract verification failed',
    );
    await runMigrations({ connectionString });
    expect(await labels()).toEqual([...previous, 'disclosure', 'operations', 'incident']);
    expect(await storedSnapshot('event-types-security')).toEqual(historical);
    await expect(
      client.query(
        "UPDATE public.signal_versions SET type='research' WHERE signal_id='event-types-security'",
      ),
    ).rejects.toMatchObject({ code: '55000' });
    expect(await storedSnapshot('event-types-security')).toEqual(historical);
  });

  it.each(['disclosure', 'operations', 'incident'])(
    'stores committed %s enum values',
    async (type) => {
      const saved = await insertSnapshot(type);
      expect(saved.type).toBe(type);
      expect(saved.content_hash).toMatch(/^[a-f0-9]{64}$/);
      expect(
        (await client.query('SELECT type FROM public.signals WHERE id=$1', [`event-types-${type}`]))
          .rows,
      ).toEqual([{ type }]);
    },
  );

  it('searches all 13 event labels in SQL without restoring retired domain keywords', async () => {
    // Existing publication integration covers the real view's qualification gate.
    // Use its exact row types here to isolate enum/JSONB/NFKC search semantics.
    await client.query(
      'CREATE TEMP TABLE event_type_search_fixture AS SELECT * FROM public.current_public_signals WITH NO DATA',
    );
    try {
      const keywords = Object.fromEntries(
        Object.entries(SIGNAL_EVENT_TYPE_LABELS).map(([type, label]) => [type, `${type} ${label}`]),
      );
      for (const type of [...Object.keys(SIGNAL_EVENT_TYPE_LABELS), 'security'])
        await client.query(
          `INSERT INTO event_type_search_fixture(signal_id,version,publication_revision,title,type,
           occurred_at,captured_at,summary,importance,topics,people,organizations,sources)
           VALUES($1,1,1,'Ｆｉｘｔｕｒｅ',$2,'2026-11-01','2026-11-02','Synthetic summary',3,'[]','[]','[]','[]')`,
          [`query-${type}`, type],
        );
      const query = publicSignalSearchQuery.replace(
        'FROM public.current_public_signals',
        'FROM pg_temp.event_type_search_fixture',
      );
      for (const [type, label] of Object.entries(SIGNAL_EVENT_TYPE_LABELS)) {
        for (const term of [type, label]) {
          const { rows } = await client.query(query, [['fixture', term], 100, keywords]);
          expect(rows.map((row) => row.signal_id)).toEqual([`query-${type}`]);
        }
      }
      expect((await client.query(query, [['security'], 100, keywords])).rows).toEqual([]);
      expect((await client.query(query, [['安全事件'], 100, keywords])).rows).toEqual([]);
      // A retired stored value can be preselected using reviewed event labels.
      // Web matching subsequently checks the exact id/title/summary projection.
      const transitionKeywords = {
        ...keywords,
        security: keywords.research,
      };
      expect(
        (
          await client.query(query, [[SIGNAL_EVENT_TYPE_LABELS.research], 100, transitionKeywords])
        ).rows.map((row) => row.signal_id),
      ).toEqual(['query-research', 'query-security']);
      expect((await client.query(query, [['security'], 100, transitionKeywords])).rows).toEqual([]);
      expect(
        (await client.query(query, [['不存在的正文', '建设投产'], 100, keywords])).rows,
      ).toEqual([]);
      expect((await client.query(query, [['fixture'], 100, keywords])).rows).toHaveLength(14);
    } finally {
      await client.query('DROP TABLE pg_temp.event_type_search_fixture');
    }
  });

  it('verifies the full contract and repeats migrations without changing history', async () => {
    await expect(verifyDatabaseContract(options())).resolves.toMatchObject({
      migrationCount: migrations.length,
      tableCount: expectedTableNames.size,
      pgvectorVersion: '0.8.6',
    });
    const before = (
      await client.query('SELECT * FROM public.hzense_schema_migrations ORDER BY name')
    ).rows;
    await runMigrations({ connectionString });
    expect(
      (await client.query('SELECT * FROM public.hzense_schema_migrations ORDER BY name')).rows,
    ).toEqual(before);
    expect(await storedSnapshot('event-types-security')).toEqual(historical);
  });
});
