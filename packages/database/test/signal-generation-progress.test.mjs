import { describe, expect, it, vi } from 'vitest';
import { readSignalGenerationProgress } from '../src/signal-generation-store.mjs';

const ids = Array.from(
  { length: 51 },
  (_, index) => `11111111-1111-4111-8111-${String(index + 1).padStart(12, '0')}`,
);
function record(index = 0, fields = {}) {
  return {
    id: ids[index],
    owner_id: 'owner',
    status: 'running',
    error_code: null,
    lease_until: '2099-01-01T00:32:00Z',
    progress_phase: 'generating',
    progress_at: '2099-01-01T00:00:01Z',
    started_at: '2099-01-01T00:00:00Z',
    finished_at: null,
    created_at: '2099-01-01T00:00:00Z',
    reserved_microusd: '100',
    charged_microusd: '0',
    deleted_at: null,
    ...fields,
  };
}
function fixture(records = [record()]) {
  const queries = [];
  const client = {
    async query(sql, values) {
      queries.push({ sql, values });
      if (sql.startsWith('SELECT id,status,error_code,lease_until,'))
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
const select = (f) => f.queries.find((q) => q.sql.startsWith('SELECT id,status,error_code,'));

describe('lightweight signal generation progress', () => {
  it('selects only small fields in one owner-scoped read-only transaction, deduplicated in request order', async () => {
    const f = fixture([
      record(0, {
        snapshot: { source: 'PRIVATE_SOURCE' },
        configuration: { internal: true },
        result: { candidates: ['PRIVATE_CANDIDATE'] },
        lease_token: 'PRIVATE_TOKEN',
      }),
      record(1),
    ]);
    const result = await readSignalGenerationProgress({
      pool: f.pool,
      owner: 'owner',
      ids: [ids[1], ids[0], ids[1]],
    });
    expect(result.map((row) => row.id)).toEqual([ids[1], ids[0]]);
    expect(Object.keys(result[0]).sort()).toEqual(
      [
        'id',
        'status',
        'error_code',
        'lease_until',
        'progress_phase',
        'progress_at',
        'started_at',
        'finished_at',
        'created_at',
        'reserved_microusd',
        'charged_microusd',
      ].sort(),
    );
    expect(JSON.stringify(result)).not.toMatch(/PRIVATE_|snapshot|configuration|result|owner_id/);
    expect(f.pool.connect).toHaveBeenCalledOnce();
    expect(f.queries[0].sql).toBe('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    expect(select(f).values).toEqual(['owner', [ids[1], ids[0]]]);
    expect(select(f).sql).toContain(
      'WHERE owner_id=$1 AND id=ANY($2::uuid[]) AND deleted_at IS NULL',
    );
    expect(select(f).sql).not.toMatch(
      /snapshot|configuration|result|lease_token|FOR UPDATE|SELECT \*/,
    );
    expect(f.queries.some((q) => /^(UPDATE|INSERT|DELETE)/.test(q.sql))).toBe(false);
    expect(f.queries.at(-1).sql).toBe('COMMIT');
    expect(f.client.release).toHaveBeenCalledOnce();
  });

  it.each([
    { records: [] },
    { records: [record(1, { owner_id: 'another-owner' })] },
    { records: [record(1, { deleted_at: '2026-01-01T00:00:00Z' })] },
  ])(
    'rejects an entire batch when a requested task is absent, foreign or deleted',
    async ({ records }) => {
      const f = fixture([record(), ...records]);
      await expect(
        readSignalGenerationProgress({ pool: f.pool, owner: 'owner', ids: [ids[0], ids[1]] }),
      ).rejects.toMatchObject({ code: 'not_found' });
      expect(f.queries.at(-1).sql).toBe('ROLLBACK');
      expect(f.client.release).toHaveBeenCalledOnce();
    },
  );

  it('substitutes NULL progress fields for the legacy read-only schema', async () => {
    const f = fixture([record(0, { progress_phase: null, progress_at: null, started_at: null })]);
    const [result] = await readSignalGenerationProgress({
      pool: f.pool,
      owner: 'owner',
      ids: [ids[0]],
      legacyReadOnly: true,
    });
    expect(result.progress_phase).toBeNull();
    expect(result.progress_at).toBeNull();
    expect(result.started_at).toBeNull();
    expect(select(f).sql).toContain(
      'NULL::text AS progress_phase,NULL::timestamptz AS progress_at,NULL::timestamptz AS started_at',
    );
  });

  it.each([null, 'invalid', [], ['invalid'], Array(1), ids, Array(51).fill(ids[0])])(
    'rejects empty, malformed or excessive input before connecting: %j',
    async (input) => {
      const f = fixture();
      await expect(
        readSignalGenerationProgress({ pool: f.pool, owner: 'owner', ids: input }),
      ).rejects.toMatchObject({ code: 'invalid_request' });
      expect(f.pool.connect).not.toHaveBeenCalled();
    },
  );

  it('allows 50 IDs before deduplication and validates owner', async () => {
    const f = fixture();
    await expect(
      readSignalGenerationProgress({ pool: f.pool, owner: '', ids: [ids[0]] }),
    ).rejects.toMatchObject({ code: 'invalid_request' });
    expect(f.pool.connect).not.toHaveBeenCalled();
    expect(
      await readSignalGenerationProgress({
        pool: f.pool,
        owner: 'owner',
        ids: Array(50).fill(ids[0]),
      }),
    ).toHaveLength(1);
  });

  it('does not mutate expired running receipts or accounting', async () => {
    const expired = record(0, { lease_until: '2000-01-01T00:00:00Z' });
    const f = fixture([expired]);
    const [result] = await readSignalGenerationProgress({
      pool: f.pool,
      owner: 'owner',
      ids: [ids[0]],
    });
    expect(result.status).toBe('running');
    expect(result.reserved_microusd).toBe('100');
    expect(result.charged_microusd).toBe('0');
    expect(expired.status).toBe('running');
    expect(f.queries.some((q) => /^(UPDATE|INSERT|DELETE)/.test(q.sql))).toBe(false);
  });

  it('sanitizes failures and releases the connection', async () => {
    const f = fixture();
    f.client.query = vi.fn(async (sql) => {
      if (sql.startsWith('SELECT')) throw new Error('PRIVATE_BACKEND_DIAGNOSTIC');
      return { rows: [] };
    });
    await expect(
      readSignalGenerationProgress({ pool: f.pool, owner: 'owner', ids: [ids[0]] }),
    ).rejects.toMatchObject({ code: 'database_unavailable' });
    expect(f.client.query).toHaveBeenCalledWith('ROLLBACK');
    expect(f.client.release).toHaveBeenCalledOnce();
  });
});
