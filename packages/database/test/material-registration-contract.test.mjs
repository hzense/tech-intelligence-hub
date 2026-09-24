import { describe, it, expect } from 'vitest';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { Buffer } from 'node:buffer';
import {
  normalizeMaterialPlan,
  materialPlanHash,
  verifyMaterialAttestation,
} from '../src/material-registration-contract.mjs';

const excerpt = 'Ada, researcher at Lab, announced X on September 24, 2026.';
const digest = (value) => createHash('sha256').update(value, 'utf8').digest('hex');
const fixture = () => ({
  version: 'material-registration-v1',
  owner: 'admin-owner',
  runId: '11111111-1111-4111-8111-111111111111',
  candidateIndex: 0,
  baseMaterialHash: 'a'.repeat(64),
  sourceBundleHash: 'b'.repeat(64),
  entities: [
    { id: 'person-ada', type: 'person', name: 'Ada', aliases: [], evidenceIds: ['evidence-x'] },
    {
      id: 'organization-lab',
      type: 'institution',
      name: 'Lab',
      aliases: [],
      evidenceIds: ['evidence-x'],
    },
  ],
  sources: [
    { id: 'source-lab', name: 'Lab', url: 'https://example.com/', allowedHosts: ['example.com'] },
  ],
  evidence: [
    {
      id: 'evidence-x',
      sourceId: 'source-lab',
      sourceUrl: 'https://example.com/x',
      locator: 'paragraph 1',
      excerpt,
      contentHash: digest(excerpt),
      capturedAt: '2026-09-24T10:00:00.000Z',
      sourcePublishedAt: null,
    },
  ],
  topicIds: ['topic-ai'],
  candidate: {
    title: 'Lab announces X',
    summary: 'Ada announces X at Lab.',
    eventDate: '2026-09-24',
    persons: [
      {
        entityId: 'person-ada',
        role: 'researcher',
        organizationId: 'organization-lab',
        evidenceIds: ['evidence-x'],
      },
    ],
    organizationIds: ['organization-lab'],
    claims: [{ text: 'Lab announced X.', evidenceId: 'evidence-x' }],
  },
});
const { publicKey, privateKey } = generateKeyPairSync('ed25519');
const trustedVerifiers = {
  trusted: {
    publicKey: publicKey.export({ type: 'spki', format: 'pem' }),
    verifierId: 'independent-verifier',
  },
};
const checkNames = [
  'sourceAuthenticity',
  'usageRights',
  'entityIdentity',
  'eventRelevance',
  'claimSupport',
  'taxonomy',
];
const report = (plan = fixture()) => ({
  version: 'signed-material-verification-v1',
  planHash: materialPlanHash(plan),
  owner: plan.owner,
  runId: plan.runId,
  candidateIndex: plan.candidateIndex,
  baseMaterialHash: plan.baseMaterialHash,
  sourceBundleHash: plan.sourceBundleHash,
  verifierId: 'independent-verifier',
  issuedAt: '2026-09-24T10:00:00.000Z',
  ingestBefore: '2026-09-24T10:01:00.000Z',
  checks: Object.fromEntries(checkNames.map((name) => [name, true])),
  rationale: Object.fromEntries(
    checkNames.map((name) => [name, 'Independent review of source and exact material.']),
  ),
});
const envelope = (payload = report(), signingKey = privateKey) => {
  const bytes = Buffer.from(JSON.stringify(payload));
  return {
    keyId: 'trusted',
    payload: bytes.toString('base64'),
    signature: sign(null, bytes, signingKey).toString('base64'),
  };
};
const verify = (value = envelope(), options = {}) =>
  verifyMaterialAttestation({
    envelope: value,
    plan: fixture(),
    trustedVerifiers,
    now: new Date('2026-09-24T10:00:30.000Z'),
    ...options,
  });

describe('material registration proposal contract', () => {
  it('normalizes without mutating and hashes semantic map/set ordering consistently', () => {
    const input = fixture(),
      original = JSON.parse(JSON.stringify(input));
    const normalized = normalizeMaterialPlan(input);
    expect(input).toEqual(original);
    expect(normalized.entities[0].id).toBe('organization-lab');
    const reordered = Object.fromEntries(Object.entries(input).reverse());
    reordered.entities = [...input.entities].reverse();
    expect(materialPlanHash(reordered)).toBe(materialPlanHash(input));
    expect(normalizeMaterialPlan(normalized)).toEqual(normalized);
    expect(normalized).not.toHaveProperty('verified');
  });
  it.each([
    (p) => {
      p.verified = true;
    },
    (p) => {
      p.evidence[0].verificationStatus = 'verified';
    },
    (p) => {
      p.entities[0].type = 'technology';
    },
    (p) => {
      p.evidence[0].contentHash = 'f'.repeat(64);
    },
    (p) => {
      p.evidence[0].sourceId = 'missing';
    },
    (p) => {
      p.entities[0].evidenceIds = ['missing'];
    },
    (p) => {
      p.candidate.claims[0].evidenceId = 'missing';
    },
    (p) => {
      p.candidate.persons[0].entityId = 'organization-lab';
    },
    (p) => {
      p.candidate.persons[0].organizationId = 'person-ada';
    },
    (p) => {
      p.candidate.persons[0].role = 'CEO';
    },
    (p) => {
      p.entities[0].name = 'Grace';
    },
    (p) => {
      p.candidate.organizationIds = [];
    },
    (p) => {
      p.entities.push(p.entities[0]);
    },
    (p) => {
      p.evidence.push(p.evidence[0]);
    },
    (p) => {
      p.topicIds = ['topic-ai', 'topic-ai'];
    },
    (p) => {
      p.candidate.eventDate = '2026-02-30';
    },
    (p) => {
      p.evidence[0].capturedAt = '2026-09-24';
    },
    (p) => {
      p.candidateIndex = 5;
    },
    (p) => {
      p.owner = 'x'.repeat(201);
    },
    (p) => {
      p.owner = 'other\nowner';
    },
    (p) => {
      p.entities = Array.from({ length: 13 }, () => p.entities[0]);
    },
    (p) => {
      p.sources = Array.from({ length: 9 }, () => p.sources[0]);
    },
    (p) => {
      p.evidence = Array.from({ length: 21 }, () => p.evidence[0]);
    },
    (p) => {
      p.topicIds = Array.from({ length: 6 }, (_, i) => `topic-${i}`);
    },
    (p) => {
      p.candidate.persons = Array.from({ length: 13 }, () => p.candidate.persons[0]);
    },
    (p) => {
      p.candidate.claims = Array.from({ length: 13 }, () => p.candidate.claims[0]);
    },
    (p) => {
      p.evidence[0].excerpt = 'x'.repeat(240 * 1024);
    },
  ])('rejects malformed, ungrounded, conflicting, or excessive material %#', (change) => {
    const plan = fixture();
    change(plan);
    expect(() => normalizeMaterialPlan(plan)).toThrow('invalid_material_plan');
  });
  it.each([
    'http://example.com/x',
    'https://localhost/x',
    'https://sub.localhost/x',
    'https://internal/x',
    'https://127.0.0.1/x',
    'https://2130706433/x',
    'https://0x7f000001/x',
    'https://10.0.0.1/x',
    'https://169.254.169.254/x',
    'https://[::1]/x',
    'https://[::ffff:127.0.0.1]/x',
    'https://example.com:8443/x',
    'https://user:password@example.com/x',
    'https://example.com/x#fragment',
    'https://example.com/x#',
    'https://other.example.com/x',
    'https://example.com./x',
    'https://example.com\\@localhost/x',
  ])('rejects unsafe or non-allowlisted evidence URL %s', (url) => {
    const plan = fixture();
    plan.evidence[0].sourceUrl = url;
    expect(() => normalizeMaterialPlan(plan)).toThrow();
  });
  it('preserves exact source excerpt UTF-8 and checks its digest', () => {
    const plan = fixture();
    plan.evidence[0].excerpt += ' 来源核验。';
    plan.evidence[0].contentHash = digest(plan.evidence[0].excerpt);
    expect(normalizeMaterialPlan(plan).evidence[0].excerpt).toBe(plan.evidence[0].excerpt);
  });
  it('fails closed for malformed inputs and sparse arrays', () => {
    for (const input of [null, undefined, [], 1, { owner: 'x' }])
      expect(() => normalizeMaterialPlan(input)).toThrow();
    const plan = fixture();
    plan.topicIds = new Array(1);
    expect(() => normalizeMaterialPlan(plan)).toThrow();
  });
});

describe('independent material verification admission', () => {
  it('admits exact signed material with all six independent explanations', () => {
    expect(verify()).toEqual(report());
  });
  it('rejects unsigned, forged, unknown-key, private-key and non-Ed25519 credentials', () => {
    expect(() => verify({ checks: report().checks })).toThrow();
    expect(() => verify({ ...envelope(), keyId: 'unknown' })).toThrow();
    expect(() =>
      verify({ ...envelope(), signature: Buffer.alloc(64).toString('base64') }),
    ).toThrow();
    const attacker = generateKeyPairSync('ed25519');
    expect(() => verify(envelope(report(), attacker.privateKey))).toThrow();
    expect(() =>
      verify(envelope(), {
        trustedVerifiers: {
          trusted: {
            ...trustedVerifiers.trusted,
            publicKey: privateKey.export({ type: 'pkcs8', format: 'pem' }),
          },
        },
      }),
    ).toThrow();
    const rsa = generateKeyPairSync('rsa', { modulusLength: 2048 });
    expect(() =>
      verify(envelope(), {
        trustedVerifiers: {
          trusted: {
            ...trustedVerifiers.trusted,
            publicKey: rsa.publicKey.export({ type: 'spki', format: 'pem' }),
          },
        },
      }),
    ).toThrow();
  });
  it.each([
    'owner',
    'runId',
    'candidateIndex',
    'baseMaterialHash',
    'sourceBundleHash',
    'planHash',
    'verifierId',
  ])('rejects signed %s binding drift', (field) => {
    const payload = report();
    payload[field] = field === 'candidateIndex' ? 1 : 'different';
    expect(() => verify(envelope(payload))).toThrow('material_verification_invalid');
  });
  it('rejects replay against changed material and failed or unexplained checks', () => {
    const plan = fixture();
    plan.candidate.summary = 'Changed';
    expect(() => verify(envelope(), { plan })).toThrow();
    for (const name of checkNames) {
      const failed = report();
      failed.checks[name] = false;
      expect(() => verify(envelope(failed))).toThrow();
      const missing = report();
      missing.rationale[name] = '';
      expect(() => verify(envelope(missing))).toThrow();
    }
    const extra = report();
    extra.verified = true;
    expect(() => verify(envelope(extra))).toThrow();
  });
  it('rejects future, expired, malformed and overlong admission windows', () => {
    expect(() => verify(envelope(), { now: new Date('2026-09-24T09:59:59.000Z') })).toThrow();
    expect(() => verify(envelope(), { now: new Date('2026-09-24T10:01:00.000Z') })).toThrow(
      'material_verification_expired',
    );
    const long = report();
    long.ingestBefore = '2026-09-24T10:01:00.001Z';
    expect(() => verify(envelope(long))).toThrow();
    const malformed = report();
    malformed.issuedAt = '2026-09-24';
    expect(() => verify(envelope(malformed))).toThrow();
    expect(() => verify(envelope(), { now: new Date('invalid') })).toThrow();
  });
});
