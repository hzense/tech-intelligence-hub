import { describe, expect, it, vi } from 'vitest';
import {
  getSignalGenerationDisplay,
  listSignalGenerationDisplays,
} from '../src/signal-generation-store.mjs';

const id = '11111111-1111-4111-8111-111111111111';
const batchId = '22222222-2222-4222-8222-222222222222';
const itemId = '33333333-3333-4333-8333-333333333333';
function fixture(fields = {}) {
  const row = {
    id,
    owner_id: 'owner',
    batch_id: batchId,
    item_id: itemId,
    profile_id: '44444444-4444-4444-8444-444444444444',
    profile_revision: 1,
    generation_version: `private-candidate-v1/retry/${id}`,
    status: 'completed',
    lease_until: null,
    reserved_microusd: '100',
    charged_microusd: '42',
    result: { classification: 'private', candidates: [{ title: 'Saved candidate' }] },
    error_code: null,
    created_at: '2026-10-18T00:00:00Z',
    finished_at: '2026-10-18T00:01:00Z',
    deleted_at: null,
    progress_phase: 'saving',
    progress_at: '2026-10-18T00:00:59Z',
    started_at: '2026-10-18T00:00:01Z',
    snapshot: { source: 'PRIVATE_SOURCE' },
    configuration: { budget: 'PRIVATE_CONFIG' },
    source_hash: 'PRIVATE_HASH',
    lease_token: 'PRIVATE_LEASE',
    ...fields,
  };
  const queries = [];
  const client = {
    async query(sql, values) {
      queries.push({ sql, values });
      if (!sql.startsWith('SELECT')) return { rows: [] };
      const owned = sql.includes('WHERE id=$1')
        ? values[0] === row.id && values[1] === row.owner_id
        : values[0] === row.owner_id &&
          (values[1] === null || values[1] === row.batch_id) &&
          (values[2] === null || values[2] === row.item_id);
      return { rows: owned && !row.deleted_at ? [row] : [] };
    },
    release: vi.fn(),
  };
  const pool = { connect: vi.fn(async () => client) };
  return { row, pool, client, queries };
}

describe('snapshot-free generation display reads', () => {
  it('preserves results, retry identity, accounting and permission inputs without reading source snapshots', async () => {
    const f = fixture();
    const detail = await getSignalGenerationDisplay({ pool: f.pool, owner: 'owner', id });
    expect(detail.result).toEqual(f.row.result);
    expect(detail.generation_version).toBe(f.row.generation_version);
    expect(detail.status).toBe('completed');
    expect(detail.automatic_publication).toBe(false);
    expect(detail.lease_until).toBeNull();
    expect(detail.charged_microusd).toBe('42');
    expect(JSON.stringify(detail)).not.toMatch(
      /PRIVATE_|snapshot|configuration|owner_id|lease_token/,
    );
    const select = f.queries.find((q) => q.sql.startsWith('SELECT'));
    expect(select.values).toEqual([id, 'owner']);
    expect(select.sql).toContain('WHERE id=$1 AND owner_id=$2 AND deleted_at IS NULL');
    expect(select.sql).toContain('generation_version');
    expect(select.sql).toContain('result');
    expect(select.sql).not.toMatch(/snapshot\s*,|configuration|lease_token|SELECT \*/);
    expect(select.sql).toContain("snapshot#>>'{publication,mode}'='automatic'");
    expect(select.sql).toContain("snapshot#>>'{publication,policy}'='auto-publication-v1'");
    expect(f.queries[0].sql).toBe('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    expect(f.queries.some((q) => /^(UPDATE|INSERT|DELETE)/.test(q.sql))).toBe(false);
    expect(f.queries.at(-1).sql).toBe('COMMIT');
  });

  it('keeps initial history owner-scoped, filtered and bounded to 50 display records', async () => {
    const f = fixture();
    const rows = await listSignalGenerationDisplays({
      pool: f.pool,
      owner: 'owner',
      batchId,
      itemId,
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].result).toEqual(f.row.result);
    expect(JSON.stringify(rows)).not.toMatch(
      /PRIVATE_|snapshot|configuration|owner_id|lease_token/,
    );
    const select = f.queries.find((q) => q.sql.startsWith('SELECT'));
    expect(select.values).toEqual(['owner', batchId, itemId]);
    expect(select.sql).toContain('WHERE owner_id=$1 AND deleted_at IS NULL');
    expect(select.sql).toContain('ORDER BY created_at DESC,id DESC LIMIT 50');
    expect(select.sql).not.toMatch(/snapshot\s*,|configuration|lease_token|SELECT \*/);
    expect(f.queries[0].sql).toBe('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    expect(f.queries.some((q) => /^(UPDATE|INSERT|DELETE)/.test(q.sql))).toBe(false);
  });

  it('supports legacy NULL progress columns for both readers', async () => {
    const f = fixture();
    await getSignalGenerationDisplay({ pool: f.pool, owner: 'owner', id, legacyReadOnly: true });
    await listSignalGenerationDisplays({ pool: f.pool, owner: 'owner', legacyReadOnly: true });
    const selects = f.queries.filter((q) => q.sql.startsWith('SELECT'));
    expect(selects).toHaveLength(2);
    for (const query of selects)
      expect(query.sql).toContain(
        'NULL::text AS progress_phase,NULL::timestamptz AS progress_at,NULL::timestamptz AS started_at',
      );
  });
  it('exposes only a strict boolean for automatic policy, never source URLs or snapshot', async () => {
    for (const [value, expected] of [
      [true, true],
      [false, false],
      [undefined, false],
      ['true', false],
    ]) {
      const f = fixture({ automatic_publication: value });
      const detail = await getSignalGenerationDisplay({ pool: f.pool, owner: 'owner', id });
      expect(detail.automatic_publication).toBe(expected);
      expect(detail).not.toHaveProperty('snapshot');
    }
  });

  it('does not display foreign or deleted tasks', async () => {
    const f = fixture();
    await expect(
      getSignalGenerationDisplay({ pool: f.pool, owner: 'other', id }),
    ).rejects.toMatchObject({ code: 'not_found' });
    expect(await listSignalGenerationDisplays({ pool: f.pool, owner: 'other' })).toEqual([]);
    f.row.deleted_at = '2026-10-18T00:00:00Z';
    await expect(
      getSignalGenerationDisplay({ pool: f.pool, owner: 'owner', id }),
    ).rejects.toMatchObject({ code: 'not_found' });
    expect(await listSignalGenerationDisplays({ pool: f.pool, owner: 'owner' })).toEqual([]);
  });

  it('validates inputs before connecting and never exposes backend diagnostics', async () => {
    const f = fixture();
    for (const execute of [
      () => getSignalGenerationDisplay({ pool: f.pool, owner: '', id }),
      () => getSignalGenerationDisplay({ pool: f.pool, owner: 'owner', id: 'invalid' }),
      () => listSignalGenerationDisplays({ pool: f.pool, owner: 'owner', batchId: 'invalid' }),
      () => listSignalGenerationDisplays({ pool: f.pool, owner: 'owner', itemId: 'invalid' }),
    ])
      await expect(execute()).rejects.toMatchObject({ code: 'invalid_request' });
    expect(f.pool.connect).not.toHaveBeenCalled();
    f.client.query = vi.fn(async (sql) => {
      if (sql.startsWith('SELECT')) throw new Error('PRIVATE_BACKEND_DETAIL');
      return { rows: [] };
    });
    await expect(
      getSignalGenerationDisplay({ pool: f.pool, owner: 'owner', id }),
    ).rejects.toMatchObject({ code: 'database_unavailable' });
    expect(f.client.query).toHaveBeenCalledWith('ROLLBACK');
    expect(f.client.release).toHaveBeenCalledOnce();
  });
});
