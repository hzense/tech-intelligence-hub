import console from 'node:console';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import {
  automationMigrationPlan,
  automationTargetBinding,
  MaintenanceGateError,
  publicMaintenanceFailure,
  runMaintenance,
  validateMaintenanceRequest,
} from '../../../.github/scripts/production-maintenance.mjs';

const operation = 'migrate-and-verify';
const preparePhases = ['preflight', 'acl-capture'];
const applyPhases = ['acl-evidence', 'migrate', 'verify'];
const now = Date.parse('2026-10-02T12:00:00Z');
const expiry = '2026-10-02T13:00:00Z';
const backup = 'synthetic-automation-sequence-backup';
const aclFingerprint = 'b'.repeat(64);
const identity = { database: 'fixture', user: 'fixture_migrator' };
const policy = { host: 'fixture.invalid', port: '5432', ...identity };
const migrationRoot = new URL('../../../db/migrations/', import.meta.url);
const migrations = Object.entries(
  JSON.parse(readFileSync(new URL('checksums.json', migrationRoot), 'utf8')),
)
  .filter(([name]) => name < '0027_')
  .map(([name, checksum]) => ({
    name,
    checksum,
    sql: readFileSync(new URL(name, migrationRoot), 'utf8'),
  }));
const pending = ['0026_automation_tasks.sql'];
const plan = automationMigrationPlan(
  pending,
  migrations,
  automationTargetBinding(policy, identity, backup),
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
  recoveryPolicy: 'accept-unverified-automation-storage',
  riskAcceptance: {
    scope: 'automation-storage-production-launch',
    accepted: true,
    historicalAclGapAccepted: true,
    acknowledgement: 'recovery-unverified-data-loss-or-prolonged-outage-accepted',
  },
  aclEvidenceMode: 'capture-in-run',
  publicArchiveApproved: true,
  archiveRepository: 'hzense/tech-intelligence-hub',
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
    verify: { migrationCount: 27, tableCount: 70 },
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

function executedPhases(test) {
  return test.execute.mock.calls.map(([, request]) => request.operation);
}

function applyHarness(approvalChanges = {}, envChanges = {}) {
  return harness(approvalChanges, {
    MAINTENANCE_SEQUENCE_PHASE: 'apply',
    MAINTENANCE_ACL_ARCHIVE_CONFIRMED: 'success',
    ...envChanges,
  });
}

describe('single-approval maintenance authorization', () => {
  it('accepts only the explicit run-bound 0026 capture-in-run approval', () => {
    expect(migrations).toHaveLength(27);
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
    'manifestFingerprint',
    'planFingerprint',
    'targetFingerprint',
    'backupIdSha256',
  ])('rejects missing %s before reading GitHub or the database', async (key) => {
    const test = harness({ [key]: undefined });
    await expect(test.run()).rejects.toBeInstanceOf(MaintenanceGateError);
    expect(test.fetchImpl).not.toHaveBeenCalled();
    expect(test.execute).not.toHaveBeenCalled();
  });

  it.each([
    'accept-unverified-fts1',
    'accept-unverified-ai-config',
    'accept-unverified-import-tasks',
    'accept-unverified-signal-generation',
    'accept-unverified-task-management',
    'accept-unverified-generation-progress',
    'accept-unverified-candidate-review',
    'accept-unverified-candidate-enrichment',
    'accept-unverified-candidate-materials',
    'accept-unverified-material-review',
    'accept-unverified-editorial-publication',
    'unknown-policy',
  ])('cannot reuse historical or unknown policy %s', async (recoveryPolicy) => {
    const test = harness({ recoveryPolicy });
    await expect(test.run()).rejects.toBeInstanceOf(MaintenanceGateError);
    expect(test.execute).not.toHaveBeenCalled();
  });

  it('does not extend the verified recovery policy to this new operation', () => {
    const env = environment({
      recoveryPolicy: 'verified',
      riskAcceptance: undefined,
      backupVerified: true,
      restoreRehearsed: true,
      aclRecoveryReviewed: true,
      restoreEvidenceFingerprint: 'c'.repeat(64),
    });
    expect(() => validateMaintenanceRequest(env, now)).toThrow(
      'migration-sequence-approval-required',
    );
  });

  it.each([null, '', aclFingerprint, 'capture-it-later'])(
    'refuses a prefilled ACL fingerprint %j',
    (value) => {
      expect(() => validateMaintenanceRequest(environment({ aclFingerprint: value }), now)).toThrow(
        'migration-sequence-approval-required',
      );
    },
  );

  it.each([
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
    { expiresAt: 'not-a-date' },
    { expiresAt: new Date(now).toISOString() },
    { expiresAt: new Date(now + 24 * 60 * 60 * 1000 + 1).toISOString() },
    { backupExpiresAt: expiry },
    { backupExpiresAt: 'not-a-date' },
    { backupNeverExpires: true },
    { riskAcceptance: { ...baseApproval.riskAcceptance, accepted: false } },
    { riskAcceptance: { ...baseApproval.riskAcceptance, scope: 'other-launch' } },
    { riskAcceptance: { ...baseApproval.riskAcceptance, historicalAclGapAccepted: false } },
  ])('rejects mismatched authority or expired recovery coverage %j', async (changes) => {
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
  ])('rejects a different execution identity or backup %j', async (changes) => {
    const test = harness({}, changes);
    await expect(test.run()).rejects.toBeInstanceOf(MaintenanceGateError);
    expect(test.fetchImpl).not.toHaveBeenCalled();
    expect(test.execute).not.toHaveBeenCalled();
  });

  it('still permits an explicit nonexpiring backup declaration without a conflicting date', () => {
    expect(
      validateMaintenanceRequest(
        environment({ backupNeverExpires: true, backupExpiresAt: undefined }),
        now,
      ).operation,
    ).toBe(operation);
  });

  it.each([undefined, '', 'all', 'migrate', 'verify', 'apply-now'])(
    'refuses missing or unsupported sequence phase %j before any remote checks',
    async (phase) => {
      const test = harness({}, { MAINTENANCE_SEQUENCE_PHASE: phase });
      await expect(test.run()).rejects.toBeInstanceOf(MaintenanceGateError);
      expect(test.fetchImpl).not.toHaveBeenCalled();
      expect(test.execute).not.toHaveBeenCalled();
    },
  );

  it.each([undefined, '', 'true', 'failure', 'cancelled', 'skipped', 'neutral'])(
    'refuses apply before successful remote archive confirmation %j',
    async (confirmation) => {
      const test = applyHarness({}, { MAINTENANCE_ACL_ARCHIVE_CONFIRMED: confirmation });
      await expect(test.run()).rejects.toBeInstanceOf(MaintenanceGateError);
      expect(test.fetchImpl).not.toHaveBeenCalled();
      expect(test.execute).not.toHaveBeenCalled();
    },
  );

  it('permits prepare without an archive-confirmation flag but never advances to DDL', async () => {
    const test = harness();
    expect(test.env.MAINTENANCE_ACL_ARCHIVE_CONFIRMED).toBeUndefined();
    expect(await test.run()).toMatchObject({ status: 'prepared', verificationCompleted: false });
    expect(executedPhases(test)).toEqual(preparePhases);
  });
});

describe('single-approval maintenance stage execution', () => {
  it.each(['prepare', 'apply'])(
    'runs only %s phases, retaining the original approval and removing the GitHub token',
    async (mode) => {
      const test = mode === 'prepare' ? harness() : applyHarness();
      const phases = mode === 'prepare' ? preparePhases : applyPhases;
      const original = { ...test.env };
      test.execute.mockImplementation(async (executionEnv, request, context) => {
        expect(executionEnv.MAINTENANCE_OPERATION).toBe(operation);
        expect(executionEnv.MAINTENANCE_APPROVAL).toBe(original.MAINTENANCE_APPROVAL);
        expect(executionEnv.MAINTENANCE_BACKUP_ID).toBe(backup);
        expect(executionEnv.GH_TOKEN).toBeUndefined();
        expect(request.approval).toEqual(baseApproval);
        expect(context.checkApproval()).toEqual({ operation, approval: baseApproval });
        expect(typeof context.checkFreshness).toBe('function');
        expect(context.aclFingerprint).toBe(
          request.operation === 'migrate' ? aclFingerprint : undefined,
        );
        return test.results[request.operation];
      });
      const result = await test.run();
      expect(executedPhases(test)).toEqual(phases);
      expect(test.env).toEqual(original);
      expect(test.fetchImpl).toHaveBeenCalledTimes((phases.length + 1) * 3);
      expect(result).toMatchObject({
        operation,
        status: mode === 'prepare' ? 'prepared' : 'succeeded',
        aclFingerprint,
        verificationCompleted: mode === 'apply',
        recoveryPolicy: baseApproval.recoveryPolicy,
        recoveryVerified: false,
        riskAcceptanceSha256: createHash('sha256')
          .update(original.MAINTENANCE_APPROVAL)
          .digest('hex'),
      });
      if (mode === 'prepare') {
        expect(result).toMatchObject({ ...plan, pendingMigrationCount: 1 });
        expect(result).not.toHaveProperty('migrationCount');
      } else {
        expect(result).toMatchObject({
          migrationCount: 27,
          tableCount: 70,
          pendingMigrationCount: 0,
        });
      }
      expect(result.stages.map((stage) => stage.operation)).toEqual(phases);
      expect(result.stages.every((stage) => stage.status === 'succeeded')).toBe(true);
      if (mode === 'prepare') expect(result.stages[0].pendingMigrationCount).toBe(1);
      expect(test.report.mock.calls.map(([event]) => [event.phase, event.status])).toEqual(
        phases.flatMap((phase) => [
          [phase, 'started'],
          [phase, 'succeeded'],
        ]),
      );
    },
  );

  it('uses the same original authority across the archive barrier without replaying capture', async () => {
    const test = harness();
    const originalApproval = test.env.MAINTENANCE_APPROVAL;
    expect(await test.run()).toMatchObject({ status: 'prepared', verificationCompleted: false });
    expect(executedPhases(test)).toEqual(preparePhases);
    test.env.MAINTENANCE_SEQUENCE_PHASE = 'apply';
    await expect(test.run()).rejects.toBeInstanceOf(MaintenanceGateError);
    expect(executedPhases(test)).toEqual(preparePhases);
    test.env.MAINTENANCE_ACL_ARCHIVE_CONFIRMED = 'success';
    expect(await test.run()).toMatchObject({ status: 'succeeded', verificationCompleted: true });
    expect(executedPhases(test)).toEqual([...preparePhases, ...applyPhases]);
    expect(test.env.MAINTENANCE_APPROVAL).toBe(originalApproval);
    for (const [, request] of test.execute.mock.calls)
      expect(request.approval).toEqual(baseApproval);
  });

  it.each([
    undefined,
    null,
    {},
    { ...plan, pendingMigrations: [] },
    { ...plan, pendingMigrations: ['0025_editorial_signal_publication.sql'] },
    { ...plan, pendingMigrations: [...pending, '0027_unreviewed.sql'] },
    ...Object.keys(plan).flatMap((key) => [
      { ...plan, pendingMigrations: pending, [key]: undefined },
      { ...plan, pendingMigrations: pending, [key]: 'f'.repeat(64) },
    ]),
  ])('stops before capture if the actual plan differs from the reviewed plan %#', async (value) => {
    const test = harness();
    test.results.preflight = value;
    const result = await test.run().catch(publicMaintenanceFailure);
    expect(result).toEqual({
      operation,
      status: 'blocked',
      gate: 'migration-sequence-plan-mismatch',
      phase: 'preflight',
      migrationMayHaveCommitted: false,
      verificationCompleted: false,
    });
    expect(executedPhases(test)).toEqual(['preflight']);
    expect(test.report).toHaveBeenCalledTimes(1);
  });

  it.each([undefined, null, {}, { fingerprint: '' }, { fingerprint: 'bad' }, { fingerprint: 1 }])(
    'refuses an absent or invalid capture fingerprint before any migration %#',
    async (capture) => {
      const test = harness();
      test.results['acl-capture'] = capture;
      const result = await test.run().catch(publicMaintenanceFailure);
      expect(result).toMatchObject({
        gate: 'migration-sequence-acl-required',
        phase: 'acl-capture',
        migrationMayHaveCommitted: false,
        verificationCompleted: false,
      });
      expect(executedPhases(test)).toEqual(['preflight', 'acl-capture']);
      expect(
        test.report.mock.calls.some(
          ([event]) => event.phase === 'acl-capture' && event.status === 'succeeded',
        ),
      ).toBe(false);
    },
  );

  it.each([undefined, null, {}, { fingerprint: '' }, { fingerprint: 'bad' }, { fingerprint: 1 }])(
    'refuses invalid archived evidence before invoking DDL %#',
    async (evidence) => {
      const test = applyHarness();
      test.results['acl-evidence'] = evidence;
      const result = await test.run().catch(publicMaintenanceFailure);
      expect(result).toMatchObject({
        phase: 'acl-evidence',
        gate: 'migration-sequence-acl-required',
        migrationMayHaveCommitted: false,
        verificationCompleted: false,
      });
      expect(executedPhases(test)).toEqual(['acl-evidence']);
      expect(test.report.mock.calls).toEqual([
        [{ operation, phase: 'acl-evidence', status: 'started' }],
      ]);
    },
  );

  it.each([
    ['expiry', 'approval-expired-or-too-long'],
    ['main', 'github-main-head-changed'],
    ['CI', 'github-main-ci-not-successful'],
  ])(
    'revalidates %s across the remote archive barrier before reading evidence',
    async (changed, gate) => {
      const test = harness();
      expect(await test.run()).toMatchObject({ status: 'prepared', verificationCompleted: false });
      if (changed === 'expiry') test.state.now = Date.parse(expiry);
      if (changed === 'main') test.state.head = 'f'.repeat(40);
      if (changed === 'CI') test.state.ci = 'failure';
      test.env.MAINTENANCE_SEQUENCE_PHASE = 'apply';
      test.env.MAINTENANCE_ACL_ARCHIVE_CONFIRMED = 'success';
      expect(await test.run().catch(publicMaintenanceFailure)).toEqual({ status: 'blocked', gate });
      expect(executedPhases(test)).toEqual(preparePhases);
    },
  );

  it.each([
    { GITHUB_SHA: 'f'.repeat(40) },
    { GITHUB_RUN_ID: '123457' },
    { GITHUB_RUN_ATTEMPT: '2' },
    { MAINTENANCE_BACKUP_ID: 'synthetic-different-backup' },
  ])('cannot reuse prepared authority for a changed run or backup %j', async (changes) => {
    const test = harness();
    expect(await test.run()).toMatchObject({ status: 'prepared' });
    Object.assign(test.env, changes, {
      MAINTENANCE_SEQUENCE_PHASE: 'apply',
      MAINTENANCE_ACL_ARCHIVE_CONFIRMED: 'success',
    });
    await expect(test.run()).rejects.toBeInstanceOf(MaintenanceGateError);
    expect(executedPhases(test)).toEqual(preparePhases);
  });

  it.each([...preparePhases, ...applyPhases])(
    'fails closed without retries when %s throws',
    async (failedPhase) => {
      const preparing = preparePhases.includes(failedPhase);
      const test = preparing ? harness() : applyHarness();
      const phases = preparing ? preparePhases : applyPhases;
      const privateError = Object.assign(new Error('private-database-error fixture.invalid'), {
        code: '42501',
      });
      test.execute.mockImplementation(async (_env, request) => {
        if (request.operation === failedPhase) throw privateError;
        return test.results[request.operation];
      });
      const result = await test.run().catch(publicMaintenanceFailure);
      const failedIndex = phases.indexOf(failedPhase);
      expect(executedPhases(test)).toEqual(phases.slice(0, failedIndex + 1));
      expect(result).toEqual({
        operation,
        status: 'failed',
        category: 'database-or-contract-check-failed',
        sqlstate: '42501',
        phase: failedPhase,
        migrationMayHaveCommitted: ['migrate', 'verify'].includes(failedPhase),
        verificationCompleted: false,
      });
      expect(test.report.mock.calls.map(([event]) => [event.phase, event.status])).toEqual([
        ...phases.slice(0, failedIndex).flatMap((phase) => [
          [phase, 'started'],
          [phase, 'succeeded'],
        ]),
        [failedPhase, 'started'],
      ]);
      expect(JSON.stringify(result)).not.toContain(privateError.message);
    },
  );

  it.each([
    ['expiry', 'approval-expired-or-too-long'],
    ['main', 'github-main-head-changed'],
    ['CI', 'github-main-ci-not-successful'],
  ])(
    'stops after reading archived evidence if %s changes before migration',
    async (changed, gate) => {
      const test = applyHarness();
      test.execute.mockImplementation(async (_env, request) => {
        if (request.operation === 'acl-evidence') {
          if (changed === 'expiry') test.state.now = Date.parse(expiry);
          if (changed === 'main') test.state.head = 'f'.repeat(40);
          if (changed === 'CI') test.state.ci = 'failure';
        }
        return test.results[request.operation];
      });
      expect(await test.run().catch(publicMaintenanceFailure)).toEqual({
        operation,
        status: 'blocked',
        gate,
        phase: 'migrate',
        migrationMayHaveCommitted: false,
        verificationCompleted: false,
      });
      expect(executedPhases(test)).toEqual(['acl-evidence']);
      expect(test.report.mock.calls.at(-1)[0]).toMatchObject({
        phase: 'acl-evidence',
        status: 'succeeded',
        fingerprint: aclFingerprint,
      });
    },
  );

  it('checks expiry again after freshness requests, before invoking the migration executor', async () => {
    const test = applyHarness();
    const freshFetch = test.fetchImpl.getMockImplementation();
    test.fetchImpl.mockImplementation(async (url, options) => {
      const result = await freshFetch(url, options);
      if (executedPhases(test).at(-1) === 'acl-evidence' && url.includes('/runs?')) {
        test.state.now = Date.parse(expiry);
      }
      return result;
    });
    const result = await test.run().catch(publicMaintenanceFailure);
    expect(result).toMatchObject({
      phase: 'migrate',
      gate: 'approval-expired-or-too-long',
      migrationMayHaveCommitted: false,
    });
    expect(executedPhases(test)).toEqual(['acl-evidence']);
  });

  it('exposes original-approval freshness checks to the migration executor and propagates refusal', async () => {
    const test = applyHarness();
    test.execute.mockImplementation(async (_env, request, context) => {
      if (request.operation === 'migrate') {
        expect(context.checkApproval().approval).toEqual(baseApproval);
        test.state.head = 'f'.repeat(40);
        await context.checkFreshness();
        throw new Error('must not reach migration SQL');
      }
      return test.results[request.operation];
    });
    const result = await test.run().catch(publicMaintenanceFailure);
    expect(result).toMatchObject({
      phase: 'migrate',
      gate: 'github-main-head-changed',
      migrationMayHaveCommitted: true,
      verificationCompleted: false,
    });
    expect(executedPhases(test)).toEqual(applyPhases.slice(0, 2));
  });

  it('does not claim rollback if approval expires after migration and before final verification', async () => {
    const test = applyHarness();
    test.execute.mockImplementation(async (_env, request) => {
      if (request.operation === 'migrate') test.state.now = Date.parse(expiry);
      return test.results[request.operation];
    });
    const result = await test.run().catch(publicMaintenanceFailure);
    expect(result).toMatchObject({
      gate: 'approval-expired-or-too-long',
      phase: 'verify',
      migrationMayHaveCommitted: true,
      verificationCompleted: false,
    });
    expect(executedPhases(test)).toEqual(applyPhases.slice(0, 2));
  });

  it.each([
    undefined,
    null,
    {},
    { migrationCount: 0 },
    { migrationCount: 26 },
    { migrationCount: 28 },
    { migrationCount: '27' },
  ])('rejects final verification that does not confirm all 27 migrations %#', async (value) => {
    const test = applyHarness();
    test.results.verify = value;
    const result = await test.run().catch(publicMaintenanceFailure);
    expect(result).toMatchObject({
      status: 'blocked',
      phase: 'verify',
      gate: 'migration-sequence-verification-required',
      migrationMayHaveCommitted: true,
      verificationCompleted: false,
    });
    expect(executedPhases(test)).toEqual(applyPhases);
    expect(test.report.mock.calls.at(-1)[0]).toEqual({
      operation,
      phase: 'verify',
      status: 'started',
    });
  });

  it('stops before migration if reporting safe ACL evidence cannot complete', async () => {
    const test = harness();
    test.report.mockImplementation((event) => {
      if (event.phase === 'acl-capture' && event.status === 'succeeded') {
        throw new MaintenanceGateError('migration-sequence-output-required');
      }
    });
    const result = await test.run().catch(publicMaintenanceFailure);
    expect(result).toMatchObject({
      phase: 'acl-capture',
      gate: 'migration-sequence-output-required',
      migrationMayHaveCommitted: false,
    });
    expect(executedPhases(test)).toEqual(['preflight', 'acl-capture']);
  });
});

describe('single-approval maintenance public receipts', () => {
  it.each(['prepare', 'apply'])(
    'allowlists %s stage results and retains explicit unverified-recovery declarations',
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
          riskAcceptanceSha256: 'f'.repeat(64),
        });
      }
      const logged = vi.spyOn(console, 'log').mockImplementation(() => {});
      const originalExecute = test.execute.getMockImplementation();
      test.execute.mockImplementation(async (...args) => {
        console.log(secret);
        return originalExecute(...args);
      });
      try {
        const result = await test.run();
        const serialized = JSON.stringify([result, test.report.mock.calls]);
        for (const excluded of [
          secret,
          test.env.MAINTENANCE_APPROVAL,
          test.env.DATABASE_DIRECT_URL,
          test.env.GH_TOKEN,
          backup,
          policy.host,
        ])
          expect(serialized).not.toContain(excluded);
        expect(result.recoveryVerified).toBe(false);
        expect(result.riskAcceptanceSha256).toBe(
          createHash('sha256').update(test.env.MAINTENANCE_APPROVAL).digest('hex'),
        );
        expect(result.stages.every((stage) => !Object.hasOwn(stage, 'recoveryVerified'))).toBe(
          true,
        );
        expect(logged).not.toHaveBeenCalled();
      } finally {
        logged.mockRestore();
      }
    },
  );

  it('redacts arbitrary provider errors while preserving the failed stage and commit uncertainty', async () => {
    const test = applyHarness();
    test.execute.mockImplementation(async (_env, request) => {
      if (request.operation === 'verify') {
        throw Object.assign(new Error(`${test.env.DATABASE_DIRECT_URL} ${test.env.GH_TOKEN}`), {
          code: 'private-non-sqlstate',
          detail: test.env.MAINTENANCE_APPROVAL,
          backupId: backup,
        });
      }
      return test.results[request.operation];
    });
    expect(await test.run().catch(publicMaintenanceFailure)).toEqual({
      operation,
      status: 'failed',
      category: 'database-or-contract-check-failed',
      phase: 'verify',
      migrationMayHaveCommitted: true,
      verificationCompleted: false,
    });
  });
});
