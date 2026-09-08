import { describe, expect, it, vi } from 'vitest';
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
const env = {
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
    const checkApproval = vi.fn();
    const result = await capturePublicAclEvidence(env, { capture, save, checkApproval });
    expect(capture).toHaveBeenCalledTimes(2);
    expect(capture.mock.calls[0][0].backupId).toBe(backupId);
    expect(checkApproval).toHaveBeenCalledTimes(3);
    expect(result).toEqual({ fingerprint: first.fingerprint });
    expect(save).toHaveBeenCalledTimes(1);
    const [path, json, options] = save.mock.calls[0];
    expect(path).toBe('/tmp/test-acl-evidence/hzense-acl-evidence.json');
    expect(options).toEqual({ encoding: 'utf8', flag: 'wx', mode: 0o600 });
    const evidence = JSON.parse(json);
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
    await expect(
      capturePublicAclEvidence(env, { capture, save, checkApproval: vi.fn() }),
    ).rejects.toThrow('captures differ');
    expect(save).not.toHaveBeenCalled();
  });
  it.each([1, 2, 3])('does not write if approval fails at check %i', async (failure) => {
    let count = 0;
    const checkApproval = () => {
      if (++count === failure) throw new Error('expired');
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
    await expect(
      capturePublicAclEvidence(env, { capture, save, checkApproval: vi.fn() }),
    ).rejects.toThrow();
    expect(save).not.toHaveBeenCalled();
  });
  it('rejects missing hosted output context or approval callback before capturing', async () => {
    const capture = vi.fn();
    await expect(capturePublicAclEvidence(env, { capture })).rejects.toThrow();
    await expect(
      capturePublicAclEvidence(
        { ...env, RUNNER_TEMP: 'relative' },
        { capture, checkApproval: vi.fn() },
      ),
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
    '-----BEGIN PRIVATE KEY-----',
  ])('rejects excluded content %s', (value) => {
    expect(() => assertPublicAclEvidenceSafe(JSON.stringify({ record: value }), env)).toThrow();
  });
  it('detects a credential hidden inside a catalog name before saving', async () => {
    const capture = vi
      .fn()
      .mockResolvedValue(baseline({ identity: { database: 'testing@password' } }));
    const save = vi.fn();
    await expect(
      capturePublicAclEvidence(env, { capture, save, checkApproval: vi.fn() }),
    ).rejects.toThrow('excluded material');
    expect(save).not.toHaveBeenCalled();
  });
});
