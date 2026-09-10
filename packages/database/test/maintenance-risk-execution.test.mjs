import { createHash } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { runMaintenance } from '../../../.github/scripts/production-maintenance.mjs';

const mocks = vi.hoisted(() => ({
  preflight: vi.fn(),
  migrate: vi.fn(),
  verify: vi.fn(),
  apply: vi.fn(),
}));
vi.mock('../src/connection-policy.mjs', () => ({
  productionDatabaseOptions: () => ({ connectionString: 'test-only' }),
  validateConnectionTarget: () => ({ host: 'test-only' }),
}));
vi.mock('../src/preflight.mjs', () => ({
  inspectDatabasePreflight: mocks.preflight,
  runDatabasePreflight: mocks.preflight,
}));
vi.mock('../src/migrate.mjs', () => ({ runMigrations: mocks.migrate }));
vi.mock('../src/verify.mjs', () => ({ verifyDatabaseContract: mocks.verify }));

const now = Date.parse('2026-09-10T10:00:00Z');
function environment(changes = {}) {
  const backup = 'test-backup-20260910';
  const sha = 'a'.repeat(40);
  return {
    GITHUB_ACTIONS: 'true',
    GITHUB_REPOSITORY: 'hzense/tech-intelligence-hub',
    GITHUB_EVENT_NAME: 'workflow_dispatch',
    GITHUB_REF: 'refs/heads/main',
    GITHUB_SHA: sha,
    GITHUB_RUN_ID: '123',
    GITHUB_RUN_ATTEMPT: '1',
    GH_TOKEN: 'test-only',
    MAINTENANCE_OPERATION: 'migrate',
    MAINTENANCE_BACKUP_ID: backup,
    MAINTENANCE_APPROVAL: JSON.stringify({
      operation: 'migrate',
      sha,
      runId: '123',
      runAttempt: '1',
      expiresAt: '2026-09-10T11:00:00Z',
      backupNeverExpires: true,
      backupIdSha256: createHash('sha256').update(backup).digest('hex'),
      backupVerified: false,
      backupPresenceReviewed: true,
      ddlFreezeConfirmed: true,
      restoreRehearsed: false,
      aclRecoveryReviewed: false,
      aclFingerprint: 'b'.repeat(64),
      recoveryPolicy: 'accept-unverified-fts1',
      riskAcceptance: {
        scope: 'fts1-production-launch',
        accepted: true,
        historicalAclGapAccepted: true,
        acknowledgement: 'recovery-unverified-data-loss-or-prolonged-outage-accepted',
      },
      ...changes,
    }),
  };
}
function options() {
  const ref = { ref: 'refs/heads/main', object: { type: 'commit', sha: 'a'.repeat(40) } };
  const run = {
    id: 1,
    path: '.github/workflows/ci.yml',
    repository: { full_name: 'hzense/tech-intelligence-hub' },
    head_sha: 'a'.repeat(40),
    head_branch: 'main',
    event: 'push',
    status: 'completed',
    conclusion: 'success',
  };
  const response = (json) => ({ status: 200, json: async () => json });
  return {
    now: () => now,
    fetchImpl: vi
      .fn()
      .mockResolvedValueOnce(response(ref))
      .mockResolvedValueOnce(response({ workflow_runs: [run] }))
      .mockResolvedValueOnce(response(ref)),
  };
}

describe('real hosted executor FTS-1 risk boundary (database adapters mocked)', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.preflight.mockResolvedValue({ pendingMigrations: ['0003_search_documents_fts.sql'] });
    mocks.verify.mockResolvedValue({ migrationCount: 4 });
    mocks.migrate.mockImplementation(async ({ beforeMigrate, beforeApply }) => {
      await beforeMigrate({});
      if (beforeApply) await beforeApply(['0003_search_documents_fts.sql']);
      mocks.apply();
    });
  });
  it('runs both scope checks and verifies the contract after FTS-1 migration', async () => {
    const result = await runMaintenance(environment(), undefined, options());
    expect(result).toMatchObject({
      status: 'succeeded',
      recoveryVerified: false,
      migrationCount: 4,
    });
    expect(mocks.preflight).toHaveBeenCalledOnce();
    expect(mocks.apply).toHaveBeenCalledOnce();
    expect(mocks.verify).toHaveBeenCalledOnce();
  });
  it('rejects unrelated pending migrations before any migration apply', async () => {
    mocks.preflight.mockResolvedValue({ pendingMigrations: ['0002_topic_projection.sql'] });
    await expect(runMaintenance(environment(), undefined, options())).rejects.toThrow(
      'fts1-migration-scope-required',
    );
    expect(mocks.apply).not.toHaveBeenCalled();
    expect(mocks.verify).not.toHaveBeenCalled();
  });
  it('rejects a changed actual pending plan after the migration lock', async () => {
    mocks.migrate.mockImplementation(async ({ beforeMigrate, beforeApply }) => {
      await beforeMigrate({});
      await beforeApply(['0003_search_documents_fts.sql', '0004_unapproved.sql']);
      mocks.apply();
    });
    await expect(runMaintenance(environment(), undefined, options())).rejects.toThrow(
      'fts1-migration-scope-required',
    );
    expect(mocks.apply).not.toHaveBeenCalled();
  });
  it('does not loosen preflight target or TLS errors', async () => {
    mocks.preflight.mockRejectedValue(new Error('target-or-tls-failed'));
    await expect(runMaintenance(environment(), undefined, options())).rejects.toThrow(
      'target-or-tls-failed',
    );
    expect(mocks.apply).not.toHaveBeenCalled();
  });
  it('keeps the default verified path compatible without the FTS-only hook', async () => {
    await runMaintenance(
      environment({
        recoveryPolicy: undefined,
        riskAcceptance: undefined,
        backupVerified: true,
        restoreRehearsed: true,
        aclRecoveryReviewed: true,
        restoreEvidenceFingerprint: 'c'.repeat(64),
      }),
      undefined,
      options(),
    );
    expect(mocks.migrate.mock.calls[0][0].beforeApply).toBeUndefined();
  });
});
