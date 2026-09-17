import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  aiConfigMigrationPlan,
  importTasksMigrationPlan,
  importTasksTargetBinding,
  publicMaintenanceFailure,
  requireSignalGenerationMigrationScope,
  runMaintenance,
  signalGenerationMigrationPlan,
  signalGenerationTargetBinding,
  validateMaintenanceRequest,
} from '../../../.github/scripts/production-maintenance.mjs';

const calls = vi.hoisted(() => ({
  preflight: vi.fn(),
  inspect: vi.fn(),
  load: vi.fn(),
  manifest: vi.fn(),
  migrate: vi.fn(),
  verify: vi.fn(),
  capture: vi.fn(),
  ddl: vi.fn(),
  lockedPending: undefined,
  lockedMigrations: undefined,
  policy: undefined,
  client: undefined,
}));
vi.mock('../src/connection-policy.mjs', () => ({
  productionDatabaseOptions: () => ({ connectionString: 'synthetic-adapter-only' }),
  validateConnectionTarget: () => calls.policy,
}));
vi.mock('../src/preflight.mjs', () => ({
  runDatabasePreflight: calls.preflight,
  inspectDatabasePreflight: calls.inspect,
}));
vi.mock('../src/migrate.mjs', () => ({
  runMigrations: calls.migrate,
  loadMigrations: calls.load,
  verifyMigrationManifest: calls.manifest,
}));
vi.mock('../src/verify.mjs', () => ({ verifyDatabaseContract: calls.verify }));
vi.mock('../../../.github/scripts/public-acl-evidence.mjs', () => ({
  capturePublicAclEvidence: calls.capture,
}));

const directory = new URL('../../../db/migrations/', import.meta.url);
const currentManifest = JSON.parse(readFileSync(new URL('checksums.json', directory), 'utf8'));
// This reviewed 0000–0015 fixture must not gain authority when 0016 is introduced.
const migrations = Object.freeze(
  Object.entries(currentManifest)
    .filter(([name]) => name < '0016_')
    .map(([name, checksum]) =>
      Object.freeze({ name, checksum, sql: readFileSync(new URL(name, directory), 'utf8') }),
    ),
);
const pending = Object.freeze(['0015_signal_generation.sql']);
const now = Date.parse('2026-09-17T10:00:00Z');
const backupId = 'synthetic-generation-backup-20260917';
const identity = Object.freeze({ database: 'synthetic_hzense', user: 'synthetic_migrator' });
const policy = Object.freeze({ host: 'generation.invalid', port: '5432', ...identity });
const hash = (value) => createHash('sha256').update(value).digest('hex');
const binding = signalGenerationTargetBinding(policy, identity, backupId);
const plan = signalGenerationMigrationPlan(pending, migrations, binding);
const riskAcceptance = Object.freeze({
  scope: 'signal-generation-production-launch',
  accepted: true,
  historicalAclGapAccepted: true,
  acknowledgement: 'recovery-unverified-data-loss-or-prolonged-outage-accepted',
});
const baseEnv = Object.freeze({
  GITHUB_ACTIONS: 'true',
  GITHUB_REPOSITORY: 'hzense/tech-intelligence-hub',
  GITHUB_EVENT_NAME: 'workflow_dispatch',
  GITHUB_REF: 'refs/heads/main',
  GITHUB_SHA: 'a'.repeat(40),
  GITHUB_RUN_ID: '15001',
  GITHUB_RUN_ATTEMPT: '1',
  GH_TOKEN: 'synthetic-read-only-github-token',
});
function environment(operation = 'migrate', changes = {}) {
  return {
    ...baseEnv,
    MAINTENANCE_OPERATION: operation,
    MAINTENANCE_BACKUP_ID: backupId,
    MAINTENANCE_APPROVAL: JSON.stringify({
      operation,
      sha: baseEnv.GITHUB_SHA,
      runId: baseEnv.GITHUB_RUN_ID,
      runAttempt: baseEnv.GITHUB_RUN_ATTEMPT,
      expiresAt: '2026-09-17T11:00:00Z',
      backupExpiresAt: '2026-09-18T11:00:00Z',
      backupVerified: false,
      backupPresenceReviewed: true,
      restoreRehearsed: false,
      aclRecoveryReviewed: false,
      ddlFreezeConfirmed: true,
      recoveryPolicy: 'accept-unverified-signal-generation',
      riskAcceptance,
      ...binding,
      ...(operation === 'acl-capture'
        ? { publicArchiveApproved: true, archiveRepository: baseEnv.GITHUB_REPOSITORY }
        : { aclFingerprint: 'b'.repeat(64), ...plan }),
      ...changes,
    }),
  };
}
function successfulFetch() {
  const reference = {
    ref: baseEnv.GITHUB_REF,
    object: { type: 'commit', sha: baseEnv.GITHUB_SHA },
  };
  const run = {
    id: 15000,
    path: '.github/workflows/ci.yml',
    repository: { full_name: baseEnv.GITHUB_REPOSITORY },
    head_sha: baseEnv.GITHUB_SHA,
    head_branch: 'main',
    event: 'push',
    status: 'completed',
    conclusion: 'success',
  };
  const response = (body) => ({ status: 200, json: async () => body });
  return vi
    .fn()
    .mockResolvedValueOnce(response(reference))
    .mockResolvedValueOnce(response({ workflow_runs: [run] }))
    .mockResolvedValueOnce(response(reference));
}
function execute(env = environment(), options = {}) {
  return runMaintenance(env, undefined, {
    fetchImpl: successfulFetch(),
    now: () => now,
    ...options,
  });
}
const futureMigration = Object.freeze({
  name: '0016_future.sql',
  sql: 'SELECT 1;',
  checksum: hash('SELECT 1;'),
});

beforeEach(() => {
  vi.resetAllMocks();
  calls.policy = { ...policy };
  calls.client = { marker: 'same-synthetic-migration-connection' };
  calls.lockedPending = pending;
  calls.lockedMigrations = migrations;
  calls.preflight.mockResolvedValue({ ...identity, pendingMigrations: pending });
  calls.inspect.mockResolvedValue({ ...identity, pendingMigrations: pending });
  calls.load.mockResolvedValue(migrations);
  calls.manifest.mockResolvedValue(undefined);
  calls.verify.mockResolvedValue({ migrationCount: 16, tableCount: 48 });
  calls.capture.mockResolvedValue({ fingerprint: 'c'.repeat(64) });
  calls.migrate.mockImplementation(async ({ beforeMigrate, beforeApply }) => {
    await beforeMigrate(calls.client);
    await beforeApply?.(calls.lockedPending, { migrations: calls.lockedMigrations });
    calls.ddl();
  });
});

describe('independent 0015 migration artifact and target binding', () => {
  it('pins all sixteen SQL files and reproduces the independent public fingerprints', () => {
    expect(migrations).toHaveLength(16);
    expect(migrations.at(-1)).toMatchObject({
      name: '0015_signal_generation.sql',
      checksum: '0c93078e520045e733824668d5eafe23064c48c60a0f0d52c72e00a9eae6b666',
    });
    const manifestFingerprint = hash(
      `hzense/signal-generation-migration-manifest/v1\0${JSON.stringify(
        migrations.map(({ name, checksum }) => [name, checksum]),
      )}`,
    );
    expect(plan).toEqual({
      ...binding,
      manifestFingerprint,
      planFingerprint: hash(
        `hzense/signal-generation-migration-plan/v1\0${JSON.stringify({
          manifestFingerprint,
          pendingMigrations: pending,
          ...binding,
        })}`,
      ),
    });
    expect(
      requireSignalGenerationMigrationScope(
        { pendingMigrations: pending },
        migrations,
        plan,
        binding,
      ),
    ).toEqual(plan);
    expect(binding.targetFingerprint).not.toBe(
      importTasksTargetBinding(policy, identity, backupId).targetFingerprint,
    );
    expect(
      signalGenerationTargetBinding({ ...policy, host: 'GENERATION.INVALID' }, identity, backupId),
    ).toEqual(binding);
  });

  it.each([
    ['empty', []],
    ['older import', ['0014_import_tasks.sql']],
    ['older plus generation', ['0014_import_tasks.sql', ...pending]],
    ['future', [...pending, '0016_future.sql']],
    ['duplicate', [...pending, ...pending]],
    ['not an array', pending[0]],
    ['missing', undefined],
  ])('rejects the %s pending plan', (_, actualPending) => {
    expect(() => signalGenerationMigrationPlan(actualPending, migrations, binding)).toThrow(
      'signal-generation-migration-scope-required',
    );
  });

  it.each([
    ['missing historical file', migrations.slice(1)],
    ['future migration', [...migrations, futureMigration]],
    ['reordered manifest', [...migrations].reverse()],
    [
      'changed name',
      migrations.map((entry, index) =>
        index === 15 ? { ...entry, name: '0015_other.sql' } : entry,
      ),
    ],
    [
      'claimed checksum',
      migrations.map((entry, index) =>
        index === 15 ? { ...entry, checksum: 'f'.repeat(64) } : entry,
      ),
    ],
    [
      'changed generation SQL',
      migrations.map((entry, index) =>
        index === 15 ? { ...entry, sql: `${entry.sql}\n` } : entry,
      ),
    ],
    [
      'changed historical SQL',
      migrations.map((entry, index) => (index === 0 ? { ...entry, sql: `${entry.sql}\n` } : entry)),
    ],
    [
      'missing SQL bytes',
      migrations.map((entry, index) => (index === 15 ? { ...entry, sql: undefined } : entry)),
    ],
  ])('rejects %s even with the approved pending name', (_, artifact) => {
    expect(() => signalGenerationMigrationPlan(pending, artifact, binding)).toThrow(
      'signal-generation-migration-manifest-required',
    );
  });

  it.each(['manifestFingerprint', 'planFingerprint', 'targetFingerprint', 'backupIdSha256'])(
    'rejects a different approval %s',
    (key) => {
      expect(() =>
        requireSignalGenerationMigrationScope(
          { pendingMigrations: pending },
          migrations,
          { ...plan, [key]: 'f'.repeat(64) },
          binding,
        ),
      ).toThrow('signal-generation-migration-plan-mismatch');
    },
  );

  it.each(['host', 'port', 'database', 'user'])('requires target component %s', (key) => {
    expect(() =>
      signalGenerationTargetBinding({ ...policy, [key]: '' }, identity, backupId),
    ).toThrow('signal-generation-target-required');
  });
  it.each(['database', 'user'])(
    'requires authenticated %s to match the connection target',
    (key) => {
      expect(() =>
        signalGenerationTargetBinding(policy, { ...identity, [key]: 'other' }, backupId),
      ).toThrow('signal-generation-target-required');
    },
  );
  it.each([
    undefined,
    '',
    'short',
    'placeholder-backup',
    'backup/none/value',
    'backup?private=value',
  ])('refuses an absent, invalid, or placeholder backup %j', (backup) => {
    expect(() => signalGenerationTargetBinding(policy, identity, backup)).toThrow(
      'reviewed-backup-required',
    );
  });
});

describe('generation recovery declarations remain explicit and run bound', () => {
  it.each(['migrate', 'acl-capture'])(
    'accepts an explicit %s declaration without claiming restoration',
    (operation) => {
      const result = validateMaintenanceRequest(environment(operation), now);
      expect(result).toMatchObject({
        operation,
        approval: {
          recoveryPolicy: 'accept-unverified-signal-generation',
          backupVerified: false,
          restoreRehearsed: false,
          aclRecoveryReviewed: false,
        },
      });
    },
  );
  it('does not authorize search writes', () => {
    expect(() => validateMaintenanceRequest(environment('search-apply'), now)).toThrow(
      'signal-generation-operation-required',
    );
  });

  it.each([
    ['sha', 'f'.repeat(40)],
    ['runId', '15002'],
    ['runAttempt', '2'],
    ['operation', 'acl-capture'],
  ])('refuses a different approval %s', (key, value) => {
    expect(() => validateMaintenanceRequest(environment('migrate', { [key]: value }), now)).toThrow(
      'approval-run-mismatch',
    );
  });
  it.each([undefined, 'invalid-date', '2026-09-17T10:00:00Z', '2026-09-18T10:00:01Z'])(
    'refuses invalid or expired approval %j',
    (expiresAt) => {
      expect(() => validateMaintenanceRequest(environment('migrate', { expiresAt }), now)).toThrow(
        'approval-expired-or-too-long',
      );
    },
  );
  it.each([
    { ddlFreezeConfirmed: false },
    { ddlFreezeConfirmed: undefined },
    { ddlFreezeConfirmed: 'true' },
    { backupExpiresAt: undefined },
    { backupExpiresAt: 'invalid-date' },
    { backupExpiresAt: '2026-09-17T11:00:00Z' },
    { backupNeverExpires: true },
    { backupNeverExpires: 'true', backupExpiresAt: undefined },
  ])('requires a frozen window and backup retention covering approval: %j', (changes) => {
    expect(() => validateMaintenanceRequest(environment('migrate', changes), now)).toThrow(
      'recovery-evidence-required',
    );
  });
  it('accepts independently declared non-expiring backups without a fabricated expiry', () => {
    expect(
      validateMaintenanceRequest(
        environment('migrate', {
          backupNeverExpires: true,
          backupExpiresAt: undefined,
        }),
        now,
      ).approval.backupVerified,
    ).toBe(false);
  });
  it.each([
    { backupVerified: true },
    { backupVerified: undefined },
    { backupPresenceReviewed: false },
    { backupPresenceReviewed: 'true' },
    { restoreRehearsed: true },
    { restoreRehearsed: undefined },
    { aclRecoveryReviewed: true },
    { aclRecoveryReviewed: undefined },
    { restoreEvidenceFingerprint: null },
    { restoreEvidenceFingerprint: 'd'.repeat(64) },
    { riskAcceptance: undefined },
  ])('rejects conflicting or missing recovery declarations: %j', (changes) => {
    expect(() => validateMaintenanceRequest(environment('migrate', changes), now)).toThrow(
      'explicit-recovery-risk-acceptance-required',
    );
  });
  it.each([
    ['scope', 'import-tasks-production-launch'],
    ['scope', 'ai-configuration-production-launch'],
    ['scope', undefined],
    ['accepted', false],
    ['accepted', 'true'],
    ['accepted', undefined],
    ['historicalAclGapAccepted', false],
    ['historicalAclGapAccepted', 'true'],
    ['historicalAclGapAccepted', undefined],
    ['acknowledgement', 'accepted'],
    ['acknowledgement', undefined],
  ])('rejects an insufficient risk field %s=%j', (key, value) => {
    expect(() =>
      validateMaintenanceRequest(
        environment('migrate', {
          riskAcceptance: { ...riskAcceptance, [key]: value },
        }),
        now,
      ),
    ).toThrow('explicit-recovery-risk-acceptance-required');
  });
  it.each(['manifestFingerprint', 'planFingerprint'])(
    'requires reviewed %s for migration',
    (key) => {
      expect(() =>
        validateMaintenanceRequest(environment('migrate', { [key]: undefined }), now),
      ).toThrow('reviewed-signal-generation-plan-required');
    },
  );
  it.each(['migrate', 'acl-capture'])('requires a target fingerprint for %s', (operation) => {
    expect(() =>
      validateMaintenanceRequest(environment(operation, { targetFingerprint: undefined }), now),
    ).toThrow('signal-generation-target-required');
  });
  it('requires a reviewed ACL fingerprint for migration', () => {
    expect(() =>
      validateMaintenanceRequest(environment('migrate', { aclFingerprint: undefined }), now),
    ).toThrow('recovery-evidence-required');
  });
  it('requires the exact backup reference hash', () => {
    expect(() =>
      validateMaintenanceRequest(environment('migrate', { backupIdSha256: 'f'.repeat(64) }), now),
    ).toThrow('reviewed-backup-required');
  });
  it.each([
    { publicArchiveApproved: false },
    { publicArchiveApproved: 'true' },
    { archiveRepository: 'other/repository' },
    { archiveRepository: undefined },
  ])('requires separate public disclosure approval for capture: %j', (changes) => {
    expect(() => validateMaintenanceRequest(environment('acl-capture', changes), now)).toThrow(
      'public-acl-archive-approval-required',
    );
  });
  it('does not reuse ACL capture approval for migration', () => {
    expect(() =>
      validateMaintenanceRequest(
        {
          ...environment('acl-capture'),
          MAINTENANCE_OPERATION: 'migrate',
        },
        now,
      ),
    ).toThrow('approval-run-mismatch');
  });
});

describe('real hosted generation executor with synthetic database adapters', () => {
  it('issues the exact read-only plan without migration, schema verification, or ACL capture', async () => {
    expect(
      await execute({
        ...baseEnv,
        MAINTENANCE_OPERATION: 'preflight',
        MAINTENANCE_BACKUP_ID: backupId,
      }),
    ).toEqual({ operation: 'preflight', status: 'succeeded', pendingMigrationCount: 1, ...plan });
    expect(calls.migrate).not.toHaveBeenCalled();
    expect(calls.verify).not.toHaveBeenCalled();
    expect(calls.capture).not.toHaveBeenCalled();
  });
  it.each([undefined, '', 'placeholder-backup'])(
    'issues no plan when preflight has no reviewed backup: %j',
    async (backup) => {
      expect(
        await execute({
          ...baseEnv,
          MAINTENANCE_OPERATION: 'preflight',
          MAINTENANCE_BACKUP_ID: backup,
        }),
      ).toEqual({ operation: 'preflight', status: 'succeeded', pendingMigrationCount: 1 });
      expect(calls.ddl).not.toHaveBeenCalled();
    },
  );
  it.each([
    ['already applied', [], migrations],
    ['older migration', ['0014_import_tasks.sql', ...pending], migrations],
    ['future manifest', pending, [...migrations, futureMigration]],
  ])(
    'preserves generic read-only preflight for %s without issuing generation approval',
    async (_, actualPending, artifact) => {
      calls.preflight.mockResolvedValue({ ...identity, pendingMigrations: actualPending });
      calls.load.mockResolvedValue(artifact);
      expect(
        await execute({
          ...baseEnv,
          MAINTENANCE_OPERATION: 'preflight',
          MAINTENANCE_BACKUP_ID: backupId,
        }),
      ).toEqual({
        operation: 'preflight',
        status: 'succeeded',
        pendingMigrationCount: actualPending.length,
      });
    },
  );

  it('rechecks the same authenticated connection and frozen artifact before applying, then verifies', async () => {
    const env = environment('migrate', { privateComment: 'never-publish-this-approval-comment' });
    calls.verify.mockResolvedValue({
      migrationCount: 16,
      tableCount: 48,
      rawSql: 'private-executor-material',
      recoveryVerified: true,
    });
    expect(await execute(env)).toEqual({
      operation: 'migrate',
      status: 'succeeded',
      migrationCount: 16,
      tableCount: 48,
      ...plan,
      recoveryPolicy: 'accept-unverified-signal-generation',
      recoveryVerified: false,
      riskAcceptanceSha256: hash(env.MAINTENANCE_APPROVAL),
    });
    expect(calls.inspect).toHaveBeenCalledTimes(2);
    for (const [client] of calls.inspect.mock.calls) expect(client).toBe(calls.client);
    expect(calls.load).toHaveBeenCalledOnce();
    expect(calls.ddl).toHaveBeenCalledOnce();
    expect(calls.verify).toHaveBeenCalledOnce();
    expect(calls.inspect.mock.invocationCallOrder[1]).toBeLessThan(
      calls.ddl.mock.invocationCallOrder[0],
    );
    expect(calls.ddl.mock.invocationCallOrder[0]).toBeLessThan(
      calls.verify.mock.invocationCallOrder[0],
    );
  });

  const importBinding = importTasksTargetBinding(policy, identity, backupId);
  it.each([
    [
      'import',
      {
        recoveryPolicy: 'accept-unverified-import-tasks',
        riskAcceptance: { ...riskAcceptance, scope: 'import-tasks-production-launch' },
        ...importTasksMigrationPlan(
          ['0014_import_tasks.sql'],
          migrations.slice(0, 15),
          importBinding,
        ),
      },
      'import-tasks-migration-manifest-required',
    ],
    [
      'AI configuration',
      {
        recoveryPolicy: 'accept-unverified-ai-config',
        riskAcceptance: { ...riskAcceptance, scope: 'ai-configuration-production-launch' },
        ...aiConfigMigrationPlan(['0013_ai_configuration.sql'], migrations.slice(0, 14)),
      },
      'ai-config-migration-manifest-required',
    ],
    [
      'FTS',
      {
        recoveryPolicy: 'accept-unverified-fts1',
        riskAcceptance: { ...riskAcceptance, scope: 'fts1-production-launch' },
      },
      'fts1-migration-scope-required',
    ],
  ])('refuses the historical %s approval for 0015 before DDL', async (_, changes, gate) => {
    await expect(execute(environment('migrate', changes))).rejects.toThrow(gate);
    expect(calls.ddl).not.toHaveBeenCalled();
    expect(calls.verify).not.toHaveBeenCalled();
  });

  it.each(['host', 'port', 'database', 'user'])(
    'refuses another %s even if connection expectations and identity change together',
    async (key) => {
      calls.policy = { ...policy, [key]: key === 'port' ? '6432' : 'other' };
      calls.inspect.mockResolvedValue({
        database: calls.policy.database,
        user: calls.policy.user,
        pendingMigrations: pending,
      });
      await expect(execute()).rejects.toThrow('signal-generation-migration-plan-mismatch');
      expect(calls.ddl).not.toHaveBeenCalled();
    },
  );
  it('refuses backup replacement even when the separate approval backup hash is updated', async () => {
    const replacement = 'synthetic-replacement-backup-20260917';
    const env = environment('migrate', { backupIdSha256: hash(replacement) });
    env.MAINTENANCE_BACKUP_ID = replacement;
    await expect(execute(env)).rejects.toThrow('signal-generation-migration-plan-mismatch');
    expect(calls.ddl).not.toHaveBeenCalled();
  });
  it.each(['database', 'user'])(
    'refuses authenticated %s drift on the connection under lock',
    async (key) => {
      calls.inspect
        .mockResolvedValueOnce({ ...identity, pendingMigrations: pending })
        .mockResolvedValueOnce({ ...identity, [key]: 'different', pendingMigrations: pending });
      await expect(execute()).rejects.toThrow('signal-generation-target-required');
      expect(calls.ddl).not.toHaveBeenCalled();
    },
  );
  it.each([[], [...pending, '0016_future.sql']].map((value) => [value]))(
    'refuses an advanced or expanded locked pending plan %j',
    async (actualPending) => {
      calls.lockedPending = actualPending;
      await expect(execute()).rejects.toThrow('signal-generation-migration-scope-required');
      expect(calls.ddl).not.toHaveBeenCalled();
    },
  );
  it.each([
    [
      'changed SQL with unchanged claimed checksum',
      migrations.map((entry, index) => (index === 15 ? { ...entry, sql: 'SELECT 1;' } : entry)),
    ],
    ['future file', [...migrations, futureMigration]],
    ['missing artifact', undefined],
  ])(
    'refuses %s in the execution artifact even when the filesystem reread was approved',
    async (_, artifact) => {
      calls.lockedMigrations = artifact;
      await expect(execute()).rejects.toThrow('signal-generation-migration-manifest-required');
      expect(calls.load).toHaveBeenCalledOnce();
      expect(calls.ddl).not.toHaveBeenCalled();
    },
  );
  it('does not report a committed migration as fully verified when the post-check fails', async () => {
    calls.verify.mockRejectedValueOnce(new Error('synthetic schema mismatch'));
    await expect(execute()).rejects.toThrow('synthetic schema mismatch');
    expect(calls.ddl).toHaveBeenCalledOnce();
  });
  it.each(['target/TLS error', 'manifest validation error'])(
    'propagates %s without fallback writes',
    async (failure) => {
      const adapter = failure === 'target/TLS error' ? calls.inspect : calls.manifest;
      adapter.mockRejectedValueOnce(new Error(failure));
      await expect(execute()).rejects.toThrow(failure);
      expect(calls.ddl).not.toHaveBeenCalled();
    },
  );
  it('does not reach database adapters if main freshness or approval expiry fails', async () => {
    await expect(
      execute(environment(), { fetchImpl: vi.fn().mockRejectedValue(new Error('private-token')) }),
    ).rejects.toThrow('github-preflight-unavailable');
    await expect(
      execute(environment(), {
        now: vi
          .fn()
          .mockReturnValueOnce(now)
          .mockReturnValueOnce(now + 3_600_000),
      }),
    ).rejects.toThrow('approval-expired-or-too-long');
    expect(calls.migrate).not.toHaveBeenCalled();
    expect(calls.preflight).not.toHaveBeenCalled();
  });
  it('publishes only a bounded gate when target binding fails', async () => {
    calls.policy = { ...policy, host: 'private-other-host.invalid' };
    let failure;
    try {
      await execute();
    } catch (error) {
      failure = publicMaintenanceFailure(error);
    }
    expect(failure).toEqual({
      status: 'blocked',
      gate: 'signal-generation-migration-plan-mismatch',
    });
  });
});

describe('generation ACL capture and public recovery evidence', () => {
  it('checks the target before independent capture without requiring a future plan or ACL fingerprint', async () => {
    const env = environment('acl-capture');
    expect(await execute(env)).toEqual({
      operation: 'acl-capture',
      status: 'succeeded',
      fingerprint: 'c'.repeat(64),
      ...binding,
      recoveryPolicy: 'accept-unverified-signal-generation',
      recoveryVerified: false,
      riskAcceptanceSha256: hash(env.MAINTENANCE_APPROVAL),
    });
    expect(calls.preflight).toHaveBeenCalledOnce();
    expect(calls.capture).toHaveBeenCalledOnce();
    expect(calls.preflight.mock.invocationCallOrder[0]).toBeLessThan(
      calls.capture.mock.invocationCallOrder[0],
    );
    expect(calls.migrate).not.toHaveBeenCalled();
    expect(calls.load).not.toHaveBeenCalled();
    expect(calls.capture.mock.calls[0][0]).not.toHaveProperty('GH_TOKEN');
  });
  it.each(['host', 'port', 'database', 'user'])(
    'refuses changed %s before capture',
    async (key) => {
      calls.policy = { ...policy, [key]: key === 'port' ? '6432' : 'other' };
      calls.preflight.mockResolvedValue({
        database: calls.policy.database,
        user: calls.policy.user,
        pendingMigrations: pending,
      });
      await expect(execute(environment('acl-capture'))).rejects.toThrow(
        'signal-generation-target-mismatch',
      );
      expect(calls.capture).not.toHaveBeenCalled();
    },
  );
  it('serializes the actual two-capture artifact with unverified recovery and no private approval material', async () => {
    const { capturePublicAclEvidence } = await vi.importActual(
      '../../../.github/scripts/public-acl-evidence.mjs',
    );
    const { buildRuntimeAclBaseline, runtimeAclBaselineCategoryNames, runtimeAclBackupReference } =
      await vi.importActual('../src/runtime-acl-baseline.mjs');
    const env = {
      ...environment('acl-capture', { privateComment: 'never-publish-this-generation-comment' }),
      DATABASE_DIRECT_URL:
        'postgresql://synthetic_migrator:synthetic-password@ep-generation.neon.tech:5432/synthetic_hzense?sslmode=verify-full',
      RUNNER_TEMP: '/tmp/generation-evidence-test-only',
    };
    const baseline = buildRuntimeAclBaseline({
      identity: { database: identity.database, currentUser: identity.user },
      categories: Object.fromEntries(runtimeAclBaselineCategoryNames.map((name) => [name, []])),
      capturedAt: '2026-09-17T10:00:00.000Z',
      backupReference: runtimeAclBackupReference(backupId),
    });
    const capture = vi.fn().mockResolvedValue(baseline);
    const save = vi.fn();
    const checkApproval = vi.fn(() => validateMaintenanceRequest(env, now));
    await capturePublicAclEvidence(env, { capture, save, checkApproval });
    expect(capture).toHaveBeenCalledTimes(2);
    expect(checkApproval).toHaveBeenCalledTimes(3);
    expect(save).toHaveBeenCalledOnce();
    const serialized = save.mock.calls[0][1];
    expect(JSON.parse(serialized)).toMatchObject({
      recoveryPolicy: 'accept-unverified-signal-generation',
      recoveryVerified: false,
      riskAcceptanceSha256: hash(env.MAINTENANCE_APPROVAL),
      restoration: 'unverified-risk-accepted',
      independentCapturesMatch: true,
      captures: [baseline, baseline],
    });
    for (const secret of [
      backupId,
      env.DATABASE_DIRECT_URL,
      env.MAINTENANCE_APPROVAL,
      env.GH_TOKEN,
      'synthetic-password',
      'ep-generation.neon.tech',
      'never-publish-this-generation-comment',
    ]) {
      expect(serialized).not.toContain(secret);
    }
  });
});
