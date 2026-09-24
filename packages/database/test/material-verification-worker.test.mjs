import { describe, it, expect, vi } from 'vitest';
import { createHash, generateKeyPairSync } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { buildCandidateSourceBundle } from '../../ingestion/src/candidate-source-bundle.mjs';
import {
  materialPlanHash,
  verifyMaterialAttestation,
} from '../src/material-registration-contract.mjs';
import {
  assessMaterialVerification,
  signMaterialVerification,
  materialReviewDossierHash,
} from '../src/material-verification-worker.mjs';

const digest = (value) => createHash('sha256').update(value).digest('hex');
const now = new Date('2026-09-24T10:00:00.000Z');
const excerpt = 'Ada, researcher at Lab, announced X on September 24, 2026.';
const sourceUrl = 'https://example.com/x';
const key = generateKeyPairSync('ed25519');
const privateKey = key.privateKey.export({ type: 'pkcs8', format: 'pem' });
const publicKey = key.publicKey.export({ type: 'spki', format: 'pem' });
const decision = () => ({
  approved: true,
  rationale: 'An independent human checked the exact evidence.',
});
function fixture() {
  const bundle = buildCandidateSourceBundle({
    baseMaterialHash: 'a'.repeat(64),
    source: {
      classification: 'private',
      fragments: [{ id: 'fragment-1', text: excerpt, locator: { paragraph: 1 } }],
    },
    supplements: [],
  });
  const plan = {
    version: 'material-registration-v1',
    owner: 'owner',
    runId: '11111111-1111-4111-8111-111111111111',
    candidateIndex: 0,
    baseMaterialHash: bundle.baseMaterialHash,
    sourceBundleHash: bundle.sourceBundleHash,
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
        sourceUrl,
        locator: 'paragraph 1',
        excerpt,
        contentHash: digest(excerpt),
        capturedAt: now.toISOString(),
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
  };
  const request = {
    requestId: '22222222-2222-4222-8222-222222222222',
    owner: plan.owner,
    runId: plan.runId,
    candidateIndex: 0,
    baseMaterialHash: plan.baseMaterialHash,
    bundle,
    originalSourceUrl: sourceUrl,
    candidate: {
      title: plan.candidate.title,
      summary: plan.candidate.summary,
      event_date: '2026-09-24',
      persons: [{ name: 'Ada', role: 'researcher', organization: 'Lab' }],
      organizations: ['Lab'],
      claims: [{ text: 'Lab announced X.', evidence: [{ quote: excerpt }] }],
    },
    catalog: { topics: [{ id: 'topic-ai', title: 'AI' }], entities: [], sources: [] },
  };
  const dossier = {
    version: 'reviewed-material-dossier-v1',
    requestId: request.requestId,
    planHash: materialPlanHash(plan),
    sourceBundleHash: bundle.sourceBundleHash,
    approvedBy: 'independent-reviewer',
    approvedAt: now.toISOString(),
    expiresAt: '2026-09-24T11:00:00.000Z',
    checks: Object.fromEntries(
      [
        'sourceAuthenticity',
        'usageRights',
        'entityIdentity',
        'eventRelevance',
        'claimSupport',
        'taxonomy',
      ].map((name) => [name, decision()]),
    ),
    sources: [
      {
        sourceUrl,
        excerptHashes: [digest(excerpt)],
        authenticity: decision(),
        usageRights: {
          ...decision(),
          basis: 'Fixture permission expressly covers this exact excerpt.',
        },
      },
    ],
    eventDate: {
      value: '2026-09-24',
      evidenceId: 'evidence-x',
      quote: 'September 24, 2026',
      rationale: 'The statement says this is the announcement date.',
    },
  };
  const fetchSource = vi.fn(async () => ({
    sourceUrl,
    text: excerpt,
    fetchedAt: now.toISOString(),
  }));
  return { request, plan, dossier, fetchSource, clock: () => now };
}
const signing = (assessment, overrides = {}) => ({
  assessment,
  approvedDossierHash: assessment.dossierHash,
  keyId: 'trusted',
  verifierId: 'human-reviewed-runner',
  privateKey,
  now,
  ...overrides,
});

describe('independent zero-AI reviewed material worker', () => {
  it('produces only evidence hashes in summary, then signs an admitted protected approval', async () => {
    const input = fixture();
    const assessment = await assessMaterialVerification(input);
    expect(input.fetchSource).toHaveBeenCalledExactlyOnceWith(sourceUrl);
    expect(JSON.stringify(assessment)).not.toContain(excerpt);
    expect(JSON.stringify(assessment)).not.toContain(sourceUrl);
    expect(Object.isFrozen(assessment)).toBe(true);
    expect(Object.isFrozen(assessment.evidence[0])).toBe(true);
    const envelope = signMaterialVerification(signing(assessment));
    const verified = verifyMaterialAttestation({
      envelope,
      plan: input.plan,
      trustedVerifiers: { trusted: { publicKey, verifierId: 'human-reviewed-runner' } },
      now,
    });
    expect(verified.planHash).toBe(materialPlanHash(input.plan));
    expect(verified.checks.usageRights).toBe(true);
  });
  it('does not call provider/network/signing internally beyond one injected source read', async () => {
    const input = fixture();
    const assessment = await assessMaterialVerification(input);
    expect(assessment).not.toHaveProperty('signature');
    expect(assessment).not.toHaveProperty('plan');
    expect(input.fetchSource).toHaveBeenCalledTimes(1);
  });
  it.each([
    [
      'request identity',
      (i) => {
        i.request.owner = 'attacker';
      },
    ],
    [
      'request number',
      (i) => {
        i.request.requestId = '33333333-3333-4333-8333-333333333333';
      },
    ],
    [
      'base material',
      (i) => {
        i.request.baseMaterialHash = 'b'.repeat(64);
      },
    ],
    [
      'bundle tampering',
      (i) => {
        i.request.bundle.source.fragments[0].text += 'FORGED';
      },
    ],
    [
      'title mutation',
      (i) => {
        i.request.candidate.title = 'Different event';
      },
    ],
    [
      'summary mutation',
      (i) => {
        i.request.candidate.summary = 'Different summary';
      },
    ],
    [
      'claim mutation',
      (i) => {
        i.request.candidate.claims[0].text = 'Different fact';
      },
    ],
    [
      'person mutation',
      (i) => {
        i.request.candidate.persons[0].name = 'Other';
      },
    ],
    [
      'role mutation',
      (i) => {
        i.request.candidate.persons[0].role = 'director';
      },
    ],
    [
      'organization mutation',
      (i) => {
        i.request.candidate.organizations = ['Other'];
      },
    ],
    [
      'private file attribution',
      (i) => {
        i.request.originalSourceUrl = null;
      },
    ],
    [
      'different original URL',
      (i) => {
        i.request.originalSourceUrl = 'https://example.com/other';
      },
    ],
    [
      'unreviewed plan',
      (i) => {
        i.dossier.planHash = 'c'.repeat(64);
      },
    ],
    [
      'unreviewed sources',
      (i) => {
        i.dossier.sourceBundleHash = 'c'.repeat(64);
      },
    ],
    [
      'missing reviewer',
      (i) => {
        i.dossier.approvedBy = '';
      },
    ],
    [
      'future review',
      (i) => {
        i.dossier.approvedAt = '2026-09-24T10:00:01.000Z';
      },
    ],
    [
      'expired review',
      (i) => {
        i.dossier.expiresAt = now.toISOString();
      },
    ],
    [
      'unbounded review expiry',
      (i) => {
        i.dossier.expiresAt = '2026-09-26T10:00:00.000Z';
      },
    ],
    [
      'missing source policy',
      (i) => {
        i.dossier.sources = [];
      },
    ],
    [
      'extra source policy',
      (i) => {
        i.dossier.sources.push(i.dossier.sources[0]);
      },
    ],
    [
      'missing excerpt authorization',
      (i) => {
        i.dossier.sources[0].excerptHashes = [];
      },
    ],
    [
      'unapproved usage rights',
      (i) => {
        i.dossier.sources[0].usageRights.approved = false;
      },
    ],
    [
      'empty rights basis',
      (i) => {
        i.dossier.sources[0].usageRights.basis = '';
      },
    ],
    [
      'false authenticity',
      (i) => {
        i.dossier.sources[0].authenticity.approved = false;
      },
    ],
    [
      'missing date evidence',
      (i) => {
        i.dossier.eventDate.evidenceId = 'absent';
      },
    ],
    [
      'made up date quote',
      (i) => {
        i.dossier.eventDate.quote = 'On October 1';
      },
    ],
    [
      'wrong date',
      (i) => {
        i.dossier.eventDate.value = '2026-10-01';
      },
    ],
    [
      'missing topic',
      (i) => {
        i.request.catalog.topics = [];
      },
    ],
    [
      'disabled topic',
      (i) => {
        i.request.catalog.topics[0].runtime_enabled = false;
      },
    ],
    [
      'archived topic',
      (i) => {
        i.request.catalog.topics[0].status = 'archived';
      },
    ],
    [
      'name conflict',
      (i) => {
        i.request.catalog.entities = [
          { id: 'person-other', type: 'person', name: 'Ada', aliases: [], status: 'active' },
        ];
      },
    ],
    [
      'type conflict',
      (i) => {
        i.request.catalog.entities = [
          { id: 'person-ada', type: 'company', name: 'Ada', aliases: [], status: 'active' },
        ];
      },
    ],
    [
      'archived entity',
      (i) => {
        i.request.catalog.entities = [
          { id: 'person-ada', type: 'person', name: 'Ada', aliases: [], status: 'archived' },
        ];
      },
    ],
    [
      'inactive source',
      (i) => {
        i.request.catalog.sources = [
          { ...i.plan.sources[0], allowed_hosts: ['example.com'], active: false },
        ];
      },
    ],
  ])('rejects %s before fetching or signing', async (_name, change) => {
    const input = fixture();
    change(input);
    await expect(assessMaterialVerification(input)).rejects.toHaveProperty('code');
    expect(input.fetchSource).not.toHaveBeenCalled();
  });
  it.each([
    'sourceAuthenticity',
    'usageRights',
    'entityIdentity',
    'eventRelevance',
    'claimSupport',
    'taxonomy',
  ])('does not manufacture a passing %s decision', async (name) => {
    const input = fixture();
    input.dossier.checks[name].approved = false;
    await expect(assessMaterialVerification(input)).rejects.toHaveProperty(
      'code',
      'material_review_incomplete',
    );
  });
  it.each([
    [
      'redirected URL',
      { sourceUrl: 'https://other.example/x', text: excerpt, fetchedAt: now.toISOString() },
    ],
    [
      'changed live content',
      { sourceUrl, text: 'Nothing supports the event.', fetchedAt: now.toISOString() },
    ],
    ['future receipt', { sourceUrl, text: excerpt, fetchedAt: '2026-09-24T10:00:01.000Z' }],
    ['stale receipt', { sourceUrl, text: excerpt, fetchedAt: '2026-09-24T09:54:59.000Z' }],
  ])('rejects %s', async (_name, snapshot) => {
    const input = fixture();
    input.fetchSource.mockResolvedValue(snapshot);
    await expect(assessMaterialVerification(input)).rejects.toHaveProperty('code');
  });
  it('sanitizes source exceptions and never leaks secrets', async () => {
    const input = fixture();
    input.fetchSource.mockRejectedValue(new Error('bearer-secret'));
    await expect(assessMaterialVerification(input)).rejects.toThrow(
      'material_live_source_unavailable',
    );
  });
  it('accepts a live fetch completing after preparation starts', async () => {
    const input = fixture();
    input.clock = vi
      .fn()
      .mockReturnValueOnce(now)
      .mockReturnValue(new Date('2026-09-24T10:00:05.000Z'));
    input.fetchSource.mockResolvedValue({
      sourceUrl,
      text: excerpt,
      fetchedAt: '2026-09-24T10:00:04.000Z',
    });
    await expect(assessMaterialVerification(input)).resolves.toHaveProperty('requestId');
  });
  it('catalog reuse requires exact active identity', async () => {
    const input = fixture();
    input.request.catalog.entities = input.plan.entities.map((row) => ({
      ...row,
      status: 'active',
    }));
    input.request.catalog.sources = input.plan.sources.map((row) => ({
      ...row,
      allowed_hosts: row.allowedHosts,
      active: true,
    }));
    await expect(assessMaterialVerification(input)).resolves.toHaveProperty('planHash');
  });
  it('rejects forged/copy assessments, wrong approval hash, stale review/source and non-Ed25519 keys', async () => {
    const assessment = await assessMaterialVerification(fixture());
    for (const overrides of [
      { assessment: { ...assessment } },
      { approvedDossierHash: '0'.repeat(64) },
      { now: new Date('2026-09-24T12:00:00.000Z') },
      { now: new Date('2026-09-24T10:05:01.000Z') },
      { ttlMs: 60001 },
      { ttlMs: 0 },
      { privateKey: 'not-a-key' },
      {
        privateKey: generateKeyPairSync('ec', { namedCurve: 'prime256v1' }).privateKey.export({
          type: 'pkcs8',
          format: 'pem',
        }),
      },
    ])
      expect(() => signMaterialVerification(signing(assessment, overrides))).toThrow();
  });
  it('cannot mutate input after assessment to change signed material and replay preserves same plan', async () => {
    const input = fixture();
    const originalPlan = JSON.parse(JSON.stringify(input.plan));
    const assessment = await assessMaterialVerification(input);
    input.plan.candidate.title = 'injected';
    input.dossier.checks.usageRights.approved = false;
    const a = signMaterialVerification(signing(assessment));
    const b = signMaterialVerification(signing(assessment));
    expect(a).toEqual(b);
    expect(JSON.parse(Buffer.from(a.payload, 'base64').toString()).planHash).toBe(
      materialPlanHash(originalPlan),
    );
  });
  it('canonical dossier hash changes with every approval scope and ignores property order', () => {
    const { dossier } = fixture();
    expect(materialReviewDossierHash(dossier)).toBe(
      materialReviewDossierHash(Object.fromEntries(Object.entries(dossier).reverse())),
    );
    const changed = JSON.parse(JSON.stringify(dossier));
    changed.sources[0].usageRights.basis = 'Different authorization';
    expect(materialReviewDossierHash(changed)).not.toBe(materialReviewDossierHash(dossier));
  });
});
