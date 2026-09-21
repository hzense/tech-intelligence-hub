import { describe, it, expect } from 'vitest';
import { generateKeyPairSync, sign } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { verifySignedCandidateReport } from '../src/signed-candidate-verification.mjs';
const { publicKey, privateKey } = generateKeyPairSync('ed25519');
const id = '11111111-1111-4111-8111-111111111111';
const checks = Object.fromEntries(
  [
    'claims_supported',
    'people_disambiguated',
    'people_are_participants',
    'organizations_supported',
    'public_sources_cleared',
    'contradictions_resolved',
  ].map((k) => [k, true]),
);
const identity = {
  runId: id,
  candidateIndex: 0,
  expectedReviewRevision: 2,
  materialHash: 'a'.repeat(64),
};
const keyring = {
  trusted: { publicKey: publicKey.export({ type: 'spki', format: 'pem' }), verifierId: id },
};
const base = () => ({
  version: 'signed-candidate-verification-v1',
  runId: id,
  candidateIndex: 0,
  reviewRevision: 2,
  materialHash: identity.materialHash,
  issuedAt: '2026-09-21T10:00:00.000Z',
  ingestBefore: '2026-09-21T10:01:00.000Z',
  verification: {
    verification_id: id,
    signal_id: 'test-signal',
    source_version: 1,
    source_content_hash: 'b'.repeat(64),
    bundle_fingerprint: 'c'.repeat(64),
    verifier_id: id,
    policy_version: 'candidate-verification-v1',
    decision: 'approved',
    checks,
    valid_for_seconds: 3600,
  },
  rationale: Object.fromEntries(
    Object.keys(checks).map((k) => [k, 'Independent synthetic verification rationale']),
  ),
});
const envelope = (payload = base()) => {
  const bytes = Buffer.from(JSON.stringify(payload));
  return {
    keyId: 'trusted',
    payload: bytes.toString('base64'),
    signature: sign(null, bytes, privateKey).toString('base64'),
  };
};
const run = (value = envelope(), options = {}) =>
  verifySignedCandidateReport({
    envelope: value,
    keyring,
    identity,
    now: new Date('2026-09-21T10:00:30.000Z'),
    ...options,
  });
describe('independent signed verification admission', () => {
  it('accepts signed exact material and retains check rationales', () => {
    expect(run().record.decision).toBe('approved');
    expect(Object.keys(run().rationale)).toHaveLength(6);
  });
  it('rejects unsigned checks, unknown keys, signature tampering and wrong verifier', () => {
    expect(() => run({ checks })).toThrow();
    expect(() => run({ ...envelope(), keyId: 'unknown' })).toThrow();
    expect(() => run({ ...envelope(), signature: Buffer.alloc(64).toString('base64') })).toThrow();
    const payload = base();
    payload.verification.verifier_id = '22222222-2222-4222-8222-222222222222';
    expect(() => run(envelope(payload))).toThrow();
  });
  it('rejects material/revision drift, future issue, expired and long admission windows', () => {
    expect(() =>
      run(envelope(), { identity: { ...identity, expectedReviewRevision: 3 } }),
    ).toThrow();
    expect(() =>
      run(envelope(), { identity: { ...identity, materialHash: 'd'.repeat(64) } }),
    ).toThrow();
    expect(() => run(envelope(), { now: new Date('2026-09-21T09:59:59.000Z') })).toThrow();
    expect(() => run(envelope(), { now: new Date('2026-09-21T10:01:00.000Z') })).toThrow(
      'verification_expired',
    );
    const payload = base();
    payload.ingestBefore = '2026-09-21T11:00:00.000Z';
    expect(() => run(envelope(payload))).toThrow();
  });
  it('rejects missing explanation, extra fields and incomplete approved checks', () => {
    const payload = base();
    payload.rationale.claims_supported = '';
    expect(() => run(envelope(payload))).toThrow();
    expect(() => run(envelope({ ...base(), trusted: true }))).toThrow();
    const bad = base();
    bad.verification = { ...bad.verification, checks: { ...checks, claims_supported: false } };
    expect(() => run(envelope(bad))).toThrow();
  });
});
