import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import { beforeEach, describe, it, expect, vi } from 'vitest';
import {
  automationTargetBinding,
  automationMigrationPlan,
  requireAutomationMigrationScope,
  editorialMigrationPlan,
  editorialTargetBinding,
  materialReviewMigrationPlan,
  generationProgressMigrationPlan,
  candidateReviewMigrationPlan,
  candidateMaterialsMigrationPlan,
  candidateMaterialsTargetBinding,
  candidateEnrichmentMigrationPlan,
  candidateEnrichmentTargetBinding,
  validateMaintenanceRequest,
  runMaintenance,
  publicMaintenanceFailure,
} from '../../../.github/scripts/production-maintenance.mjs';

const calls = vi.hoisted(() => ({
  preflight: vi.fn(),
  load: vi.fn(),
  inspect: vi.fn(),
  migrate: vi.fn(),
  verify: vi.fn(),
  capture: vi.fn(),
  evidence: vi.fn(),
  inspectAcl: vi.fn(),
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
vi.mock('../../../.github/scripts/public-acl-evidence.mjs', () => ({
  capturePublicAclEvidence: calls.capture,
  readPublicAclEvidence: calls.evidence,
}));
vi.mock('../src/runtime-acl-baseline.mjs', () => ({
  inspectRuntimeAclBaseline: calls.inspectAcl,
  runtimeAclBackupReference: (backupId) => ({ backupId }),
}));

const root = new URL('../../../db/migrations/', import.meta.url);
const currentMigrations = Object.entries(
  JSON.parse(readFileSync(new URL('checksums.json', root), 'utf8')),
).map(([name, checksum]) => ({ name, checksum, sql: readFileSync(new URL(name, root), 'utf8') }));
// This approval is historical authority for 0000–0026, never for later migrations.
const migrations = currentMigrations.filter(({ name }) => name < '0027_');
const pending = ['0026_automation_tasks.sql'];
const identity = { database: 'hzense', user: 'migrator' };
const policy = { host: 'fixture.invalid', port: '5432', ...identity };
const backup = 'synthetic-automation-storage-backup';
const binding = automationTargetBinding(policy, identity, backup);
const plan = automationMigrationPlan(pending, migrations, binding);
const now = Date.parse('2026-09-23T12:00:00Z');
const approval = {
  operation: 'migrate',
  sha: 'a'.repeat(40),
  runId: '123',
  runAttempt: '1',
  expiresAt: '2026-09-23T13:00:00Z',
  backupExpiresAt: '2026-09-24T13:00:00Z',
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

function sequenceEnvironment(phase = 'prepare') {
  const { aclFingerprint, ...base } = approval;
  void aclFingerprint;
  return {
    ...env,
    MAINTENANCE_OPERATION: 'migrate-and-verify',
    MAINTENANCE_SEQUENCE_PHASE: phase,
    ...(phase === 'apply' ? { MAINTENANCE_ACL_ARCHIVE_CONFIRMED: 'success' } : {}),
    MAINTENANCE_APPROVAL: JSON.stringify({
      ...base,
      operation: 'migrate-and-verify',
      aclEvidenceMode: 'capture-in-run',
      publicArchiveApproved: true,
      archiveRepository: env.GITHUB_REPOSITORY,
    }),
  };
}

describe('independent 0026 maintenance authority', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    calls.policy = policy;
    calls.preflight.mockResolvedValue({ ...identity, pendingMigrations: pending });
    calls.inspect.mockResolvedValue({ ...identity, pendingMigrations: pending });
    calls.load.mockResolvedValue(migrations);
  });
  it('pins all 27 files and accepts only the reviewed 0026', () => {
    expect(migrations).toHaveLength(27);
    expect(() => editorialMigrationPlan(pending, migrations, binding)).toThrow('manifest-required');
    expect(editorialTargetBinding(policy, identity, backup).targetFingerprint).not.toBe(
      binding.targetFingerprint,
    );
    expect(() => materialReviewMigrationPlan(pending, migrations, binding)).toThrow(
      'manifest-required',
    );
    const both = ['0025_editorial_signal_publication.sql', ...pending];
    expect(() => automationMigrationPlan(both, migrations, binding)).toThrow('scope-required');
    expect(() => candidateMaterialsMigrationPlan(both, migrations, binding)).toThrow(
      'manifest-required',
    );
    expect(candidateMaterialsTargetBinding(policy, identity, backup).targetFingerprint).not.toBe(
      binding.targetFingerprint,
    );
    expect(
      requireAutomationMigrationScope({ pendingMigrations: pending }, migrations, plan, binding),
    ).toEqual(plan);
    for (const names of [
      [],
      Array(1),
      ['0021_candidate_review_attestations.sql', ...pending],
      ['0020_future.sql'],
      ['0022_candidate_enrichment_runs.sql', ...pending],
      [...pending, '0027_future.sql'],
    ])
      expect(() => automationMigrationPlan(names, migrations, binding)).toThrow(
        'automation-storage-migration-scope-required',
      );
    expect(binding.targetFingerprint).not.toBe(
      candidateEnrichmentTargetBinding(policy, identity, backup).targetFingerprint,
    );
    expect(() => candidateEnrichmentMigrationPlan(pending, migrations, binding)).toThrow();
    expect(() => generationProgressMigrationPlan(pending, migrations, binding)).toThrow();
    expect(() => candidateReviewMigrationPlan(pending, migrations, binding)).toThrow();
    expect(() =>
      requireAutomationMigrationScope(
        { pendingMigrations: pending },
        migrations,
        { ...plan, targetFingerprint: 'c'.repeat(64) },
        binding,
      ),
    ).toThrow('plan-mismatch');
    expect(() =>
      automationMigrationPlan(
        pending,
        migrations.map((migration, index) =>
          index === 24 ? { ...migration, sql: `${migration.sql} ` } : migration,
        ),
        binding,
      ),
    ).toThrow('manifest-required');
  });

  it('binds every plan field and refuses altered or extended migration artifacts', () => {
    for (const key of Object.keys(plan))
      expect(() =>
        requireAutomationMigrationScope(
          { pendingMigrations: pending },
          migrations,
          { ...plan, [key]: 'c'.repeat(64) },
          binding,
        ),
      ).toThrow('plan-mismatch');
    for (const artifact of [
      migrations.slice(0, -1),
      [...migrations, { name: '0027_future.sql', checksum: 'd'.repeat(64), sql: '' }],
      migrations.toReversed(),
      migrations.map((entry, index) => (index === 0 ? { ...entry, sql: `${entry.sql} ` } : entry)),
      migrations.map((entry, index) =>
        index === 23 ? { ...entry, checksum: 'e'.repeat(64) } : entry,
      ),
    ])
      expect(() => automationMigrationPlan(pending, artifact, binding)).toThrow(
        'manifest-required',
      );
    for (const key of ['host', 'port', 'database', 'user']) {
      expect(
        automationTargetBinding(
          { ...policy, [key]: `different-${policy[key]}` },
          {
            ...identity,
            ...(key === 'database' || key === 'user' ? { [key]: `different-${policy[key]}` } : {}),
          },
          backup,
        ).targetFingerprint,
      ).not.toBe(binding.targetFingerprint);
    }
    expect(
      automationMigrationPlan(
        pending,
        migrations,
        automationTargetBinding(policy, identity, `${backup}-new`),
      ).planFingerprint,
    ).not.toBe(plan.planFingerprint);
  });

  it('does not extend the frozen 0026 approval to the real configuration-deletion migration', () => {
    expect(currentMigrations.map(({ name }) => name)).toContain(
      '0027_automation_config_deletion.sql',
    );
    expect(() => automationMigrationPlan(pending, currentMigrations, binding)).toThrow(
      'automation-storage-migration-manifest-required',
    );
    expect(() =>
      requireAutomationMigrationScope(
        { pendingMigrations: ['0027_automation_config_deletion.sql'] },
        currentMigrations,
        plan,
        binding,
      ),
    ).toThrow('automation-storage-migration-manifest-required');
  });

  it('emits fingerprints only for the exact read-only preflight with a reviewed backup', async () => {
    const preflightEnv = { ...env, MAINTENANCE_OPERATION: 'preflight', MAINTENANCE_APPROVAL: '' };
    expect(
      await runMaintenance(preflightEnv, undefined, { fetchImpl, now: () => now }),
    ).toMatchObject(plan);
    for (const names of [
      [],
      ['0022_candidate_enrichment_runs.sql', ...pending],
      [...pending, '0027_future.sql'],
    ]) {
      calls.preflight.mockResolvedValueOnce({ ...identity, pendingMigrations: names });
      expect(
        await runMaintenance(preflightEnv, undefined, { fetchImpl, now: () => now }),
      ).not.toHaveProperty('planFingerprint');
    }
    expect(
      await runMaintenance({ ...preflightEnv, MAINTENANCE_BACKUP_ID: '' }, undefined, {
        fetchImpl,
        now: () => now,
      }),
    ).not.toHaveProperty('targetFingerprint');
    expect(calls.migrate).not.toHaveBeenCalled();
  });

  it('checks the independent target binding before ACL capture', async () => {
    const captureEnv = {
      ...env,
      MAINTENANCE_OPERATION: 'acl-capture',
      MAINTENANCE_APPROVAL: JSON.stringify({
        ...approval,
        operation: 'acl-capture',
        publicArchiveApproved: true,
        archiveRepository: env.GITHUB_REPOSITORY,
      }),
    };
    calls.capture.mockResolvedValue({ fingerprint: 'a'.repeat(64) });
    const result = await runMaintenance(captureEnv, undefined, { fetchImpl, now: () => now });
    expect(result).toMatchObject({
      ...binding,
      recoveryVerified: false,
      recoveryPolicy: approval.recoveryPolicy,
    });
    expect(calls.capture).toHaveBeenCalledOnce();
    calls.policy = { ...policy, host: 'other.invalid' };
    await expect(
      runMaintenance(captureEnv, undefined, { fetchImpl, now: () => now }),
    ).rejects.toThrow('automation-storage-target-mismatch');
    expect(calls.capture).toHaveBeenCalledOnce();
  });

  it('requires the automation-storage risk scope and binds the reviewed target', () => {
    expect(validateMaintenanceRequest(env, now).operation).toBe('migrate');
    for (const change of [
      { sha: 'f'.repeat(40) },
      { runId: '124' },
      { runAttempt: '2' },
      { expiresAt: '2026-09-23T11:00:00Z' },
      { ddlFreezeConfirmed: false },
      { backupExpiresAt: '2026-09-23T12:30:00Z' },
      { backupIdSha256: 'f'.repeat(64) },
      { aclFingerprint: undefined },
      { backupVerified: true },
      { restoreRehearsed: true },
      { restoreEvidenceFingerprint: 'f'.repeat(64) },
      { recoveryPolicy: 'accept-unverified-editorial-publication' },
      { recoveryPolicy: 'accept-unverified-material-review' },
      {
        riskAcceptance: {
          ...approval.riskAcceptance,
          scope: 'candidate-materials-production-launch',
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
    for (const operation of ['search-apply', 'acl-capture']) {
      expect(() =>
        validateMaintenanceRequest(
          {
            ...env,
            MAINTENANCE_OPERATION: operation,
            MAINTENANCE_APPROVAL: JSON.stringify({ ...approval, operation }),
          },
          now,
        ),
      ).toThrow(); // Search is out of scope; ACL capture additionally needs archive approval.
    }
  });

  it('rechecks the locked execution artifact before applying DDL', async () => {
    calls.policy = policy;
    calls.preflight.mockResolvedValue({ ...identity, pendingMigrations: pending });
    calls.inspect.mockResolvedValue({ ...identity, pendingMigrations: pending });
    calls.load.mockResolvedValue(migrations);
    calls.verify.mockResolvedValue({ migrationCount: 27 });
    const ddl = vi.fn();
    let artifact = migrations;
    calls.migrate.mockImplementation(async ({ beforeMigrate, beforeApply }) => {
      await beforeMigrate({});
      await beforeApply(pending, { migrations: artifact });
      ddl();
    });
    const result = await runMaintenance(env, undefined, { fetchImpl, now: () => now });
    expect(result.planFingerprint).toBe(plan.planFingerprint);
    expect(result).toMatchObject({
      recoveryPolicy: 'accept-unverified-automation-storage',
      recoveryVerified: false,
    });
    expect(ddl).toHaveBeenCalledTimes(1);
    artifact = migrations.slice(0, -1);
    await expect(runMaintenance(env, undefined, { fetchImpl, now: () => now })).rejects.toThrow(
      'manifest-required',
    );
    expect(ddl).toHaveBeenCalledTimes(1);
    artifact = migrations;
    calls.inspect
      .mockResolvedValueOnce({ ...identity, pendingMigrations: pending })
      .mockResolvedValueOnce({
        database: 'wrong-target',
        user: identity.user,
        pendingMigrations: pending,
      });
    await expect(runMaintenance(env, undefined, { fetchImpl, now: () => now })).rejects.toThrow(
      'target-required',
    );
    expect(ddl).toHaveBeenCalledTimes(1);
  });

  it('uses the real sequence and checks ACL in a read-only transaction on the locked migration client', async () => {
    const request = sequenceEnvironment();
    const client = { query: vi.fn().mockResolvedValue({}) };
    const ddl = vi.fn();
    calls.capture.mockImplementation(async (captureEnv, { checkApproval }) => {
      expect(captureEnv.MAINTENANCE_APPROVAL).toBe(request.MAINTENANCE_APPROVAL);
      expect(checkApproval().operation).toBe('migrate-and-verify');
      return { fingerprint: 'b'.repeat(64) };
    });
    calls.inspectAcl.mockResolvedValue({ fingerprint: 'b'.repeat(64) });
    calls.evidence.mockResolvedValue({ fingerprint: 'b'.repeat(64) });
    calls.verify.mockResolvedValue({ migrationCount: 27 });
    calls.migrate.mockImplementation(async ({ beforeMigrate, beforeApply }) => {
      await beforeMigrate(client);
      await beforeApply(pending, { migrations });
      ddl();
    });
    const prepared = await runMaintenance(request, undefined, { fetchImpl, now: () => now });
    expect(prepared.status).toBe('prepared');
    expect(ddl).not.toHaveBeenCalled();
    expect(calls.verify).not.toHaveBeenCalled();
    const result = await runMaintenance(sequenceEnvironment('apply'), undefined, {
      fetchImpl,
      now: () => now,
    });
    expect(ddl).toHaveBeenCalledOnce();
    expect(calls.inspectAcl).toHaveBeenCalledWith(
      client,
      expect.objectContaining({
        expectedDatabase: identity.database,
        expectedUser: identity.user,
      }),
    );
    expect(client.query.mock.calls.map(([query]) => query)).toEqual([
      'BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY',
      'SET LOCAL search_path = pg_catalog, pg_temp',
      "SET LOCAL statement_timeout = '30s'",
      "SET LOCAL lock_timeout = '5s'",
      "SET LOCAL idle_in_transaction_session_timeout = '45s'",
      'ROLLBACK',
    ]);
    expect(calls.verify).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({ verificationCompleted: true, pendingMigrationCount: 0 });
    expect([...prepared.stages, ...result.stages].map(({ operation }) => operation)).toEqual([
      'preflight',
      'acl-capture',
      'acl-evidence',
      'migrate',
      'verify',
    ]);
  });

  it.each(['acl-drift', 'acl-read', 'rollback', 'expiry', 'main', 'artifact'])(
    'stops DDL on the locked check failure: %s',
    async (failure) => {
      const client = { query: vi.fn().mockResolvedValue({}) };
      const ddl = vi.fn();
      let locked = false;
      calls.capture.mockResolvedValue({ fingerprint: 'b'.repeat(64) });
      calls.evidence.mockResolvedValue({ fingerprint: 'b'.repeat(64) });
      calls.inspectAcl.mockResolvedValue({
        fingerprint: (failure === 'acl-drift' ? 'c' : 'b').repeat(64),
      });
      if (failure === 'acl-read') calls.inspectAcl.mockRejectedValue(new Error('private-db-host'));
      if (failure === 'rollback')
        client.query.mockImplementation(async (query) => {
          if (query === 'ROLLBACK') throw new Error('private-db-host');
          return {};
        });
      calls.migrate.mockImplementation(async ({ beforeMigrate, beforeApply }) => {
        await beforeMigrate(client);
        locked = true;
        await beforeApply(pending, {
          migrations: failure === 'artifact' ? migrations.slice(0, -1) : migrations,
        });
        ddl();
      });
      const result = await runMaintenance(sequenceEnvironment('apply'), undefined, {
        fetchImpl: async (url) =>
          locked && failure === 'main' ? { status: 200, json: async () => ({}) } : fetchImpl(url),
        now: () => (locked && failure === 'expiry' ? now + 3_600_000 : now),
      }).catch(publicMaintenanceFailure);
      expect(ddl).not.toHaveBeenCalled();
      expect(calls.verify).not.toHaveBeenCalled();
      expect(result).toMatchObject({ phase: 'migrate', verificationCompleted: false });
      expect(JSON.stringify(result)).not.toContain('private-db-host');
      if (['acl-drift', 'acl-read', 'rollback'].includes(failure))
        expect(client.query).toHaveBeenLastCalledWith('ROLLBACK');
      else expect(calls.inspectAcl).not.toHaveBeenCalled();
    },
  );
});
