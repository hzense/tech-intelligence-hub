import { readFile } from 'node:fs/promises';
import process from 'node:process';
import { randomUUID } from 'node:crypto';
import { URL } from 'node:url';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { validateConnectionTarget } from '../src/connection-policy.mjs';
import {
  createImportBatch,
  getImportBatch,
  confirmImportDocument,
  claimImportItem,
  finishImportAttempt,
  cancelImportBatch,
  retryImportItem,
  expireImportAttempt,
  getImportOutput,
  listImportBatches,
  getImportQueue,
} from '../src/import-store.mjs';
import { importChecks } from '../src/import-catalog.mjs';
import { canonicalPublicationControlCheck } from '../src/signal-publication-control-catalog.mjs';

const adminUrl = process.env.MIGRATION_TEST_ADMIN_URL;
if (adminUrl) validateConnectionTarget({ connectionString: adminUrl, profile: 'local-test' });
const suite = adminUrl ? describe.sequential : describe.skip;
const name = `hzense_import_${process.pid}_${Date.now()}`;
const owner = 'test-admin';
const capabilities = { parsers: ['text'], urlFetch: true };
const ddl = await readFile(
  new URL('../../../db/migrations/0014_import_tasks.sql', import.meta.url),
  'utf8',
);
let admin, pool;
const request = () => ({
  id: randomUUID(),
  intent: 'preview',
  manifest: { files: [{ clientItemId: 'a', name: 'note.txt', size: 5 }] },
});
async function created(overrides = {}) {
  return createImportBatch({
    pool,
    owner,
    request: request(),
    capabilities,
    configuration: { parserVersion: 'text/v1', batchLimitMicrousd: 0 },
    ...overrides,
  });
}
function args(b) {
  return { pool, owner, batchId: b.id, itemId: b.items[0].id };
}
function document(b) {
  return {
    object_key: `imports/${b.id}/${b.items[0].id}`,
    object_version: 'etag-v1',
    sha256: 'a'.repeat(64),
    byte_size: 5,
    format: 'text',
  };
}
async function ready(overrides = {}) {
  const b = await created(overrides);
  await confirmImportDocument({ ...args(b), document: document(b) });
  return b;
}
const output = { fragments: [{ text: 'hello', locator: { paragraph: 1 } }] };

suite('private import PostgreSQL persistence', () => {
  it('releases daily and batch reservations for a missing source before processing', async () => {
    const input = request();
    input.manifest.files.push({ clientItemId: 'b', name: 'second.txt', size: 5 });
    const b = await created({
      request: input,
      configuration: { parserVersion: 'text/v1', batchLimitMicrousd: 100 },
    });
    for (const i of b.items)
      await confirmImportDocument({
        ...args(b),
        itemId: i.id,
        document: { ...document(b), object_key: `imports/${b.id}/${i.id}` },
      });
    const first = await claimImportItem({
      ...args(b),
      parserVersion: 'text/v1',
      reserveMicrousd: 100,
      dailyLimitMicrousd: 100,
    });
    await finishImportAttempt({
      ...args(b),
      fence: first.attempt.fence,
      outcome: 'failed',
      errorCode: 'source_unavailable',
      chargedMicrousd: 0,
    });
    const usage = (
      await pool.query(
        "SELECT reserved_microusd,charged_microusd FROM public.import_daily_usage WHERE day=(now() AT TIME ZONE 'UTC')::date",
      )
    ).rows[0];
    expect(usage).toEqual({ reserved_microusd: '0', charged_microusd: '0' });
    const queue = await getImportQueue({ pool, parserVersion: 'text/v1', reserveMicrousd: 100 });
    expect(queue.some((entry) => entry.itemId === b.items[1].id)).toBe(true);
    const secondArgs = { ...args(b), itemId: b.items[1].id };
    const second = await claimImportItem({
      ...secondArgs,
      parserVersion: 'text/v1',
      reserveMicrousd: 100,
      dailyLimitMicrousd: 100,
    });
    await finishImportAttempt({
      ...secondArgs,
      fence: second.attempt.fence,
      outcome: 'failed',
      errorCode: 'source_unavailable',
      chargedMicrousd: 0,
    });
  });
  it('expired originals remain failed and cannot be queued for another paid retry', async () => {
    const b = await ready();
    const claim = await claimImportItem({ ...args(b), parserVersion: 'text/v1' });
    await finishImportAttempt({
      ...args(b),
      fence: claim.attempt.fence,
      outcome: 'failed',
      errorCode: 'source_unavailable',
    });
    await expect(retryImportItem(args(b))).rejects.toMatchObject({ code: 'retry_not_allowed' });
    expect((await getImportBatch({ pool, owner, id: b.id })).items[0].status).toBe('failed');
  });
  beforeAll(async () => {
    admin = new pg.Client({ connectionString: adminUrl });
    await admin.connect();
    await admin.query(`CREATE DATABASE "${name}" TEMPLATE template0 ENCODING 'UTF8'`);
    const url = new URL(adminUrl);
    url.pathname = `/${name}`;
    pool = new pg.Pool({ connectionString: url.toString(), max: 5 });
    await pool.query(ddl);
  });
  afterAll(async () => {
    await pool?.end();
    if (admin) {
      await admin.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
      await admin.end();
    }
  });
  it('pins native PostgreSQL CHECK expressions to the independent verifier', async () => {
    const checks = (
      await pool.query(
        "SELECT r.relname,pg_get_constraintdef(c.oid) AS definition FROM pg_constraint c JOIN pg_class r ON r.oid=c.conrelid WHERE c.contype='c' AND r.relname LIKE 'import_%'",
      )
    ).rows;
    for (const [table, forms] of Object.entries(importChecks)) {
      const actual = checks
        .filter((row) => row.relname === table)
        .map((row) => canonicalPublicationControlCheck(row.definition));
      expect(actual).toHaveLength(forms.length);
      for (const alternatives of forms)
        expect(
          actual.some((value) => alternatives.includes(value)),
          JSON.stringify({ table, actual, alternatives }),
        ).toBe(true);
    }
  });
  it('commits one batch under concurrent idempotent submission and rejects changed ownership/content', async () => {
    const value = request();
    const [a, b] = await Promise.all([created({ request: value }), created({ request: value })]);
    expect(a.id).toBe(b.id);
    expect(a.items[0].id).toBe(b.items[0].id);
    await expect(created({ owner: 'other', request: value })).rejects.toMatchObject({
      code: 'request_id_conflict',
    });
    await expect(
      created({ request: { ...value, intent: 'generate_publish' } }),
    ).rejects.toMatchObject({ code: 'request_id_conflict' });
    await expect(getImportBatch({ pool, owner: 'other', id: a.id })).rejects.toMatchObject({
      code: 'not_found',
    });
  });
  it('requires actual object identity and immutable content before queuing', async () => {
    const b = await created();
    expect(b.status).toBe('awaiting_upload');
    await expect(claimImportItem({ ...args(b), parserVersion: 'text/v1' })).rejects.toMatchObject({
      code: 'not_claimable',
    });
    await expect(
      confirmImportDocument({ ...args(b), document: { ...document(b), byte_size: 6 } }),
    ).rejects.toMatchObject({ code: 'document_conflict' });
    await confirmImportDocument({ ...args(b), document: document(b) });
    await confirmImportDocument({ ...args(b), document: document(b) });
    await expect(
      confirmImportDocument({ ...args(b), document: { ...document(b), sha256: 'b'.repeat(64) } }),
    ).rejects.toMatchObject({ code: 'document_conflict' });
    expect((await getImportBatch({ pool, owner, id: b.id })).status).toBe('queued');
  });
  it('pins the parser revision and budget cap from creation, not the next worker request', async () => {
    const b = await ready();
    await expect(claimImportItem({ ...args(b), parserVersion: 'text/v2' })).rejects.toMatchObject({
      code: 'configuration_conflict',
    });
    await expect(
      claimImportItem({
        ...args(b),
        parserVersion: 'text/v1',
        reserveMicrousd: 1,
        dailyLimitMicrousd: 1000,
        batchLimitMicrousd: 1000,
      }),
    ).rejects.toMatchObject({ code: 'budget_exceeded' });
    expect((await getImportBatch({ pool, owner, id: b.id })).status).toBe('queued');
  });
  it('only one worker claims an item, stores located output, and rejects duplicate finish', async () => {
    const b = await ready();
    const claims = await Promise.allSettled([
      claimImportItem({ ...args(b), parserVersion: 'text/v1' }),
      claimImportItem({ ...args(b), parserVersion: 'text/v1' }),
    ]);
    expect(claims.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    await finishImportAttempt({ ...args(b), fence: 1, outcome: 'completed', output });
    expect((await getImportBatch({ pool, owner, id: b.id })).status).toBe('completed');
    await expect(
      finishImportAttempt({ ...args(b), fence: 1, outcome: 'completed', output }),
    ).rejects.toMatchObject({ code: 'stale_attempt' });
    const result = (
      await pool.query('SELECT content FROM public.import_outputs WHERE item_id=$1', [
        b.items[0].id,
      ])
    ).rows[0].content;
    expect(result.classification).toBe('private');
    expect(result.fragments[0].locator.paragraph).toBe(1);
  });
  it('cancel invalidates running work without deleting completed evidence', async () => {
    const b = await ready();
    await claimImportItem({ ...args(b), parserVersion: 'text/v1' });
    await cancelImportBatch({ pool, owner, id: b.id });
    await expect(
      finishImportAttempt({ ...args(b), fence: 1, outcome: 'completed', output }),
    ).rejects.toMatchObject({ code: 'stale_attempt' });
    await expect(retryImportItem(args(b))).rejects.toMatchObject({ code: 'retry_not_allowed' });
    expect((await getImportBatch({ pool, owner, id: b.id })).status).toBe('cancelled');
    const next = await ready();
    await expect(
      claimImportItem({ ...args(next), parserVersion: 'text/v1' }),
    ).rejects.toMatchObject({ code: 'worker_busy' });
    // Advance only the cancelled fixture lease. A cancelled VM keeps capacity until this deadline.
    await pool.query(
      "UPDATE public.import_attempts SET lease_until=now()-interval '1 second' WHERE item_id=$1",
      [b.items[0].id],
    );
    await claimImportItem({ ...args(next), parserVersion: 'text/v1' });
    await finishImportAttempt({ ...args(next), fence: 1, outcome: 'completed', output });
  });
  it('expired free work can retry with a new fence; old workers cannot submit', async () => {
    const b = await created({
      request: {
        id: randomUUID(),
        intent: 'preview',
        manifest: { urlLines: 'https://example.com/unreceived' },
      },
    });
    await claimImportItem({ ...args(b), parserVersion: 'text/v1' });
    await pool.query(
      "UPDATE public.import_attempts SET lease_until=now()-interval '1 second' WHERE item_id=$1",
      [b.items[0].id],
    );
    expect(await expireImportAttempt(args(b))).toEqual({ changed: true, status: 'failed' });
    await retryImportItem(args(b));
    await claimImportItem({ ...args(b), parserVersion: 'text/v1' });
    await expect(
      finishImportAttempt({ ...args(b), fence: 1, outcome: 'completed', output }),
    ).rejects.toMatchObject({ code: 'stale_attempt' });
    await confirmImportDocument({ ...args(b), document: document(b), fence: 2 });
    await finishImportAttempt({ ...args(b), fence: 2, outcome: 'completed', output });
  });
  it('locked retry rejects a document received after an earlier source-free snapshot', async () => {
    const b = await created({
      request: {
        id: randomUUID(),
        intent: 'preview',
        manifest: { urlLines: 'https://example.com/retry-race' },
      },
    });
    await claimImportItem({ ...args(b), parserVersion: 'text/v1' });
    await finishImportAttempt({
      ...args(b),
      fence: 1,
      outcome: 'failed',
      errorCode: 'fetch_failed',
    });
    const stale = await getImportBatch({ pool, owner, id: b.id });
    expect(stale.items[0].sha256).toBeNull();
    await retryImportItem(args(b));
    await claimImportItem({ ...args(b), parserVersion: 'text/v1' });
    await confirmImportDocument({ ...args(b), document: document(b), fence: 2 });
    await finishImportAttempt({
      ...args(b),
      fence: 2,
      outcome: 'failed',
      errorCode: 'parse_failed',
    });
    // The delayed request reaches persistence with its old service snapshot.
    await expect(retryImportItem(args(stale))).rejects.toMatchObject({ code: 'retry_not_allowed' });
    const current = await getImportBatch({ pool, owner, id: b.id });
    expect(current.items[0].status).toBe('failed');
    expect(current.items[0].fence).toBe(2);
  });
  it('atomically enforces global budgets across batches and preserves unknown charges', async () => {
    const configuration = { parserVersion: 'ocr/v1', batchLimitMicrousd: 100 };
    const a = await ready({ configuration }),
      b = await ready({ configuration });
    const budget = {
      parserVersion: 'ocr/v1',
      reserveMicrousd: 80,
      dailyLimitMicrousd: 100,
    };
    const claims = await Promise.allSettled([
      claimImportItem({ ...args(a), ...budget }),
      claimImportItem({ ...args(b), ...budget }),
    ]);
    expect(claims.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const winner = claims[0].status === 'fulfilled' ? a : b;
    await finishImportAttempt({
      ...args(winner),
      fence: 1,
      outcome: 'unknown',
      chargedMicrousd: 90,
      errorCode: 'outcome_unknown',
    });
    await expect(retryImportItem(args(winner))).rejects.toMatchObject({
      code: 'retry_not_allowed',
    });
    const usage = (await pool.query('SELECT * FROM public.import_daily_usage')).rows[0];
    expect(usage.reserved_microusd).toBe('0');
    expect(usage.charged_microusd).toBe('90');
    const next = await ready();
    await expect(
      claimImportItem({ ...args(next), parserVersion: 'text/v1', dailyLimitMicrousd: 100 }),
    ).rejects.toMatchObject({ code: 'worker_busy' });
    await pool.query(
      "UPDATE public.import_attempts SET lease_until=now()-interval '1 second' WHERE item_id=$1",
      [winner.items[0].id],
    );
  });
  it('completed private output requires owning admin and the current completed fence', async () => {
    const b = await ready();
    // Previous tests consumed the daily budget; a free fixture uses that existing ceiling.
    await claimImportItem({ ...args(b), parserVersion: 'text/v1', dailyLimitMicrousd: 100 });
    await finishImportAttempt({ ...args(b), fence: 1, outcome: 'completed', output });
    expect((await getImportOutput(args(b))).classification).toBe('private');
    await expect(getImportOutput({ ...args(b), owner: 'other-admin' })).rejects.toMatchObject({
      code: 'not_found',
    });
  });
  it('a failed transaction cannot leave a half-created batch', async () => {
    const value = request();
    await expect(created({ request: { ...value, manifest: { files: [] } } })).rejects.toMatchObject(
      { code: 'manifest_rejected' },
    );
    expect(
      (await pool.query('SELECT id FROM public.import_batches WHERE id=$1', [value.id])).rows,
    ).toHaveLength(0);
  });
  it('pages all batches with exact database timestamp precision and ownership checks', async () => {
    const ids = [];
    for (let n = 0; n < 51; n++) ids.push((await created({ owner: 'pager' })).id);
    // Force sub-millisecond differences: the cursor must not round-trip a JavaScript Date.
    await pool.query(
      "UPDATE public.import_batches SET created_at='2026-01-01T00:00:00.123456Z' WHERE owner_id='pager'",
    );
    const first = await listImportBatches({ pool, owner: 'pager' });
    const second = await listImportBatches({ pool, owner: 'pager', before: first.at(-1).id });
    expect(first).toHaveLength(50);
    expect(second).toHaveLength(1);
    expect(new Set([...first, ...second].map((x) => x.id)).size).toBe(51);
    await expect(
      listImportBatches({ pool, owner: 'intruder', before: first[0].id }),
    ).rejects.toMatchObject({ code: 'not_found' });
  });
  it('filters incompatible and exhausted batches before bounding the worker queue', async () => {
    for (let n = 0; n < 12; n++)
      await created({
        owner: 'queue',
        request: {
          id: randomUUID(),
          intent: 'preview',
          manifest: { urlLines: 'https://example.com' },
        },
        configuration: { parserVersion: 'old-parser', batchLimitMicrousd: 10 },
      });
    for (let n = 0; n < 12; n++)
      await created({
        owner: 'queue',
        request: {
          id: randomUUID(),
          intent: 'preview',
          manifest: { urlLines: 'https://example.com' },
        },
        configuration: { parserVersion: 'new-parser', batchLimitMicrousd: 0 },
      });
    const valid = await created({
      owner: 'queue',
      request: {
        id: randomUUID(),
        intent: 'preview',
        manifest: { urlLines: 'https://example.com' },
      },
      configuration: { parserVersion: 'new-parser', batchLimitMicrousd: 10 },
    });
    const queue = await getImportQueue({ pool, parserVersion: 'new-parser', reserveMicrousd: 1 });
    expect(queue.map((x) => x.batchId)).toEqual([valid.id]);
  });
  it('migration refuses leaked default privileges atomically', async () => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('ALTER DEFAULT PRIVILEGES GRANT SELECT ON TABLES TO PUBLIC');
      // A separate schema is not equivalent; recreate only this isolated fixture in a rollback transaction.
      await client.query(
        'DROP TABLE public.import_outputs, public.import_attempts, public.import_documents, public.import_audit, public.import_items, public.import_batches, public.import_daily_usage',
      );
      // PUBLIC is explicitly revoked; an inherited named role must fail.
      await client.query(`CREATE ROLE "${name}_leak"`);
      await client.query(`ALTER DEFAULT PRIVILEGES GRANT SELECT ON TABLES TO "${name}_leak"`);
      await expect(client.query(ddl)).rejects.toThrow(/owner-only ACLs/);
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  });
});
