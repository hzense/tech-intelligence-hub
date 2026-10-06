import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { describe, it, expect, vi } from 'vitest';
import {
  executeUnifiedSignalApply,
  unifiedCutoverGrantSql,
} from '../../../.github/scripts/unified-signal-apply.mjs';
import { assertUnifiedMaintenanceManifest } from '../../../.github/scripts/unified-signal-maintenance.mjs';
import {
  publicMaintenanceFailure,
  publicMaintenanceResult,
  validateMaintenanceRequest,
} from '../../../.github/scripts/production-maintenance.mjs';
import { loadMigrations } from '../src/migrate.mjs';
const migrations = await loadMigrations();
const hash = (v) => createHash('sha256').update(v).digest('hex');
const policy = { host: 'fixture.invalid', port: '5432', database: 'fixture', user: 'owner' };
const approval = {
  manifestFingerprint: assertUnifiedMaintenanceManifest(migrations),
  targetFingerprint: hash(
    `hzense/unified-signal-preflight-target/v1\0${JSON.stringify(Object.values(policy))}`,
  ),
  planFingerprint: 'a'.repeat(64),
  aclFingerprint: 'b'.repeat(64),
  backupIdSha256: hash('reviewed-test-backup'),
};
function fixture() {
  const clients = [],
    queries = [];
  let ready = false;
  const receipt = {
    signalCount: 114,
    versionCount: 120,
    publicCount: 112,
    sourceFingerprint: 'c'.repeat(64),
    planFingerprint: approval.planFingerprint,
    publicIdFingerprint: 'd'.repeat(64),
    verificationCompleted: true,
  };
  const deps = {
    options: { connectionString: 'never-print-private-url' },
    validateConnectionTarget: vi.fn(() => policy),
    loadMigrations: vi.fn(async () => migrations),
    verifyMigrationManifest: vi.fn(),
    verifyDatabaseContract: vi.fn(async () => ({ migrationCount: 31, tableCount: 62 })),
    migrationLockKeys: [1, 2],
    inspectDatabasePreflight: vi.fn(async () => ({ ...policy, pendingMigrations: [] })),
    runtimeAclBackupReference: vi.fn((v) => v),
    inspectRuntimeAclBaseline: vi.fn(async () => ({ fingerprint: approval.aclFingerprint })),
    inspectUnifiedCutoverGrants: vi.fn(),
    createClient: vi.fn(() => {
      const client = Object.assign(new EventEmitter(), {
        connect: vi.fn(),
        end: vi.fn(async () => {}),
        query: vi.fn(async (sql) => {
          queries.push(sql);
          if (sql.includes('pg_try_advisory_lock')) return { rows: [{ locked: true }] };
          if (sql.startsWith('SELECT ready,plan_hash'))
            return { rows: [{ ready, plan_hash: ready ? approval.planFingerprint : null }] };
          if (sql.startsWith('UPDATE public.unified_signal_cutover')) {
            ready = true;
            return { rowCount: 1, rows: [] };
          }
          return { rows: [] };
        }),
      });
      clients.push(client);
      return client;
    }),
    applyUnifiedSignalBackfill: vi.fn(async (_, { checkBeforeCommit }) => {
      await checkBeforeCommit();
      return { ...receipt, committed: true, inserted: 114 };
    }),
    verifyUnifiedSignalBackfill: vi.fn(async () => receipt),
  };
  const context = { checkFreshness: vi.fn(), checkApproval: vi.fn() };
  const execute = (operation = 'unified-signal-apply', a = approval) =>
    executeUnifiedSignalApply(
      { MAINTENANCE_BACKUP_ID: 'reviewed-test-backup' },
      { operation, approval: a },
      context,
      deps,
    );
  return {
    deps,
    clients,
    queries,
    context,
    execute,
    activate: () => {
      ready = true;
    },
  };
}
describe('protected unified cutover orchestration', () => {
  it('binds target, schema, source plan and ACL; grants and activation precede commit, verify uses another connection', async () => {
    const f = fixture();
    const result = await f.execute();
    expect(f.clients).toHaveLength(2);
    expect(f.clients.every((c) => c.end.mock.calls.length === 1)).toBe(true);
    expect(f.deps.verifyUnifiedSignalBackfill).toHaveBeenCalledWith(f.clients[1], {
      expectedPlanHash: approval.planFingerprint,
    });
    expect(f.queries).toContain(unifiedCutoverGrantSql);
    expect(f.context.checkApproval).toHaveBeenCalledTimes(2);
    expect(publicMaintenanceResult('unified-signal-apply', result)).toMatchObject({
      committed: true,
      verificationCompleted: true,
      cutoverReady: true,
      publicCount: 112,
      previewOnly: false,
    });
    expect(JSON.stringify(publicMaintenanceResult('unified-signal-apply', result))).not.toContain(
      'private-url',
    );
  });
  it('verify only reads, independently deriving the approved plan from protected state', async () => {
    const f = fixture();
    f.activate();
    await f.execute('unified-signal-verify', undefined);
    expect(f.deps.applyUnifiedSignalBackfill).not.toHaveBeenCalled();
    expect(f.clients).toHaveLength(1);
    expect(f.queries.some((q) => /GRANT|^UPDATE|pg_try_advisory_lock/.test(q))).toBe(false);
  });
  it.each(['manifestFingerprint', 'targetFingerprint', 'backupIdSha256'])(
    'rejects mismatched %s before opening a write session',
    async (key) => {
      const f = fixture();
      await expect(
        f.execute('unified-signal-apply', { ...approval, [key]: 'e'.repeat(64) }),
      ).rejects.toThrow();
      expect(f.clients).toHaveLength(0);
      expect(f.deps.applyUnifiedSignalBackfill).not.toHaveBeenCalled();
    },
  );
  it.each(['acl', 'schema', 'pending', 'freshness', 'approval', 'grant', 'already-ready'])(
    'stops %s failure without retrying the application',
    async (mode) => {
      const f = fixture();
      if (mode === 'acl')
        f.deps.inspectRuntimeAclBaseline.mockResolvedValue({ fingerprint: 'f'.repeat(64) });
      if (mode === 'schema')
        f.deps.verifyDatabaseContract.mockResolvedValue({ migrationCount: 30, tableCount: 61 });
      if (mode === 'pending')
        f.deps.inspectDatabasePreflight.mockResolvedValue({
          ...policy,
          pendingMigrations: ['0030'],
        });
      if (mode === 'freshness') f.context.checkFreshness.mockRejectedValue(new Error('stale'));
      if (mode === 'approval')
        f.context.checkApproval.mockImplementation(() => {
          throw new Error('expired');
        });
      if (mode === 'grant')
        f.deps.inspectUnifiedCutoverGrants.mockRejectedValue(new Error('unsafe-grants'));
      if (mode === 'already-ready') f.activate();
      await expect(f.execute()).rejects.toThrow();
      expect(f.deps.applyUnifiedSignalBackfill.mock.calls.length).toBeLessThanOrEqual(1);
      expect(f.clients.every((c) => c.end.mock.calls.length === 1)).toBe(true);
      expect(f.deps.verifyUnifiedSignalBackfill).not.toHaveBeenCalled();
    },
  );
  it('marks commit ambiguity and independent verification failure without leaking provider details', async () => {
    for (const mode of ['commit', 'verify']) {
      const f = fixture();
      if (mode === 'commit')
        f.deps.applyUnifiedSignalBackfill.mockImplementation(async (_, o) => {
          await o.checkBeforeCommit();
          throw new Error('private-url');
        });
      else f.deps.verifyUnifiedSignalBackfill.mockRejectedValue(new Error('private-url'));
      const error = await f.execute().catch((e) => e);
      expect(publicMaintenanceFailure(error)).toMatchObject({
        migrationMayHaveCommitted: true,
        verificationCompleted: false,
      });
      expect(JSON.stringify(publicMaintenanceFailure(error))).not.toContain('private-url');
      expect(f.deps.applyUnifiedSignalBackfill).toHaveBeenCalledOnce();
    }
  });
  it('requires a fresh run-bound verified-recovery approval explicitly covering ACL and cutover', () => {
    const now = Date.parse('2026-10-06T12:00:00Z');
    const env = {
      GITHUB_ACTIONS: 'true',
      GITHUB_REPOSITORY: 'hzense/tech-intelligence-hub',
      GITHUB_EVENT_NAME: 'workflow_dispatch',
      GITHUB_REF: 'refs/heads/main',
      GITHUB_SHA: 'a'.repeat(40),
      GITHUB_RUN_ID: '123',
      GITHUB_RUN_ATTEMPT: '1',
      MAINTENANCE_OPERATION: 'unified-signal-apply',
      MAINTENANCE_BACKUP_ID: 'reviewed-test-backup',
    };
    const approved = {
      ...approval,
      operation: env.MAINTENANCE_OPERATION,
      sha: env.GITHUB_SHA,
      runId: '123',
      runAttempt: '1',
      expiresAt: '2026-10-06T13:00:00Z',
      backupExpiresAt: '2026-10-07T13:00:00Z',
      backupVerified: true,
      restoreRehearsed: true,
      aclRecoveryReviewed: true,
      ddlFreezeConfirmed: true,
      restoreEvidenceFingerprint: 'c'.repeat(64),
      roleUpgradeApproved: true,
      cutoverApproved: true,
    };
    const validate = (a) =>
      validateMaintenanceRequest({ ...env, MAINTENANCE_APPROVAL: JSON.stringify(a) }, now);
    expect(validate(approved).operation).toBe(env.MAINTENANCE_OPERATION);
    for (const [key, value] of [
      ['roleUpgradeApproved', false],
      ['cutoverApproved', false],
      ['restoreRehearsed', false],
      ['ddlFreezeConfirmed', false],
      ['planFingerprint', 'invalid'],
      ['runAttempt', '2'],
      ['sha', 'b'.repeat(40)],
      ['expiresAt', '2026-10-06T11:00:00Z'],
    ])
      expect(() => validate({ ...approved, [key]: value })).toThrow();
  });
});
