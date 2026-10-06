import { readFile, readdir } from 'node:fs/promises';
import { URL } from 'node:url';
import process from 'node:process';
import pg from 'pg';
import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { validateConnectionTarget } from '../src/connection-policy.mjs';
import { applyLegacySignalArchive } from '../src/legacy-signal-archive.mjs';
import { inspectUnifiedSignalMigration } from '../src/unified-signal-preflight.mjs';
import {
  applyUnifiedSignalBackfill,
  verifyUnifiedSignalBackfill,
} from '../src/unified-signal-backfill.mjs';
import { unifiedBackfillFixture } from './fixtures/unified-signal-backfill.mjs';

const adminUrl = process.env.MIGRATION_TEST_ADMIN_URL;
if (adminUrl) validateConnectionTarget({ connectionString: adminUrl, profile: 'local-test' });
const suite = adminUrl ? describe.sequential : describe.skip;
const noVector = process.env.HZENSE_UNIFIED_NO_VECTOR === '1';
if (noVector && process.env.CI) throw new Error('CI must test complete pgvector migrations');

suite('unified Signal backfill in isolated PostgreSQL', () => {
  const database = `hzense_backfill_${process.pid}_${Date.now()}`;
  let admin,
    client,
    connectionString,
    fixture,
    expectedPlanHash,
    created = false;
  const gate = async () => {};
  const request = (checkBeforeCommit = gate) => ({ expectedPlanHash, checkBeforeCommit });
  const count = async () =>
    (await client.query('SELECT count(*)::int AS n FROM public.signals')).rows[0].n;
  const freshClient = async () => {
    const result = new pg.Client({ connectionString });
    await result.connect();
    return result;
  };
  beforeAll(async () => {
    admin = new pg.Client({ connectionString: adminUrl });
    await admin.connect();
    await admin.query(`CREATE DATABASE "${database}" TEMPLATE template0`);
    created = true;
    const url = new URL(adminUrl);
    url.pathname = `/${database}`;
    connectionString = url.toString();
    client = await freshClient();
    const directory = new URL('../../../db/migrations/', import.meta.url);
    for (const name of (await readdir(directory))
      .filter((name) => /^00\d\d_.*\.sql$/.test(name))
      .sort()) {
      if (noVector && name.startsWith('0003_')) continue;
      let sql = await readFile(new URL(name, directory), 'utf8');
      // Same local-only structural fixture as the 0029 suite. CI never uses it.
      if (noVector && name.startsWith('0000_'))
        sql = sql
          .replace('CREATE EXTENSION IF NOT EXISTS vector;', '')
          .replace('embedding vector(1536)', 'embedding text');
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('COMMIT');
    }
    fixture = await unifiedBackfillFixture();
    await client.query('BEGIN');
    await applyLegacySignalArchive(client, fixture.sources.archivePlan);
    const run = fixture.sources.editorialRevisions[0];
    await client.query(
      `INSERT INTO public.signal_generation_runs
      (id,owner_id,batch_id,item_id,source_fence,source_hash,profile_id,profile_revision,
       generation_version,fingerprint,snapshot,configuration,status,result)
      VALUES($1,$2,$1,$1,1,$3,$1,1,'test',$3,'{}','{}','completed','{"classification":"private"}')`,
      [run.run_id, run.owner_id, 'a'.repeat(64)],
    );
    for (const row of fixture.sources.editorialRevisions)
      await client.query(
        `INSERT INTO public.editorial_signal_revisions
        (request_id,run_id,owner_id,candidate_index,revision,material_hash,action,content,request_hash,created_at)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [
          row.request_id,
          row.run_id,
          row.owner_id,
          row.candidate_index,
          row.revision,
          row.material_hash,
          row.action,
          row.content,
          row.request_hash,
          row.created_at,
        ],
      );
    await client.query('COMMIT');
    expectedPlanHash = (await inspectUnifiedSignalMigration(client)).summary.plan_hash;
    expect(expectedPlanHash).toBe(fixture.plan.plan_hash);
  }, 60_000);
  afterAll(async () => {
    await client?.end();
    if (created) await admin.query(`DROP DATABASE "${database}"`);
    await admin?.end();
  });

  it('refuses verification of an empty target', async () => {
    await expect(verifyUnifiedSignalBackfill(client, request())).rejects.toMatchObject({
      code: 'unified_backfill_incomplete',
    });
    expect(await count()).toBe(0);
  });
  it('refuses a stale approved plan before writing', async () => {
    await expect(
      applyUnifiedSignalBackfill(client, { ...request(), expectedPlanHash: 'f'.repeat(64) }),
    ).rejects.toMatchObject({ code: 'unified_backfill_plan_changed' });
    expect(await count()).toBe(0);
  });
  it('rolls back the whole 114/120-row backfill if the final gate fails', async () => {
    await expect(
      applyUnifiedSignalBackfill(
        client,
        request(async () => {
          throw new Error('expired');
        }),
      ),
    ).rejects.toMatchObject({ phase: 'authorization', mayHaveCommitted: false });
    expect(await count()).toBe(0);
    expect(
      (await client.query('SELECT count(*)::int AS n FROM public.signal_versions')).rows[0].n,
    ).toBe(0);
    expect(
      (await client.query('SELECT count(*)::int AS n FROM public.editorial_signal_revisions'))
        .rows[0].n,
    ).toBe(10);
  });
  it('locks source writers, commits all history and retains the two withdrawn heads', async () => {
    const observer = await freshClient();
    try {
      const result = await applyUnifiedSignalBackfill(
        client,
        request(async () => {
          // Public reads are not locked out; uncommitted core rows remain invisible.
          expect(
            (await observer.query('SELECT count(*)::int AS n FROM public.signals')).rows[0].n,
          ).toBe(0);
          expect(
            (await observer.query('SELECT count(*)::int AS n FROM public.editorial_public_signals'))
              .rows[0].n,
          ).toBe(2);
          await observer.query('BEGIN');
          await observer.query("SET LOCAL lock_timeout='100ms'");
          await expect(
            observer.query('LOCK TABLE public.editorial_signal_revisions IN ROW EXCLUSIVE MODE'),
          ).rejects.toMatchObject({ code: '55P03' });
          await observer.query('ROLLBACK');
        }),
      );
      expect(result).toMatchObject({
        signalCount: 114,
        versionCount: 120,
        publicCount: 112,
        inserted: 114,
        committed: true,
        cutoverReady: false,
      });
      expect(
        (
          await observer.query(
            `SELECT lifecycle_status,count(*)::int AS n FROM public.signals s JOIN public.signal_versions v ON v.signal_id=s.id AND v.version=s.latest_version GROUP BY lifecycle_status ORDER BY lifecycle_status`,
          )
        ).rows,
      ).toEqual([
        { lifecycle_status: 'published', n: 112 },
        { lifecycle_status: 'withdrawn', n: 2 },
      ]);
      // Existing public view is unchanged, not secretly switched by backfill.
      expect(
        (await observer.query('SELECT count(*)::int AS n FROM public.current_public_signals'))
          .rows[0].n,
      ).toBe(0);
    } finally {
      await observer.query('ROLLBACK');
      await observer.end();
    }
  });
  it('independently verifies exact content, microsecond times and source references', async () => {
    const verifier = await freshClient();
    try {
      expect(await verifyUnifiedSignalBackfill(verifier, request())).toMatchObject({
        verificationCompleted: true,
        signalCount: 114,
        versionCount: 120,
        publicCount: 112,
        planFingerprint: expectedPlanHash,
        cutoverReady: false,
      });
      const times = (
        await verifier.query(
          "SELECT to_char(recorded_at AT TIME ZONE 'UTC','US') AS micros FROM public.signal_versions WHERE origin='ai_generation'",
        )
      ).rows;
      expect(times).toHaveLength(10);
      expect(times.every((r) => r.micros === '123456')).toBe(true);
    } finally {
      await verifier.end();
    }
  });
  it('performs no second import when the complete target already matches', async () => {
    expect(await applyUnifiedSignalBackfill(client, request())).toMatchObject({
      alreadyPresent: true,
      inserted: 0,
      committed: false,
    });
    expect(await count()).toBe(114);
  });
  it('retains committed-version immutability and complete-head constraints', async () => {
    await expect(
      client.query(
        "UPDATE public.signal_versions SET content=jsonb_set(content,'{title}','\"tampered\"') WHERE signal_id=$1",
        [fixture.plan.signals[0].id],
      ),
    ).rejects.toMatchObject({ code: '55000' });
    await expect(
      client.query('UPDATE public.signals SET latest_version=latest_version+1 WHERE id=$1', [
        fixture.plan.signals[0].id,
      ]),
    ).rejects.toMatchObject({ code: '23503' });
    expect(await count()).toBe(114);
  });
  it('requires a new plan if the old source changes after commit; it never silently repairs the copy', async () => {
    const previous = fixture.sources.editorialRevisions[0];
    await client.query(
      `INSERT INTO public.editorial_signal_revisions
      (request_id,run_id,owner_id,candidate_index,revision,material_hash,action,content,request_hash)
      VALUES('00000000-0000-0000-0000-000000000099',$1,$2,0,2,$3,'withdraw',$4,$3)`,
      [previous.run_id, previous.owner_id, 'c'.repeat(64), previous.content],
    );
    await expect(verifyUnifiedSignalBackfill(client, request())).rejects.toMatchObject({
      code: 'unified_backfill_plan_changed',
    });
    expect(await count()).toBe(114);
  });
});
