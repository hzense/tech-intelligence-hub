import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  aiConfigMigrationPlan,
  publicMaintenanceFailure,
  publicMaintenanceResult,
  requireAiConfigMigrationScope,
  runMaintenance,
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
}));
vi.mock('../src/connection-policy.mjs', () => ({
  productionDatabaseOptions: () => ({ connectionString: 'test-adapter-only' }),
  validateConnectionTarget: () => ({ host: 'test.invalid' }),
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
// This is the historical 0000–0013 approval fixture, not permission for 0014.
const manifest = Object.fromEntries(
  Object.entries(currentManifest).filter(([name]) => name < '0014_'),
);
const migrations = Object.entries(manifest).map(([name, checksum]) => ({
  name,
  checksum,
  sql: readFileSync(new URL(name, directory), 'utf8'),
}));
const pending = migrations.slice(4).map(({ name }) => name);
const now = Date.parse('2026-09-14T10:00:00Z');
const backupId = 'synthetic-reviewed-backup-20260914';
const baseEnv = {
  GITHUB_ACTIONS: 'true',
  GITHUB_REPOSITORY: 'hzense/tech-intelligence-hub',
  GITHUB_EVENT_NAME: 'workflow_dispatch',
  GITHUB_REF: 'refs/heads/main',
  GITHUB_SHA: 'a'.repeat(40),
  GITHUB_RUN_ID: '123',
  GITHUB_RUN_ATTEMPT: '1',
  GH_TOKEN: 'synthetic-read-only-token',
};
function environment(operation = 'migrate', changes = {}) {
  return {
    ...baseEnv,
    MAINTENANCE_OPERATION: operation,
    MAINTENANCE_BACKUP_ID: backupId,
    MAINTENANCE_APPROVAL: JSON.stringify({
      operation,
      sha: baseEnv.GITHUB_SHA,
      runId: '123',
      runAttempt: '1',
      expiresAt: '2026-09-14T11:00:00Z',
      backupExpiresAt: '2026-09-15T11:00:00Z',
      backupIdSha256: createHash('sha256').update(backupId).digest('hex'),
      backupVerified: false,
      backupPresenceReviewed: true,
      restoreRehearsed: false,
      aclRecoveryReviewed: false,
      ddlFreezeConfirmed: true,
      recoveryPolicy: 'accept-unverified-ai-config',
      riskAcceptance: {
        scope: 'ai-configuration-production-launch',
        accepted: true,
        historicalAclGapAccepted: true,
        acknowledgement: 'recovery-unverified-data-loss-or-prolonged-outage-accepted',
      },
      ...(operation === 'acl-capture'
        ? { publicArchiveApproved: true, archiveRepository: baseEnv.GITHUB_REPOSITORY }
        : { aclFingerprint: 'b'.repeat(64), ...aiConfigMigrationPlan(pending, migrations) }),
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
    id: 42,
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
beforeEach(() => {
  vi.clearAllMocks();
  calls.lockedPending = pending;
  calls.lockedMigrations = migrations;
  calls.preflight.mockResolvedValue({ pendingMigrations: pending });
  calls.inspect.mockResolvedValue({ pendingMigrations: pending });
  calls.load.mockResolvedValue(migrations);
  calls.manifest.mockResolvedValue(undefined);
  calls.verify.mockResolvedValue({ migrationCount: 14, tableCount: 40 });
  calls.capture.mockResolvedValue({ fingerprint: 'c'.repeat(64) });
  calls.migrate.mockImplementation(async ({ beforeMigrate, beforeApply }) => {
    await beforeMigrate({});
    await beforeApply?.(calls.lockedPending, { migrations: calls.lockedMigrations });
    calls.ddl();
  });
});

describe('fixed AI configuration migration plan', () => {
  it('refuses the current import migration under the historical AI approval', () => {
    const current = Object.entries(currentManifest).map(([name, checksum]) => ({
      name,
      checksum,
      sql: readFileSync(new URL(name, directory), 'utf8'),
    }));
    expect(() =>
      aiConfigMigrationPlan(
        current.slice(4).map(({ name }) => name),
        current,
      ),
    ).toThrow('ai-config-migration-manifest-required');
  });
  it('pins independently reviewed names and actual SQL checksums, with domain-separated hashes', () => {
    expect(migrations).toHaveLength(14);
    for (const migration of migrations) {
      expect(
        createHash('sha256')
          .update(readFileSync(new URL(migration.name, directory), 'utf8'))
          .digest('hex'),
      ).toBe(migration.checksum);
    }
    const manifestFingerprint = createHash('sha256')
      .update('hzense/ai-config-migration-manifest/v1\0')
      .update(JSON.stringify(Object.entries(manifest)))
      .digest('hex');
    expect(aiConfigMigrationPlan(pending, migrations)).toEqual({
      manifestFingerprint,
      planFingerprint: createHash('sha256')
        .update('hzense/ai-config-migration-plan/v1\0')
        .update(JSON.stringify({ manifestFingerprint, pendingMigrations: pending }))
        .digest('hex'),
    });
  });
  it.each(Array.from({ length: 10 }, (_, index) => index))(
    'permits only a newly approved nonempty suffix beginning at offset %i',
    (offset) => {
      const suffix = pending.slice(offset);
      const approval = aiConfigMigrationPlan(suffix, migrations);
      expect(
        requireAiConfigMigrationScope({ pendingMigrations: suffix }, migrations, approval),
      ).toEqual(approval);
      if (offset) {
        expect(approval.manifestFingerprint).toBe(
          aiConfigMigrationPlan(pending, migrations).manifestFingerprint,
        );
        expect(() =>
          requireAiConfigMigrationScope(
            { pendingMigrations: suffix },
            migrations,
            aiConfigMigrationPlan(pending, migrations),
          ),
        ).toThrow('ai-config-migration-plan-mismatch');
      }
    },
  );
  it.each(
    [
      undefined,
      null,
      [],
      '0013_ai_configuration.sql',
      ['0003_search_documents_fts.sql', ...pending],
      pending.slice(0, -1),
      [...pending.slice(0, 2), ...pending.slice(3)],
      [...pending].reverse(),
      [...pending, '0014_future.sql'],
      [pending[9], pending[9]],
      [undefined],
      new Array(10),
    ].map((value) => [value]),
  )('rejects empty, missing, noncontiguous, older or future pending plans %j', (value) => {
    expect(() => aiConfigMigrationPlan(value, migrations)).toThrow(
      'ai-config-migration-scope-required',
    );
  });
  it.each(Array.from({ length: 14 }, (_, index) => index))(
    'rejects checksum drift at manifest index %i',
    (index) => {
      const changed = migrations.map((entry, position) =>
        position === index ? { ...entry, checksum: 'f'.repeat(64) } : entry,
      );
      expect(() => aiConfigMigrationPlan(pending, changed)).toThrow(
        'ai-config-migration-manifest-required',
      );
    },
  );
  it.each(
    [
      undefined,
      null,
      [],
      migrations.slice(1),
      [...migrations].reverse(),
      [...migrations, { name: '0014_future.sql', checksum: 'f'.repeat(64) }],
      new Array(14),
    ].map((value) => [value]),
  )('rejects malformed or expanded artifacts %j', (value) => {
    expect(() => aiConfigMigrationPlan(pending, value)).toThrow(
      'ai-config-migration-manifest-required',
    );
  });
});

describe('AI configuration recovery declarations', () => {
  it.each(['migrate', 'acl-capture'])(
    'requires exact AI scope and run binding for %s',
    (operation) => {
      expect(validateMaintenanceRequest(environment(operation), now).operation).toBe(operation);
    },
  );
  it('does not grant the existing search writer permission', () => {
    expect(() => validateMaintenanceRequest(environment('search-apply'), now)).toThrow(
      'ai-config-operation-required',
    );
  });
  it.each([
    { manifestFingerprint: undefined },
    { manifestFingerprint: '' },
    { manifestFingerprint: ['a'.repeat(64)] },
    { manifestFingerprint: { toString: 'a'.repeat(64) } },
    { planFingerprint: undefined },
    { planFingerprint: ['b'.repeat(64)] },
    { planFingerprint: 'not-a-hash' },
    { aclFingerprint: undefined },
    { backupVerified: true },
    { backupPresenceReviewed: false },
    { backupPresenceReviewed: 'true' },
    { restoreRehearsed: true },
    { restoreRehearsed: undefined },
    { aclRecoveryReviewed: true },
    { restoreEvidenceFingerprint: 'c'.repeat(64) },
    { restoreEvidenceFingerprint: null },
    { ddlFreezeConfirmed: false },
    { backupExpiresAt: undefined },
    { backupExpiresAt: '2026-09-14T10:30:00Z' },
    { backupNeverExpires: true },
    { backupIdSha256: 'f'.repeat(64) },
    { sha: 'f'.repeat(40) },
    { runId: '124' },
    { runAttempt: '2' },
    { expiresAt: '2026-09-14T09:00:00Z' },
    { expiresAt: '2026-09-16T10:00:00Z' },
    { recoveryPolicy: 'verified' },
    { recoveryPolicy: 'accept-unverified-fts1' },
    { riskAcceptance: undefined },
    { riskAcceptance: null },
  ])('rejects incomplete, stale or fabricated migrate declarations %j', (changes) => {
    expect(() => validateMaintenanceRequest(environment('migrate', changes), now)).toThrow();
  });
  it.each([
    ['scope', 'fts1-production-launch'],
    ['scope', 'all-maintenance'],
    ['accepted', false],
    ['accepted', 'true'],
    ['historicalAclGapAccepted', false],
    ['acknowledgement', 'accepted'],
  ])('rejects insufficient risk acceptance %s', (key, value) => {
    const env = environment();
    const approval = JSON.parse(env.MAINTENANCE_APPROVAL);
    approval.riskAcceptance[key] = value;
    expect(() =>
      validateMaintenanceRequest({ ...env, MAINTENANCE_APPROVAL: JSON.stringify(approval) }, now),
    ).toThrow('explicit-recovery-risk-acceptance-required');
  });
  it('capture needs independent public consent but no as-yet-unknown plan or ACL fingerprint', async () => {
    const result = await execute(environment('acl-capture'));
    expect(result).toMatchObject({
      operation: 'acl-capture',
      recoveryPolicy: 'accept-unverified-ai-config',
      recoveryVerified: false,
    });
    expect(calls.capture).toHaveBeenCalledOnce();
    expect(calls.migrate).not.toHaveBeenCalled();
    expect(calls.load).not.toHaveBeenCalled();
  });
  it('preserves unverified AI policy in the actual public evidence builder without private approval fields', async () => {
    const { capturePublicAclEvidence } = await vi.importActual(
      '../../../.github/scripts/public-acl-evidence.mjs',
    );
    const { buildRuntimeAclBaseline, runtimeAclBaselineCategoryNames, runtimeAclBackupReference } =
      await vi.importActual('../src/runtime-acl-baseline.mjs');
    const env = {
      ...environment('acl-capture', { privateComment: 'do-not-publish-this-comment' }),
      DATABASE_DIRECT_URL:
        'postgresql://hzense_migrator:synthetic-password@ep-synthetic.neon.tech:5432/hzense?sslmode=verify-full',
      RUNNER_TEMP: '/tmp/ai-config-evidence-test-only',
    };
    const baseline = buildRuntimeAclBaseline({
      identity: { database: 'hzense', currentUser: 'hzense_migrator' },
      categories: Object.fromEntries(runtimeAclBaselineCategoryNames.map((name) => [name, []])),
      capturedAt: '2026-09-14T10:00:00.000Z',
      backupReference: runtimeAclBackupReference(backupId),
    });
    const capture = vi.fn().mockResolvedValue(baseline);
    const save = vi.fn();
    const checkApproval = vi.fn(() => validateMaintenanceRequest(env, now));
    await capturePublicAclEvidence(env, { capture, save, checkApproval });
    expect(capture).toHaveBeenCalledTimes(2);
    expect(checkApproval).toHaveBeenCalledTimes(3);
    const serialized = save.mock.calls[0][1];
    expect(JSON.parse(serialized)).toMatchObject({
      recoveryPolicy: 'accept-unverified-ai-config',
      recoveryVerified: false,
      restoration: 'unverified-risk-accepted',
      independentCapturesMatch: true,
    });
    expect(serialized).not.toMatch(/synthetic-password|ep-synthetic|do-not-publish-this-comment/);
    expect(serialized).not.toContain(backupId);
  });
  it.each([
    { publicArchiveApproved: false },
    { publicArchiveApproved: 'true' },
    { archiveRepository: 'other/repository' },
    { archiveRepository: undefined },
  ])('refuses capture without current public archive consent %j', (changes) => {
    expect(() => validateMaintenanceRequest(environment('acl-capture', changes), now)).toThrow(
      'public-acl-archive-approval-required',
    );
  });
  it('does not reuse a capture approval for migration', () => {
    const env = environment('acl-capture');
    expect(() =>
      validateMaintenanceRequest({ ...env, MAINTENANCE_OPERATION: 'migrate' }, now),
    ).toThrow('approval-run-mismatch');
  });
  it('preserves explicit non-expiring backups and never labels them restored', async () => {
    const result = await execute(
      environment('migrate', { backupNeverExpires: true, backupExpiresAt: undefined }),
    );
    expect(result.recoveryVerified).toBe(false);
  });
});

describe('real hosted dispatch wiring with synthetic database adapters', () => {
  it('publishes only plan hashes and pending count from eligible read-only preflight', async () => {
    calls.preflight.mockResolvedValue({
      pendingMigrations: pending,
      connectionString: 'private-secret',
    });
    const result = await execute({ ...baseEnv, MAINTENANCE_OPERATION: 'preflight' });
    expect(result).toEqual({
      operation: 'preflight',
      status: 'succeeded',
      pendingMigrationCount: 10,
      ...aiConfigMigrationPlan(pending, migrations),
    });
    expect(JSON.stringify(result)).not.toMatch(/private|\.sql|postgres:/);
    expect(calls.ddl).not.toHaveBeenCalled();
  });
  it.each(
    [[], ['0003_search_documents_fts.sql'], [...pending, '0014_future.sql']].map((value) => [
      value,
    ]),
  )('keeps generic preflight but issues no AI plan for %j', async (value) => {
    calls.preflight.mockResolvedValue({ pendingMigrations: value });
    const result = await execute({ ...baseEnv, MAINTENANCE_OPERATION: 'preflight' });
    expect(result.pendingMigrationCount).toBe(value.length);
    expect(result).not.toHaveProperty('manifestFingerprint');
    expect(result).not.toHaveProperty('planFingerprint');
  });
  it('rechecks SQL and artifact pins before locking and under the actual migration lock', async () => {
    const env = environment();
    const result = await execute(env);
    expect(calls.load).toHaveBeenCalledOnce();
    expect(calls.manifest).toHaveBeenCalledOnce();
    expect(calls.ddl).toHaveBeenCalledOnce();
    expect(calls.verify).toHaveBeenCalledOnce();
    expect(result).toEqual({
      operation: 'migrate',
      status: 'succeeded',
      migrationCount: 14,
      tableCount: 40,
      ...aiConfigMigrationPlan(pending, migrations),
      recoveryPolicy: 'accept-unverified-ai-config',
      recoveryVerified: false,
      riskAcceptanceSha256: createHash('sha256').update(env.MAINTENANCE_APPROVAL).digest('hex'),
    });
  });
  it.each(['manifestFingerprint', 'planFingerprint'])(
    'rejects stale approval %s before DDL',
    async (field) => {
      await expect(execute(environment('migrate', { [field]: 'f'.repeat(64) }))).rejects.toThrow(
        'ai-config-migration-plan-mismatch',
      );
      expect(calls.ddl).not.toHaveBeenCalled();
    },
  );
  it('rejects a plan advanced by a concurrent migration after initial preflight', async () => {
    calls.lockedPending = pending.slice(1);
    await expect(execute()).rejects.toThrow('ai-config-migration-plan-mismatch');
    expect(calls.ddl).not.toHaveBeenCalled();
    expect(calls.verify).not.toHaveBeenCalled();
  });
  it('allows partial progress only after new preflight and fresh suffix approval', async () => {
    const suffix = pending.slice(3);
    calls.preflight.mockResolvedValue({ pendingMigrations: suffix });
    calls.inspect.mockResolvedValue({ pendingMigrations: suffix });
    calls.lockedPending = suffix;
    const { manifestFingerprint, planFingerprint } = await execute({
      ...baseEnv,
      MAINTENANCE_OPERATION: 'preflight',
    });
    await expect(
      execute(environment('migrate', { manifestFingerprint, planFingerprint })),
    ).resolves.toMatchObject({ status: 'succeeded' });
    expect(calls.ddl).toHaveBeenCalledOnce();
  });
  it.each([[], [...pending, '0014_future.sql'], pending.slice(0, -1)].map((value) => [value]))(
    'blocks actual locked out-of-scope plan %j',
    async (value) => {
      calls.lockedPending = value;
      await expect(execute()).rejects.toThrow('ai-config-migration-scope-required');
      expect(calls.ddl).not.toHaveBeenCalled();
    },
  );
  it('blocks artifact drift appearing after initial preflight', async () => {
    calls.lockedMigrations = migrations.map((entry, index) =>
      index === 13 ? { ...entry, checksum: 'f'.repeat(64) } : entry,
    );
    await expect(execute()).rejects.toThrow('ai-config-migration-manifest-required');
    expect(calls.ddl).not.toHaveBeenCalled();
  });
  it('rejects a changed actual SQL string even with a claimed approved checksum and clean disk reads', async () => {
    calls.lockedMigrations = migrations.map((entry, index) =>
      index === 13 ? { ...entry, sql: 'SELECT 1; -- unapproved artifact' } : entry,
    );
    await expect(execute()).rejects.toThrow('ai-config-migration-manifest-required');
    expect(calls.load).toHaveBeenCalledOnce();
    expect(calls.ddl).not.toHaveBeenCalled();
  });
  it('does not return success or risk acceptance if final schema verification fails', async () => {
    calls.verify.mockRejectedValueOnce(new Error('schema drift'));
    await expect(execute()).rejects.toThrow('schema drift');
    expect(calls.ddl).toHaveBeenCalledOnce();
  });
  it('leaves default verified migrations unrestricted by the new artifact pins', async () => {
    const env = environment('migrate', {
      recoveryPolicy: undefined,
      riskAcceptance: undefined,
      backupVerified: true,
      restoreRehearsed: true,
      aclRecoveryReviewed: true,
      restoreEvidenceFingerprint: 'c'.repeat(64),
      planFingerprint: undefined,
      manifestFingerprint: undefined,
    });
    calls.lockedPending = [...pending, '0014_future.sql'];
    const result = await execute(env);
    expect(calls.ddl).toHaveBeenCalledOnce();
    expect(calls.load).not.toHaveBeenCalled();
    expect(result).not.toHaveProperty('recoveryPolicy');
    expect(result).not.toHaveProperty('manifestFingerprint');
  });
  it('retains the FTS-only exception without gaining AI migration authority', async () => {
    const env = environment('migrate', {
      recoveryPolicy: 'accept-unverified-fts1',
      riskAcceptance: {
        scope: 'fts1-production-launch',
        accepted: true,
        historicalAclGapAccepted: true,
        acknowledgement: 'recovery-unverified-data-loss-or-prolonged-outage-accepted',
      },
      planFingerprint: undefined,
      manifestFingerprint: undefined,
    });
    await expect(execute(env)).rejects.toThrow('fts1-migration-scope-required');
    expect(calls.ddl).not.toHaveBeenCalled();
    calls.inspect.mockResolvedValue({ pendingMigrations: ['0003_search_documents_fts.sql'] });
    calls.lockedPending = ['0003_search_documents_fts.sql'];
    await expect(execute(env)).resolves.toMatchObject({ recoveryPolicy: 'accept-unverified-fts1' });
    expect(calls.ddl).toHaveBeenCalledOnce();
    expect(calls.load).not.toHaveBeenCalled();
  });
  it('does not run database code before current-main CI and approval-expiry checks', async () => {
    await expect(
      execute(environment(), { fetchImpl: vi.fn().mockRejectedValue(new Error('private-token')) }),
    ).rejects.toThrow('github-preflight-unavailable');
    const clock = vi
      .fn()
      .mockReturnValueOnce(now)
      .mockReturnValueOnce(now + 60 * 60 * 1000);
    await expect(execute(environment(), { now: clock })).rejects.toThrow(
      'approval-expired-or-too-long',
    );
    expect(calls.migrate).not.toHaveBeenCalled();
  });
  it('sanitizes hash types and blocked errors without exposing the migration plan', () => {
    expect(
      publicMaintenanceResult('preflight', {
        manifestFingerprint: ['a'.repeat(64)],
        planFingerprint: 'private',
      }),
    ).toEqual({ operation: 'preflight', status: 'succeeded' });
    try {
      requireAiConfigMigrationScope({ pendingMigrations: pending }, migrations, {});
    } catch (error) {
      expect(publicMaintenanceFailure(error)).toEqual({
        status: 'blocked',
        gate: 'ai-config-migration-plan-mismatch',
      });
    }
  });
});
