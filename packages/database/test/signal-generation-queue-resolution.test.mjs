import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { resolveQueuedSignalGeneration } from '../src/signal-generation-store.mjs';

const queuedAt = '2026-10-03T09:49:31.947Z';
function fixture(overrides = {}) {
  const row = {
    id: randomUUID(),
    owner_id: 'owner',
    status: 'pending',
    progress_phase: 'queued',
    progress_at: new Date(queuedAt),
    started_at: null,
    lease_token: null,
    lease_until: null,
    budget_day: null,
    reserved_microusd: '0',
    charged_microusd: '0',
    error_code: null,
    result: null,
    finished_at: null,
    deleted_at: null,
    snapshot: { source: 'retained private source' },
    ...overrides,
  };
  const queries = [];
  const client = {
    query: vi.fn(async (sql, params) => {
      queries.push({ sql, params });
      if (sql.includes('FOR UPDATE'))
        return { rows: [{ ...row, queued_matches: params[2] === row.progress_at?.toISOString() }] };
      if (sql.startsWith('UPDATE public.signal_generation_runs')) {
        Object.assign(row, {
          status: 'failed',
          error_code: 'generation_dispatch_failed',
          finished_at: new Date('2026-10-03T12:00:00.000Z'),
        });
        return { rows: [{ ...row }] };
      }
      return { rows: [] };
    }),
    release: vi.fn(),
  };
  const pool = { connect: vi.fn(async () => client) };
  return {
    row,
    queries,
    client,
    pool,
    args: { pool, owner: row.owner_id, id: row.id, queuedAt },
  };
}

describe('explicit resolution of a never-claimed generation dispatch', () => {
  it('locks the owner task and preserves every field except the failure receipt', async () => {
    const { row, queries, client, args } = fixture();
    const before = { ...row };
    const result = await resolveQueuedSignalGeneration(args);
    expect(result).toEqual({
      ...before,
      status: 'failed',
      error_code: 'generation_dispatch_failed',
      finished_at: new Date('2026-10-03T12:00:00.000Z'),
    });
    expect(queries.find(({ sql }) => sql.includes('FOR UPDATE')).params).toEqual([
      row.id,
      row.owner_id,
      queuedAt,
    ]);
    expect(queries.at(-1).sql).toBe('COMMIT');
    expect(client.release).toHaveBeenCalledWith(undefined);
  });

  it('reads the same dispatch failure idempotently without writing again', async () => {
    const { args, queries } = fixture();
    const resolved = await resolveQueuedSignalGeneration(args);
    expect(await resolveQueuedSignalGeneration(args)).toEqual(resolved);
    expect(queries.filter(({ sql }) => sql.startsWith('UPDATE '))).toHaveLength(1);
  });

  it.each([
    undefined,
    null,
    1791020971947,
    new Date(queuedAt),
    '',
    'not-a-date',
    '2026-10-03',
    '2026-10-03T09:49:31Z',
    '2026-10-03T09:49:31.947+00:00',
    '2026-10-03T09:49:31.9470Z',
    '2026-02-30T09:49:31.947Z',
    `${queuedAt}\n`,
  ])(
    'rejects a non-canonical queuedAt %s before acquiring a database connection',
    async (value) => {
      const { args, pool } = fixture();
      await expect(
        resolveQueuedSignalGeneration({ ...args, queuedAt: value }),
      ).rejects.toMatchObject({
        code: 'invalid_request',
      });
      expect(pool.connect).not.toHaveBeenCalled();
    },
  );

  it.each([
    [{ progress_at: new Date('2026-10-03T09:49:31.948Z') }, 'stale_attempt'],
    [{ progress_phase: null }, 'stale_attempt'],
    [{ status: 'running' }, 'task_active'],
    [{ started_at: new Date(queuedAt) }, 'task_active'],
    [{ lease_token: randomUUID() }, 'task_active'],
    [{ lease_until: new Date(queuedAt) }, 'task_active'],
    [{ budget_day: '2026-10-03' }, 'task_active'],
    [{ reserved_microusd: '1' }, 'task_active'],
    [{ charged_microusd: '1' }, 'task_active'],
    [{ status: 'completed' }, 'stale_attempt'],
    [{ status: 'cancelled' }, 'stale_attempt'],
    [{ status: 'unknown' }, 'stale_attempt'],
    [{ status: 'failed', error_code: 'generation_invalid_output' }, 'stale_attempt'],
    [{ deleted_at: new Date(queuedAt) }, 'not_found'],
  ])('rejects an ineligible receipt %j without mutation', async (overrides, code) => {
    const { args, row, queries } = fixture(overrides);
    const before = { ...row };
    await expect(resolveQueuedSignalGeneration(args)).rejects.toMatchObject({ code });
    expect(row).toEqual(before);
    expect(queries.some(({ sql }) => sql.startsWith('UPDATE '))).toBe(false);
    expect(queries.at(-1).sql).toBe('ROLLBACK');
  });

  it('does not report success for a lost commit acknowledgment', async () => {
    const { args, client } = fixture();
    const query = client.query.getMockImplementation();
    client.query.mockImplementation(async (sql, params) => {
      if (sql === 'COMMIT') throw new Error('lost commit acknowledgment');
      return query(sql, params);
    });
    await expect(resolveQueuedSignalGeneration(args)).rejects.toMatchObject({
      code: 'commit_unknown',
    });
  });
});
