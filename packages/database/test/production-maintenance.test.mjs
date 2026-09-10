import console from 'node:console';
import process from 'node:process';
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
  requireFts1MigrationScope,
  validateMaintenanceRequest,
  verifyMaintenanceFreshness,
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
  GH_TOKEN: 'test-only-read-token',
};
const reference = {
  ref: 'refs/heads/main',
  object: { type: 'commit', sha: env.GITHUB_SHA },
};
const ciRun = {
  id: 42,
  path: '.github/workflows/ci.yml',
  repository: { full_name: env.GITHUB_REPOSITORY },
  head_sha: env.GITHUB_SHA,
  head_branch: 'main',
  event: 'push',
  status: 'completed',
  conclusion: 'success',
};
function response(body, status = 200) {
  return { status, json: async () => body };
}
function successfulFetch() {
  return vi
    .fn()
    .mockResolvedValueOnce(response(reference))
    .mockResolvedValueOnce(response({ workflow_runs: [ciRun] }))
    .mockResolvedValueOnce(response(reference));
}
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

function riskEnvironment(operation = 'migrate', changes = {}) {
  return writeEnvironment(operation, {
    recoveryPolicy: 'accept-unverified-fts1',
    backupVerified: false,
    backupPresenceReviewed: true,
    restoreRehearsed: false,
    aclRecoveryReviewed: false,
    restoreEvidenceFingerprint: undefined,
    riskAcceptance: {
      scope: 'fts1-production-launch',
      accepted: true,
      historicalAclGapAccepted: true,
      acknowledgement: 'recovery-unverified-data-loss-or-prolonged-outage-accepted',
    },
    ...changes,
  });
}

describe.each(['migrate', 'search-apply'])(
  '%s explicit unverified recovery acceptance',
  (operation) => {
    it('accepts only a complete run-bound declaration without fabricated restore evidence', () => {
      expect(validateMaintenanceRequest(riskEnvironment(operation), now).operation).toBe(operation);
    });
    it.each([
      { recoveryPolicy: undefined },
      { recoveryPolicy: null },
      { recoveryPolicy: 'typo' },
      { recoveryPolicy: 'verified' },
      { backupVerified: true },
      { backupVerified: undefined },
      { backupPresenceReviewed: false },
      { backupPresenceReviewed: 'true' },
      { restoreRehearsed: true },
      { restoreRehearsed: undefined },
      { aclRecoveryReviewed: true },
      { restoreEvidenceFingerprint: 'c'.repeat(64) },
      { restoreEvidenceFingerprint: null },
      { riskAcceptance: undefined },
      { riskAcceptance: null },
      { riskAcceptance: {} },
      { aclFingerprint: '' },
      { backupExpiresAt: undefined },
      { backupExpiresAt: '2026-09-07T10:30:00Z' },
      { backupNeverExpires: true },
      { backupIdSha256: 'f'.repeat(64) },
      { ddlFreezeConfirmed: false },
      { operation: 'preflight' },
      { sha: 'f'.repeat(40) },
      { runId: '456' },
      { runAttempt: '2' },
      { expiresAt: '2026-09-07T09:00:00Z' },
      { expiresAt: '2026-09-09T11:00:00Z' },
      ...(operation === 'search-apply'
        ? [{ projectionFingerprint: '' }, { planFingerprint: '' }]
        : []),
    ])('rejects incomplete, conflicting or stale acceptance %j', (changes) => {
      expect(() => validateMaintenanceRequest(riskEnvironment(operation, changes), now)).toThrow();
    });
    it.each([
      ['scope', 'all-maintenance'],
      ['accepted', false],
      ['accepted', 'true'],
      ['historicalAclGapAccepted', false],
      ['historicalAclGapAccepted', undefined],
      ['acknowledgement', 'accepted'],
    ])('rejects incorrect risk acknowledgement %s=%s', (key, value) => {
      const request = riskEnvironment(operation);
      const approval = JSON.parse(request.MAINTENANCE_APPROVAL);
      approval.riskAcceptance[key] = value;
      request.MAINTENANCE_APPROVAL = JSON.stringify(approval);
      expect(() => validateMaintenanceRequest(request, now)).toThrow(
        'explicit-recovery-risk-acceptance-required',
      );
    });
    it('preserves explicit non-expiring backup support without claiming restore verification', () => {
      expect(
        validateMaintenanceRequest(
          riskEnvironment(operation, {
            backupNeverExpires: true,
            backupExpiresAt: undefined,
          }),
          now,
        ).operation,
      ).toBe(operation);
    });
    it('emits only fixed risk status and the exact protected approval digest after success', async () => {
      const request = riskEnvironment(operation);
      const execute = vi.fn(async () => ({
        recoveryVerified: true,
        riskAcceptance: 'private',
        inserted: 1,
      }));
      const summary = await runMaintenance(request, execute, {
        fetchImpl: successfulFetch(),
        now: () => now,
      });
      expect(summary).toEqual({
        operation,
        status: 'succeeded',
        inserted: 1,
        recoveryPolicy: 'accept-unverified-fts1',
        recoveryVerified: false,
        riskAcceptanceSha256: createHash('sha256')
          .update(request.MAINTENANCE_APPROVAL)
          .digest('hex'),
      });
      expect(JSON.stringify(summary)).not.toContain('private');
      expect(execute).toHaveBeenCalledOnce();
    });
    it('does not execute if latest main CI failed', async () => {
      const execute = vi.fn();
      const fetchImpl = vi
        .fn()
        .mockResolvedValueOnce(response(reference))
        .mockResolvedValueOnce(response({ workflow_runs: [{ ...ciRun, conclusion: 'failure' }] }));
      await expect(
        runMaintenance(riskEnvironment(operation), execute, { fetchImpl, now: () => now }),
      ).rejects.toThrow('github-main-ci-not-successful');
      expect(execute).not.toHaveBeenCalled();
    });
    it('rechecks expiry after freshness checks and never executes an expired acceptance', async () => {
      const execute = vi.fn();
      const clock = vi
        .fn()
        .mockReturnValueOnce(now)
        .mockReturnValueOnce(now + 60 * 60 * 1000);
      await expect(
        runMaintenance(riskEnvironment(operation), execute, {
          fetchImpl: successfulFetch(),
          now: clock,
        }),
      ).rejects.toThrow('approval-expired-or-too-long');
      expect(execute).not.toHaveBeenCalled();
    });
    it('does not turn an executor failure into a successful risk acceptance result', async () => {
      await expect(
        runMaintenance(
          riskEnvironment(operation),
          async () => {
            throw new Error('failure');
          },
          { fetchImpl: successfulFetch(), now: () => now },
        ),
      ).rejects.toThrow('failure');
    });
  },
);

describe('FTS-1 exception scope', () => {
  it.each([{ pendingMigrations: [] }, { pendingMigrations: ['0003_search_documents_fts.sql'] }])(
    'accepts only FTS-1 or no-op pending migrations %j',
    (preflight) => {
      expect(() => requireFts1MigrationScope(preflight)).not.toThrow();
    },
  );
  it.each([
    undefined,
    null,
    {},
    { pendingMigrations: '0003_search_documents_fts.sql' },
    { pendingMigrations: ['0002_topic_projection.sql'] },
    { pendingMigrations: ['0003_search_documents_fts.sql', '0004_future.sql'] },
  ])('rejects missing or broader migration plans %j', (preflight) => {
    expect(() => requireFts1MigrationScope(preflight)).toThrow('fts1-migration-scope-required');
  });
  it('cannot replace ACL public archive consent or grant an additional operation', () => {
    expect(() =>
      validateMaintenanceRequest(
        riskEnvironment('acl-capture', {
          backupVerified: true,
          publicArchiveApproved: true,
          archiveRepository: env.GITHUB_REPOSITORY,
        }),
        now,
      ),
    ).toThrow('risk-acceptance-write-only');
    expect(() => validateMaintenanceRequest(riskEnvironment('arbitrary-sql'), now)).toThrow(
      'unsupported-operation',
    );
  });
});

describe.each(['migrate', 'search-apply', 'acl-capture'])(
  '%s backup retention declarations',
  (operation) => {
    const request = (changes = {}) =>
      writeEnvironment(operation, {
        publicArchiveApproved: true,
        archiveRepository: 'hzense/tech-intelligence-hub',
        ...changes,
      });
    it.each([
      {},
      { backupNeverExpires: false },
      { backupNeverExpires: true, backupExpiresAt: undefined },
    ])('accepts an explicit valid retention mode %j', (changes) => {
      expect(validateMaintenanceRequest(request(changes), now).operation).toBe(operation);
    });
    it.each([
      { backupExpiresAt: undefined },
      { backupExpiresAt: null },
      { backupExpiresAt: '' },
      { backupExpiresAt: 'never' },
      { backupExpiresAt: 'not-a-date' },
      { backupExpiresAt: ['2026-09-08T11:00:00Z'] },
      { backupExpiresAt: '2026-09-07T11:00:00Z' },
      { backupExpiresAt: '2026-09-07T10:30:00Z' },
      { backupNeverExpires: true },
      { backupNeverExpires: true, backupExpiresAt: null },
      { backupNeverExpires: true, backupExpiresAt: '' },
      { backupNeverExpires: true, backupExpiresAt: 'expired-or-invalid' },
      { backupNeverExpires: false, backupExpiresAt: undefined },
      { backupNeverExpires: 'true', backupExpiresAt: undefined },
      { backupNeverExpires: 'false' },
      { backupNeverExpires: 1 },
      { backupNeverExpires: null },
    ])('fails closed for missing, malformed or conflicting retention %j', (changes) => {
      expect(() => validateMaintenanceRequest(request(changes), now)).toThrow(
        'recovery-evidence-required',
      );
    });
    it.each([
      { backupVerified: false },
      { ddlFreezeConfirmed: false },
      { backupIdSha256: 'f'.repeat(64) },
      { sha: 'f'.repeat(40) },
      { runId: '124' },
      { runAttempt: '2' },
      { operation: 'preflight' },
      { expiresAt: '2026-09-07T10:00:00Z' },
      { expiresAt: '2026-09-09T10:00:00Z' },
      { expiresAt: 'invalid' },
      ...(operation === 'acl-capture'
        ? [{ publicArchiveApproved: false }, { archiveRepository: 'someone/other' }]
        : [
            { restoreRehearsed: false },
            { aclRecoveryReviewed: false },
            { aclFingerprint: '' },
            { restoreEvidenceFingerprint: '' },
          ]),
      ...(operation === 'search-apply'
        ? [{ projectionFingerprint: '' }, { planFingerprint: '' }]
        : []),
    ])('does not bypass other gates with non-expiring backup %j', (changes) => {
      expect(() =>
        validateMaintenanceRequest(
          request({ backupNeverExpires: true, backupExpiresAt: undefined, ...changes }),
          now,
        ),
      ).toThrow();
    });
    it('blocks execution if approval expires during GitHub checks despite non-expiring backup', async () => {
      const execute = vi.fn();
      const clock = vi
        .fn()
        .mockReturnValueOnce(now)
        .mockReturnValueOnce(now + 60 * 60 * 1000);
      await expect(
        runMaintenance(request({ backupNeverExpires: true, backupExpiresAt: undefined }), execute, {
          fetchImpl: successfulFetch(),
          now: clock,
        }),
      ).rejects.toThrow('approval-expired-or-too-long');
      expect(execute).not.toHaveBeenCalled();
    });
    it('still checks main before database execution for a non-expiring backup', async () => {
      const execute = vi.fn();
      await expect(
        runMaintenance(request({ backupNeverExpires: true, backupExpiresAt: undefined }), execute, {
          fetchImpl: vi.fn().mockResolvedValue(response(null)),
          now: () => now,
        }),
      ).rejects.toThrow('github-main-head-changed');
      expect(execute).not.toHaveBeenCalled();
    });
  },
);

describe('hosted production maintenance guards', () => {
  it('requires separate public disclosure consent but not a completed restore for capture', () => {
    const request = writeEnvironment('acl-capture', {
      publicArchiveApproved: true,
      archiveRepository: 'hzense/tech-intelligence-hub',
      restoreRehearsed: false,
      aclRecoveryReviewed: false,
      aclFingerprint: undefined,
      restoreEvidenceFingerprint: undefined,
    });
    expect(validateMaintenanceRequest(request, now).operation).toBe('acl-capture');
    expect(() => validateMaintenanceRequest(writeEnvironment('acl-capture'), now)).toThrow(
      'public-acl-archive-approval-required',
    );
  });
  it.each([
    { publicArchiveApproved: false },
    { archiveRepository: 'someone/other' },
    { backupVerified: false },
    { ddlFreezeConfirmed: false },
    { runId: 'other' },
    { backupIdSha256: 'f'.repeat(64) },
    { expiresAt: '2026-09-07T09:00:00Z' },
    { backupExpiresAt: '2026-09-07T10:30:00Z' },
  ])('blocks unsafe ACL capture approval %j', (changes) => {
    expect(() =>
      validateMaintenanceRequest(
        writeEnvironment('acl-capture', {
          publicArchiveApproved: true,
          archiveRepository: 'hzense/tech-intelligence-hub',
          ...changes,
        }),
        now,
      ),
    ).toThrow();
  });
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
      await runMaintenance(
        env,
        async () => {
          console.log('private details');
          return { pendingMigrations: ['private-name'] };
        },
        { fetchImpl: successfulFetch() },
      );
      expect(spy).not.toHaveBeenCalled();
      await expect(
        runMaintenance(
          env,
          async () => {
            console.log('private details');
            throw new Error('private database failure');
          },
          { fetchImpl: successfulFetch() },
        ),
      ).rejects.toThrow();
      expect(console.log).toBe(spy);
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });
});

describe('execution-time GitHub freshness check', () => {
  it('checks main, the latest push CI, then main again against fixed GitHub endpoints', async () => {
    const fetchImpl = successfulFetch();
    await verifyMaintenanceFreshness(env, { fetchImpl });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    const urls = fetchImpl.mock.calls.map(([url]) => url);
    expect(urls).toEqual([
      'https://api.github.com/repos/hzense/tech-intelligence-hub/git/ref/heads/main',
      `https://api.github.com/repos/hzense/tech-intelligence-hub/actions/workflows/ci.yml/runs?branch=main&event=push&head_sha=${env.GITHUB_SHA}&per_page=1`,
      'https://api.github.com/repos/hzense/tech-intelligence-hub/git/ref/heads/main',
    ]);
    expect(urls[1]).not.toContain('status=success');
    for (const [, options] of fetchImpl.mock.calls) {
      expect(options).toMatchObject({
        method: 'GET',
        redirect: 'error',
        cache: 'no-store',
        headers: {
          Authorization: `Bearer ${env.GH_TOKEN}`,
          'X-GitHub-Api-Version': '2026-03-10',
        },
      });
      expect(options.signal).toBeInstanceOf(globalThis.AbortSignal);
    }
  });
  it.each([
    { GH_TOKEN: '' },
    { GH_TOKEN: '  ' },
    { GITHUB_REPOSITORY: 'someone/fork' },
    { GITHUB_REF: 'refs/tags/main' },
    { GITHUB_SHA: 'bad/sha' },
    { GITHUB_API_URL: 'https://untrusted.invalid' },
  ])('refuses unsafe API configuration without a network call %j', async (changes) => {
    const fetchImpl = vi.fn();
    await expect(
      verifyMaintenanceFreshness({ ...env, ...changes }, { fetchImpl }),
    ).rejects.toThrow();
    expect(fetchImpl).not.toHaveBeenCalled();
  });
  it.each([301, 401, 403, 404, 429, 500, 503])(
    'blocks on HTTP %i without reading or logging the response body',
    async (status) => {
      const json = vi.fn(() => ({ message: 'private-api-error' }));
      const fetchImpl = vi.fn().mockResolvedValue({ status, json });
      await expect(verifyMaintenanceFreshness(env, { fetchImpl })).rejects.toThrow(
        'github-preflight-unavailable',
      );
      expect(json).not.toHaveBeenCalled();
    },
  );
  it.each([
    null,
    {},
    { ...reference, ref: 'refs/tags/main' },
    { ...reference, object: { type: 'tag', sha: env.GITHUB_SHA } },
    { ...reference, object: { type: 'commit', sha: 'f'.repeat(40) } },
  ])('blocks on a missing, malformed or stale main reference %j', async (body) => {
    const fetchImpl = vi.fn().mockResolvedValue(response(body));
    await expect(verifyMaintenanceFreshness(env, { fetchImpl })).rejects.toThrow(
      'github-main-head-changed',
    );
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
  it.each([
    { id: '42' },
    { path: '.github/workflows/other.yml' },
    { repository: { full_name: 'someone/fork' } },
    { head_sha: 'f'.repeat(40) },
    { head_branch: 'feature' },
    { event: 'workflow_dispatch' },
    { status: 'in_progress' },
    { status: 'queued', conclusion: null },
    { conclusion: 'failure' },
    { conclusion: 'cancelled' },
    { conclusion: 'skipped' },
    { conclusion: 'neutral' },
    { conclusion: null },
  ])('rejects CI from the wrong identity or an unsuccessful latest run %j', async (changes) => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(response(reference))
      .mockResolvedValueOnce(response({ workflow_runs: [{ ...ciRun, ...changes }] }));
    await expect(verifyMaintenanceFreshness(env, { fetchImpl })).rejects.toThrow(
      'github-main-ci-not-successful',
    );
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
  it.each([null, {}, { workflow_runs: [] }, { workflow_runs: [ciRun, ciRun] }])(
    'rejects missing or malformed CI results %j',
    async (body) => {
      const fetchImpl = vi
        .fn()
        .mockResolvedValueOnce(response(reference))
        .mockResolvedValueOnce(response(body));
      await expect(verifyMaintenanceFreshness(env, { fetchImpl })).rejects.toThrow(
        'github-main-ci-not-successful',
      );
    },
  );
  it('detects main advancing during the CI lookup', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(response(reference))
      .mockResolvedValueOnce(response({ workflow_runs: [ciRun] }))
      .mockResolvedValueOnce(
        response({
          ...reference,
          object: { type: 'commit', sha: 'f'.repeat(40) },
        }),
      );
    await expect(verifyMaintenanceFreshness(env, { fetchImpl })).rejects.toThrow(
      'github-main-head-changed',
    );
  });
  it.each(['network', 'timeout', 'json'])(
    'sanitizes %s failures and never starts database execution',
    async (failure) => {
      const error = new Error(`private-${failure}-detail ${env.GH_TOKEN}`);
      error.name = failure === 'timeout' ? 'TimeoutError' : 'Error';
      const fetchImpl =
        failure === 'json'
          ? vi.fn().mockResolvedValue({
              status: 200,
              json: async () => {
                throw error;
              },
            })
          : vi.fn().mockRejectedValue(error);
      const execute = vi.fn();
      const result = await runMaintenance(env, execute, { fetchImpl }).catch(
        publicMaintenanceFailure,
      );
      expect(result).toEqual({ status: 'blocked', gate: 'github-preflight-unavailable' });
      expect(execute).not.toHaveBeenCalled();
      expect(JSON.stringify(result)).not.toContain('private-');
      expect(JSON.stringify(result)).not.toContain(env.GH_TOKEN);
    },
  );
  it.each(maintenanceOperations)('gates %s before calling database code', async (operation) => {
    const request = ['migrate', 'search-apply', 'acl-capture'].includes(operation)
      ? writeEnvironment(operation, {
          publicArchiveApproved: true,
          archiveRepository: 'hzense/tech-intelligence-hub',
        })
      : { ...env, MAINTENANCE_OPERATION: operation };
    const execute = vi.fn();
    const fetchImpl = vi.fn().mockResolvedValue(response(null));
    await expect(runMaintenance(request, execute, { fetchImpl, now: () => now })).rejects.toThrow(
      'github-main-head-changed',
    );
    expect(execute).not.toHaveBeenCalled();
  });
  it('revalidates an approval that expires during the API calls', async () => {
    const execute = vi.fn();
    const clock = vi
      .fn()
      .mockReturnValueOnce(now)
      .mockReturnValueOnce(now + 60 * 60 * 1000);
    await expect(
      runMaintenance(writeEnvironment(), execute, {
        fetchImpl: successfulFetch(),
        now: clock,
      }),
    ).rejects.toThrow('approval-expired-or-too-long');
    expect(execute).not.toHaveBeenCalled();
  });
  it('removes the GitHub token from the dependency-facing environment', async () => {
    const execute = vi.fn(async (executionEnv) => {
      expect(executionEnv.GH_TOKEN).toBeUndefined();
      expect(executionEnv.DATABASE_DIRECT_URL).toBe('test-only-database-url');
      return {};
    });
    const fetchImpl = successfulFetch();
    await runMaintenance({ ...env, DATABASE_DIRECT_URL: 'test-only-database-url' }, execute, {
      fetchImpl,
    });
    expect(execute).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(fetchImpl.mock.calls)).not.toContain('test-only-database-url');
  });
  it('also removes the token from process.env before importing database dependencies', async () => {
    try {
      for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
      const execute = vi.fn(async () => {
        expect(process.env.GH_TOKEN).toBeUndefined();
        return {};
      });
      await runMaintenance(process.env, execute, { fetchImpl: successfulFetch() });
      expect(execute).toHaveBeenCalledTimes(1);
    } finally {
      vi.unstubAllEnvs();
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
    (w) => delete w.jobs.maintenance.steps[4].env.GH_TOKEN,
    (w) => (w.jobs.maintenance.steps[4].env.GH_TOKEN = '${{ secrets.PERSONAL_TOKEN }}'),
    (w) => (w.jobs.maintenance.steps[4].run = 'node arbitrary-script.mjs'),
    (w) => w.jobs.maintenance.steps.push({ uses: 'actions/upload-artifact@unreviewed' }),
    (w) => (w.jobs.maintenance.steps[5].if = 'always()'),
    (w) => (w.jobs.maintenance.steps[5].with.path = '${{ runner.temp }}/**'),
    (w) => (w.jobs.maintenance.steps[5].with['if-no-files-found'] = 'warn'),
    (w) =>
      (w.jobs.maintenance.steps[5].env = {
        DATABASE_DIRECT_URL: '${{ secrets.DATABASE_DIRECT_URL }}',
      }),
  ])('rejects weakened workflow boundaries %#', (mutate) => {
    const copy = globalThis.structuredClone(workflow);
    mutate(copy);
    expect(maintenanceWorkflowProblems(copy).length).toBeGreaterThan(0);
  });
});
