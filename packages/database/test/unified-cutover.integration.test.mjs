import { readFile, readdir } from 'node:fs/promises';
import { URL } from 'node:url';
import process from 'node:process';
import pg from 'pg';
import { beforeAll, afterAll, it, describe, expect } from 'vitest';
import { validateConnectionTarget } from '../src/connection-policy.mjs';
import { applyLegacySignalArchive } from '../src/legacy-signal-archive.mjs';
import {
  applyUnifiedSignalBackfill,
  verifyUnifiedSignalBackfill,
} from '../src/unified-signal-backfill.mjs';
import { inspectUnifiedSignalMigration } from '../src/unified-signal-preflight.mjs';
import { editorialUnifiedContent } from '../src/unified-signal-plan.mjs';
import { unifiedBackfillFixture } from './fixtures/unified-signal-backfill.mjs';
import { mapUnifiedSignalRows } from '../../../apps/web/lib/unified-signal-reader-core.ts';
import { collectSignalImmutabilityProblems } from '../src/signal-immutability-catalog.mjs';
import { saveEditorialSignal } from '../src/editorial-signal-store.mjs';
import { unifiedCutoverChecks } from '../src/unified-cutover-catalog.mjs';
import { canonicalPublicationControlCheck } from '../src/signal-publication-control-catalog.mjs';
import { collectCurrentPublicSignalViewProblems } from '../src/current-publication-view-contract.mjs';
import {
  inspectUnifiedCutoverGrants,
  unifiedCutoverGrantSql,
} from '../../../.github/scripts/unified-signal-apply.mjs';
const url = process.env.MIGRATION_TEST_ADMIN_URL;
if (url) validateConnectionTarget({ connectionString: url, profile: 'local-test' });
const noVector = process.env.HZENSE_UNIFIED_NO_VECTOR === '1';
if (noVector && process.env.CI) throw new Error('CI requires pgvector');
const suite = url ? describe.sequential : describe.skip;
suite('unified cutover writes and public reads', () => {
  const suffix = `${process.pid}_${Date.now()}`;
  const db = `hzense_cutover_${suffix}`,
    role = `hzense_cutover_writer_${suffix}`,
    readerRole = `hzense_cutover_reader_${suffix}`;
  let admin,
    client,
    writer,
    fixture,
    created = false,
    roleCreated = false,
    readerCreated = false;
  beforeAll(async () => {
    admin = new pg.Client({ connectionString: url });
    await admin.connect();
    await admin.query(`CREATE DATABASE "${db}" TEMPLATE template0`);
    created = true;
    const connection = new URL(url);
    connection.pathname = `/${db}`;
    client = new pg.Client({ connectionString: connection.toString() });
    await client.connect();
    const dir = new URL('../../../db/migrations/', import.meta.url);
    for (const name of (await readdir(dir)).filter((n) => /^00\d\d_.*\.sql$/.test(n)).sort()) {
      if (noVector && name.startsWith('0003_')) continue;
      let sql = await readFile(new URL(name, dir), 'utf8');
      if (noVector && name.startsWith('0000_'))
        sql = sql
          .replace('CREATE EXTENSION IF NOT EXISTS vector;', '')
          .replace('embedding vector(1536)', 'embedding text');
      await client.query(sql);
    }
    fixture = await unifiedBackfillFixture();
    await client.query('BEGIN');
    await applyLegacySignalArchive(client, fixture.sources.archivePlan);
    const first = fixture.sources.editorialRevisions[0];
    await client.query(
      `INSERT INTO public.signal_generation_runs(id,owner_id,batch_id,item_id,source_fence,source_hash,profile_id,profile_revision,generation_version,fingerprint,snapshot,configuration,status,result)
    VALUES($1,$2,$1,$1,1,$3,$1,1,'test',$3,'{}','{}','completed','{"classification":"private"}')`,
      [first.run_id, first.owner_id, 'a'.repeat(64)],
    );
    for (const row of fixture.sources.editorialRevisions)
      await client.query(
        `INSERT INTO public.editorial_signal_revisions(request_id,run_id,owner_id,candidate_index,revision,material_hash,action,content,request_hash,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
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
    await admin.query(`CREATE ROLE "${role}" LOGIN`);
    roleCreated = true;
    await admin.query(`CREATE ROLE "${readerRole}" LOGIN`);
    readerCreated = true;
    await client.query(
      `GRANT USAGE ON SCHEMA public TO "${role}","${readerRole}";
      GRANT INSERT(request_id,run_id,owner_id,candidate_index,revision,material_hash,action,content,request_hash,created_at,unified_content), SELECT(request_id,run_id,owner_id,candidate_index,revision,material_hash,action,content,request_hash,created_at) ON public.editorial_signal_revisions TO "${role}"`,
    );
    connection.username = role;
    connection.password = '';
    writer = new pg.Client({ connectionString: connection.toString() });
    await writer.connect();
  }, 60000);
  afterAll(async () => {
    await writer?.end();
    await client?.end();
    if (created) await admin.query(`DROP DATABASE "${db}"`);
    if (roleCreated) await admin.query(`DROP ROLE "${role}"`);
    if (readerCreated) await admin.query(`DROP ROLE "${readerRole}"`);
    await admin?.end();
  });
  const row = () => fixture.sources.editorialRevisions[0];
  async function revision(
    connection,
    {
      id = '00000000-0000-0000-0000-000000000099',
      rev = 2,
      action = 'withdraw',
      unified = true,
    } = {},
  ) {
    const r = row();
    return connection.query(
      `INSERT INTO public.editorial_signal_revisions(request_id,run_id,owner_id,candidate_index,revision,material_hash,action,content,request_hash,unified_content) VALUES($1,$2,$3,0,$4,$5,$6,$7,$5,$8)`,
      [
        id,
        r.run_id,
        r.owner_id,
        rev,
        'c'.repeat(64),
        action,
        r.content,
        unified ? editorialUnifiedContent(r.content) : null,
      ],
    );
  }
  it('starts closed with no public rows and rejects premature unified writes', async () => {
    expect((await client.query('SELECT ready FROM public.unified_public_status')).rows).toEqual([
      { ready: false },
    ]);
    await expect(revision(writer)).rejects.toMatchObject({ code: '55000' });
    await expect(
      client.query('UPDATE public.unified_signal_cutover SET ready=true'),
    ).rejects.toMatchObject({ code: '23514' });
    const checks = await client.query(
      "SELECT pg_get_constraintdef(oid,false) AS expression FROM pg_constraint WHERE conrelid='public.unified_signal_cutover'::regclass AND contype='c'",
    );
    expect(checks.rows.map((r) => canonicalPublicationControlCheck(r.expression)).sort()).toEqual(
      unifiedCutoverChecks.unified_signal_cutover.flat().sort(),
    );
    expect(await collectCurrentPublicSignalViewProblems(client, 'postgres')).toEqual([]);
  });
  it('requires the complete minimal grant and rejects ambient core/control/function authority', async () => {
    const adapt = (sql) =>
      sql
        .replaceAll('hzense_editorial_writer', role)
        .replaceAll('hzense_editorial_reader', readerRole);
    const inspector = { query: (sql) => client.query(adapt(sql)) };
    await expect(inspectUnifiedCutoverGrants(inspector)).rejects.toThrow('minimal-grants-required');
    await client.query(adapt(unifiedCutoverGrantSql));
    await expect(inspectUnifiedCutoverGrants(inspector)).resolves.toBeUndefined();
    for (const [grant, revoke] of [
      [`GRANT DELETE ON signals TO "${role}"`, `REVOKE DELETE ON signals FROM "${role}"`],
      [
        `GRANT SELECT ON unified_signal_cutover TO "${role}"`,
        `REVOKE SELECT ON unified_signal_cutover FROM "${role}"`,
      ],
      [
        `GRANT EXECUTE ON FUNCTION hzense_unified_canonical(jsonb) TO "${readerRole}"`,
        `REVOKE EXECUTE ON FUNCTION hzense_unified_canonical(jsonb) FROM "${readerRole}"`,
      ],
    ]) {
      await client.query(grant);
      await expect(inspectUnifiedCutoverGrants(inspector)).rejects.toThrow(
        'minimal-grants-required',
      );
      await client.query(revoke);
    }
    await expect(inspectUnifiedCutoverGrants(inspector)).resolves.toBeUndefined();
  });
  it('backfills before activation; returns exactly 112 public DTOs', async () => {
    const hash = (await inspectUnifiedSignalMigration(client)).summary.plan_hash;
    expect(hash).toBe(fixture.plan.plan_hash);
    await applyUnifiedSignalBackfill(client, {
      expectedPlanHash: hash,
      checkBeforeCommit: async () => {
        await client.query('UPDATE public.unified_signal_cutover SET ready=true,plan_hash=$1', [
          hash,
        ]);
      },
    });
    const rows = (await client.query('SELECT * FROM public.unified_public_signals')).rows;
    expect(mapUnifiedSignalRows(rows)).toHaveLength(112);
    expect(rows.some((r) => JSON.stringify(r).includes('synthetic-owner'))).toBe(false);
  });
  it('rejects old audit-only writers after activation', async () => {
    await expect(revision(writer, { unified: false })).rejects.toMatchObject({ code: '23514' });
    expect(
      (await client.query('SELECT count(*)::int n FROM public.editorial_signal_revisions')).rows[0]
        .n,
    ).toBe(10);
  });
  it('atomically withdraws using the restricted writer without core table grants', async () => {
    await expect(writer.query('SELECT * FROM public.signal_versions')).rejects.toMatchObject({
      code: '42501',
    });
    await revision(writer);
    expect(
      (await client.query('SELECT count(*)::int n FROM public.unified_public_signals')).rows[0].n,
    ).toBe(111);
    const plan = (await inspectUnifiedSignalMigration(client)).summary.plan_hash;
    expect(await verifyUnifiedSignalBackfill(client, { expectedPlanHash: plan })).toMatchObject({
      verificationCompleted: true,
      publicCount: 111,
    });
  });
  it('re-publishes with matching JS/SQL source and version hashes', async () => {
    await revision(writer, {
      id: '00000000-0000-0000-0000-000000000100',
      rev: 3,
      action: 'publish',
    });
    const plan = (await inspectUnifiedSignalMigration(client)).summary.plan_hash;
    expect(await verifyUnifiedSignalBackfill(client, { expectedPlanHash: plan })).toMatchObject({
      verificationCompleted: true,
      publicCount: 112,
    });
  });
  it('verifies exact trigger bodies, owner context and disabled PUBLIC execute', async () => {
    expect(await collectSignalImmutabilityProblems(client, 'postgres')).toEqual([]);
    await expect(
      writer.query("SELECT public.hzense_unified_canonical('{}')"),
    ).rejects.toMatchObject({ code: '42501' });
  });
  it('preserves application ownership, replay, revision and draft/publish semantics with unified writes', async () => {
    await client.query(`GRANT SELECT(id,owner_id,status,deleted_at) ON public.signal_generation_runs TO "${role}";
      GRANT SELECT(id,title,runtime_enabled,status) ON public.topics TO "${role}";
      INSERT INTO public.topics(id,title,runtime_enabled) VALUES('ai-safety','AI 安全',true);`);
    const r = row();
    const pool = { connect: async () => ({ query: writer.query.bind(writer), release: () => {} }) };
    const request = {
      requestId: '00000000-0000-0000-0000-000000000101',
      runId: r.run_id,
      candidateIndex: 4,
      expectedRevision: 0,
      materialHash: 'a'.repeat(64),
      action: 'draft',
      content: r.content,
      consent: true,
    };
    const material = {
      materialHash: request.materialHash,
      title: r.content.title,
      summary: r.content.summary,
      sourceUrls: r.content.sourceUrls,
    };
    const args = { pool, owner: r.owner_id, request, material, unified: true };
    const draft = await saveEditorialSignal(args);
    expect(draft.revision).toBe(1);
    expect(await saveEditorialSignal(args)).toEqual(draft);
    await expect(saveEditorialSignal({ ...args, owner: 'another-owner' })).rejects.toThrow(
      'not_found',
    );
    await expect(
      saveEditorialSignal({
        ...args,
        request: {
          ...request,
          requestId: '00000000-0000-0000-0000-000000000102',
          action: 'publish',
        },
      }),
    ).rejects.toThrow('revision_conflict');
    expect(
      (await client.query('SELECT count(*)::int n FROM public.unified_public_signals')).rows[0].n,
    ).toBe(112);
    const published = await saveEditorialSignal({
      ...args,
      request: {
        ...request,
        requestId: '00000000-0000-0000-0000-000000000102',
        expectedRevision: 1,
        action: 'publish',
      },
    });
    expect(published.revision).toBe(2);
    const plan = (await inspectUnifiedSignalMigration(client)).summary.plan_hash;
    expect(await verifyUnifiedSignalBackfill(client, { expectedPlanHash: plan })).toMatchObject({
      verificationCompleted: true,
      publicCount: 113,
    });
  });
});
