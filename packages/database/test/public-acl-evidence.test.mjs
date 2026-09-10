import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { validateMaintenanceRequest } from '../../../.github/scripts/production-maintenance.mjs';
import {
  assertPublicAclEvidenceSafe,
  capturePublicAclEvidence,
  reviewedBaseline,
} from '../../../.github/scripts/public-acl-evidence.mjs';
import {
  buildRuntimeAclBaseline,
  runtimeAclBaselineCategoryNames,
  runtimeAclBackupReference,
} from '../src/runtime-acl-baseline.mjs';

const backupId = 'reviewed-backup-20260908';
const now = Date.parse('2026-09-08T12:00:00Z');
const env = {
  GITHUB_ACTIONS: 'true',
  GITHUB_REPOSITORY: 'hzense/tech-intelligence-hub',
  GITHUB_EVENT_NAME: 'workflow_dispatch',
  GITHUB_REF: 'refs/heads/main',
  MAINTENANCE_OPERATION: 'acl-capture',
  MAINTENANCE_APPROVAL: JSON.stringify({
    operation: 'acl-capture',
    sha: 'a'.repeat(40),
    runId: '123',
    runAttempt: '1',
    expiresAt: '2026-09-08T13:00:00Z',
    backupNeverExpires: true,
    backupIdSha256: createHash('sha256').update(backupId).digest('hex'),
    backupVerified: true,
    ddlFreezeConfirmed: true,
    publicArchiveApproved: true,
    archiveRepository: 'hzense/tech-intelligence-hub',
  }),
  DATABASE_DIRECT_URL:
    'postgresql://hzense_migrator:testing%40password@ep-fixture.us-east-1.neon.tech:5432/hzense?sslmode=verify-full',
  HZENSE_DATABASE_EXPECTED_HOST: 'ep-fixture.us-east-1.neon.tech',
  HZENSE_DATABASE_EXPECTED_PORT: '5432',
  HZENSE_DATABASE_EXPECTED_NAME: 'hzense',
  HZENSE_DATABASE_EXPECTED_USER: 'hzense_migrator',
  HZENSE_DATABASE_EXPECTED_PGVECTOR_VERSION: '0.8.6',
  MAINTENANCE_BACKUP_ID: backupId,
  GITHUB_SHA: 'a'.repeat(40),
  GITHUB_RUN_ID: '123',
  GITHUB_RUN_ATTEMPT: '1',
  RUNNER_TEMP: '/tmp/test-acl-evidence',
};

function checkApproval() {
  return validateMaintenanceRequest(env, now);
}

function riskEnvironment(changes = {}) {
  return {
    ...env,
    MAINTENANCE_APPROVAL: JSON.stringify({
      ...JSON.parse(env.MAINTENANCE_APPROVAL),
      recoveryPolicy: 'accept-unverified-fts1',
      backupVerified: false,
      backupPresenceReviewed: true,
      restoreRehearsed: false,
      aclRecoveryReviewed: false,
      riskAcceptance: {
        scope: 'fts1-production-launch',
        accepted: true,
        historicalAclGapAccepted: true,
        acknowledgement: 'recovery-unverified-data-loss-or-prolonged-outage-accepted',
      },
      ...changes,
    }),
  };
}

function baseline(changes = {}) {
  return buildRuntimeAclBaseline({
    identity: { database: 'hzense', currentUser: 'hzense_migrator' },
    categories: Object.fromEntries(runtimeAclBaselineCategoryNames.map((name) => [name, []])),
    capturedAt: '2026-09-08T12:00:00.000Z',
    backupReference: runtimeAclBackupReference(backupId),
    ...changes,
  });
}

describe('approved public ACL evidence', () => {
  it('captures independently twice, strips unrelated properties, and writes only the exact file', async () => {
    const first = { ...baseline(), transport: { password: 'never serialize' }, arbitrary: 'drop' };
    const second = baseline({ capturedAt: '2026-09-08T12:01:00.000Z' });
    const capture = vi.fn().mockResolvedValueOnce(first).mockResolvedValueOnce(second);
    const save = vi.fn();
    const check = vi.fn(checkApproval);
    const result = await capturePublicAclEvidence(env, { capture, save, checkApproval: check });
    expect(capture).toHaveBeenCalledTimes(2);
    expect(capture.mock.calls[0][0].backupId).toBe(backupId);
    expect(check).toHaveBeenCalledTimes(3);
    expect(result).toEqual({ fingerprint: first.fingerprint });
    expect(save).toHaveBeenCalledTimes(1);
    const [path, json, options] = save.mock.calls[0];
    expect(path).toBe('/tmp/test-acl-evidence/hzense-acl-evidence.json');
    expect(options).toEqual({ encoding: 'utf8', flag: 'wx', mode: 0o600 });
    const evidence = JSON.parse(json);
    expect(evidence.restoration).toBe('manual-review-and-isolated-rehearsal-required');
    expect(evidence).not.toHaveProperty('recoveryPolicy');
    expect(evidence).not.toHaveProperty('recoveryVerified');
    expect(evidence).not.toHaveProperty('riskAcceptanceSha256');
    expect(evidence.captures).toHaveLength(2);
    expect(evidence.captures[0].capturedAt).not.toBe(evidence.captures[1].capturedAt);
    expect(evidence.captures[0].backup.providerApiVerified).toBe(false);
    expect(json).not.toContain('transport');
    expect(json).not.toContain('arbitrary');
    expect(json).not.toContain(backupId);
    expect(json).not.toContain('testing');
  });
  it('does not write if independent states differ', async () => {
    const capture = vi
      .fn()
      .mockResolvedValueOnce(baseline())
      .mockResolvedValueOnce(baseline({ identity: { database: 'other' } }));
    const save = vi.fn();
    await expect(capturePublicAclEvidence(env, { capture, save, checkApproval })).rejects.toThrow(
      'captures differ',
    );
    expect(save).not.toHaveBeenCalled();
  });
  it.each([1, 2, 3])('does not write if approval fails at check %i', async (failure) => {
    let count = 0;
    const checkApproval = () => {
      if (++count === failure) throw new Error('expired');
      return validateMaintenanceRequest(env, now);
    };
    const save = vi.fn();
    const capture = vi.fn().mockResolvedValue(baseline());
    await expect(capturePublicAclEvidence(env, { capture, save, checkApproval })).rejects.toThrow(
      'expired',
    );
    expect(save).not.toHaveBeenCalled();
    expect(capture).toHaveBeenCalledTimes(Math.min(failure - 1, 2));
  });
  it('does not publish a partial capture when the second connection fails', async () => {
    const save = vi.fn();
    const capture = vi
      .fn()
      .mockResolvedValueOnce(baseline())
      .mockRejectedValueOnce(new Error('connection failed'));
    await expect(capturePublicAclEvidence(env, { capture, save, checkApproval })).rejects.toThrow();
    expect(save).not.toHaveBeenCalled();
  });
  it('rejects missing hosted output context or approval callback before capturing', async () => {
    const capture = vi.fn();
    await expect(capturePublicAclEvidence(env, { capture })).rejects.toThrow();
    await expect(
      capturePublicAclEvidence({ ...env, RUNNER_TEMP: 'relative' }, { capture, checkApproval }),
    ).rejects.toThrow();
    expect(capture).not.toHaveBeenCalled();
  });
  it('rejects invalid fingerprints and backup bindings', () => {
    expect(() =>
      reviewedBaseline({ ...baseline(), fingerprint: 'f'.repeat(64) }, backupId),
    ).toThrow();
    expect(() => reviewedBaseline(baseline(), 'different-backup-20260908')).toThrow();
  });
  it.each([
    'postgres://other-credential',
    'testing%40password',
    'testing@password',
    'ep-fixture.us-east-1.neon.tech',
    backupId,
    env.MAINTENANCE_APPROVAL,
    '-----BEGIN PRIVATE KEY-----',
  ])('rejects excluded content %s', (value) => {
    expect(() => assertPublicAclEvidenceSafe(JSON.stringify({ record: value }), env)).toThrow();
  });
  it('detects a credential hidden inside a catalog name before saving', async () => {
    const capture = vi
      .fn()
      .mockResolvedValue(baseline({ identity: { database: 'testing@password' } }));
    const save = vi.fn();
    await expect(capturePublicAclEvidence(env, { capture, save, checkApproval })).rejects.toThrow(
      'excluded material',
    );
    expect(save).not.toHaveBeenCalled();
  });
});

describe('public ACL capture with real risk approval validation', () => {
  it('records unverified acceptance without changing either full baseline or its fingerprint', async () => {
    const request = riskEnvironment({ privateComment: 'never publish approval' });
    const first = baseline();
    const second = baseline({ capturedAt: '2026-09-08T12:01:00.000Z' });
    const capture = vi.fn().mockResolvedValueOnce(first).mockResolvedValueOnce(second);
    const save = vi.fn();
    const check = vi.fn(() => validateMaintenanceRequest(request, now));
    await capturePublicAclEvidence(request, { capture, save, checkApproval: check });
    const evidence = JSON.parse(save.mock.calls[0][1]);
    expect(evidence).toMatchObject({
      format: 'hzense-public-acl-evidence/v1',
      restoration: 'unverified-risk-accepted',
      recoveryPolicy: 'accept-unverified-fts1',
      recoveryVerified: false,
      riskAcceptanceSha256: createHash('sha256').update(request.MAINTENANCE_APPROVAL).digest('hex'),
      independentCapturesMatch: true,
    });
    expect(evidence.captures).toEqual([first, second]);
    expect(evidence.captures[0].backup.providerApiVerified).toBe(false);
    expect(capture).toHaveBeenCalledTimes(2);
    expect(check).toHaveBeenCalledTimes(3);
    expect(save).toHaveBeenCalledOnce();
    expect(save.mock.calls[0][1]).not.toContain('never publish approval');
    expect(save.mock.calls[0][1]).not.toContain(backupId);
  });
  it.each([1, 2, 3])(
    'rejects real expired risk approval at check %i without publishing',
    async (failure) => {
      const request = riskEnvironment();
      let checks = 0;
      const check = () =>
        validateMaintenanceRequest(request, ++checks === failure ? now + 3600000 : now);
      const capture = vi.fn().mockResolvedValue(baseline());
      const save = vi.fn();
      await expect(
        capturePublicAclEvidence(request, { capture, save, checkApproval: check }),
      ).rejects.toThrow('approval-expired-or-too-long');
      expect(save).not.toHaveBeenCalled();
      expect(capture).toHaveBeenCalledTimes(failure - 1);
    },
  );
  it.each(['divergence', 'connection', 'secret'])(
    'does not publish a failed risk capture: %s',
    async (failure) => {
      const request = riskEnvironment();
      const capture = vi.fn().mockResolvedValueOnce(baseline());
      if (failure === 'connection') capture.mockRejectedValueOnce(new Error('connection failed'));
      else if (failure === 'secret') {
        const unsafe = baseline({ identity: { database: 'testing@password' } });
        capture.mockReset().mockResolvedValue(unsafe);
      } else capture.mockResolvedValueOnce(baseline({ identity: { database: 'other' } }));
      const save = vi.fn();
      await expect(
        capturePublicAclEvidence(request, {
          capture,
          save,
          checkApproval: () => validateMaintenanceRequest(request, now),
        }),
      ).rejects.toThrow();
      expect(save).not.toHaveBeenCalled();
    },
  );
  it.each([
    { publicArchiveApproved: false },
    { archiveRepository: 'other/repo' },
    { backupVerified: true },
    { backupPresenceReviewed: false },
    { restoreRehearsed: true },
    { restoreEvidenceFingerprint: 'f'.repeat(64) },
    { riskAcceptance: undefined },
    { runId: '124' },
  ])('rejects invalid risk approval before connecting: %j', async (changes) => {
    const request = riskEnvironment(changes);
    const capture = vi.fn();
    const save = vi.fn();
    await expect(
      capturePublicAclEvidence(request, {
        capture,
        save,
        checkApproval: () => validateMaintenanceRequest(request, now),
      }),
    ).rejects.toThrow();
    expect(capture).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
  });
  it.each([
    undefined,
    { operation: 'preflight' },
    { operation: 'migrate', approval: {} },
    { operation: 'acl-capture', approval: { operation: 'migrate' } },
  ])('requires the callback to return a validated capture request: %j', async (result) => {
    const capture = vi.fn();
    const save = vi.fn();
    await expect(
      capturePublicAclEvidence(env, { capture, save, checkApproval: () => result }),
    ).rejects.toThrow('Validated ACL capture approval required');
    expect(capture).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
  });
});
