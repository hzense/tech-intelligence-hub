import { describe, expect, it } from 'vitest';
import { readEditorialSignalStatuses } from '../src/editorial-signal-store.mjs';

const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const publicId = `editorial-${'a'.repeat(32)}`;
function fixture(rows = [], error = null) {
  const queries = [];
  const releases = [];
  const pool = {
    connect: async () => ({
      query: async (sql, values) => {
        queries.push({ sql, values });
        if (error) throw error;
        return { rows };
      },
      release: (discard) => releases.push(discard),
    }),
  };
  return { pool, queries, releases };
}

describe('batched editorial publication status', () => {
  it('reads latest revisions once and distinguishes owned unpublished runs from absent runs', async () => {
    const f = fixture([
      { run_id: id(1), candidate_index: 0, revision: 3, action: 'publish', public_id: publicId },
      { run_id: id(1), candidate_index: 2, revision: 2, action: 'withdraw', public_id: null },
      { run_id: id(1), candidate_index: 4, revision: 1, action: 'draft', public_id: null },
      { run_id: id(2), candidate_index: null, revision: null, action: null, public_id: null },
    ]);
    const result = await readEditorialSignalStatuses({
      pool: f.pool,
      owner: 'owner',
      runIds: [id(1), id(2), id(3), id(1)],
    });
    expect(result).toEqual([
      {
        run_id: id(1),
        candidates: [
          { candidate_index: 0, revision: 3, action: 'publish', public_id: publicId },
          { candidate_index: 2, revision: 2, action: 'withdraw', public_id: null },
          { candidate_index: 4, revision: 1, action: 'draft', public_id: null },
        ],
      },
      { run_id: id(2), candidates: [] },
    ]);
    expect(f.queries).toHaveLength(1);
    expect(f.queries[0].values).toEqual(['owner', [id(1), id(2), id(3)]]);
    const sql = f.queries[0].sql;
    expect(sql).toContain(
      "owner_id=$1 AND id=ANY($2::uuid[]) AND status='completed' AND deleted_at IS NULL",
    );
    expect(sql).toContain('WHERE r.owner_id=$1');
    expect(sql).toContain('DISTINCT ON (r.run_id,r.candidate_index)');
    expect(sql).toContain('ORDER BY r.run_id,r.candidate_index,r.revision DESC');
    expect(sql).toContain('LEFT JOIN latest');
    expect(sql).not.toMatch(/\b(?:INSERT|UPDATE|DELETE|GRANT|REVOKE)\b/);
    expect(sql).not.toMatch(/\b(?:content|material_hash|request_hash)\b/);
    expect(f.releases).toEqual([false]);
  });

  it('does not connect for empty input and rejects malformed or overlarge requests', async () => {
    let connected = 0;
    const pool = {
      connect: async () => {
        connected++;
        throw new Error('unexpected');
      },
    };
    expect(await readEditorialSignalStatuses({ pool, owner: 'owner', runIds: [] })).toEqual([]);
    for (const runIds of [null, ['bad'], Array.from({ length: 51 }, (_, n) => id(n))])
      await expect(readEditorialSignalStatuses({ pool, owner: 'owner', runIds })).rejects.toThrow(
        'invalid_request',
      );
    await expect(readEditorialSignalStatuses({ pool, owner: '', runIds: [id(1)] })).rejects.toThrow(
      'invalid_request',
    );
    expect(connected).toBe(0);
  });

  it('fails closed and releases the connection on query failure or malformed rows', async () => {
    const valid = {
      run_id: id(1),
      candidate_index: 0,
      revision: 1,
      action: 'publish',
      public_id: publicId,
    };
    for (const rows of [
      [{ ...valid, run_id: id(2) }],
      [{ ...valid, action: 'rejected' }],
      [{ ...valid, revision: 0 }],
      [{ ...valid, candidate_index: 5 }],
      [{ ...valid, public_id: 'https://evil.example/' }],
      [{ ...valid, action: 'withdraw' }],
      [valid, valid],
      [{ ...valid, candidate_index: null }],
    ]) {
      const f = fixture(rows);
      await expect(
        readEditorialSignalStatuses({ pool: f.pool, owner: 'owner', runIds: [id(1)] }),
      ).rejects.toThrow('database_unavailable');
      expect(f.releases).toEqual([true]);
    }
    const f = fixture([], new Error('private database detail'));
    await expect(
      readEditorialSignalStatuses({ pool: f.pool, owner: 'owner', runIds: [id(1)] }),
    ).rejects.toThrow('database_unavailable');
    expect(f.releases).toEqual([true]);
  });
});
