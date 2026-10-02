import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/automation-role.mjs', () => ({
  automationConfigDeletionAvailable: vi.fn(),
}));
import { automationConfigDeletionAvailable } from '../src/automation-role.mjs';
import {
  AutomationError,
  enqueueAutomation,
  enqueueDueAutomations,
} from '../src/automation-store.mjs';

const owner = 'admission-test-owner';
const configId = randomUUID();
const insightId = randomUUID();
const request = { configId, requestId: randomUUID(), expectedRevision: 3, consent: true };
const config = {
  name: 'Source admission',
  kind: 'source_collection',
  enabled: true,
  frequency: 'daily',
  sourceUrls: [],
  topicIds: [],
  profileId: randomUUID(),
  profileRevision: 1,
  discovery: { keywords: [], lookbackDays: 2, maxSources: 5 },
};
const source = {
  id: configId,
  owner_id: owner,
  revision: 3,
  config,
  enabled: true,
  deleted_at: null,
};
const insight = {
  ...source,
  id: insightId,
  config: { ...config, name: 'Insight admission', kind: 'topic_insight', topicIds: ['topic-ai'] },
};
delete insight.config.discovery;
const existingRun = {
  id: request.requestId,
  owner_id: owner,
  config_id: configId,
  config_revision: 3,
  snapshot: config,
  slot: `manual:${request.requestId}`,
  trigger: 'manual',
  status: 'queued',
  phase: 'queued',
  reserved_microusd: 0,
  charged_microusd: 0,
};

function fixture({ rows = [source, insight], replay = null, onConfigLock } = {}) {
  const calls = [];
  let listed = false;
  const query = vi.fn(async (sql, params = []) => {
    calls.push({ sql, params });
    if (sql.includes('pg_advisory_xact_lock') && listed && onConfigLock) onConfigLock(params[0]);
    if (sql.startsWith('SELECT') && sql.includes('FROM public.automation_configs')) {
      if (sql.includes('WHERE enabled')) {
        listed = true;
        const selected = sql.includes('ANY($2::text[])')
          ? rows.filter((row) => params[1].includes(row.config.kind))
          : rows;
        return { rows: selected.slice(0, params[0]) };
      }
      const row = rows.find((row) => row.id === params[0]);
      if (!row || (sql.includes('owner_id=$2') && row.owner_id !== params[1]) || row.deleted_at)
        return { rows: [] };
      if (sql.includes('ANY($2::text[])') && !params[1].includes(row.config.kind))
        return { rows: [] };
      return { rows: [row] };
    }
    if (sql.startsWith('SELECT') && sql.includes('FROM public.automation_runs WHERE id=$1'))
      return { rows: replay ? [replay] : [] };
    if (sql === 'SELECT clock_timestamp() AS now')
      return { rows: [{ now: new Date('2026-10-03T00:00:00Z') }] };
    if (sql.startsWith('INSERT INTO public.automation_runs'))
      return {
        rows: [
          {
            ...existingRun,
            id: params[0],
            config_id: params[1],
            snapshot: JSON.parse(params[4]),
            trigger: params[6],
          },
        ],
      };
    return { rows: [] };
  });
  const release = vi.fn();
  const pool = { connect: vi.fn(async () => ({ query, release })) };
  return { pool, calls, release };
}

describe('automation execution admission before task mutation', () => {
  beforeEach(() => vi.mocked(automationConfigDeletionAvailable).mockResolvedValue(true));

  it('rejects missing execution dependencies before any task write or dispatch-unknown receipt', async () => {
    const f = fixture();
    const beforeEnqueue = vi.fn(() => {
      throw new AutomationError('not_configured');
    });
    await expect(
      enqueueAutomation({ pool: f.pool, owner, request, beforeEnqueue }),
    ).rejects.toThrow('not_configured');
    expect(beforeEnqueue).toHaveBeenCalledWith(config);
    expect(f.calls.some(({ sql }) => /^(INSERT|UPDATE|DELETE) /.test(sql))).toBe(false);
    expect(f.calls.at(-1).sql).toBe('ROLLBACK');
    expect(f.release).toHaveBeenCalledOnce();
  });

  it('runs admission on the locked owner-scoped revision before insertion', async () => {
    const f = fixture();
    const beforeEnqueue = vi.fn(async () => {
      expect(
        f.calls.some(
          ({ sql, params }) =>
            sql.includes('pg_advisory_xact_lock') && params[0] === `automation:${configId}`,
        ),
      ).toBe(true);
      expect(
        f.calls.some(({ sql, params }) => sql.includes('owner_id=$2') && params[1] === owner),
      ).toBe(true);
      expect(f.calls.some(({ sql }) => sql.startsWith('INSERT'))).toBe(false);
    });
    expect((await enqueueAutomation({ pool: f.pool, owner, request, beforeEnqueue })).created).toBe(
      true,
    );
    expect(beforeEnqueue).toHaveBeenCalledOnce();
    expect(
      f.calls.filter(({ sql }) => sql.startsWith('INSERT INTO public.automation_runs')),
    ).toHaveLength(1);
    expect(f.calls.at(-1).sql).toBe('COMMIT');
  });

  it('replays an old request without applying new profile or service requirements', async () => {
    const f = fixture({ rows: [{ ...source, revision: 4 }], replay: existingRun });
    const beforeEnqueue = vi.fn(() => {
      throw new AutomationError('profile_not_ready');
    });
    const result = await enqueueAutomation({ pool: f.pool, owner, request, beforeEnqueue });
    expect(result.created).toBe(false);
    expect(result.run.id).toBe(request.requestId);
    expect(beforeEnqueue).not.toHaveBeenCalled();
    expect(f.calls.some(({ sql }) => /^(INSERT|UPDATE|DELETE) /.test(sql))).toBe(false);
  });

  it.each([
    [{ ...source, revision: 4 }, 'revision_conflict'],
    [{ ...source, owner_id: 'another-owner' }, 'not_found'],
    [{ ...source, deleted_at: new Date() }, 'not_found'],
  ])('does not run profile access for unavailable or stale configurations', async (row, code) => {
    const f = fixture({ rows: [row] });
    const beforeEnqueue = vi.fn();
    await expect(
      enqueueAutomation({ pool: f.pool, owner, request, beforeEnqueue }),
    ).rejects.toThrow(code);
    expect(beforeEnqueue).not.toHaveBeenCalled();
  });

  it('rejects a mismatched replay without calling admission', async () => {
    const f = fixture({ replay: { ...existingRun, owner_id: 'another-owner' } });
    const beforeEnqueue = vi.fn();
    await expect(
      enqueueAutomation({ pool: f.pool, owner, request, beforeEnqueue }),
    ).rejects.toThrow('request_id_conflict');
    expect(beforeEnqueue).not.toHaveBeenCalled();
  });

  it('refuses a non-callable server admission hook before opening a transaction', async () => {
    const f = fixture();
    await expect(
      enqueueAutomation({ pool: f.pool, owner, request, beforeEnqueue: true }),
    ).rejects.toThrow('invalid_request');
    expect(f.pool.connect).not.toHaveBeenCalled();
  });

  it('does not connect or advance schedules when no kind is ready', async () => {
    const f = fixture();
    expect(await enqueueDueAutomations({ pool: f.pool, kinds: [] })).toEqual([]);
    expect(f.pool.connect).not.toHaveBeenCalled();
  });

  it.each([null, 'source_collection', ['other'], ['topic_insight', 'topic_insight'], [undefined]])(
    'rejects invalid kind admission filters',
    async (kinds) => {
      const f = fixture();
      await expect(enqueueDueAutomations({ pool: f.pool, kinds })).rejects.toThrow(
        'invalid_request',
      );
      expect(f.pool.connect).not.toHaveBeenCalled();
    },
  );

  it('filters before LIMIT and under the config lock without advancing excluded schedules', async () => {
    const f = fixture();
    const result = await enqueueDueAutomations({
      pool: f.pool,
      limit: 1,
      kinds: ['topic_insight'],
    });
    expect(result).toHaveLength(1);
    expect(result[0].run.config_id).toBe(insightId);
    const selected = f.calls.filter(({ sql }) => sql.includes('FROM public.automation_configs'));
    expect(selected).toHaveLength(2);
    for (const call of selected) {
      expect(call.sql).toContain("config->>'kind'=ANY($2::text[])");
      expect(call.params[1]).toEqual(['topic_insight']);
    }
    const updates = f.calls.filter(({ sql }) => sql.startsWith('UPDATE public.automation_configs'));
    expect(updates).toHaveLength(1);
    expect(updates[0].params[0]).toBe(insightId);
  });

  it('skips a configuration whose kind changed before its locked reread', async () => {
    const current = { ...insight, config: { ...insight.config } };
    const f = fixture({
      rows: [current],
      onConfigLock: () => {
        current.config = config;
      },
    });
    expect(await enqueueDueAutomations({ pool: f.pool, kinds: ['topic_insight'] })).toEqual([]);
    expect(f.calls.some(({ sql }) => /^(INSERT|UPDATE|DELETE) /.test(sql))).toBe(false);
  });
});
