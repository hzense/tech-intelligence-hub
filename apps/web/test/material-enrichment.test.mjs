import test from 'node:test';
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { buildCandidateSourceBundle } from '../../../packages/ingestion/src/candidate-source-bundle.mjs';
import { signalGenerationSourceHash } from '../../../packages/database/src/signal-generation-store.mjs';
import {
  materialEnrichmentInput,
  assessMaterialEnrichment,
  restoreMaterialEnrichment,
  splitMaterialEvidenceStatements,
  materialEnrichmentJsonSchema,
} from '../lib/material-enrichment.ts';
import { generationCandidateJsonSchema } from '../../../packages/ingestion/src/signal-generation-contract.mjs';
import { prepareMaterialPlan } from '../lib/material-plan-preparation.ts';
import { approvedMaterialDossier } from '../lib/material-review-dossier.ts';
import { assessMaterialVerification } from '../../../packages/database/src/material-verification-worker.mjs';

const source = (texts) => ({
  classification: 'private',
  fragments: texts.map((text, index) => ({
    id: `fragment-${index + 1}`,
    text,
    locator: { paragraph: index + 1 },
  })),
});
const ref = (id, quote) => ({ fragment_id: `fragment-${id}`, quote });
const quote = 'Lab is a company. Ada, researcher at Lab, announced model X on 2026-09-24.';
const candidate = {
  index: 0,
  classification: 'private',
  status: 'needs_review',
  issues: [],
  title: 'Lab 发布模型 X',
  summary: 'Lab 发布模型 X。',
  event_date: '2026-09-24',
  event_date_evidence: [ref(2, '2026-09-24')],
  persons: [],
  organizations: ['Lab'],
  claims: [{ text: 'Lab 发布模型 X。', evidence: [ref(2, 'Lab announced X')] }],
};
const context = { topics: [{ id: 'topic-ai', title: 'Artificial Intelligence' }] };
const original = source(['unused original paragraph', 'Lab announced X on 2026-09-24.']);
function bundle(supplementText = quote, originalSource = original) {
  const supplement = source(Array.isArray(supplementText) ? supplementText : [supplementText]);
  return buildCandidateSourceBundle({
    baseMaterialHash: 'a'.repeat(64),
    source: originalSource,
    supplements: [
      {
        batchId: '11111111-1111-4111-8111-111111111111',
        itemId: '22222222-2222-4222-8222-222222222222',
        fence: 1,
        sourceUrl: 'https://example.com/news',
        contentHash: signalGenerationSourceHash(supplement),
        source: supplement,
      },
    ],
  });
}
function output() {
  return {
    event_date: '2026-09-24',
    event_date_evidence: [ref(2, '2026-09-24')],
    persons: [
      {
        name: 'Ada',
        role: 'researcher',
        organization: 'Lab',
        evidence: [ref(2, 'Ada, researcher at Lab')],
      },
    ],
    organizations: ['Lab'],
    claim_evidence: [
      [ref(2, 'Lab is a company. Ada, researcher at Lab, announced model X on 2026-09-24.')],
    ],
    organization_identities: [
      { name: 'Lab', type: 'company', evidence: [ref(2, 'Lab is a company.')] },
    ],
    topic_ids: ['topic-ai'],
  };
}

test('supplement-only person, multi-fragment organization identity and nonliteral topic become a private review plan', async () => {
  const b = bundle([quote, 'Lab is a research company. Acme is a company.']),
    input = materialEnrichmentInput(b, candidate);
  assert.deepEqual(input.fragmentIds, ['fragment-2', 'fragment-3', 'fragment-4']);
  assert.equal(input.candidate.claims[0].evidence[0].fragment_id, 'fragment-1');
  assert.equal(input.source.fragments[1].text, quote);
  const value = output();
  value.organization_identities[0].evidence.push(ref(3, 'Lab is a research company.'));
  value.organizations.push('Acme');
  value.organization_identities.push({
    name: 'Acme',
    type: 'company',
    evidence: [ref(3, 'Acme is a company.')],
  });
  const result = assessMaterialEnrichment(value, input.candidate, input.source, context);
  const restored = restoreMaterialEnrichment(b, candidate, result, context);
  assert.equal(restored.candidate.persons[0].evidence[0].fragment_id, 'fragment-3');
  assert.equal(restored.candidate.title, candidate.title);
  assert.deepEqual(
    restored.candidate.claims.map((c) => c.text),
    candidate.claims.map((c) => c.text),
  );
  const packet = {
    requestId: '33333333-3333-4333-8333-333333333333',
    owner: 'owner',
    runId: '44444444-4444-4444-8444-444444444444',
    candidateIndex: 0,
    baseMaterialHash: b.baseMaterialHash,
    bundle: b,
    candidate: restored.candidate,
    originalSourceUrl: null,
    catalog: { ...context, entities: [], sources: [] },
  };
  const now = new Date('2026-09-25T00:00:00Z');
  assert.equal(prepareMaterialPlan({ ...packet, candidate }, now).ready, false);
  const prepared = prepareMaterialPlan(packet, now, restored.hints);
  assert.equal(prepared.ready, true, JSON.stringify(prepared));
  assert.equal(prepared.payload.plan.entities.find((e) => e.name === 'Lab').type, 'company');
  assert.equal(prepared.payload.plan.entities.find((e) => e.name === 'Acme').type, 'company');
  assert.deepEqual(prepared.payload.plan.topicIds, ['topic-ai']);
  const dossier = approvedMaterialDossier(prepared.payload, {
    owner_id: 'owner',
    approved_by: 'owner',
    created_at: now,
  });
  await assert.doesNotReject(
    assessMaterialVerification({
      request: { ...packet, candidate },
      plan: prepared.payload.plan,
      dossier,
      clock: () => now,
      fetchSource: async (url) => ({
        sourceUrl: url,
        text: `${quote} Lab is a research company. Acme is a company.`,
        fetchedAt: now.toISOString(),
      }),
    }),
  );
});

test('invented people, quotes, unknown topics, inferred organization types and extra authority are rejected', () => {
  const input = materialEnrichmentInput(bundle(), candidate);
  for (const mutate of [
    (v) => {
      v.event_date = '2026-09-25';
    },
    (v) => {
      v.persons[0].name = 'Invented';
    },
    (v) => {
      v.claim_evidence[0][0].quote = 'invented quote';
    },
    (v) => {
      v.topic_ids = ['unknown-topic'];
    },
    (v) => {
      v.topic_ids = ['topic-ai', 'topic-ai'];
    },
    (v) => {
      v.organization_identities[0].type = 'institution';
    },
    (v) => {
      v.organization_identities[0].evidence = [ref(2, 'Lab')];
    },
    (v) => {
      v.verified = true;
    },
    (v) => {
      v.claim_evidence = [];
    },
  ]) {
    const value = output();
    mutate(value);
    assert.throws(() => assessMaterialEnrichment(value, input.candidate, input.source, context));
  }
});

test('existing organizations survive projection while new organizations still require source evidence', () => {
  const prior = { ...candidate, organizations: ['Lab', 'Legacy'] };
  const input = materialEnrichmentInput(
    bundle(quote, source(['Legacy participated.', original.fragments[1].text])),
    prior,
  );
  assert.ok(input.source.fragments.every((f) => !f.text.includes('Legacy')));
  const value = { ...output(), organizations: ['Lab', 'Legacy'] };
  assert.doesNotThrow(() =>
    assessMaterialEnrichment(value, input.candidate, input.source, context),
  );
  value.organizations.push('Invented');
  assert.throws(() => assessMaterialEnrichment(value, input.candidate, input.source, context));
});

test('person fields cannot borrow Latin substrings from longer names, roles or organizations', () => {
  const text = 'Adaline discussed CEOship at FooLab';
  const input = materialEnrichmentInput(bundle(`${quote} ${text}`), candidate);
  for (const [name, role, organization] of [
    ['Ada', 'CEOship', 'FooLab'],
    ['Adaline', 'CEO', 'FooLab'],
    ['Adaline', 'CEOship', 'Lab'],
  ]) {
    const value = output();
    value.persons = [{ name, role, organization, evidence: [ref(2, text)] }];
    assert.throws(() => assessMaterialEnrichment(value, input.candidate, input.source, context));
  }
});

test('claim references must fit the single-evidence registration contract', () => {
  const input = materialEnrichmentInput(bundle([quote, 'Lab announced X.']), candidate);
  const value = output();
  value.claim_evidence[0].push(ref(3, 'Lab announced X.'));
  assert.throws(() => assessMaterialEnrichment(value, input.candidate, input.source, context));
});

test('supplement enrichment accepts all twelve claims allowed by the generation contract', () => {
  const maximum =
    generationCandidateJsonSchema.properties.candidates.items.properties.claims.maxItems;
  assert.equal(materialEnrichmentJsonSchema.properties.claim_evidence.maxItems, maximum);
  const original = {
    ...candidate,
    claims: Array.from({ length: maximum }, (_, i) => ({
      ...candidate.claims[0],
      text: `Lab 发布模型 X：主张 ${i + 1}`,
    })),
  };
  const input = materialEnrichmentInput(bundle(), original);
  const value = output();
  value.claim_evidence = original.claims.map(() => output().claim_evidence[0]);
  const result = assessMaterialEnrichment(value, input.candidate, input.source, context);
  assert.equal(result.candidate.claims.length, 12);
});

test('organization types cannot borrow unrelated type words from another quote or sentence', () => {
  const input = materialEnrichmentInput(
    bundle(`${quote} Lab announced X; Foo is a company.`),
    candidate,
  );
  for (const refs of [
    [ref(2, 'Lab'), ref(2, 'Foo is a company.')],
    [ref(2, 'Lab announced X; Foo is a company.')],
  ]) {
    const value = output();
    value.organization_identities[0].evidence = refs;
    assert.throws(() => assessMaterialEnrichment(value, input.candidate, input.source, context));
  }
});

test('person relationships cannot be stitched from unrelated statements', () => {
  const unrelated = 'Ada announced X; Bob is CEO at Lab.';
  const separateSentences = 'Ada announced X. Bob is CEO at Lab.';
  const compactSentences = 'Ada announced X.Bob is CEO at Lab.';
  const input = materialEnrichmentInput(
    bundle(`${quote} ${unrelated} ${separateSentences} ${compactSentences}`),
    candidate,
  );
  for (const evidence of [
    [ref(2, 'Ada announced X'), ref(2, 'Bob is CEO at Lab.')],
    [ref(2, unrelated)],
    [ref(2, separateSentences)],
    [ref(2, compactSentences)],
  ]) {
    const value = output();
    value.persons = [{ name: 'Ada', role: 'CEO', organization: 'Lab', evidence }];
    assert.throws(() => assessMaterialEnrichment(value, input.candidate, input.source, context));
  }
});

test('sentence splitting preserves titles, initialisms, initials and decimals', () => {
  assert.deepEqual(
    splitMaterialEvidenceStatements('Dr.Ada of the U.S. lab led version 3.14.Next event.'),
    ['Dr.Ada of the U.S. lab led version 3.14', 'Next event', ''],
  );
  assert.deepEqual(splitMaterialEvidenceStatements('A. Smith is CEO.'), ['A. Smith is CEO', '']);
  assert.deepEqual(
    splitMaterialEvidenceStatements('Ada A. Smith is CEO at Lab.', ['Ada A. Smith']),
    ['Ada A. Smith is CEO at Lab', ''],
  );
  assert.deepEqual(
    splitMaterialEvidenceStatements('A launch happened. A. Smith is CEO at Lab.', ['A. Smith']),
    ['A launch happened', ' A. Smith is CEO at Lab', ''],
  );
});

test('valid middle initials and names in later sentences pass the actual enrichment validator', () => {
  for (const name of ['Ada A. Smith', 'A. Smith']) {
    const text = `A launch happened. ${name} is CEO at Lab.`;
    const input = materialEnrichmentInput(bundle(`${quote} ${text}`), candidate);
    const value = output();
    value.persons = [{ name, role: 'CEO', organization: 'Lab', evidence: [ref(2, text)] }];
    assert.doesNotThrow(() =>
      assessMaterialEnrichment(value, input.candidate, input.source, context),
    );
  }
});

test('Chinese type statements match the whole organization name, not a suffix', () => {
  for (const [text, accepted] of [
    ['FooLab是一家公司。', false],
    ['Lab是一家公司。', true],
  ]) {
    const input = materialEnrichmentInput(bundle(`${quote} ${text}`), candidate);
    const value = output();
    value.organization_identities[0].evidence = [ref(2, text)];
    const check = () => assessMaterialEnrichment(value, input.candidate, input.source, context);
    if (accepted) assert.doesNotThrow(check);
    else assert.throws(check);
  }
});

test('persisted proposals revalidate against current bundle and enabled topics, preserving original story', () => {
  const b = bundle(),
    input = materialEnrichmentInput(b, candidate);
  const result = assessMaterialEnrichment(output(), input.candidate, input.source, context);
  assert.throws(() =>
    restoreMaterialEnrichment(bundle('unrelated source'), candidate, result, context),
  );
  assert.throws(() => restoreMaterialEnrichment(b, candidate, result, { topics: [] }));
  assert.throws(() =>
    restoreMaterialEnrichment(
      b,
      candidate,
      { ...result, candidate: { ...result.candidate, title: 'changed' } },
      context,
    ),
  );
});

test('projection preserves cited originals and complete supplements within the unchanged 48,000-byte input limit', () => {
  const b = bundle('x'.repeat(19000));
  const large = buildCandidateSourceBundle({
    baseMaterialHash: b.baseMaterialHash,
    source: source(['z'.repeat(19000), ...original.fragments.map((f) => f.text)]),
    supplements: [],
  });
  const projected = materialEnrichmentInput(large, {
    ...candidate,
    event_date_evidence: [ref(3, '2026-09-24')],
    claims: [{ text: 'Lab 发布模型 X。', evidence: [ref(3, 'Lab announced X')] }],
  });
  assert.equal(projected.source.fragments.length, 1);
  assert.ok(Buffer.byteLength(JSON.stringify(projected.source)) < 48000);
  const full = bundle('汉'.repeat(15000));
  // A source that was valid alone may exceed the model budget with required original references.
  full.source.fragments[1].text += '汉'.repeat(2000);
  assert.throws(() => materialEnrichmentInput(full, candidate)); // tampered source hash
  const largeSource = source([
    'Lab announced X on 2026-09-24.' + 'a'.repeat(19000),
    'b'.repeat(19000),
  ]);
  const supplement = source(['c'.repeat(11000)]);
  const over = buildCandidateSourceBundle({
    baseMaterialHash: 'a'.repeat(64),
    source: largeSource,
    supplements: [
      {
        batchId: '11111111-1111-4111-8111-111111111111',
        itemId: '22222222-2222-4222-8222-222222222222',
        fence: 1,
        sourceUrl: 'https://example.com/news',
        contentHash: signalGenerationSourceHash(supplement),
        source: supplement,
      },
    ],
  });
  assert.throws(
    () =>
      materialEnrichmentInput(over, {
        ...candidate,
        event_date_evidence: [ref(1, '2026-09-24')],
        claims: [
          { text: 'Lab 发布模型 X。', evidence: [ref(1, 'Lab announced X'), ref(2, 'bbb')] },
        ],
      }),
    { code: 'generation_source_too_large' },
  );
});
