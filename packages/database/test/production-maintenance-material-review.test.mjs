import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import { beforeEach, describe, it, expect, vi } from 'vitest';
import {
  materialReviewTargetBinding,
  materialReviewMigrationPlan,
  requireMaterialReviewMigrationScope,
  generationProgressMigrationPlan,
  candidateReviewMigrationPlan,
  candidateMaterialsMigrationPlan,
  candidateMaterialsTargetBinding,
  candidateEnrichmentMigrationPlan,
  candidateEnrichmentTargetBinding,
  validateMaintenanceRequest,
  runMaintenance,
} from '../../../.github/scripts/production-maintenance.mjs';

const calls = vi.hoisted(() => ({
  preflight: vi.fn(),
  load: vi.fn(),
  inspect: vi.fn(),
  migrate: vi.fn(),
  verify: vi.fn(),
  capture: vi.fn(),
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
}));

const root = new URL('../../../db/migrations/', import.meta.url);
const migrations = Object.entries(JSON.parse(readFileSync(new URL('checksums.json', root), 'utf8')))
  .filter(([name]) => name < '0025_')
  .map(([name, checksum]) => ({ name, checksum, sql: readFileSync(new URL(name, root), 'utf8') }));
const pending = ['0024_material_review_proposals.sql'];
const identity = { database: 'hzense', user: 'migrator' };
const policy = { host: 'fixture.invalid', port: '5432', ...identity };
const backup = 'synthetic-material-review-backup';
const binding = materialReviewTargetBinding(policy, identity, backup);
const plan = materialReviewMigrationPlan(pending, migrations, binding);
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
  recoveryPolicy: 'accept-unverified-material-review',
  riskAcceptance: {
    scope: 'material-review-production-launch',
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

describe('independent 0023–0024 maintenance authority', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    calls.policy = policy;
    calls.preflight.mockResolvedValue({ ...identity, pendingMigrations: pending });
    calls.inspect.mockResolvedValue({ ...identity, pendingMigrations: pending });
    calls.load.mockResolvedValue(migrations);
  });
  it('pins twenty-five files and accepts only reviewed 0024 or 0023–0024', () => {
    expect(migrations).toHaveLength(25);
    const both = ['0023_candidate_materials.sql', ...pending];
    expect(materialReviewMigrationPlan(both, migrations, binding).planFingerprint).not.toBe(
      plan.planFingerprint,
    );
    expect(() => candidateMaterialsMigrationPlan(both, migrations, binding)).toThrow(
      'manifest-required',
    );
    expect(candidateMaterialsTargetBinding(policy, identity, backup).targetFingerprint).not.toBe(
      binding.targetFingerprint,
    );
    expect(
      requireMaterialReviewMigrationScope(
        { pendingMigrations: pending },
        migrations,
        plan,
        binding,
      ),
    ).toEqual(plan);
    for (const names of [
      [],
      Array(1),
      ['0021_candidate_review_attestations.sql', ...pending],
      ['0020_future.sql'],
      ['0022_candidate_enrichment_runs.sql', ...pending],
      [...pending, '0025_future.sql'],
    ])
      expect(() => materialReviewMigrationPlan(names, migrations, binding)).toThrow(
        'material-review-migration-scope-required',
      );
    expect(binding.targetFingerprint).not.toBe(
      candidateEnrichmentTargetBinding(policy, identity, backup).targetFingerprint,
    );
    expect(() => candidateEnrichmentMigrationPlan(pending, migrations, binding)).toThrow();
    expect(() => generationProgressMigrationPlan(pending, migrations, binding)).toThrow();
    expect(() => candidateReviewMigrationPlan(pending, migrations, binding)).toThrow();
    expect(() =>
      requireMaterialReviewMigrationScope(
        { pendingMigrations: pending },
        migrations,
        { ...plan, targetFingerprint: 'c'.repeat(64) },
        binding,
      ),
    ).toThrow('plan-mismatch');
    expect(() =>
      materialReviewMigrationPlan(
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
        requireMaterialReviewMigrationScope(
          { pendingMigrations: pending },
          migrations,
          { ...plan, [key]: 'c'.repeat(64) },
          binding,
        ),
      ).toThrow('plan-mismatch');
    for (const artifact of [
      migrations.slice(0, -1),
      [...migrations, { name: '0025_future.sql', checksum: 'd'.repeat(64), sql: '' }],
      migrations.toReversed(),
      migrations.map((entry, index) => (index === 0 ? { ...entry, sql: `${entry.sql} ` } : entry)),
      migrations.map((entry, index) =>
        index === 23 ? { ...entry, checksum: 'e'.repeat(64) } : entry,
      ),
    ])
      expect(() => materialReviewMigrationPlan(pending, artifact, binding)).toThrow(
        'manifest-required',
      );
    for (const key of ['host', 'port', 'database', 'user']) {
      expect(
        materialReviewTargetBinding(
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
      materialReviewMigrationPlan(
        pending,
        migrations,
        materialReviewTargetBinding(policy, identity, `${backup}-new`),
      ).planFingerprint,
    ).not.toBe(plan.planFingerprint);
  });

  it('emits fingerprints only for the exact read-only preflight with a reviewed backup', async () => {
    const preflightEnv = { ...env, MAINTENANCE_OPERATION: 'preflight', MAINTENANCE_APPROVAL: '' };
    expect(
      await runMaintenance(preflightEnv, undefined, { fetchImpl, now: () => now }),
    ).toMatchObject(plan);
    for (const names of [
      [],
      ['0022_candidate_enrichment_runs.sql', ...pending],
      [...pending, '0025_future.sql'],
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
    ).rejects.toThrow('material-review-target-mismatch');
    expect(calls.capture).toHaveBeenCalledOnce();
  });

  it('requires the material-review risk scope and binds the reviewed target', () => {
    expect(validateMaintenanceRequest(env, now).operation).toBe('migrate');
    for (const change of [
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
  });

  it('rechecks the locked execution artifact before applying DDL', async () => {
    calls.policy = policy;
    calls.preflight.mockResolvedValue({ ...identity, pendingMigrations: pending });
    calls.inspect.mockResolvedValue({ ...identity, pendingMigrations: pending });
    calls.load.mockResolvedValue(migrations);
    calls.verify.mockResolvedValue({ migrationCount: 25 });
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
      recoveryPolicy: 'accept-unverified-material-review',
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
});
