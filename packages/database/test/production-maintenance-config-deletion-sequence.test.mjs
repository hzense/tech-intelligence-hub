import console from 'node:console';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import {
  automationConfigDeletionMigrationPlan,
  automationConfigDeletionTargetBinding,
  MaintenanceGateError,
  publicMaintenanceFailure,
  runMaintenance,
  validateMaintenanceRequest,
} from '../../../.github/scripts/production-maintenance.mjs';

const operation = 'migrate-and-verify';
const grant = 'automation-config-deletion-grant';
const preparePhases = ['preflight', 'acl-capture'];
const applyPhases = ['acl-evidence', 'migrate', 'verify', grant];
const now = Date.parse('2026-10-02T12:00:00Z');
const expiry = '2026-10-02T13:00:00Z';
const backup = 'synthetic-config-deletion-sequence-backup';
const aclFingerprint = 'b'.repeat(64);
const identity = { database: 'fixture', user: 'fixture_owner' };
const policy = { host: 'fixture.invalid', port: '5432', ...identity };
const migrationRoot = new URL('../../../db/migrations/', import.meta.url);
const migrations = Object.entries(
  JSON.parse(readFileSync(new URL('checksums.json', migrationRoot), 'utf8')),
).map(([name, checksum]) => ({
  name,
  checksum,
  sql: readFileSync(new URL(name, migrationRoot), 'utf8'),
}));
const pending = ['0027_automation_config_deletion.sql'];
const plan = automationConfigDeletionMigrationPlan(
  pending,
  migrations,
  automationConfigDeletionTargetBinding(policy, identity, backup),
);
const baseApproval = {
  operation,
  sha: 'a'.repeat(40),
  runId: '123456',
  runAttempt: '1',
  expiresAt: expiry,
  backupExpiresAt: '2026-10-09T13:00:00Z',
  backupVerified: false,
  backupPresenceReviewed: true,
  restoreRehearsed: false,
  aclRecoveryReviewed: false,
  ddlFreezeConfirmed: true,
  recoveryPolicy: 'accept-unverified-automation-config-deletion',
  riskAcceptance: {
    scope: 'automation-config-deletion-production-launch',
    accepted: true,
    historicalAclGapAccepted: true,
    acknowledgement: 'recovery-unverified-data-loss-or-prolonged-outage-accepted',
  },
  aclEvidenceMode: 'capture-in-run',
  publicArchiveApproved: true,
  archiveRepository: 'hzense/tech-intelligence-hub',
  roleUpgradeApproved: true,
  ...plan,
};

function environment(approvalChanges = {}, envChanges = {}) {
  return {
    GITHUB_ACTIONS: 'true',
    GITHUB_REPOSITORY: 'hzense/tech-intelligence-hub',
    GITHUB_EVENT_NAME: 'workflow_dispatch',
    GITHUB_REF: 'refs/heads/main',
    GITHUB_SHA: baseApproval.sha,
    GITHUB_RUN_ID: baseApproval.runId,
    GITHUB_RUN_ATTEMPT: baseApproval.runAttempt,
    GH_TOKEN: 'synthetic-private-github-token',
    DATABASE_DIRECT_URL: 'postgresql://fixture:synthetic-private-password@fixture.invalid/fixture',
    MAINTENANCE_OPERATION: operation,
    MAINTENANCE_SEQUENCE_PHASE: 'prepare',
    MAINTENANCE_BACKUP_ID: backup,
    MAINTENANCE_APPROVAL: JSON.stringify({ ...baseApproval, ...approvalChanges }),
    ...envChanges,
  };
}

function harness(approvalChanges = {}, envChanges = {}) {
  const env = environment(approvalChanges, envChanges);
  const state = { now, head: baseApproval.sha, ci: 'success' };
  const results = {
    preflight: { ...plan, ...identity, pendingMigrations: [...pending] },
    'acl-capture': { fingerprint: aclFingerprint },
    'acl-evidence': { fingerprint: aclFingerprint },
    migrate: { ...plan },
    verify: { migrationCount: 28, tableCount: 60 },
    [grant]: {
      ...plan,
      migrationCount: 28,
      tableCount: 60,
      roleUpgradeCompleted: true,
    },
  };
  const execute = vi.fn(async (_env, request) => results[request.operation]);
  const fetchImpl = vi.fn(async (url) => ({
    status: 200,
    json: async () =>
      url.includes('/runs?')
        ? {
            workflow_runs: [
              {
                id: 123455,
                path: '.github/workflows/ci.yml',
                repository: { full_name: 'hzense/tech-intelligence-hub' },
                head_sha: baseApproval.sha,
                head_branch: 'main',
                event: 'push',
                status: 'completed',
                conclusion: state.ci,
              },
            ],
          }
        : { ref: 'refs/heads/main', object: { type: 'commit', sha: state.head } },
  }));
  const report = vi.fn();
  const run = () => runMaintenance(env, execute, { fetchImpl, now: () => state.now, report });
  return { env, state, results, execute, fetchImpl, report, run };
}

const phases = (test) => test.execute.mock.calls.map(([, request]) => request.operation);
const applyHarness = (changes = {}, envChanges = {}) =>
  harness(changes, {
    MAINTENANCE_SEQUENCE_PHASE: 'apply',
    MAINTENANCE_ACL_ARCHIVE_CONFIRMED: 'success',
    ...envChanges,
  });

describe('0027 sequence approval and phase boundaries', () => {
  it('requires explicit authority for the exact migration and minimal role upgrade', () => {
    expect(validateMaintenanceRequest(environment(), now)).toEqual({
      operation,
      approval: baseApproval,
    });
  });

  it.each([
    'operation',
    'sha',
    'runId',
    'runAttempt',
    'expiresAt',
    'backupExpiresAt',
    'backupVerified',
    'backupPresenceReviewed',
    'restoreRehearsed',
    'aclRecoveryReviewed',
    'ddlFreezeConfirmed',
    'recoveryPolicy',
    'riskAcceptance',
    'aclEvidenceMode',
    'publicArchiveApproved',
    'archiveRepository',
    'roleUpgradeApproved',
    ...Object.keys(plan),
  ])('rejects missing %s before any remote or database access', async (key) => {
    const test = harness({ [key]: undefined });
    await expect(test.run()).rejects.toBeInstanceOf(MaintenanceGateError);
    expect(test.fetchImpl).not.toHaveBeenCalled();
    expect(test.execute).not.toHaveBeenCalled();
  });

  it.each([
    { roleUpgradeApproved: false },
    { roleUpgradeApproved: 'true' },
    { roleUpgradeSha256: 'c'.repeat(64) },
    { roleUpgradeSha256: 'bad' },
    { recoveryPolicy: 'accept-unverified-automation-storage' },
    { recoveryPolicy: 'accept-unverified-editorial-publication' },
    { recoveryPolicy: 'accept-unverified-ai-config' },
    { recoveryPolicy: 'unknown-policy' },
    { operation: 'migrate' },
    { sha: 'f'.repeat(40) },
    { runId: '123457' },
    { runAttempt: '2' },
    { aclEvidenceMode: 'reuse-capture' },
    { publicArchiveApproved: false },
    { archiveRepository: 'someone/another-repository' },
    { manifestFingerprint: 'bad' },
    { planFingerprint: 'bad' },
    { targetFingerprint: 'bad' },
    { backupIdSha256: 'e'.repeat(64) },
    { ddlFreezeConfirmed: false },
    { backupPresenceReviewed: false },
    { restoreEvidenceFingerprint: 'c'.repeat(64) },
    { backupVerified: true },
    { restoreRehearsed: true },
    { expiresAt: 'not-a-date' },
    { expiresAt: new Date(now).toISOString() },
    { expiresAt: new Date(now + 24 * 60 * 60 * 1000 + 1).toISOString() },
    { backupExpiresAt: expiry },
    { backupExpiresAt: 'not-a-date' },
    { backupNeverExpires: true },
    { riskAcceptance: { ...baseApproval.riskAcceptance, accepted: false } },
    {
      riskAcceptance: {
        ...baseApproval.riskAcceptance,
        scope: 'automation-storage-production-launch',
      },
    },
    { riskAcceptance: { ...baseApproval.riskAcceptance, historicalAclGapAccepted: false } },
  ])('rejects mismatched authority or stale coverage %j', async (changes) => {
    const test = harness(changes);
    await expect(test.run()).rejects.toBeInstanceOf(MaintenanceGateError);
    expect(test.fetchImpl).not.toHaveBeenCalled();
    expect(test.execute).not.toHaveBeenCalled();
  });

  it.each([
    { GITHUB_ACTIONS: 'false' },
    { GITHUB_REPOSITORY: 'someone/fork' },
    { GITHUB_REF: 'refs/heads/feature' },
    { GITHUB_EVENT_NAME: 'push' },
    { GITHUB_SHA: 'f'.repeat(40) },
    { GITHUB_RUN_ID: '123457' },
    { GITHUB_RUN_ATTEMPT: '2' },
    { HZENSE_DATABASE_BASELINE_CHECKSUM: 'b'.repeat(64) },
    { MAINTENANCE_BACKUP_ID: '' },
    { MAINTENANCE_BACKUP_ID: 'synthetic-different-backup' },
    { MAINTENANCE_APPROVAL: 'invalid-json' },
  ])('rejects a changed execution identity or backup %j', async (changes) => {
    const test = harness({}, changes);
    await expect(test.run()).rejects.toBeInstanceOf(MaintenanceGateError);
    expect(test.fetchImpl).not.toHaveBeenCalled();
    expect(test.execute).not.toHaveBeenCalled();
  });

  it.each([undefined, '', 'true', 'failure', 'cancelled', 'skipped', 'neutral'])(
    'never writes without durable remote ACL archive confirmation %j',
    async (confirmation) => {
      const test = applyHarness({}, { MAINTENANCE_ACL_ARCHIVE_CONFIRMED: confirmation });
      await expect(test.run()).rejects.toBeInstanceOf(MaintenanceGateError);
      expect(test.fetchImpl).not.toHaveBeenCalled();
      expect(test.execute).not.toHaveBeenCalled();
    },
  );

  it.each([undefined, '', 'all', grant])('rejects unsupported sequence phase %j', async (phase) => {
    const test = harness({}, { MAINTENANCE_SEQUENCE_PHASE: phase });
    await expect(test.run()).rejects.toBeInstanceOf(MaintenanceGateError);
    expect(test.execute).not.toHaveBeenCalled();
  });

  it('prepares only evidence, then uses the same authority after the archive barrier', async () => {
    const test = harness();
    const original = test.env.MAINTENANCE_APPROVAL;
    expect(await test.run()).toMatchObject({
      status: 'prepared',
      verificationCompleted: false,
      ...plan,
      pendingMigrationCount: 1,
    });
    expect(phases(test)).toEqual(preparePhases);
    test.env.MAINTENANCE_SEQUENCE_PHASE = 'apply';
    await expect(test.run()).rejects.toBeInstanceOf(MaintenanceGateError);
    expect(phases(test)).toEqual(preparePhases);
    test.env.MAINTENANCE_ACL_ARCHIVE_CONFIRMED = 'success';
    expect(await test.run()).toMatchObject({
      status: 'succeeded',
      migrationCount: 28,
      tableCount: 60,
      pendingMigrationCount: 0,
      verificationCompleted: true,
      roleUpgradeCompleted: true,
      roleUpgradeSha256: plan.roleUpgradeSha256,
      recoveryVerified: false,
    });
    expect(phases(test)).toEqual([...preparePhases, ...applyPhases]);
    expect(test.env.MAINTENANCE_APPROVAL).toBe(original);
    for (const [executionEnv, request, context] of test.execute.mock.calls) {
      expect(executionEnv.GH_TOKEN).toBeUndefined();
      expect(request.approval).toEqual(baseApproval);
      expect(context.checkApproval().approval).toEqual(baseApproval);
    }
  });
});

describe('0027 sequence fail-closed behavior', () => {
  it.each([
    undefined,
    null,
    {},
    { ...plan, pendingMigrations: [] },
    { ...plan, pendingMigrations: ['0026_automation_tasks.sql'] },
    { ...plan, pendingMigrations: [...pending, '0028_unreviewed.sql'] },
    ...Object.keys(plan).flatMap((key) => [
      { ...plan, pendingMigrations: pending, [key]: undefined },
      { ...plan, pendingMigrations: pending, [key]: 'f'.repeat(64) },
    ]),
  ])('stops before capture when the actual plan differs %#', async (value) => {
    const test = harness();
    test.results.preflight = value;
    expect(await test.run().catch(publicMaintenanceFailure)).toMatchObject({
      status: 'blocked',
      phase: 'preflight',
      migrationMayHaveCommitted: false,
      verificationCompleted: false,
    });
    expect(phases(test)).toEqual(['preflight']);
  });

  it.each([undefined, null, {}, { fingerprint: '' }, { fingerprint: 'bad' }, { fingerprint: 1 }])(
    'refuses an invalid archived ACL before DDL %#',
    async (value) => {
      const test = applyHarness();
      test.results['acl-evidence'] = value;
      expect(await test.run().catch(publicMaintenanceFailure)).toMatchObject({
        phase: 'acl-evidence',
        migrationMayHaveCommitted: false,
        verificationCompleted: false,
      });
      expect(phases(test)).toEqual(['acl-evidence']);
    },
  );

  it.each([
    undefined,
    null,
    {},
    { migrationCount: 27, tableCount: 60 },
    { migrationCount: 29, tableCount: 60 },
    { migrationCount: '28', tableCount: 60 },
    { migrationCount: 28 },
    { migrationCount: 28, tableCount: 59 },
    { migrationCount: 28, tableCount: 61 },
    { migrationCount: 28, tableCount: '60' },
  ])('never runs grants unless all 28 migrations and 60 tables verify %#', async (value) => {
    const test = applyHarness();
    test.results.verify = value;
    expect(await test.run().catch(publicMaintenanceFailure)).toMatchObject({
      status: 'blocked',
      phase: 'verify',
      migrationMayHaveCommitted: true,
      verificationCompleted: false,
    });
    expect(phases(test)).toEqual(applyPhases.slice(0, 3));
  });

  it.each([
    undefined,
    null,
    {},
    { roleUpgradeCompleted: false, roleUpgradeSha256: plan.roleUpgradeSha256 },
    { roleUpgradeCompleted: 'true', roleUpgradeSha256: plan.roleUpgradeSha256 },
    { roleUpgradeCompleted: true },
    { roleUpgradeCompleted: true, roleUpgradeSha256: 'f'.repeat(64) },
  ])('does not claim grants completed without the exact approved receipt %#', async (value) => {
    const test = applyHarness();
    test.results[grant] = value;
    const result = await test.run().catch(publicMaintenanceFailure);
    expect(result).toMatchObject({
      status: 'blocked',
      phase: grant,
      migrationMayHaveCommitted: true,
    });
    expect(result.roleUpgradeCompleted).not.toBe(true);
    expect(phases(test)).toEqual(applyPhases);
  });

  it.each([...preparePhases, ...applyPhases])(
    'stops without retrying when %s throws and redacts connection secrets',
    async (failedPhase) => {
      const preparing = preparePhases.includes(failedPhase);
      const test = preparing ? harness() : applyHarness();
      const expected = preparing ? preparePhases : applyPhases;
      test.execute.mockImplementation(async (_env, request) => {
        if (request.operation === failedPhase) {
          throw Object.assign(new Error(`${test.env.DATABASE_DIRECT_URL} ${test.env.GH_TOKEN}`), {
            code: '42501',
            detail: test.env.MAINTENANCE_APPROVAL,
            backupId: backup,
          });
        }
        return test.results[request.operation];
      });
      const result = await test.run().catch(publicMaintenanceFailure);
      expect(result).toMatchObject({
        operation,
        status: 'failed',
        category: 'database-or-contract-check-failed',
        sqlstate: '42501',
        phase: failedPhase,
        migrationMayHaveCommitted: ['migrate', 'verify', grant].includes(failedPhase),
      });
      expect(result.roleUpgradeCompleted).not.toBe(true);
      expect(phases(test)).toEqual(expected.slice(0, expected.indexOf(failedPhase) + 1));
      const output = JSON.stringify(result);
      for (const value of [
        test.env.DATABASE_DIRECT_URL,
        test.env.GH_TOKEN,
        backup,
        'fixture.invalid',
      ]) {
        expect(output).not.toContain(value);
      }
    },
  );

  it.each(['expiry', 'main', 'CI'])(
    'checks %s again after schema verification and before the grant',
    async (changed) => {
      const test = applyHarness();
      test.execute.mockImplementation(async (_env, request) => {
        if (request.operation === 'verify') {
          if (changed === 'expiry') test.state.now = Date.parse(expiry);
          if (changed === 'main') test.state.head = 'f'.repeat(40);
          if (changed === 'CI') test.state.ci = 'failure';
        }
        return test.results[request.operation];
      });
      expect(await test.run().catch(publicMaintenanceFailure)).toMatchObject({
        status: 'blocked',
        phase: grant,
        migrationMayHaveCommitted: true,
      });
      expect(phases(test)).toEqual(applyPhases.slice(0, 3));
    },
  );

  it('exposes fresh authority to the internal grant and propagates its refusal', async () => {
    const test = applyHarness();
    const write = vi.fn();
    test.execute.mockImplementation(async (_env, request, context) => {
      if (request.operation === grant) {
        expect(context.checkApproval().approval).toEqual(baseApproval);
        test.state.head = 'f'.repeat(40);
        await context.checkFreshness();
        write();
      }
      return test.results[request.operation];
    });
    expect(await test.run().catch(publicMaintenanceFailure)).toMatchObject({
      status: 'blocked',
      phase: grant,
      migrationMayHaveCommitted: true,
    });
    expect(write).not.toHaveBeenCalled();
    expect(phases(test)).toEqual(applyPhases);
  });

  it('does not continue when the captured evidence receipt cannot be persisted', async () => {
    const test = harness();
    test.report.mockImplementation((event) => {
      if (event.phase === 'acl-capture' && event.status === 'succeeded') {
        throw new MaintenanceGateError('migration-sequence-output-required');
      }
    });
    expect(await test.run().catch(publicMaintenanceFailure)).toMatchObject({
      phase: 'acl-capture',
      migrationMayHaveCommitted: false,
    });
    expect(phases(test)).toEqual(preparePhases);
  });
});

describe('0027 public receipts', () => {
  it.each(['prepare', 'apply'])(
    'allowlists %s receipts without claiming the recovery was exercised',
    async (mode) => {
      const test = mode === 'prepare' ? harness() : applyHarness();
      const secret = 'synthetic-private-result-field';
      for (const result of Object.values(test.results)) {
        Object.assign(result, {
          privateField: secret,
          approval: test.env.MAINTENANCE_APPROVAL,
          connectionString: test.env.DATABASE_DIRECT_URL,
          backupId: backup,
          GH_TOKEN: test.env.GH_TOKEN,
          recoveryVerified: true,
        });
      }
      const logged = vi.spyOn(console, 'log').mockImplementation(() => {});
      const original = test.execute.getMockImplementation();
      test.execute.mockImplementation(async (...args) => {
        console.log(secret);
        return original(...args);
      });
      try {
        const result = await test.run();
        const serialized = JSON.stringify([result, test.report.mock.calls]);
        for (const value of [
          secret,
          test.env.MAINTENANCE_APPROVAL,
          test.env.DATABASE_DIRECT_URL,
          test.env.GH_TOKEN,
          backup,
          policy.host,
        ])
          expect(serialized).not.toContain(value);
        expect(result.recoveryVerified).toBe(false);
        expect(result.riskAcceptanceSha256).toBe(
          createHash('sha256').update(test.env.MAINTENANCE_APPROVAL).digest('hex'),
        );
        if (mode === 'prepare') expect(result.roleUpgradeCompleted).not.toBe(true);
        else expect(result.roleUpgradeCompleted).toBe(true);
        expect(logged).not.toHaveBeenCalled();
      } finally {
        logged.mockRestore();
      }
    },
  );
});
