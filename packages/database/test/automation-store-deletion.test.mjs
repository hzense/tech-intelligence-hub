import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/automation-role.mjs', () => ({
  automationConfigDeletionAvailable: vi.fn(),
}));
import { automationConfigDeletionAvailable } from '../src/automation-role.mjs';
import {
  deleteAutomationConfig,
  enqueueAutomation,
  readAutomationDashboard,
  saveAutomationConfig,
} from '../src/automation-store.mjs';

const owner = 'unit-test-owner';
const id = randomUUID();
const request = { id, expectedRevision: 4, consent: true };
const deletedAt = new Date('2026-10-02T12:00:00Z');
const config = {
  name: 'Manual configuration',
  kind: 'source_collection',
  enabled: false,
  frequency: 'manual',
  sourceUrls: [],
  topicIds: [],
  profileId: randomUUID(),
  profileRevision: 1,
  discovery: { keywords: [], lookbackDays: 2, maxSources: 5 },
};
const row = { id, owner_id: owner, revision: 4, config, deleted_at: null };

function fixture({ existing = row, blocked = false, commitError = false } = {}) {
  const calls = [];
  const query = vi.fn(async (sql, params) => {
    calls.push({ sql, params });
    if (sql === 'COMMIT' && commitError) throw new Error('synthetic lost commit response');
    if (sql.startsWith('SELECT') && sql.includes('FROM public.automation_configs')) {
      if (sql.includes('count(*)')) return { rows: [{ count: 0 }] };
      if (sql.includes('deleted_at IS NULL') && existing?.deleted_at) return { rows: [] };
      return { rows: existing ? [existing] : [] };
    }
    if (sql.startsWith('SELECT 1 FROM public.automation_runs'))
      return { rows: blocked ? [{}] : [] };
    if (sql.startsWith('UPDATE public.automation_configs SET deleted_at'))
      return { rows: [{ id, revision: 5, deleted_at: deletedAt }] };
    return { rows: [] };
  });
  const release = vi.fn();
  const client = { query, release };
  const pool = { connect: vi.fn(async () => client) };
  return { pool, calls, release };
}

describe('automation configuration deletion transaction contract', () => {
  beforeEach(() => {
    vi.mocked(automationConfigDeletionAvailable).mockReset().mockResolvedValue(true);
  });

  it.each([
    { ...request, consent: false },
    { ...request, expectedRevision: 0 },
    { ...request, expectedRevision: 1.5 },
    { ...request, id: 'not-a-uuid' },
    { ...request, unexpected: true },
  ])('rejects malformed requests before obtaining a database connection', async (invalid) => {
    const { pool } = fixture();
    await expect(deleteAutomationConfig({ pool, owner, request: invalid })).rejects.toThrow(
      'invalid_request',
    );
    expect(pool.connect).not.toHaveBeenCalled();
  });

  it('serializes with owner and config locks, retains history, and updates only the configuration', async () => {
    const { pool, calls, release } = fixture();
    expect(await deleteAutomationConfig({ pool, owner, request })).toEqual({
      id,
      revision: 5,
      deleted_at: deletedAt,
    });
    const locks = calls.filter(({ sql }) => sql.includes('pg_advisory_xact_lock'));
    expect(locks.map(({ params }) => params[0])).toEqual([
      `automation:owner:${owner}`,
      `automation:${id}`,
    ]);
    const read = calls.find(({ sql }) => sql.includes('FROM public.automation_configs'));
    expect(read).toMatchObject({ params: [id, owner] });
    expect(read.sql).toContain('owner_id=$2 FOR UPDATE');
    const taskGuard = calls.find(({ sql }) =>
      sql.startsWith('SELECT 1 FROM public.automation_runs'),
    );
    expect(taskGuard.sql).toContain("status IN ('queued','running','unknown')");
    expect(taskGuard.sql).toContain('lease_token IS NOT NULL OR lease_until IS NOT NULL');
    const writes = calls.filter(({ sql }) => /^(UPDATE|INSERT|DELETE) /.test(sql));
    expect(writes).toHaveLength(1);
    expect(writes[0].sql).toContain(
      "enabled=false,config=jsonb_set(config,'{enabled}','false'::jsonb),next_run_at=NULL,revision=revision+1",
    );
    expect(writes[0].sql).toContain('AND deleted_at IS NULL');
    expect(calls.at(-1).sql).toBe('COMMIT');
    expect(release).toHaveBeenCalledOnce();
  });

  it('replays the same confirmed deletion without advancing its revision or touching runs', async () => {
    const { pool, calls } = fixture({ existing: { ...row, revision: 5, deleted_at: deletedAt } });
    expect(await deleteAutomationConfig({ pool, owner, request })).toEqual({
      id,
      revision: 5,
      deleted_at: deletedAt,
    });
    expect(calls.some(({ sql }) => /^(UPDATE|INSERT|DELETE) /.test(sql))).toBe(false);
    expect(calls.some(({ sql }) => sql.includes('automation_runs'))).toBe(false);
  });

  it.each([
    [{ existing: null }, 'not_found'],
    [{ existing: { ...row, revision: 6 } }, 'revision_conflict'],
    [{ existing: { ...row, revision: 6, deleted_at: deletedAt } }, 'revision_conflict'],
    [{ blocked: true }, 'config_in_use'],
  ])('rolls back rejected deletions without any writes', async (state, code) => {
    const { pool, calls } = fixture(state);
    await expect(deleteAutomationConfig({ pool, owner, request })).rejects.toThrow(code);
    expect(calls.at(-1).sql).toBe('ROLLBACK');
    expect(calls.some(({ sql }) => /^(UPDATE|INSERT|DELETE) /.test(sql))).toBe(false);
  });

  it('keeps pre-0027 dashboard queries compatible, but does not pretend deletion is enabled', async () => {
    vi.mocked(automationConfigDeletionAvailable).mockResolvedValue(false);
    const dashboardFixture = fixture();
    const dashboard = await readAutomationDashboard({ pool: dashboardFixture.pool, owner });
    expect(dashboard.configDeletionAvailable).toBe(false);
    expect(dashboardFixture.calls.some(({ sql }) => sql.includes('deleted_at'))).toBe(false);
    const deletionFixture = fixture();
    await expect(
      deleteAutomationConfig({ pool: deletionFixture.pool, owner, request }),
    ).rejects.toThrow('config_deletion_unavailable');
    expect(
      deletionFixture.calls.some(({ sql }) => sql.includes('FROM public.automation_configs')),
    ).toBe(false);
  });

  it('does not downgrade to old queries when a current-schema check fails', async () => {
    vi.mocked(automationConfigDeletionAvailable).mockRejectedValue(
      new Error('metadata unavailable'),
    );
    const { pool, calls } = fixture();
    await expect(readAutomationDashboard({ pool, owner })).rejects.toThrow('database_unavailable');
    expect(calls.some(({ sql }) => sql.includes('FROM public.automation_configs'))).toBe(false);
  });

  it('hides deleted configurations from the dashboard without filtering out historical runs', async () => {
    const { pool, calls } = fixture({ existing: { ...row, deleted_at: deletedAt } });
    const dashboard = await readAutomationDashboard({ pool, owner });
    expect(dashboard.configDeletionAvailable).toBe(true);
    expect(dashboard.configs).toEqual([]);
    const configRead = calls.find(({ sql }) => sql.includes('FROM public.automation_configs'));
    expect(configRead.sql).toContain('AND deleted_at IS NULL');
    const historyRead = calls.find(({ sql }) => sql.includes('FROM public.automation_runs'));
    expect(historyRead.sql).not.toContain('deleted_at');
    expect(historyRead.sql).not.toContain('automation_configs');
  });

  it('refuses to revive a deleted configuration with either a save or a new manual run', async () => {
    const { pool, calls } = fixture({ existing: { ...row, deleted_at: deletedAt } });
    await expect(
      saveAutomationConfig({ pool, owner, request: { ...request, config } }),
    ).rejects.toThrow('not_found');
    await expect(
      enqueueAutomation({
        pool,
        owner,
        request: { configId: id, expectedRevision: 4, requestId: randomUUID(), consent: true },
      }),
    ).rejects.toThrow('not_found');
    expect(calls.some(({ sql }) => /^(UPDATE|INSERT|DELETE) /.test(sql))).toBe(false);
  });

  it('reports an ambiguous commit so the caller can safely retry the same revision', async () => {
    const { pool, release } = fixture({ commitError: true });
    await expect(deleteAutomationConfig({ pool, owner, request })).rejects.toThrow(
      'commit_unknown',
    );
    expect(release).toHaveBeenCalledOnce();
  });
});
