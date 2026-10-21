import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/automation-role.mjs', () => ({
  automationConfigDeletionAvailable: vi.fn(),
}));
import { automationConfigDeletionAvailable } from '../src/automation-role.mjs';
import { normalizeAutomationConfig } from '../src/automation-contract.mjs';
import {
  enqueueAutomation,
  enqueueDueAutomations,
  readAutomationDashboard,
  readAutomationRunDetail,
  saveAutomationConfig,
} from '../src/automation-store.mjs';

const owner = 'publication-mode-owner';
const base = {
  name: 'Publication mode fixture',
  kind: 'source_collection',
  enabled: false,
  frequency: 'manual',
  sourceUrls: [],
  topicIds: [],
  profileId: randomUUID(),
  profileRevision: 1,
  discovery: { keywords: [], lookbackDays: 2, maxSources: 5 },
};
const copy = (value) => globalThis.structuredClone(value);

// Execute the real store with a stateful SQL boundary. Captured SQL additionally
// proves that dashboard projection happens before private snapshots leave PostgreSQL.
function fixture({ initialConfig, initialRuns = [], onConfigLock } = {}) {
  const configId = initialConfig?.id ?? randomUUID();
  let config = initialConfig ? copy(initialConfig) : null;
  const runs = initialRuns.map(copy);
  const calls = [];
  const projectRun = (run, sql) => {
    if (!sql.includes('AS snapshot')) return copy(run);
    return {
      id: run.id,
      status: run.status,
      phase: run.phase,
      error_code: null,
      created_at: run.created_at,
      finished_at: null,
      charged_microusd: run.charged_microusd,
      cost_source: null,
      publication_status: 'private',
      snapshot: {
        name: run.snapshot.name,
        kind: run.snapshot.kind,
        publicationMode:
          run.snapshot.kind === 'source_collection' && run.snapshot.publicationMode === 'automatic'
            ? 'automatic'
            : 'manual',
      },
      result: null,
    };
  };
  const query = vi.fn(async (sql, params = []) => {
    calls.push({ sql, params: copy(params) });
    if (sql.includes('pg_advisory_xact_lock') && params[0] === `automation:${configId}`)
      onConfigLock?.(config);
    if (sql.startsWith('SELECT') && sql.includes('FROM public.automation_configs')) {
      if (sql.includes('count(*)')) return { rows: [{ count: config ? 1 : 0 }] };
      if (!config || config.deleted_at) return { rows: [] };
      if (
        sql.includes("config->>'publicationMode' IS DISTINCT FROM 'automatic'") &&
        config.config.publicationMode === 'automatic'
      )
        return { rows: [] };
      if (sql.includes('WHERE enabled')) return { rows: config.enabled ? [copy(config)] : [] };
      if (sql.includes('WHERE owner_id=$1'))
        return { rows: config.owner_id === params[0] ? [copy(config)] : [] };
      if (config.id !== params[0]) return { rows: [] };
      if (sql.includes('owner_id=$2') && config.owner_id !== params[1]) return { rows: [] };
      return { rows: [copy(config)] };
    }
    if (sql.startsWith('INSERT INTO public.automation_configs')) {
      config = {
        id: params[0],
        owner_id: params[1],
        revision: 1,
        config: JSON.parse(params[2]),
        enabled: params[3],
        next_run_at: params[4],
        deleted_at: null,
      };
      return { rows: [copy(config)] };
    }
    if (sql.startsWith('UPDATE public.automation_configs SET revision=revision+1')) {
      config = {
        ...config,
        revision: config.revision + 1,
        config: JSON.parse(params[2]),
        enabled: params[3],
        next_run_at: params[4],
      };
      return { rows: [copy(config)] };
    }
    if (sql.startsWith('SELECT') && sql.includes('FROM public.automation_runs')) {
      if (sql.includes('SELECT 1 FROM public.automation_runs'))
        return {
          rows: runs
            .filter(
              (run) => run.config_id === params[0] && ['queued', 'running'].includes(run.status),
            )
            .map(() => ({ present: 1 })),
        };
      if (sql.includes('WHERE owner_id=$1'))
        return {
          rows: runs.filter((run) => run.owner_id === params[0]).map((run) => projectRun(run, sql)),
        };
      const row = runs.find(
        (run) =>
          run.id === params[0] ||
          (sql.includes('OR (config_id=$2 AND slot=$3)') &&
            run.config_id === params[1] &&
            run.slot === params[2]),
      );
      if (!row || (sql.includes('owner_id=$2') && row.owner_id !== params[1])) return { rows: [] };
      return { rows: [projectRun(row, sql)] };
    }
    if (sql.startsWith('INSERT INTO public.automation_runs')) {
      const row = {
        id: params[0],
        config_id: params[1],
        owner_id: params[2],
        config_revision: params[3],
        snapshot: JSON.parse(params[4]),
        slot: params[5],
        trigger: params[6],
        status: 'queued',
        phase: 'queued',
        reserved_microusd: 0,
        charged_microusd: 0,
        created_at: new Date('2026-10-21T00:00:00Z'),
      };
      runs.push(row);
      return { rows: [copy(row)] };
    }
    if (sql === 'SELECT clock_timestamp() AS now')
      return { rows: [{ now: new Date('2026-10-21T00:00:00Z') }] };
    return { rows: [] };
  });
  const pool = { connect: vi.fn(async () => ({ query, release: vi.fn() })) };
  return { pool, configId, calls, runs };
}

const configRow = (config = base) => ({
  id: randomUUID(),
  owner_id: owner,
  revision: 1,
  config: copy(config),
  enabled: config.enabled,
  deleted_at: null,
});
const save = (f, config, expectedRevision = 0) =>
  saveAutomationConfig({
    pool: f.pool,
    owner,
    request: { id: f.configId, expectedRevision, consent: true, config },
  });
const trigger = (f, requestId = randomUUID(), expectedRevision = 1, beforeEnqueue) =>
  enqueueAutomation({
    pool: f.pool,
    owner,
    request: { configId: f.configId, requestId, expectedRevision, consent: true },
    ...(beforeEnqueue ? { beforeEnqueue } : {}),
  });

describe('optional source-collection publication policy', () => {
  beforeEach(() => vi.mocked(automationConfigDeletionAvailable).mockResolvedValue(true));

  it('retains the exact legacy JSON shape instead of upgrading absent policy', () => {
    const original = JSON.stringify(base);
    expect(normalizeAutomationConfig(base)).toEqual(base);
    expect(JSON.stringify(normalizeAutomationConfig(base))).toBe(original);
    expect(Object.hasOwn(normalizeAutomationConfig(base), 'publicationMode')).toBe(false);
    expect(JSON.stringify(base)).toBe(original);
  });

  it.each(['manual', 'automatic'])('accepts and preserves explicit %s source policy', (mode) => {
    expect(normalizeAutomationConfig({ ...base, publicationMode: mode })).toEqual({
      ...base,
      publicationMode: mode,
    });
  });

  it.each([null, undefined, true, false, 1, '', 'auto', 'Automatic', 'automatic ', {}, []])(
    'rejects malformed explicit policy %j',
    (mode) => {
      expect(() => normalizeAutomationConfig({ ...base, publicationMode: mode })).toThrow(
        'invalid_request',
      );
    },
  );

  it.each(['manual', 'automatic'])('never extends topic-insight publication via %s', (mode) => {
    const insight = { ...base, kind: 'topic_insight', topicIds: ['topic-ai'] };
    delete insight.discovery;
    expect(normalizeAutomationConfig(insight)).toEqual(insight);
    expect(() => normalizeAutomationConfig({ ...insight, publicationMode: mode })).toThrow(
      'invalid_request',
    );
  });

  it('saves, reads back and revises policy without enqueueing tasks or rewriting snapshots', async () => {
    const f = fixture();
    const first = await save(f, { ...base, publicationMode: 'automatic' });
    expect(first).toMatchObject({ revision: 1, config: { publicationMode: 'automatic' } });
    expect((await readAutomationDashboard({ pool: f.pool, owner })).configs[0]).toEqual(first);
    const second = await save(f, { ...base, publicationMode: 'manual' }, first.revision);
    expect(second).toMatchObject({ revision: 2, config: { publicationMode: 'manual' } });
    expect((await readAutomationDashboard({ pool: f.pool, owner })).configs[0]).toEqual(second);
    expect(f.calls.some(({ sql }) => /^(INSERT|UPDATE).*public\.automation_runs/.test(sql))).toBe(
      false,
    );
    expect(f.runs).toEqual([]);
  });

  it('enforces owner and revision checks for changing publication mode', async () => {
    const f = fixture();
    await save(f, { ...base, publicationMode: 'manual' });
    await expect(save(f, { ...base, publicationMode: 'automatic' }, 0)).rejects.toThrow(
      'revision_conflict',
    );
    await expect(
      saveAutomationConfig({
        pool: f.pool,
        owner: 'different-owner',
        request: {
          id: f.configId,
          expectedRevision: 1,
          consent: true,
          config: { ...base, publicationMode: 'automatic' },
        },
      }),
    ).rejects.toThrow('not_found');
    expect(
      (await readAutomationDashboard({ pool: f.pool, owner })).configs[0].config.publicationMode,
    ).toBe('manual');
  });

  it.each([undefined, 'manual', 'automatic'])(
    'pins %s policy when a source run is enqueued',
    async (mode) => {
      const config = { ...base, ...(mode === undefined ? {} : { publicationMode: mode }) };
      const f = fixture({ initialConfig: configRow(config) });
      const beforeEnqueue = vi.fn(async (saved) => expect(saved).toEqual(config));
      const result = await trigger(f, undefined, 1, beforeEnqueue);
      expect(result.created).toBe(true);
      expect(result.run.snapshot).toEqual(config);
      expect(Object.hasOwn(result.run.snapshot, 'publicationMode')).toBe(mode !== undefined);
      expect(beforeEnqueue).toHaveBeenCalledOnce();
      expect(
        f.calls.find(({ sql }) => sql.startsWith('INSERT INTO public.automation_runs')).params[4],
      ).toBe(JSON.stringify(config));
    },
  );

  it.each([undefined, 'manual', 'automatic'])(
    'preserves %s run policy after config revision and same-ID replay',
    async (mode) => {
      const config = { ...base, ...(mode === undefined ? {} : { publicationMode: mode }) };
      const f = fixture({ initialConfig: configRow(config) });
      const id = randomUUID();
      const first = await trigger(f, id);
      await save(f, { ...base, publicationMode: mode === 'automatic' ? 'manual' : 'automatic' }, 1);
      const beforeEnqueue = vi.fn(() => {
        throw new Error('must not re-admit a saved task');
      });
      const replay = await trigger(f, id, 1, beforeEnqueue);
      expect(replay.created).toBe(false);
      expect(replay.run).toEqual(first.run);
      expect(replay.run.snapshot).toEqual(config);
      expect(beforeEnqueue).not.toHaveBeenCalled();
      expect(
        f.calls.filter(({ sql }) => sql.startsWith('INSERT INTO public.automation_runs')),
      ).toHaveLength(1);
      expect(
        f.calls.some(({ sql }) => /^UPDATE public\.automation_runs SET snapshot/.test(sql)),
      ).toBe(false);
    },
  );

  it('keeps the original scheduled slot snapshot when a config changes to automatic', async () => {
    const config = { ...base, enabled: true, frequency: 'daily', publicationMode: 'manual' };
    const f = fixture({ initialConfig: configRow(config) });
    const [first] = await enqueueDueAutomations({ pool: f.pool });
    expect(first.run.snapshot.publicationMode).toBe('manual');
    await save(f, { ...config, publicationMode: 'automatic' }, 1);
    const [replay] = await enqueueDueAutomations({ pool: f.pool, allowAutomaticPublication: true });
    expect(replay.created).toBe(false);
    expect(replay.run).toEqual(first.run);
    expect(
      f.calls.filter(({ sql }) => sql.startsWith('INSERT INTO public.automation_runs')),
    ).toHaveLength(1);
  });

  it.each([undefined, false])(
    'does not enqueue or advance automatic schedules when allowed=%s',
    async (allowed) => {
      const config = { ...base, enabled: true, frequency: 'daily', publicationMode: 'automatic' };
      const f = fixture({ initialConfig: configRow(config) });
      expect(
        await enqueueDueAutomations({
          pool: f.pool,
          ...(allowed === undefined ? {} : { allowAutomaticPublication: allowed }),
        }),
      ).toEqual([]);
      expect(f.calls.some(({ sql }) => /^(INSERT|UPDATE|DELETE) /.test(sql))).toBe(false);
      const selection = f.calls.find(({ sql }) => sql.includes('WHERE enabled'))?.sql;
      expect(selection).toContain("config->>'publicationMode' IS DISTINCT FROM 'automatic'");
      expect(selection.indexOf("config->>'publicationMode'")).toBeLessThan(
        selection.indexOf('LIMIT'),
      );
    },
  );

  it('enqueues an automatic schedule only with explicit server capability', async () => {
    const config = { ...base, enabled: true, frequency: 'daily', publicationMode: 'automatic' };
    const f = fixture({ initialConfig: configRow(config) });
    const result = await enqueueDueAutomations({ pool: f.pool, allowAutomaticPublication: true });
    expect(result).toHaveLength(1);
    expect(result[0].run.snapshot).toEqual(config);
    expect(
      f.calls.filter(({ sql }) => sql.startsWith('INSERT INTO public.automation_runs')),
    ).toHaveLength(1);
    expect(
      f.calls.filter(({ sql }) =>
        sql.startsWith('UPDATE public.automation_configs SET next_run_at'),
      ),
    ).toHaveLength(1);
  });

  it.each([undefined, 'manual'])(
    'still admits legacy/manual %s schedules with capability off',
    async (mode) => {
      const config = {
        ...base,
        enabled: true,
        frequency: 'daily',
        ...(mode === undefined ? {} : { publicationMode: mode }),
      };
      const f = fixture({ initialConfig: configRow(config) });
      const result = await enqueueDueAutomations({
        pool: f.pool,
        allowAutomaticPublication: false,
      });
      expect(result).toHaveLength(1);
      expect(result[0].run.snapshot).toEqual(config);
    },
  );

  it('rechecks publication capability under the config lock after a concurrent policy change', async () => {
    const config = { ...base, enabled: true, frequency: 'daily', publicationMode: 'manual' };
    const f = fixture({
      initialConfig: configRow(config),
      onConfigLock: (row) => {
        row.config.publicationMode = 'automatic';
        row.revision++;
      },
    });
    expect(await enqueueDueAutomations({ pool: f.pool })).toEqual([]);
    const selections = f.calls.filter(({ sql }) => sql.includes('FROM public.automation_configs'));
    expect(selections).toHaveLength(2);
    for (const { sql } of selections)
      expect(sql).toContain("config->>'publicationMode' IS DISTINCT FROM 'automatic'");
    expect(selections[1].sql).toContain('FOR UPDATE');
    expect(f.calls.some(({ sql }) => /^(INSERT|UPDATE|DELETE) /.test(sql))).toBe(false);
  });

  it.each([null, 0, 1, 'true', 'false', {}, []])(
    'rejects non-boolean scheduler capability %j',
    async (allowed) => {
      const f = fixture({ initialConfig: configRow() });
      await expect(
        enqueueDueAutomations({ pool: f.pool, allowAutomaticPublication: allowed }),
      ).rejects.toThrow('invalid_request');
      expect(f.pool.connect).not.toHaveBeenCalled();
    },
  );

  it.each([undefined, 'manual', 'automatic'])(
    'projects only safe %s policy metadata for dashboard and detail',
    async (mode) => {
      const config = { ...base, ...(mode === undefined ? {} : { publicationMode: mode }) };
      const f = fixture({ initialConfig: configRow(config) });
      const { run } = await trigger(f);
      const dashboard = await readAutomationDashboard({ pool: f.pool, owner });
      const detail = await readAutomationRunDetail({ pool: f.pool, owner, id: run.id });
      for (const display of [dashboard.runs[0], detail]) {
        expect(display.snapshot).toEqual({
          name: base.name,
          kind: base.kind,
          publicationMode: mode ?? 'manual',
        });
        expect(display).not.toHaveProperty('config_snapshot');
        expect(display.snapshot).not.toHaveProperty('discovery');
        expect(display.snapshot).not.toHaveProperty('profileId');
        expect(display.snapshot).not.toHaveProperty('sourceUrls');
      }
      const reads = f.calls.filter(({ sql }) => sql.includes('AS snapshot'));
      expect(reads).toHaveLength(2);
      for (const { sql } of reads) {
        expect(sql).toContain(
          "jsonb_build_object('name',snapshot->'name','kind',snapshot->'kind',",
        );
        expect(sql).toContain(
          "'publicationMode',CASE WHEN snapshot->>'publicationMode'='automatic'",
        );
        expect(sql).toContain(
          "AND snapshot->>'kind'='source_collection' THEN 'automatic' ELSE 'manual' END) AS snapshot",
        );
        expect(sql).not.toMatch(/SELECT\s+(?:\*|snapshot\b)/);
      }
    },
  );
});
