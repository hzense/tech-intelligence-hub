import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import { describe, it, expect, vi } from 'vitest';
import {
  candidateReviewTargetBinding,
  candidateReviewMigrationPlan,
  requireCandidateReviewMigrationScope,
  generationProgressMigrationPlan,
  validateMaintenanceRequest,
  runMaintenance,
} from '../../../.github/scripts/production-maintenance.mjs';

const calls = vi.hoisted(() => ({
  preflight: vi.fn(),
  load: vi.fn(),
  inspect: vi.fn(),
  migrate: vi.fn(),
  verify: vi.fn(),
  policy: undefined,
}));
vi.mock('../src/connection-policy.mjs', () => ({
  productionDatabaseOptions: () => ({}),
  validateConnectionTarget: () => calls.policy,
}));
vi.mock('../src/preflight.mjs', () => ({
  runDatabasePreflight: calls.preflight,
  inspectDatabasePreflight: calls.inspect,
}));
vi.mock('../src/migrate.mjs', () => ({
  loadMigrations: calls.load,
  verifyMigrationManifest: vi.fn(),
  runMigrations: calls.migrate,
}));
vi.mock('../src/verify.mjs', () => ({ verifyDatabaseContract: calls.verify }));

const root = new URL('../../../db/migrations/', import.meta.url);
const migrations = Object.entries(JSON.parse(readFileSync(new URL('checksums.json', root), 'utf8')))
  .filter(([name]) => name < '0022_')
  .map(([name, checksum]) => ({ name, checksum, sql: readFileSync(new URL(name, root), 'utf8') }));
const pending = ['0020_candidate_reviews.sql', '0021_candidate_review_attestations.sql'];
const identity = { database: 'hzense', user: 'migrator' };
const policy = { host: 'fixture.invalid', port: '5432', ...identity };
const backup = 'synthetic-candidate-review-backup';
const binding = candidateReviewTargetBinding(policy, identity, backup);
const plan = candidateReviewMigrationPlan(pending, migrations, binding);
const now = Date.parse('2026-09-22T12:00:00Z');
const approval = {
  operation: 'migrate',
  sha: 'a'.repeat(40),
  runId: '123',
  runAttempt: '1',
  expiresAt: '2026-09-22T13:00:00Z',
  backupExpiresAt: '2026-09-23T13:00:00Z',
  backupVerified: false,
  backupPresenceReviewed: true,
  restoreRehearsed: false,
  aclRecoveryReviewed: false,
  ddlFreezeConfirmed: true,
  recoveryPolicy: 'accept-unverified-candidate-review',
  riskAcceptance: {
    scope: 'candidate-review-production-launch',
    accepted: true,
    historicalAclGapAccepted: true,
    acknowledgement: 'recovery-unverified-data-loss-or-prolonged-outage-accepted',
  },
  aclFingerprint: 'b'.repeat(64),
  ...plan,
};
const env = {
  GITHUB_ACTIONS: 'true',
  GITHUB_REPOSITORY: 'hzense/tech-intelligence-hub',
  GITHUB_EVENT_NAME: 'workflow_dispatch',
  GITHUB_REF: 'refs/heads/main',
  GITHUB_SHA: approval.sha,
  GITHUB_RUN_ID: '123',
  GITHUB_RUN_ATTEMPT: '1',
  GH_TOKEN: 'synthetic',
  MAINTENANCE_OPERATION: 'migrate',
  MAINTENANCE_BACKUP_ID: backup,
  MAINTENANCE_APPROVAL: JSON.stringify(approval),
};

describe('independent 0020-0021 maintenance authority', () => {
  it('pins twenty-two files and accepts only the final one- or two-file suffix', () => {
    expect(migrations).toHaveLength(22);
    expect(
      requireCandidateReviewMigrationScope(
        { pendingMigrations: pending },
        migrations,
        plan,
        binding,
      ),
    ).toEqual(plan);
    expect(candidateReviewMigrationPlan(pending.slice(1), migrations, binding)).toBeTruthy();
    for (const names of [[], ['0019_generation_progress.sql', ...pending], ['0020_future.sql']])
      expect(() => candidateReviewMigrationPlan(names, migrations, binding)).toThrow(
        'candidate-review-migration-scope-required',
      );
    expect(() => generationProgressMigrationPlan(pending, migrations, binding)).toThrow();
    expect(() =>
      requireCandidateReviewMigrationScope(
        { pendingMigrations: pending },
        migrations,
        { ...plan, targetFingerprint: 'c'.repeat(64) },
        binding,
      ),
    ).toThrow('plan-mismatch');
    expect(() =>
      candidateReviewMigrationPlan(
        pending,
        migrations.map((migration, index) =>
          index === 21 ? { ...migration, sql: `${migration.sql} ` } : migration,
        ),
        binding,
      ),
    ).toThrow('manifest-required');
  });

  it('requires the candidate-review risk scope and binds the reviewed target', () => {
    expect(validateMaintenanceRequest(env, now).operation).toBe('migrate');
    for (const change of [
      {
        riskAcceptance: {
          ...approval.riskAcceptance,
          scope: 'generation-progress-production-launch',
        },
      },
      { planFingerprint: 'wrong' },
      { backupPresenceReviewed: false },
    ])
      expect(() =>
        validateMaintenanceRequest(
          { ...env, MAINTENANCE_APPROVAL: JSON.stringify({ ...approval, ...change }) },
          now,
        ),
      ).toThrow();
  });

  it('rechecks the locked execution artifact before applying DDL', async () => {
    calls.policy = policy;
    calls.preflight.mockResolvedValue({ ...identity, pendingMigrations: pending });
    calls.inspect.mockResolvedValue({ ...identity, pendingMigrations: pending });
    calls.load.mockResolvedValue(migrations);
    calls.verify.mockResolvedValue({ migrationCount: 22 });
    const ddl = vi.fn();
    let artifact = migrations;
    calls.migrate.mockImplementation(async ({ beforeMigrate, beforeApply }) => {
      await beforeMigrate({});
      await beforeApply(pending, { migrations: artifact });
      ddl();
    });
    const fetchImpl = async (url) => ({
      status: 200,
      json: async () =>
        url.includes('/runs?')
          ? {
              workflow_runs: [
                {
                  id: 122,
                  path: '.github/workflows/ci.yml',
                  repository: { full_name: env.GITHUB_REPOSITORY },
                  head_sha: env.GITHUB_SHA,
                  head_branch: 'main',
                  event: 'push',
                  status: 'completed',
                  conclusion: 'success',
                },
              ],
            }
          : { ref: env.GITHUB_REF, object: { type: 'commit', sha: env.GITHUB_SHA } },
    });
    const result = await runMaintenance(env, undefined, { fetchImpl, now: () => now });
    expect(result.planFingerprint).toBe(plan.planFingerprint);
    expect(ddl).toHaveBeenCalledTimes(1);
    artifact = migrations.slice(0, -1);
    await expect(runMaintenance(env, undefined, { fetchImpl, now: () => now })).rejects.toThrow(
      'manifest-required',
    );
    expect(ddl).toHaveBeenCalledTimes(1);
  });
});
