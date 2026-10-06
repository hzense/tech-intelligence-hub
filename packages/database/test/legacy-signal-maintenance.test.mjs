import { EventEmitter } from 'node:events';
import { URL } from 'node:url';
import { readFile } from 'node:fs/promises';
import { describe, expect, it, vi } from 'vitest';
import {
  executeLegacySignalMaintenance,
  legacySignalMaintenancePlan,
  legacyMigrationName,
} from '../../../.github/scripts/legacy-signal-maintenance.mjs';
import {
  validateMaintenanceRequest,
  publicMaintenanceFailure,
} from '../../../.github/scripts/production-maintenance.mjs';
import { loadMigrations } from '../src/migrate.mjs';

// Historical 0028 approval stays frozen; it must never authorize newer DDL.
const allMigrations = await loadMigrations();
const migrations = allMigrations.filter((row) => row.name <= legacyMigrationName);
const policy = {
  host: 'reviewed.invalid',
  port: '5432',
  database: 'fixture',
  user: 'fixture_owner',
};
const initial = {
  database: policy.database,
  user: policy.user,
  pendingMigrations: [legacyMigrationName],
};
const archivePlan = { count: 110, plan_hash: 'a'.repeat(64) };
const backupId = 'synthetic-legacy-signal-backup';
const plan = () =>
  legacySignalMaintenancePlan({ migrations, policy, preflight: initial, backupId, archivePlan });
const now = Date.parse('2026-10-04T20:00:00Z');
const approval = () => ({
  operation: 'legacy-signal-apply',
  sha: 'd'.repeat(40),
  runId: '1234',
  runAttempt: '1',
  expiresAt: '2026-10-04T21:00:00Z',
  backupExpiresAt: '2026-10-05T21:00:00Z',
  backupVerified: true,
  restoreRehearsed: true,
  aclRecoveryReviewed: true,
  ddlFreezeConfirmed: true,
  roleUpgradeApproved: true,
  aclFingerprint: 'b'.repeat(64),
  restoreEvidenceFingerprint: 'c'.repeat(64),
  ...plan(),
});
const environment = (changes = {}) => ({
  GITHUB_ACTIONS: 'true',
  GITHUB_REPOSITORY: 'hzense/tech-intelligence-hub',
  GITHUB_EVENT_NAME: 'workflow_dispatch',
  GITHUB_REF: 'refs/heads/main',
  GITHUB_SHA: 'd'.repeat(40),
  GITHUB_RUN_ID: '1234',
  GITHUB_RUN_ATTEMPT: '1',
  MAINTENANCE_OPERATION: 'legacy-signal-apply',
  MAINTENANCE_BACKUP_ID: backupId,
  MAINTENANCE_APPROVAL: JSON.stringify({ ...approval(), ...changes }),
});
function fixture() {
  const state = { completed: false, queries: [], clients: [] };
  const deps = {
    options: { connectionString: 'synthetic', expectedPostgresMajor: 18 },
    archivePlan,
    validateConnectionTarget: () => policy,
    loadMigrations: async () => migrations,
    verifyMigrationManifest: vi.fn(),
    migrationLockKeys: [1215921955, 1298498925],
    inspectDatabasePreflight: vi.fn(async () => ({
      ...initial,
      pendingMigrations: state.completed ? [] : [legacyMigrationName],
    })),
    inspectRuntimeAclBaseline: vi.fn(async () => ({ fingerprint: 'b'.repeat(64) })),
    runtimeAclBackupReference: (id) => ({ id }),
    verifyDatabaseContract: vi.fn(async () => ({ migrationCount: 29, tableCount: 61 })),
    reconcileLegacySignalArchive: vi.fn(async () => ({ existing: 110, missing: [], count: 110 })),
    applyLegacySignalArchive: vi.fn(async () => ({ inserted: 110, count: 110 })),
    createClient: () => {
      const client = Object.assign(new EventEmitter(), {
        connect: vi.fn(),
        end: vi.fn(),
        query: vi.fn(async (sql) => {
          state.queries.push(sql);
          if (sql === 'COMMIT') state.completed = true;
          if (sql.includes('pg_try_advisory_lock')) return { rows: [{ locked: true }] };
          if (sql.includes('AS valid')) return { rows: [{ valid: true }] };
          return { rows: [] };
        }),
      });
      state.clients.push(client);
      return client;
    },
  };
  const context = { checkFreshness: vi.fn(), checkApproval: vi.fn() };
  const execute = (operation = 'legacy-signal-apply', patch = {}) =>
    executeLegacySignalMaintenance(
      { MAINTENANCE_BACKUP_ID: backupId },
      { operation, approval: { ...approval(), ...patch } },
      context,
      deps,
    );
  return { state, deps, context, execute };
}

describe('protected legacy signal migration', () => {
  it('refuses the newer unified-storage migration under the historical approval', () => {
    expect(() =>
      legacySignalMaintenancePlan({
        migrations: allMigrations,
        policy,
        preflight: initial,
        backupId,
        archivePlan,
      }),
    ).toThrow('legacy-signal-manifest-required');
  });
  it('binds artifact content, target, backup, pending state and original immutable manifest', () => {
    expect(plan()).toMatchObject({ contentFingerprint: archivePlan.plan_hash });
    for (const change of [
      { migrations: migrations.slice(1) },
      {
        migrations: migrations.map((row, index) =>
          index === 2 ? { ...row, sql: `${row.sql}\n` } : row,
        ),
      },
      {
        preflight: {
          ...initial,
          pendingMigrations: ['0027_automation_config_deletion.sql', legacyMigrationName],
        },
      },
      { policy: { ...policy, database: 'different' } },
      { archivePlan: { ...archivePlan, count: 111 } },
      { backupId: 'placeholder-backup' },
    ])
      expect(() =>
        legacySignalMaintenancePlan({
          migrations,
          policy,
          preflight: initial,
          backupId,
          archivePlan,
          ...change,
        }),
      ).toThrow();
    const replaced = legacySignalMaintenancePlan({
      migrations,
      policy,
      preflight: initial,
      backupId: 'synthetic-new-backup',
      archivePlan,
    });
    expect(replaced.planFingerprint).not.toBe(plan().planFingerprint);
  });
  it('requires verified recovery, exact new run approval and explicit reader grant', () => {
    expect(validateMaintenanceRequest(environment(), now).approval).toEqual(approval());
    for (const patch of [
      { recoveryPolicy: 'accept-unverified-fts1' },
      { runId: '1235' },
      { restoreRehearsed: false },
      { roleUpgradeApproved: false },
      { contentFingerprint: null },
      { targetFingerprint: null },
      { expiresAt: '2026-10-04T19:00:00Z' },
    ])
      expect(() => validateMaintenanceRequest(environment(patch), now)).toThrow();
  });
  it('dry-run double captures through independent sessions and never sends DDL or grants', async () => {
    const { execute, state, deps } = fixture();
    expect(await execute('legacy-signal-dry-run')).toMatchObject({
      ...plan(),
      committed: false,
      desiredCount: 110,
      aclFingerprint: 'b'.repeat(64),
    });
    expect(state.clients).toHaveLength(2);
    expect(deps.inspectRuntimeAclBaseline).toHaveBeenCalledTimes(2);
    expect(deps.applyLegacySignalArchive).not.toHaveBeenCalled();
    expect(
      state.queries.some(
        (sql) =>
          sql === 'BEGIN' ||
          sql === 'COMMIT' ||
          sql.startsWith('GRANT') ||
          sql === migrations[28].sql,
      ),
    ).toBe(false);
  });
  it('rejects inconsistent independent captures', async () => {
    const { execute, deps } = fixture();
    deps.inspectRuntimeAclBaseline
      .mockResolvedValueOnce({ fingerprint: 'b'.repeat(64) })
      .mockResolvedValueOnce({ fingerprint: 'f'.repeat(64) });
    await expect(execute('legacy-signal-dry-run')).rejects.toThrow('stopped');
  });
  it('commits schema, ledger, full import and narrow grant together then independently verifies', async () => {
    const { execute, state, deps, context } = fixture();
    const result = await execute();
    expect(result).toMatchObject({
      desiredCount: 110,
      inserted: 110,
      committed: true,
      verificationCompleted: true,
      migrationCount: 29,
      tableCount: 61,
    });
    expect(result.planFingerprint).toBe(plan().planFingerprint);
    expect(result.planFingerprint).not.toBe(
      legacySignalMaintenancePlan({
        migrations,
        policy,
        preflight: { ...initial, pendingMigrations: [] },
        backupId,
        archivePlan,
      }).planFingerprint,
    );
    expect(state.clients).toHaveLength(2);
    const begin = state.queries.indexOf('BEGIN'),
      ddl = state.queries.indexOf(migrations[28].sql),
      ledger = state.queries.findIndex((sql) =>
        sql.startsWith('INSERT INTO public.hzense_schema_migrations'),
      ),
      grant = state.queries.findIndex((sql) => sql.startsWith('GRANT')),
      commit = state.queries.indexOf('COMMIT');
    expect(begin).toBeLessThan(ddl);
    expect(ddl).toBeLessThan(ledger);
    expect(ledger).toBeLessThan(grant);
    expect(grant).toBeLessThan(commit);
    expect(deps.applyLegacySignalArchive).toHaveBeenCalledWith(state.clients[0], archivePlan);
    expect(deps.verifyDatabaseContract).toHaveBeenCalledOnce();
    expect(deps.reconcileLegacySignalArchive).toHaveBeenCalledWith(state.clients[1], archivePlan);
    expect(context.checkFreshness.mock.calls.length).toBeGreaterThanOrEqual(4);
  });
  it.each(['approved-plan', 'acl', 'pending', 'role'])(
    'refuses %s drift before first write',
    async (kind) => {
      const { execute, state, deps } = fixture();
      let patch = {};
      if (kind === 'approved-plan') patch = { contentFingerprint: 'e'.repeat(64) };
      if (kind === 'acl')
        deps.inspectRuntimeAclBaseline.mockResolvedValue({ fingerprint: 'e'.repeat(64) });
      if (kind === 'pending') state.completed = true;
      if (kind === 'role') {
        const create = deps.createClient;
        deps.createClient = () => {
          const client = create();
          const query = client.query;
          client.query = vi.fn((sql, ...args) =>
            sql.includes('FROM pg_roles WHERE')
              ? Promise.resolve({ rows: [{ valid: false }] })
              : query(sql, ...args),
          );
          return client;
        };
      }
      await expect(execute('legacy-signal-apply', patch)).rejects.toThrow('stopped');
      expect(state.queries.includes('BEGIN')).toBe(false);
      expect(deps.applyLegacySignalArchive).not.toHaveBeenCalled();
    },
  );
  it('rolls back the whole transaction if freshness expires before commit', async () => {
    const { execute, state, context } = fixture();
    context.checkFreshness
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('stale'));
    await expect(execute()).rejects.toThrow('stopped');
    expect(state.queries).toContain(migrations[28].sql);
    expect(state.queries).not.toContain('COMMIT');
    expect(state.queries.at(-2)).toBe('ROLLBACK');
  });
  it('reports unknown commit as failed and never retries', async () => {
    const { execute, state, deps } = fixture();
    const create = deps.createClient;
    deps.createClient = () => {
      const client = create();
      const query = client.query;
      client.query = vi.fn((sql, ...args) =>
        sql === 'COMMIT'
          ? Promise.reject(new Error('secret raw provider message'))
          : query(sql, ...args),
      );
      return client;
    };
    const error = await execute().catch((value) => value);
    expect(publicMaintenanceFailure(error)).toEqual({
      status: 'failed',
      category: 'database-or-contract-check-failed',
      operation: 'legacy-signal-apply',
      migrationMayHaveCommitted: true,
      verificationCompleted: false,
    });
    expect(state.clients).toHaveLength(1);
    expect(deps.applyLegacySignalArchive).toHaveBeenCalledOnce();
  });
  it('never reports verify success when a row is missing or connection cleanup fails', async () => {
    for (const failure of ['missing', 'close']) {
      const { execute, state, deps } = fixture();
      state.completed = true;
      if (failure === 'missing')
        deps.reconcileLegacySignalArchive.mockResolvedValue({
          existing: 109,
          missing: ['missing-id'],
        });
      else {
        const create = deps.createClient;
        deps.createClient = () => {
          const c = create();
          c.end.mockRejectedValue(new Error('closefailed'));
          return c;
        };
      }
      await expect(execute('legacy-signal-verify')).rejects.toThrow('stopped');
      expect(deps.applyLegacySignalArchive).not.toHaveBeenCalled();
    }
  });
  it('keeps workflow secret bindings bounded to the new operations', async () => {
    const text = await readFile(
      new URL('../../../.github/workflows/production-maintenance.yml', import.meta.url),
      'utf8',
    );
    expect(text).toContain(
      "inputs.operation == 'legacy-signal-apply' || inputs.operation == 'unified-signal-apply') && secrets.MAINTENANCE_APPROVAL",
    );
    expect(text).not.toContain(
      "inputs.operation == 'legacy-signal-dry-run') && secrets.MAINTENANCE_APPROVAL",
    );
  });
});
