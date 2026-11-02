import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import {
  AutomationBudgetError,
  beginSourceDiscovery,
  claimAutomationRun,
} from '../src/automation-store.mjs';

const owner = 'admin@example.invalid';

function queuedRunHarness(used, snapshot = { kind: 'topic_insight' }) {
  const id = randomUUID();
  const configId = randomUUID();
  const queries = [];
  const query = vi.fn(async (sql, params) => {
    queries.push(sql);
    if (sql.includes('FROM public.automation_runs WHERE id=$1 AND owner_id=$2 FOR UPDATE')) {
      return {
        rows: [
          {
            id,
            config_id: configId,
            owner_id: owner,
            status: 'queued',
            snapshot,
            trigger: 'manual',
            config_revision: 1,
          },
        ],
      };
    }
    if (sql.includes('SELECT revision,enabled FROM public.automation_configs')) {
      return { rows: [{ revision: 1, enabled: true }] };
    }
    if (sql.includes('SELECT COALESCE(sum(')) return { rows: [{ used }] };
    if (sql.includes('AS budget_day')) return { rows: [{ budget_day: '2026-11-02' }] };
    if (sql.includes("SET status='running'"))
      return {
        rows: [
          { id, status: 'running', snapshot, reserved_microusd: params[2], charged_microusd: 0 },
        ],
      };
    return { rows: [] };
  });
  return { id, queries, pool: { connect: async () => ({ query, release() {} }) } };
}

describe('automation budget claim', () => {
  it('claims discovery without a fixed reservation or daily budget check', async () => {
    const { id, queries, pool } = queuedRunHarness(75, {
      kind: 'source_collection',
      discovery: { maxSources: 5 },
    });
    await expect(
      claimAutomationRun({ pool, owner, id, limits: { batch: 100, daily: 100, reserve: 50 } }),
    ).resolves.toMatchObject({ status: 'running', reserved_microusd: 0 });
    expect(queries.some((sql) => sql.includes('SELECT COALESCE(sum('))).toBe(false);
    expect(queries.some((sql) => sql.includes("phase='budget_exceeded'"))).toBe(false);
  });
  it.each([
    ['missing limits', undefined, 0, 'not_configured'],
    ['daily limit exhausted', { batch: 100, daily: 100, reserve: 50 }, 75, 'budget_exceeded'],
  ])('records %s as a final task result', async (_label, limits, used, errorCode) => {
    const { id, queries, pool } = queuedRunHarness(used);
    await expect(claimAutomationRun({ pool, owner, id, limits })).resolves.toBeNull();
    expect(queries.some((sql) => sql.includes(`status='failed',phase='${errorCode}'`))).toBe(true);
    expect(queries).toContain('COMMIT');
    expect(queries.some((sql) => sql.includes("SET status='running'"))).toBe(false);
  });
});

function discoveryHarness({
  used = 0,
  exists = true,
  updateExists = true,
  day = '2026-11-02',
} = {}) {
  const id = randomUUID();
  const token = randomUUID();
  const calls = [];
  const query = vi.fn(async (sql, params = []) => {
    calls.push({ sql, params });
    if (sql.startsWith('SELECT id FROM public.automation_runs'))
      return { rows: exists ? [{ id }] : [] };
    if (sql.includes('AS budget_day')) return { rows: [{ budget_day: day }] };
    if (sql.includes('SELECT COALESCE(sum(')) return { rows: [{ used }] };
    if (sql.startsWith('UPDATE public.automation_runs'))
      return { rows: updateExists ? [{ id }] : [] };
    return { rows: [] };
  });
  const pool = { connect: vi.fn(async () => ({ query, release() {} })) };
  return {
    calls,
    pool,
    input: {
      pool,
      owner,
      id,
      token,
      estimateMicrousd: 1500000,
      limits: { batch: 5000000, daily: 10000000 },
    },
  };
}

describe('dynamic discovery admission', () => {
  it('reserves the model estimate after the global and task locks using one UTC day', async () => {
    const f = discoveryHarness({ used: 2500000 });
    expect(await beginSourceDiscovery(f.input)).toEqual({
      version: 1,
      estimatedMicrousd: 1500000,
      batchLimitMicrousd: 5000000,
      dailyLimitMicrousd: 10000000,
      dailyUsedMicrousd: 2500000,
      dailyRemainingMicrousd: 7500000,
    });
    const global = f.calls.findIndex(({ sql }) => sql.includes('pg_advisory_xact_lock'));
    const row = f.calls.findIndex(({ sql }) => sql.includes('FOR UPDATE'));
    const day = f.calls.findIndex(({ sql }) => sql.includes('AS budget_day'));
    const usage = f.calls.findIndex(({ sql }) => sql.includes('SELECT COALESCE(sum('));
    const write = f.calls.findIndex(({ sql }) => sql.startsWith('UPDATE public.automation_runs'));
    expect(global).toBeLessThan(row);
    expect(row).toBeLessThan(day);
    expect(day).toBeLessThan(usage);
    expect(usage).toBeLessThan(write);
    expect(f.calls[usage].params).toEqual(['2026-11-02', f.input.id]);
    expect(f.calls[write].params).toEqual([
      f.input.id,
      owner,
      f.input.token,
      '2026-11-02',
      1500000,
    ]);
    expect(f.calls[write].sql).not.toContain('AT TIME ZONE');
    expect(f.calls.filter(({ sql }) => sql.includes('AS budget_day'))).toHaveLength(1);
    expect(f.calls.at(-1).sql).toBe('COMMIT');
  });

  it.each([
    [5000001, 0, 'discovery_batch_budget_exceeded', 10000000],
    [1500000, 9000000, 'discovery_daily_budget_exceeded', 1000000],
    [1500000, 12000000, 'discovery_daily_budget_exceeded', 0],
  ])(
    'rejects estimate %s against used %s with safe diagnostics',
    async (estimate, used, code, remaining) => {
      const f = discoveryHarness({ used });
      const error = await beginSourceDiscovery({ ...f.input, estimateMicrousd: estimate }).catch(
        (error) => error,
      );
      expect(error).toBeInstanceOf(AutomationBudgetError);
      expect(error.code).toBe(code);
      expect(error.budget).toEqual({
        version: 1,
        estimatedMicrousd: estimate,
        batchLimitMicrousd: 5000000,
        dailyLimitMicrousd: 10000000,
        dailyUsedMicrousd: used,
        dailyRemainingMicrousd: remaining,
      });
      const updates = f.calls.filter(({ sql }) => sql.startsWith('UPDATE'));
      expect(updates).toHaveLength(1);
      expect(updates[0].sql).toContain("status='failed',phase='discovery_failed'");
      expect(updates[0].sql).toContain("charged_microusd=0,cost_source='estimate'");
      expect(updates[0].params[3]).toBe(code);
      expect(JSON.parse(updates[0].params[4])).toEqual(error.budget);
      expect(f.calls.at(-1).sql).toBe('COMMIT');
    },
  );

  it.each([undefined, null, 0, -1, 1.1, Infinity, '1500000', Number.MAX_SAFE_INTEGER + 1])(
    'rejects malformed estimate %s before connecting',
    async (estimateMicrousd) => {
      const f = discoveryHarness();
      await expect(beginSourceDiscovery({ ...f.input, estimateMicrousd })).rejects.toThrow(
        'invalid_request',
      );
      expect(f.pool.connect).not.toHaveBeenCalled();
    },
  );
  it.each([
    undefined,
    null,
    {},
    { batch: 1 },
    { batch: 0, daily: 1 },
    { batch: 2, daily: 1 },
    { batch: 1, daily: 50000001 },
    { batch: 1.5, daily: 2 },
  ])('rejects malformed limits %s before connecting', async (limits) => {
    const f = discoveryHarness();
    await expect(beginSourceDiscovery({ ...f.input, limits })).rejects.toThrow('not_configured');
    expect(f.pool.connect).not.toHaveBeenCalled();
  });
  it.each([undefined, 'invalid', -1, Number.MAX_SAFE_INTEGER + 1])(
    'fails closed on invalid stored usage %s',
    async (used) => {
      const f = discoveryHarness({ used: used === undefined ? null : used });
      if (used === undefined) {
        // A missing aggregate cannot be silently treated as an empty ledger.
        const base = f.pool.connect;
        f.pool.connect = async () => {
          const client = await base();
          const query = client.query;
          client.query = (sql, args) =>
            sql.includes('SELECT COALESCE(sum(') ? { rows: [] } : query(sql, args);
          return client;
        };
      }
      await expect(beginSourceDiscovery(f.input)).rejects.toThrow('database_unavailable');
    },
  );
  it('rejects replay/stale attempts before reading another budget', async () => {
    const f = discoveryHarness({ exists: false });
    await expect(beginSourceDiscovery(f.input)).rejects.toThrow('stale_attempt');
    expect(f.calls.some(({ sql }) => sql.includes('AS budget_day'))).toBe(false);
  });
  it('rolls back when the lease expires while checking the ledger', async () => {
    const f = discoveryHarness({ updateExists: false });
    await expect(beginSourceDiscovery(f.input)).rejects.toThrow('stale_attempt');
    expect(f.calls.at(-1).sql).toBe('ROLLBACK');
  });
  it('does not report a confirmed budget rejection when its COMMIT is unknown', async () => {
    const f = discoveryHarness({ used: 10000000 });
    const connect = f.pool.connect;
    f.pool.connect = async () => {
      const client = await connect();
      const query = client.query;
      client.query = (sql, params) => {
        if (sql === 'COMMIT') throw new Error('private connection error');
        return query(sql, params);
      };
      return client;
    };
    const error = await beginSourceDiscovery(f.input).catch((error) => error);
    expect(error).not.toBeInstanceOf(AutomationBudgetError);
    expect(error.code).toBe('commit_unknown');
    expect(error.message).not.toContain('private');
  });
});
