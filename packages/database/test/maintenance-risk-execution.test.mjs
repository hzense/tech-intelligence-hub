import { createHash } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { runMaintenance } from '../../../.github/scripts/production-maintenance.mjs';
import {
  buildRuntimeAclBaseline,
  runtimeAclBaselineCategoryNames,
  runtimeAclBackupReference,
} from '../src/runtime-acl-baseline.mjs';

const mocks = vi.hoisted(() => ({
  preflight: vi.fn(),
  migrate: vi.fn(),
  verify: vi.fn(),
  apply: vi.fn(),
  capture: vi.fn(),
  save: vi.fn(),
}));
vi.mock('node:fs/promises', async (importOriginal) => ({
  ...(await importOriginal()),
  writeFile: mocks.save,
}));
vi.mock('../src/runtime-acl-baseline.mjs', async (importOriginal) => ({
  ...(await importOriginal()),
  runRuntimeAclBaselineCapture: mocks.capture,
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
  it.each(['success', 'expired-between-captures'])(
    'routes the real hosted capture through risk validation and evidence serialization: %s',
    async (outcome) => {
      const env = {
        ...environment({
          operation: 'acl-capture',
          aclFingerprint: undefined,
          publicArchiveApproved: true,
          archiveRepository: 'hzense/tech-intelligence-hub',
        }),
        MAINTENANCE_OPERATION: 'acl-capture',
        DATABASE_DIRECT_URL:
          'postgresql://hzense_migrator:test-password@ep-fixture.neon.tech/hzense',
        RUNNER_TEMP: '/tmp/test-hosted-evidence',
      };
      const baseline = buildRuntimeAclBaseline({
        identity: { database: 'hzense', currentUser: 'hzense_migrator' },
        categories: Object.fromEntries(runtimeAclBaselineCategoryNames.map((name) => [name, []])),
        capturedAt: '2026-09-10T10:00:00.000Z',
        backupReference: runtimeAclBackupReference(env.MAINTENANCE_BACKUP_ID),
      });
      const clock = vi.spyOn(Date, 'now').mockReturnValue(now);
      mocks.capture.mockImplementation(async () => {
        if (outcome !== 'success') clock.mockReturnValue(now + 3600000);
        return baseline;
      });
      try {
        if (outcome === 'success') {
          const result = await runMaintenance(env, undefined, options());
          const evidence = JSON.parse(mocks.save.mock.calls[0][1]);
          expect(result).toEqual({
            operation: 'acl-capture',
            status: 'succeeded',
            fingerprint: baseline.fingerprint,
            recoveryPolicy: 'accept-unverified-fts1',
            recoveryVerified: false,
            riskAcceptanceSha256: createHash('sha256')
              .update(env.MAINTENANCE_APPROVAL)
              .digest('hex'),
          });
          for (const key of ['recoveryPolicy', 'recoveryVerified', 'riskAcceptanceSha256']) {
            expect(evidence[key]).toBe(result[key]);
          }
          expect(evidence.restoration).toBe('unverified-risk-accepted');
          expect(evidence.captures).toEqual([baseline, baseline]);
          expect(mocks.capture).toHaveBeenCalledTimes(2);
          expect(mocks.save).toHaveBeenCalledOnce();
        } else {
          await expect(runMaintenance(env, undefined, options())).rejects.toThrow(
            'approval-expired-or-too-long',
          );
          expect(mocks.capture).toHaveBeenCalledOnce();
          expect(mocks.save).not.toHaveBeenCalled();
        }
        expect(mocks.apply).not.toHaveBeenCalled();
        expect(mocks.migrate).not.toHaveBeenCalled();
      } finally {
        clock.mockRestore();
      }
    },
  );
});
