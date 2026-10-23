import { describe, expect, it } from 'vitest';
import { finishImportAttempt, getImportBatch } from '../src/import-store.mjs';

const batchId = '11111111-1111-4111-8111-111111111111';
const itemId = '22222222-2222-4222-8222-222222222222';
const owner = 'test-admin';
function fixture(errorCode = 'fetch_failed') {
  const queries = [];
  const b = { id: batchId, owner_id: owner, cancelled: false };
  const i = { id: itemId, batch_id: batchId, kind: 'url', status: 'running', fence: 1 };
  const client = {
    release() {},
    async query(sql, values = []) {
      queries.push({ sql, values });
      if (sql.includes('FROM public.import_batches WHERE')) return { rows: [b] };
      if (sql.includes('FROM public.import_items WHERE')) return { rows: [i] };
      if (sql.includes('FROM public.import_attempts WHERE'))
        return {
          rows: [
            { status: 'running', live: true, reserved_microusd: '100', budget_day: '2026-10-23' },
          ],
        };
      if (sql.startsWith('WITH canonical_items'))
        return { rows: [{ ...i, status: 'failed', error_code: errorCode }] };
      return { rows: [] };
    },
  };
  return { pool: { connect: async () => client }, queries };
}

describe('durable import fetch diagnostics', () => {
  it('writes bounded diagnostic suffixes without persisting arbitrary exception data', async () => {
    for (const [diagnostic, expected] of [
      [{ reason: 'http_status', status: 403 }, 'fetch_failed:http_status:403'],
      [{ reason: 'dns' }, 'fetch_failed:dns'],
      [{ reason: 'timeout' }, 'fetch_failed:timeout'],
      [{ reason: 'encoding' }, 'fetch_failed:encoding'],
      [{ reason: 'network' }, 'fetch_failed:network'],
    ]) {
      const { pool, queries } = fixture();
      await finishImportAttempt({
        pool,
        owner,
        batchId,
        itemId,
        fence: 1,
        outcome: 'failed',
        errorCode: 'fetch_failed',
        chargedMicrousd: 100,
        fetchDiagnostic: {
          ...diagnostic,
          url: 'private-url',
          headers: 'private-key',
          body: 'private-body',
        },
      });
      const write = queries.find(({ sql }) => sql.startsWith('UPDATE public.import_attempts'));
      expect(write.values).toEqual([itemId, 1, 'failed', expected, '100']);
      expect(JSON.stringify(queries)).not.toContain('private-');
    }
  });

  it('normalizes current and historical codes without exposing malformed suffixes', async () => {
    for (const [errorCode, expectedCode, expectedDiagnostic] of [
      ['fetch_failed:http_status:403', 'fetch_failed', { reason: 'http_status', status: 403 }],
      ['fetch_failed:dns', 'fetch_failed', { reason: 'dns' }],
      ['fetch_failed:timeout', 'fetch_failed', { reason: 'timeout' }],
      ['fetch_failed:encoding', 'fetch_failed', { reason: 'encoding' }],
      ['fetch_failed:network', 'fetch_failed', { reason: 'network' }],
      ['fetch_failed', 'fetch_failed', undefined],
      ['parse_failed', 'parse_failed', undefined],
      [null, null, undefined],
      ['fetch_failed:http_status:999', 'fetch_failed', undefined],
      ['fetch_failed:http_status:403:private-url', 'fetch_failed', undefined],
      ['fetch_failed:private-key', 'fetch_failed', undefined],
    ]) {
      const { pool } = fixture(errorCode);
      const b = await getImportBatch({ pool, owner, id: batchId });
      expect(b.items[0].error_code).toBe(expectedCode);
      expect(b.items[0].fetch_diagnostic).toEqual(expectedDiagnostic);
      expect(JSON.stringify(b)).not.toContain('private-');
    }
  });

  it('rejects invalid diagnostics and diagnostics attached to a non-fetch outcome before connecting', async () => {
    for (const change of [
      { fetchDiagnostic: { reason: 'http_status', status: '403' } },
      { fetchDiagnostic: { reason: 'http_status', status: 999 } },
      { fetchDiagnostic: { reason: 'secret' } },
      { fetchDiagnostic: null },
      { outcome: 'unknown' },
      { errorCode: 'parse_failed' },
      { outcome: 'completed' },
    ]) {
      const { pool, queries } = fixture();
      await expect(
        finishImportAttempt({
          pool,
          owner,
          batchId,
          itemId,
          fence: 1,
          outcome: 'failed',
          errorCode: 'fetch_failed',
          fetchDiagnostic: { reason: 'http_status', status: 403 },
          ...change,
        }),
      ).rejects.toMatchObject({ code: 'invalid_request' });
      expect(queries).toEqual([]);
    }
  });
});
