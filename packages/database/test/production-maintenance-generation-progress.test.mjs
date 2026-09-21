import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import { describe, it, expect, vi } from 'vitest';
import {
  generationProgressTargetBinding,
  generationProgressMigrationPlan,
  requireGenerationProgressMigrationScope,
  taskManagementMigrationPlan,
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
  .filter(([name]) => name < '0020_')
  .map(([name, checksum]) => ({ name, checksum, sql: readFileSync(new URL(name, root), 'utf8') }));
const pending = ['0019_generation_progress.sql'];
const identity = { database: 'hzense', user: 'migrator' };
const policy = { host: 'fixture.invalid', port: '5432', ...identity };
const backup = 'synthetic-progress-backup';
const binding = generationProgressTargetBinding(policy, identity, backup);
const plan = generationProgressMigrationPlan(pending, migrations, binding);
const now = Date.parse('2026-09-19T12:00:00Z');
const approval = {
  operation: 'migrate',
  sha: 'a'.repeat(40),
  runId: '123',
  runAttempt: '1',
  expiresAt: '2026-09-19T13:00:00Z',
  backupExpiresAt: '2026-09-20T13:00:00Z',
  backupVerified: false,
  backupPresenceReviewed: true,
  restoreRehearsed: false,
  aclRecoveryReviewed: false,
  ddlFreezeConfirmed: true,
  recoveryPolicy: 'accept-unverified-generation-progress',
  riskAcceptance: {
    scope: 'generation-progress-production-launch',
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
describe('independent 0019 maintenance authority', () => {
  it('pins twenty files, exactly one pending migration, target and backup', () => {
    expect(migrations).toHaveLength(20);
    expect(
      requireGenerationProgressMigrationScope(
        { pendingMigrations: pending },
        migrations,
        plan,
        binding,
      ),
    ).toEqual(plan);
    for (const names of [
      [],
      ['0018_generation_task_visibility.sql', ...pending],
      ['0020_future.sql'],
    ])
      expect(() => generationProgressMigrationPlan(names, migrations, binding)).toThrow(
        'generation-progress-migration-scope-required',
      );
    expect(() => taskManagementMigrationPlan(pending, migrations, binding)).toThrow();
    expect(() =>
      generationProgressMigrationPlan(
        pending,
        migrations.map((m, i) => (i === 19 ? { ...m, sql: m.sql + ' ' } : m)),
        binding,
      ),
    ).toThrow('manifest-required');
    expect(() =>
      requireGenerationProgressMigrationScope(
        { pendingMigrations: pending },
        migrations,
        plan,
        generationProgressTargetBinding(policy, identity, backup + '-changed'),
      ),
    ).toThrow('plan-mismatch');
    expect(() =>
      requireGenerationProgressMigrationScope(
        { pendingMigrations: pending },
        migrations,
        plan,
        generationProgressTargetBinding({ ...policy, host: 'other.invalid' }, identity, backup),
      ),
    ).toThrow('plan-mismatch');
  });
  it('requires independent risk acceptance and confines it to migrate/ACL capture', () => {
    expect(validateMaintenanceRequest(env, now).operation).toBe('migrate');
    for (const change of [
      {
        riskAcceptance: { ...approval.riskAcceptance, scope: 'task-management-production-launch' },
      },
      { riskAcceptance: { ...approval.riskAcceptance, accepted: false } },
      { ddlFreezeConfirmed: false },
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
  it('checks the actual locked execution snapshot before DDL', async () => {
    calls.policy = policy;
    calls.preflight.mockResolvedValue({ ...identity, pendingMigrations: pending });
    calls.inspect.mockResolvedValue({ ...identity, pendingMigrations: pending });
    calls.load.mockResolvedValue(migrations);
    calls.verify.mockResolvedValue({ migrationCount: 20 });
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
