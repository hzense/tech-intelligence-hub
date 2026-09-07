import console from 'node:console';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { parse } from 'yaml';
import {
  maintenanceOperations,
  publicMaintenanceFailure,
  publicMaintenanceResult,
  runMaintenance,
  validateMaintenanceRequest,
} from '../../../.github/scripts/production-maintenance.mjs';
import { maintenanceWorkflowProblems } from '../../../.github/scripts/maintenance-workflow-contract.mjs';

const now = Date.parse('2026-09-07T10:00:00Z');
const backupId = 'protected-backup-20260907';
const env = {
  GITHUB_ACTIONS: 'true',
  GITHUB_REPOSITORY: 'hzense/tech-intelligence-hub',
  GITHUB_EVENT_NAME: 'workflow_dispatch',
  GITHUB_REF: 'refs/heads/main',
  GITHUB_SHA: 'a'.repeat(40),
  GITHUB_RUN_ID: '123',
  GITHUB_RUN_ATTEMPT: '1',
  MAINTENANCE_OPERATION: 'preflight',
};
function writeEnvironment(operation = 'migrate', changes = {}) {
  return {
    ...env,
    MAINTENANCE_OPERATION: operation,
    MAINTENANCE_BACKUP_ID: backupId,
    MAINTENANCE_APPROVAL: JSON.stringify({
      operation,
      sha: env.GITHUB_SHA,
      runId: env.GITHUB_RUN_ID,
      runAttempt: env.GITHUB_RUN_ATTEMPT,
      expiresAt: '2026-09-07T11:00:00Z',
      backupExpiresAt: '2026-09-08T11:00:00Z',
      backupVerified: true,
      restoreRehearsed: true,
      aclRecoveryReviewed: true,
      ddlFreezeConfirmed: true,
      aclFingerprint: 'b'.repeat(64),
      restoreEvidenceFingerprint: 'c'.repeat(64),
      backupIdSha256: createHash('sha256').update(backupId).digest('hex'),
      projectionFingerprint: 'd'.repeat(64),
      planFingerprint: 'e'.repeat(64),
      ...changes,
    }),
  };
}

describe('hosted production maintenance guards', () => {
  it.each(['preflight', 'verify', 'search-dry-run', 'runtime-preflight'])(
    'allows reviewed read operation %s without write approval',
    (operation) => {
      expect(validateMaintenanceRequest({ ...env, MAINTENANCE_OPERATION: operation }, now)).toEqual(
        {
          operation,
        },
      );
    },
  );
  it.each([
    ['GITHUB_ACTIONS', 'false'],
    ['GITHUB_REPOSITORY', 'someone/fork'],
    ['GITHUB_EVENT_NAME', 'pull_request_target'],
    ['GITHUB_REF', 'refs/tags/main'],
    ['GITHUB_REF', 'refs/heads/feature'],
    ['GITHUB_SHA', 'main'],
    ['GITHUB_RUN_ID', ''],
    ['GITHUB_RUN_ATTEMPT', ''],
    ['MAINTENANCE_OPERATION', 'arbitrary-sql'],
    ['HZENSE_DATABASE_BASELINE_CHECKSUM', 'anything'],
  ])('rejects unsafe %s', (key, value) => {
    expect(() => validateMaintenanceRequest({ ...env, [key]: value }, now)).toThrow();
  });
  it.each(['migrate', 'search-apply'])('requires approval for %s', (operation) => {
    expect(() =>
      validateMaintenanceRequest({ ...env, MAINTENANCE_OPERATION: operation }, now),
    ).toThrow('write-approval-required');
    expect(validateMaintenanceRequest(writeEnvironment(operation), now).operation).toBe(operation);
  });
  it.each([
    { sha: 'f'.repeat(40) },
    { operation: 'search-apply' },
    { runId: '124' },
    { runAttempt: '2' },
    { expiresAt: '2026-09-07T10:00:00Z' },
    { expiresAt: '2026-09-09T10:00:00Z' },
    { expiresAt: 'not-a-date' },
    { backupExpiresAt: '2026-09-07T10:30:00Z' },
    { backupVerified: false },
    { restoreRehearsed: false },
    { aclRecoveryReviewed: false },
    { ddlFreezeConfirmed: false },
    { aclFingerprint: 'pending' },
    { restoreEvidenceFingerprint: '' },
    { backupIdSha256: 'f'.repeat(64) },
  ])('rejects unreviewed, stale or incomplete write approval %j', (changes) => {
    expect(() => validateMaintenanceRequest(writeEnvironment('migrate', changes), now)).toThrow();
  });
  it.each(['projectionFingerprint', 'planFingerprint'])(
    'requires the dry-run %s for search apply',
    (key) => {
      expect(() =>
        validateMaintenanceRequest(writeEnvironment('search-apply', { [key]: '' }), now),
      ).toThrow('reviewed-search-plan-required');
    },
  );
  it('rejects placeholder backups even with a matching digest', () => {
    const value = 'placeholder-backup';
    const request = writeEnvironment('migrate', {
      backupIdSha256: createHash('sha256').update(value).digest('hex'),
    });
    request.MAINTENANCE_BACKUP_ID = value;
    expect(() => validateMaintenanceRequest(request, now)).toThrow('reviewed-backup-required');
  });
  it('never calls the database executor for a blocked request', async () => {
    const execute = vi.fn();
    await expect(
      runMaintenance({ ...env, MAINTENANCE_OPERATION: 'migrate' }, execute),
    ).rejects.toThrow();
    expect(execute).not.toHaveBeenCalled();
  });
  it('filters identifiers, credentials, error details and invalid types from public output', () => {
    const result = publicMaintenanceResult('search-dry-run', {
      inserted: 2,
      desiredCount: 'password',
      fingerprint: 'd'.repeat(64),
      planFingerprint: 'secret',
      changedIds: ['private-document'],
      database: 'private-database',
      connectionString: 'postgres://private',
      committed: false,
    });
    expect(result).toEqual({
      operation: 'search-dry-run',
      status: 'succeeded',
      inserted: 2,
      fingerprint: 'd'.repeat(64),
      committed: false,
    });
    expect(publicMaintenanceFailure({ message: 'secret', code: '53300' })).toEqual({
      status: 'failed',
      category: 'database-or-contract-check-failed',
      sqlstate: '53300',
    });
    expect(
      JSON.stringify(publicMaintenanceFailure({ code: 'password', stack: 'secret' })),
    ).not.toMatch(/password|secret/);
  });
  it('suppresses legacy logs and restores logging after success and failure', async () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      await runMaintenance(env, async () => {
        console.log('private details');
        return { pendingMigrations: ['private-name'] };
      });
      expect(spy).not.toHaveBeenCalled();
      await expect(
        runMaintenance(env, async () => {
          console.log('private details');
          throw new Error('private database failure');
        }),
      ).rejects.toThrow();
      expect(console.log).toBe(spy);
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });
});

const workflow = parse(
  readFileSync(
    new URL('../../../.github/workflows/production-maintenance.yml', import.meta.url),
    'utf8',
  ),
);
describe('production maintenance workflow contract', () => {
  it('accepts the checked-in workflow and exact operation choices', () => {
    expect(maintenanceWorkflowProblems(workflow)).toEqual([]);
    expect(workflow.on.workflow_dispatch.inputs.operation.options).toEqual(maintenanceOperations);
  });
  it.each([
    (w) => (w.on.push = {}),
    (w) => (w.env = { DATABASE_DIRECT_URL: '${{ secrets.DATABASE_DIRECT_URL }}' }),
    (w) => (w.concurrency['cancel-in-progress'] = true),
    (w) => (w.jobs.maintenance.environment = 'Production'),
    (w) => (w.jobs.maintenance.if = 'always()'),
    (w) => (w.jobs.maintenance.steps[0].with.ref = 'main'),
    (w) => (w.jobs.maintenance.steps[0].with['persist-credentials'] = true),
    (w) => (w.jobs.maintenance.steps[2].env = { SECRET: '${{ secrets.DATABASE_DIRECT_URL }}' }),
    (w) => (w.jobs.maintenance.steps[3].run = 'true'),
    (w) => (w.jobs.maintenance.steps[3]['continue-on-error'] = true),
    (w) => (w.jobs.maintenance.steps[4].env.MAINTENANCE_APPROVAL = ''),
    (w) => (w.jobs.maintenance.steps[4].run = 'node arbitrary-script.mjs'),
    (w) => w.jobs.maintenance.steps.push({ uses: 'actions/upload-artifact@unreviewed' }),
  ])('rejects weakened workflow boundaries %#', (mutate) => {
    const copy = globalThis.structuredClone(workflow);
    mutate(copy);
    expect(maintenanceWorkflowProblems(copy).length).toBeGreaterThan(0);
  });
});
