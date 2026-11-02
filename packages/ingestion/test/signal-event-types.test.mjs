import assert from 'node:assert/strict';
import test from 'node:test';
import {
  GENERATION_EVENT_TYPES_CONTRACT,
  GENERATION_SOURCE_PUBLICATION_CONTRACT,
  GENERATION_RESOURCES_CONTRACT,
  assessGeneratedCandidates,
  generationCandidateWithEventTypesJsonSchema,
  generationCandidateWithPublicationDateJsonSchema,
  hasGenerationResources,
  hasSourcePublicationDate,
} from '../src/signal-generation-contract.mjs';
import { LEGACY_SIGNAL_TYPES, SIGNAL_EVENT_TYPES } from '../src/signal-types.mjs';
import { assessCandidateEnrichment } from '../src/candidate-enrichment-contract.mjs';

const quote = 'Published November 2, 2026. Lab announced a new project.';
const evidence = [{ fragment_id: 'fragment-1', quote }];
const source = {
  classification: 'private',
  fragments: [{ id: 'fragment-1', text: quote, locator: { paragraph: 1 } }],
};
const candidate = {
  title: 'Lab 公布项目',
  summary: 'Lab 公布一项项目。',
  event_date: '2026-11-02',
  event_date_evidence: evidence,
  date_basis: 'source_published',
  persons: [],
  organizations: [],
  resources: [],
  topic_ids: [],
  signal_type: 'product',
  claims: [{ text: 'Lab 公布项目。', evidence }],
};
const assess = (value, contract) =>
  assessGeneratedCandidates({ candidates: [value], reason: '测试候选' }, source, [], contract);

test('event-only contract inherits source dates and resources while old schemas remain fixed', () => {
  const fields = generationCandidateWithEventTypesJsonSchema.properties.candidates.items;
  const legacy = generationCandidateWithPublicationDateJsonSchema.properties.candidates.items;
  assert.deepEqual(fields.properties.signal_type.enum, SIGNAL_EVENT_TYPES);
  assert.deepEqual(legacy.properties.signal_type.enum, LEGACY_SIGNAL_TYPES);
  assert.equal(legacy.properties.signal_type.enum.length, 15);
  assert.ok(fields.required.includes('resources'));
  assert.ok(fields.required.includes('date_basis'));
  assert.equal(hasSourcePublicationDate(GENERATION_EVENT_TYPES_CONTRACT), true);
  assert.equal(hasGenerationResources(GENERATION_EVENT_TYPES_CONTRACT), true);
  assert.equal(hasSourcePublicationDate(GENERATION_RESOURCES_CONTRACT), false);
  for (const type of SIGNAL_EVENT_TYPES) {
    const result = assess({ ...candidate, signal_type: type }, GENERATION_EVENT_TYPES_CONTRACT);
    assert.equal(result.candidates[0].signal_type, type);
    assert.equal(result.candidates[0].date_basis, 'source_published');
    assert.deepEqual(result.candidates[0].event_date_evidence, evidence);
  }
});

test('retired dimensions stay readable in legacy candidates but are rejected for new generation', () => {
  for (const type of ['technology', 'security', 'market', 'supply_chain', 'open_source']) {
    const input = { ...candidate, signal_type: type };
    const before = JSON.stringify(input);
    assert.equal(
      assess(input, GENERATION_SOURCE_PUBLICATION_CONTRACT).candidates[0].signal_type,
      type,
    );
    const modern = assess(input, GENERATION_EVENT_TYPES_CONTRACT);
    assert.equal(modern.candidates.length, 0);
    assert.deepEqual(modern.rejected[0].errors, [
      {
        field: 'signal_type',
        code: 'invalid_field',
        path: 'signal_type',
        reason: 'invalid_type',
      },
    ]);
    assert.equal(JSON.stringify(input), before);
  }
  for (const type of ['disclosure', 'operations', 'incident']) {
    assert.equal(
      assess({ ...candidate, signal_type: type }, GENERATION_SOURCE_PUBLICATION_CONTRACT).candidates
        .length,
      0,
    );
  }
});

test('new event candidates retain quotation, unknown date and resource validation', () => {
  for (const input of [
    { ...candidate, date_basis: 'event' },
    { ...candidate, event_date_evidence: [] },
    {
      ...candidate,
      claims: [
        { text: 'unsupported', evidence: [{ fragment_id: 'fragment-1', quote: 'fabricated' }] },
      ],
    },
  ])
    assert.equal(assess(input, GENERATION_EVENT_TYPES_CONTRACT).candidates.length, 0);
  const missingDate = assess(
    { ...candidate, event_date: null, event_date_evidence: [] },
    GENERATION_EVENT_TYPES_CONTRACT,
  ).candidates[0];
  assert.equal(missingDate.event_date, null);
  assert.ok(missingDate.issues.includes('needs_event_time'));
});

test('enrichment preserves new event types and legacy retired categories without rewriting originals', () => {
  const proposal = {
    event_date: candidate.event_date,
    event_date_evidence: evidence,
    persons: [],
    organizations: [],
    resources: [],
  };
  for (const type of [...SIGNAL_EVENT_TYPES, 'security']) {
    const contract =
      type === 'security'
        ? GENERATION_SOURCE_PUBLICATION_CONTRACT
        : GENERATION_EVENT_TYPES_CONTRACT;
    const original = assess({ ...candidate, signal_type: type }, contract).candidates[0];
    const before = JSON.stringify(original);
    const result = assessCandidateEnrichment(proposal, original, source).candidate;
    assert.equal(result.signal_type, type);
    assert.equal(result.date_basis, 'source_published');
    assert.equal(result.event_date, candidate.event_date);
    assert.equal(JSON.stringify(original), before);
  }
});
