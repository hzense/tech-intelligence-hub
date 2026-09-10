import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import { describe, it, expect, vi } from 'vitest';
import { parse } from 'yaml';
import {
  validateRecoveryRequest,
  runRecoveryVerification,
  assertRecoveryEvidenceSafe,
} from '../../../.github/scripts/recovery-verification.mjs';
import { recoveryWorkflowProblems } from '../../../.github/scripts/recovery-workflow-contract.mjs';
import { beginRecoveryRead, inspectRecoveryIdentity } from '../src/recovery-verification.mjs';

const now = Date.parse('2026-09-10T10:00:00Z');
const approval = {
  operation: 'capture-r0',
  sha: 'a'.repeat(40),
  runId: '123',
  runAttempt: '1',
  expiresAt: '2026-09-10T10:30:00Z',
  targetExpiresAt: '2026-09-11T10:00:00Z',
  sourceNeverExpires: true,
  topologyReviewed: true,
  ddlFreezeConfirmed: true,
  publicArchiveApproved: true,
  archiveRepository: 'hzense/tech-intelligence-hub',
  projectId: 'unit-test-project',
  targetBranchId: 'br-unit-target',
  sourceBranchId: 'br-unit-source',
  productionBranchId: 'br-unit-main',
  targetFingerprint: '12'.repeat(32),
  sourceFingerprint: '34'.repeat(32),
  productionFingerprint: '56'.repeat(32),
  directHost: 'ep-unit.eu-central-1.aws.neon.tech',
  runtimeHost: 'ep-unit-pooler.eu-central-1.aws.neon.tech',
};
const env = {
  GITHUB_ACTIONS: 'true',
  GITHUB_REPOSITORY: 'hzense/tech-intelligence-hub',
  GITHUB_REF: 'refs/heads/main',
  GITHUB_EVENT_NAME: 'workflow_dispatch',
  GITHUB_SHA: approval.sha,
  GITHUB_RUN_ID: '123',
  GITHUB_RUN_ATTEMPT: '1',
  GITHUB_WORKFLOW_REF:
    'hzense/tech-intelligence-hub/.github/workflows/recovery-verification.yml@refs/heads/main',
  GH_TOKEN: 'test-only-github-token',
  RUNNER_TEMP: '/tmp',
  RECOVERY_OPERATION: 'capture-r0',
  RECOVERY_APPROVAL: JSON.stringify(approval),
  RECOVERY_OWNER_URL: `postgresql://hzense_migrator:test-only-secret@${approval.directHost}:5432/hzense?sslmode=verify-full`,
};
function request(changes = {}, envChanges = {}) {
  return { ...env, RECOVERY_APPROVAL: JSON.stringify({ ...approval, ...changes }), ...envChanges };
}
function githubFetch() {
  return vi.fn(async (url) => ({
    status: 200,
    json: async () =>
      url.includes('/git/ref/')
        ? {
            ref: 'refs/heads/main',
            object: { type: 'commit', sha: env.GITHUB_SHA },
          }
        : {
            workflow_runs: [
              {
                id: 77,
                path: '.github/workflows/ci.yml',
                repository: { full_name: env.GITHUB_REPOSITORY },
                head_sha: env.GITHUB_SHA,
                head_branch: 'main',
                event: 'push',
                status: 'completed',
                conclusion: 'success',
              },
            ],
          },
  }));
}

describe('protected hosted read-only recovery request', () => {
  it('accepts a fresh bound capture without claiming completed recovery', () => {
    expect(validateRecoveryRequest(env, now)).toEqual(approval);
  });
  it.each([
    { operation: 'restore' },
    { sha: 'b'.repeat(40) },
    { runId: '124' },
    { runAttempt: '2' },
    { expiresAt: '2026-09-10T09:59:00Z' },
    { expiresAt: '2026-09-10T11:01:00Z' },
    { expiresAt: null },
    { topologyReviewed: false },
    { ddlFreezeConfirmed: false },
    { publicArchiveApproved: false },
    { archiveRepository: 'wrong/repo' },
    { targetBranchId: approval.sourceBranchId },
    { targetBranchId: approval.productionBranchId },
    { sourceBranchId: approval.productionBranchId },
    { targetBranchId: '../main' },
    { projectId: '../project' },
    { targetFingerprint: 'a'.repeat(64) },
    { targetFingerprint: approval.sourceFingerprint },
    { sourceFingerprint: approval.productionFingerprint },
    { targetFingerprint: '' },
    { targetExpiresAt: approval.expiresAt },
    { sourceNeverExpires: undefined },
    { sourceNeverExpires: true, sourceExpiresAt: '2026-09-12T00:00:00Z' },
    { sourceNeverExpires: false, sourceExpiresAt: '2026-09-10T10:20:00Z' },
    { directHost: 'localhost' },
    { runtimeHost: 'other.neon.tech' },
    { directHost: approval.runtimeHost },
  ])('rejects invalid approval %j', (changes) => {
    expect(() => validateRecoveryRequest(request(changes), now)).toThrow();
  });
  it.each([
    { GITHUB_ACTIONS: 'false' },
    { GITHUB_REF: 'refs/heads/feature' },
    { GITHUB_EVENT_NAME: 'pull_request' },
    { GITHUB_WORKFLOW_REF: 'wrong-workflow' },
    { RECOVERY_APPROVAL: 'null' },
    { RECOVERY_APPROVAL: 'invalid' },
    { DATABASE_DIRECT_URL: 'production' },
    { HZENSE_RUNTIME_DATABASE_URL: 'production' },
    { MAINTENANCE_APPROVAL: '{}' },
    { RECOVERY_OWNER_URL: '' },
    { RECOVERY_RUNTIME_URL: 'wrong-scope' },
    { RUNNER_TEMP: 'relative' },
  ])('rejects invalid execution context %j', (changes) => {
    expect(() => validateRecoveryRequest(request({}, changes), now)).toThrow();
  });
  it('requires an R1 fingerprint and only Runtime credential for restored verification', () => {
    const changes = { operation: 'verify-restored', r1Fingerprint: '78'.repeat(32) };
    const context = {
      RECOVERY_OPERATION: 'verify-restored',
      RECOVERY_OWNER_URL: '',
      RECOVERY_RUNTIME_URL: 'test-runtime-url',
    };
    expect(validateRecoveryRequest(request(changes, context), now).operation).toBe(
      'verify-restored',
    );
    expect(() =>
      validateRecoveryRequest(request({ ...changes, r1Fingerprint: '' }, context), now),
    ).toThrow();
    expect(() =>
      validateRecoveryRequest(
        request({ operation: 'capture-r3' }, { RECOVERY_OPERATION: 'capture-r3' }),
        now,
      ),
    ).toThrow();
  });
  it('checks fresh main before collection and again before exclusive artifact creation', async () => {
    const fetchImpl = githubFetch();
    const collect = vi.fn(async (executionEnv, _approval, guard) => {
      expect(executionEnv.GH_TOKEN).toBeUndefined();
      await guard();
      return { targetFingerprint: approval.targetFingerprint };
    });
    const save = vi.fn();
    await expect(
      runRecoveryVerification(env, { now: () => now, fetchImpl, collect, save }),
    ).resolves.toEqual({ operation: 'capture-r0', status: 'succeeded' });
    expect(fetchImpl).toHaveBeenCalledTimes(9);
    expect(save).toHaveBeenCalledWith(
      '/tmp/hzense-recovery-verification.json',
      expect.any(String),
      { encoding: 'utf8', flag: 'wx', mode: 0o600 },
    );
  });
  it('fails closed on GitHub API failure before connecting', async () => {
    const collect = vi.fn();
    await expect(
      runRecoveryVerification(env, {
        now: () => now,
        fetchImpl: vi.fn().mockResolvedValue({ status: 503 }),
        collect,
      }),
    ).rejects.toThrow();
    expect(collect).not.toHaveBeenCalled();
  });
  it('does not archive if approval expires during collection', async () => {
    let time = now;
    const save = vi.fn();
    await expect(
      runRecoveryVerification(env, {
        now: () => time,
        fetchImpl: githubFetch(),
        save,
        collect: async () => {
          time += 3_600_000;
          return {};
        },
      }),
    ).rejects.toThrow('recovery-approval-expired');
    expect(save).not.toHaveBeenCalled();
  });
  it.each([
    'test-only-secret',
    'test-only-github-token',
    approval.directHost,
    approval.targetBranchId,
    'postgresql://bad',
  ])('blocks excluded artifact material', (secret) => {
    expect(() => assertRecoveryEvidenceSafe(JSON.stringify({ secret }), env, approval)).toThrow(
      'recovery-evidence-unsafe',
    );
  });
});

describe('live recovery identity and transaction', () => {
  const row = {
    database_name: 'hzense',
    authenticated_role: 'hzense_migrator',
    effective_role: 'hzense_migrator',
    read_only: 'on',
    version: 180006,
    event_triggers: 0,
    search_columns: 10,
    identity: { 'neon.project_id': approval.projectId, 'neon.branch_id': approval.targetBranchId },
    fingerprint: approval.targetFingerprint,
  };
  it('sets read-only, bounded catalog-first transaction', async () => {
    const query = vi.fn();
    await beginRecoveryRead({ query });
    expect(query.mock.calls[0][0]).toBe(
      'BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY',
    );
    expect(query.mock.calls[1][0]).toBe('SET LOCAL search_path = pg_catalog, pg_temp');
  });
  it.each([
    { fingerprint: approval.sourceFingerprint },
    { fingerprint: approval.productionFingerprint },
    { fingerprint: null },
    { identity: null },
    { read_only: 'off' },
    { effective_role: 'other' },
    { authenticated_role: 'other' },
    { database_name: 'other' },
    { version: 170000 },
    { event_triggers: 1 },
    { search_columns: 18 },
  ])('rejects mismatching live identity %j', async (changes) => {
    const query = vi.fn().mockResolvedValue({ rowCount: 1, rows: [{ ...row, ...changes }] });
    await expect(inspectRecoveryIdentity({ query }, approval, 'hzense_migrator')).rejects.toThrow();
  });
  it('accepts the exact reviewed identity', async () => {
    const query = vi.fn().mockResolvedValue({ rowCount: 1, rows: [row] });
    await expect(
      inspectRecoveryIdentity({ query }, approval, 'hzense_migrator'),
    ).resolves.toBeUndefined();
  });
});

describe('recovery workflow contract', () => {
  const load = () =>
    parse(
      readFileSync(
        new URL('../../../.github/workflows/recovery-verification.yml', import.meta.url),
        'utf8',
      ),
    );
  it('accepts the checked-in read-only workflow', () =>
    expect(recoveryWorkflowProblems(load())).toEqual([]));
  it.each([
    (w) => {
      w.on.push = {};
    },
    (w) => {
      w.jobs.verification.environment = 'unprotected';
    },
    (w) => {
      w.jobs.verification.steps[3].env.RECOVERY_OWNER_URL = '${{ secrets.DATABASE_DIRECT_URL }}';
    },
    (w) => {
      w.jobs.verification.steps[3].run = 'psql';
    },
    (w) => {
      w.jobs.verification.steps[3]['continue-on-error'] = true;
    },
    (w) => {
      w.jobs.verification.steps[4].with.path = '${{ runner.temp }}/*';
    },
    (w) => {
      w.jobs.verification.steps[4].if = 'always()';
    },
    (w) => {
      w.jobs.verification.steps[2].env = { KEY: '${{ secrets.KEY }}' };
    },
  ])('rejects bypasses', (mutate) => {
    const workflow = load();
    mutate(workflow);
    expect(recoveryWorkflowProblems(workflow).length).toBeGreaterThan(0);
  });
});
