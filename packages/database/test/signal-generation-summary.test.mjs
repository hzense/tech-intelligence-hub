import { describe, expect, it, vi } from 'vitest';
import { readSignalGenerationSummaries } from '../src/signal-generation-store.mjs';

const ids = Array.from(
  { length: 6 },
  (_, index) => `11111111-1111-4111-8111-${String(index + 1).padStart(12, '0')}`,
);
function fixture(records = []) {
  const queries = [];
  const client = {
    async query(sql, values) {
      queries.push({ sql, values });
      if (/^SELECT id,status,/.test(sql))
        return {
          rows: records.filter(
            (row) => row.owner_id === values[0] && values[1].includes(row.id) && !row.deleted_at,
          ),
        };
      return { rows: [] };
    },
    release: vi.fn(),
  };
  const pool = { connect: vi.fn(async () => client) };
  return { pool, client, queries };
}
const row = (index = 0, fields = {}) => ({
  id: ids[index],
  owner_id: 'owner',
  status: 'completed',
  progress_phase: 'saving',
  candidate_count: 2,
  lease_until: null,
  deleted_at: null,
  ...fields,
});

describe('linked signal generation summaries', () => {
  it('uses one owner-scoped, parameterized read-only transaction and deduplicates IDs', async () => {
    const f = fixture([
      row(0, { result: { private: true }, lease_token: 'secret', charged_microusd: '123' }),
      row(1, { owner_id: 'another-owner' }),
      row(2, { deleted_at: '2026-09-20T00:00:00Z' }),
      row(3),
    ]);
    const summaries = await readSignalGenerationSummaries({
      pool: f.pool,
      owner: 'owner',
      ids: [ids[0], ids[0], ids[1], ids[2], ids[4]],
    });
    expect(summaries).toEqual([
      { id: ids[0], status: 'completed', progress_phase: 'saving', candidate_count: 2 },
    ]);
    expect(f.pool.connect).toHaveBeenCalledOnce();
    expect(f.queries[0].sql).toBe('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const select = f.queries.find((q) => q.sql.startsWith('SELECT id,status,'));
    expect(select.values).toEqual(['owner', [ids[0], ids[1], ids[2], ids[4]]]);
    expect(select.sql).toContain('WHERE owner_id=$1 AND id=ANY($2::uuid[]) AND deleted_at IS NULL');
    expect(select.sql).not.toMatch(/LIMIT|FOR UPDATE|SELECT \*/);
    expect(f.queries.some((q) => /^(UPDATE|INSERT|DELETE)/.test(q.sql))).toBe(false);
    expect(f.queries.at(-1).sql).toBe('COMMIT');
    expect(f.client.release).toHaveBeenCalledOnce();
  });

  it('counts only completed candidate arrays, preserving missing receipts as null', async () => {
    const f = fixture([
      row(0, { candidate_count: 0 }),
      row(1, { candidate_count: null }),
      row(2, { status: 'failed', candidate_count: 3 }),
      row(3, { status: 'pending', candidate_count: 3 }),
      row(4, { status: 'unknown', candidate_count: 3 }),
      row(5, { status: 'cancelled', candidate_count: 3 }),
    ]);
    const summaries = await readSignalGenerationSummaries({ pool: f.pool, owner: 'owner', ids });
    expect(summaries.map((value) => value.candidate_count)).toEqual([
      0,
      null,
      null,
      null,
      null,
      null,
    ]);
    const select = f.queries.find((q) => q.sql.startsWith('SELECT id,status,'));
    expect(select.sql).toMatch(
      /CASE WHEN status='completed' AND jsonb_typeof\(result->'candidates'\)='array'\s+THEN jsonb_array_length\(result->'candidates'\) ELSE NULL END AS candidate_count/,
    );
  });

  it('reports expired, missing or malformed running leases as unknown without mutating rows', async () => {
    const f = fixture([
      row(0, { status: 'running', lease_until: '2000-01-01T00:00:00Z' }),
      row(1, { status: 'running', lease_until: null }),
      row(2, { status: 'running', lease_until: 'invalid' }),
      row(3, { status: 'running', lease_until: '9999-01-01T00:00:00Z' }),
    ]);
    const summaries = await readSignalGenerationSummaries({ pool: f.pool, owner: 'owner', ids });
    expect(summaries.map((value) => value.status)).toEqual([
      'unknown',
      'unknown',
      'unknown',
      'running',
    ]);
    expect(summaries.every((value) => value.candidate_count === null)).toBe(true);
    expect(f.queries.some((q) => /^(UPDATE|INSERT|DELETE)/.test(q.sql))).toBe(false);
  });

  it('supports legacy read-only schema without querying absent progress columns', async () => {
    const f = fixture([row(0, { progress_phase: null })]);
    const summaries = await readSignalGenerationSummaries({
      pool: f.pool,
      owner: 'owner',
      ids: [ids[0]],
      legacyReadOnly: true,
    });
    expect(summaries[0].progress_phase).toBeNull();
    expect(f.queries.find((q) => q.sql.startsWith('SELECT id,status,')).sql).toContain(
      'NULL::text AS progress_phase',
    );
  });

  it('does not connect for an empty ID list', async () => {
    const f = fixture();
    expect(await readSignalGenerationSummaries({ pool: f.pool, owner: 'owner', ids: [] })).toEqual(
      [],
    );
    expect(f.pool.connect).not.toHaveBeenCalled();
  });

  it.each([null, 'invalid', ['invalid'], Array(1), Array(801).fill(ids[0])])(
    'rejects malformed or oversized IDs before connecting: %j',
    async (input) => {
      const f = fixture();
      await expect(
        readSignalGenerationSummaries({ pool: f.pool, owner: 'owner', ids: input }),
      ).rejects.toMatchObject({ code: 'invalid_request' });
      expect(f.pool.connect).not.toHaveBeenCalled();
    },
  );

  it('validates owner and accepts at most 800 UUIDs before deduplication', async () => {
    const f = fixture([row()]);
    await expect(
      readSignalGenerationSummaries({ pool: f.pool, owner: '', ids: [] }),
    ).rejects.toMatchObject({ code: 'invalid_request' });
    expect(f.pool.connect).not.toHaveBeenCalled();
    expect(
      await readSignalGenerationSummaries({
        pool: f.pool,
        owner: 'owner',
        ids: Array(800).fill(ids[0]),
      }),
    ).toHaveLength(1);
    expect(f.queries.find((q) => q.sql.startsWith('SELECT id,status,')).values[1]).toEqual([
      ids[0],
    ]);
  });

  it('sanitizes database failures and releases the connection', async () => {
    const f = fixture();
    f.client.query = vi.fn(async (sql) => {
      if (sql.startsWith('SELECT')) throw new Error('private backend detail');
      return { rows: [] };
    });
    await expect(
      readSignalGenerationSummaries({ pool: f.pool, owner: 'owner', ids: [ids[0]] }),
    ).rejects.toMatchObject({ code: 'database_unavailable' });
    expect(f.client.query).toHaveBeenCalledWith('ROLLBACK');
    expect(f.client.release).toHaveBeenCalledOnce();
  });
});
