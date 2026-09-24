import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { bindMaterialPlan, materialPlanCandidate } from '../lib/material-registration-binding.ts';
import { buildCandidateSourceBundle } from '../../../packages/ingestion/src/candidate-source-bundle.mjs';
import { signalGenerationSourceHash } from '../../../packages/database/src/signal-generation-store.mjs';

const excerpt =
  'Ada, researcher at Lab, announced X on September 24, 2026. Grace, scientist at Other Lab, also attended.';
const source = (text) => ({
  classification: 'private',
  fragments: [{ id: 'fragment-1', text, locator: { paragraph: 1 } }],
});
const digest = (text) => createHash('sha256').update(text).digest('hex');
function fixture() {
  const supplementary = source(excerpt);
  const bundle = buildCandidateSourceBundle({
    baseMaterialHash: 'a'.repeat(64),
    source: source('Original report: Lab announced X. Ada researcher'),
    supplements: [
      {
        batchId: '11111111-1111-4111-8111-111111111111',
        itemId: '22222222-2222-4222-8222-222222222222',
        fence: 1,
        contentHash: signalGenerationSourceHash(supplementary),
        sourceUrl: 'https://example.com/article',
        source: supplementary,
      },
    ],
  });
  const identity = {
    owner: 'owner',
    runId: '33333333-3333-4333-8333-333333333333',
    candidateIndex: 0,
    materialHash: 'a'.repeat(64),
    candidate: {
      title: 'Lab announces X',
      summary: 'Ada announces X at Lab.',
      event_date: '2026-09-24',
      persons: [{ name: 'Ada', role: 'researcher', organization: 'Lab', evidence: [] }],
      organizations: ['Lab'],
      claims: [{ text: 'Lab announced X.', evidence: [] }],
    },
  };
  const plan = {
    version: 'material-registration-v1',
    owner: identity.owner,
    runId: identity.runId,
    candidateIndex: 0,
    baseMaterialHash: identity.materialHash,
    sourceBundleHash: bundle.sourceBundleHash,
    entities: [
      { id: 'ada', type: 'person', name: 'Ada', aliases: [], evidenceIds: ['e'] },
      { id: 'lab', type: 'institution', name: 'Lab', aliases: [], evidenceIds: ['e'] },
    ],
    sources: [
      {
        id: 'source',
        name: 'Lab source',
        url: 'https://example.com/',
        allowedHosts: ['example.com'],
      },
    ],
    evidence: [
      {
        id: 'e',
        sourceId: 'source',
        sourceUrl: 'https://example.com/article',
        locator: 'paragraph 1',
        excerpt,
        contentHash: digest(excerpt),
        capturedAt: '2026-09-24T10:00:00.000Z',
        sourcePublishedAt: null,
      },
    ],
    topicIds: ['ai'],
    candidate: {
      title: identity.candidate.title,
      summary: identity.candidate.summary,
      eventDate: '2026-09-24',
      persons: [{ entityId: 'ada', role: 'researcher', organizationId: 'lab', evidenceIds: ['e'] }],
      organizationIds: ['lab'],
      claims: [{ text: 'Lab announced X.', evidenceId: 'e' }],
    },
  };
  return { plan, bundle, identity };
}
test('binds plan to immutable story and same-source parsed excerpts, then projects formal identities', () => {
  const { plan, bundle, identity } = fixture();
  const bound = bindMaterialPlan(plan, bundle, identity);
  const projected = materialPlanCandidate(bound);
  assert.equal(projected.persons[0].name, 'Ada');
  assert.equal(projected.persons[0].organization, 'Lab');
  assert.equal(projected.claims[0].text, identity.candidate.claims[0].text);
  assert.deepEqual(projected.claims[0].evidence, [{ quote: excerpt }]);
});
test('accepts original URL evidence only with server-provided matching original URL context', () => {
  const { plan, identity } = fixture();
  const bundle = buildCandidateSourceBundle({
    baseMaterialHash: identity.materialHash,
    source: source(excerpt),
    supplements: [],
  });
  plan.sourceBundleHash = bundle.sourceBundleHash;
  const before = JSON.stringify(bundle);
  for (const context of [
    identity,
    { ...identity, originalSourceUrl: null },
    { ...identity, originalSourceUrl: 'https://example.com/another-article' },
  ]) {
    assert.throws(() => bindMaterialPlan(plan, bundle, context), { code: 'material_changed' });
  }
  assert.equal(
    bindMaterialPlan(plan, bundle, {
      ...identity,
      originalSourceUrl: 'https://example.com/article',
    }).evidence[0].sourceUrl,
    'https://example.com/article',
  );
  assert.equal(JSON.stringify(bundle), before);
  assert.equal(bundle.provenance[0].sourceUrl, null);
});
test('original URL context cannot relabel supplementary text or cross-source quotes', () => {
  const { plan, bundle, identity } = fixture();
  plan.evidence[0].sourceUrl = 'https://example.com/original';
  assert.throws(
    () =>
      bindMaterialPlan(plan, bundle, {
        ...identity,
        originalSourceUrl: 'https://example.com/original',
      }),
    { code: 'material_changed' },
  );
  plan.evidence[0].sourceUrl = 'https://example.com/article';
  // The legacy omitted context still accepts correctly pinned supplement evidence.
  assert.equal(
    bindMaterialPlan(plan, bundle, identity).evidence[0].sourceUrl,
    'https://example.com/article',
  );
});
test('rejects signed proposals replacing known identities, roles, affiliations, story or event date', () => {
  for (const mutate of [
    (p) => {
      p.entities[0].name = 'Grace';
    },
    (p) => {
      p.candidate.persons[0].role = 'scientist';
    },
    (p) => {
      p.entities[1].name = 'Other Lab';
    },
    (p) => {
      p.candidate.persons[0].organizationId = null;
    },
    (p) => {
      p.candidate.organizationIds = [];
      p.candidate.persons[0].organizationId = null;
    },
    (p) => {
      p.candidate.eventDate = '2026-09-25';
    },
    (p) => {
      p.candidate.title = 'New title';
    },
    (p) => {
      p.candidate.summary = 'New summary';
    },
    (p) => {
      p.candidate.claims[0].text = 'New claim';
    },
    (p) => {
      p.owner = 'other';
    },
    (p) => {
      p.sourceBundleHash = 'b'.repeat(64);
    },
  ]) {
    const { plan, bundle, identity } = fixture();
    mutate(plan);
    assert.throws(() => bindMaterialPlan(plan, bundle, identity), { code: 'material_changed' });
  }
});
test('can fill missing original identities and dates, but cannot substitute cross-source identical quotes', () => {
  const { plan, bundle, identity } = fixture();
  identity.candidate.persons = [];
  identity.candidate.organizations = [];
  identity.candidate.event_date = null;
  assert.equal(bindMaterialPlan(plan, bundle, identity).candidate.persons.length, 1);
  plan.evidence[0].sourceUrl = 'https://example.com/different-article';
  assert.throws(() => bindMaterialPlan(plan, bundle, identity), { code: 'material_changed' });
});
test('rejects excerpts present only in the private original or invented by verifier', () => {
  for (const text of [
    'Original report: Lab announced X. Ada researcher',
    'Unseen Ada researcher Lab',
  ]) {
    const { plan, bundle, identity } = fixture();
    plan.evidence[0].excerpt = text;
    plan.evidence[0].contentHash = digest(text);
    assert.throws(() => bindMaterialPlan(plan, bundle, identity), { code: 'material_changed' });
  }
});
