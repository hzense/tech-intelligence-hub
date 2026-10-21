import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assessGeneratedCandidates,
  normalizeGeneratedCandidates,
  GENERATION_RESOURCES_CONTRACT,
  GENERATION_SOURCE_PUBLICATION_CONTRACT,
  generationCandidateWithPublicationDateJsonSchema,
} from '../src/signal-generation-contract.mjs';
import { assessCandidateEnrichment } from '../src/candidate-enrichment-contract.mjs';

const source = {
  classification: 'private',
  fragments: [
    {
      id: 'fragment-1',
      text: 'Published October 20, 2026. Updated October 21, 2026.',
      locator: { paragraph: 1 },
    },
    { id: 'fragment-2', text: 'Lab released X on October 18, 2026.', locator: { paragraph: 2 } },
  ],
};
const dateEvidence = [{ fragment_id: 'fragment-1', quote: 'Published October 20, 2026.' }];
const raw = {
  title: 'Lab 发布 X',
  summary: 'Lab 发布 X。',
  event_date: '2026-10-20',
  event_date_evidence: dateEvidence,
  date_basis: 'source_published',
  persons: [],
  organizations: [],
  resources: [],
  topic_ids: [],
  signal_type: 'product',
  claims: [
    { text: 'Lab 发布 X。', evidence: [{ fragment_id: 'fragment-2', quote: 'Lab released X' }] },
  ],
};
const assess = (candidate) =>
  assessGeneratedCandidates(
    { candidates: [candidate], reason: '私有候选' },
    source,
    [],
    GENERATION_SOURCE_PUBLICATION_CONTRACT,
  );

test('publication contract preserves article date and references independently of event and updated dates', () => {
  const schema = generationCandidateWithPublicationDateJsonSchema.properties.candidates.items;
  assert.ok(schema.required.includes('date_basis'));
  assert.deepEqual(schema.properties.date_basis.enum, ['source_published']);
  assert.match(schema.properties.event_date.description, /首次发布日期/);
  const result = assessGeneratedCandidates(
    {
      candidates: Array.from({ length: 5 }, (_, index) => ({
        ...raw,
        title: `Lab 新闻 ${index + 1}`,
      })),
      reason: '同篇文章的多条候选',
    },
    source,
    [],
    GENERATION_SOURCE_PUBLICATION_CONTRACT,
  );
  assert.equal(result.candidates.length, 5);
  for (const candidate of result.candidates) {
    assert.equal(candidate.event_date, '2026-10-20');
    assert.equal(candidate.date_basis, 'source_published');
    assert.deepEqual(candidate.event_date_evidence, dateEvidence);
  }
});

test('date meaning is mandatory in new contracts and forbidden in historical contracts', () => {
  const { date_basis: ignored, ...legacy } = raw;
  assert.equal(ignored, 'source_published');
  for (const input of [
    legacy,
    { ...raw, date_basis: 'event' },
    { ...raw, date_basis: 'captured_at' },
  ]) {
    const result = assess(input);
    assert.equal(result.candidates.length, 0);
    assert.equal(result.rejected[0].errors[0].code, 'invalid_candidate_shape');
  }
  const old = normalizeGeneratedCandidates(
    { candidates: [legacy], reason: '历史任务' },
    source,
    [],
    GENERATION_RESOURCES_CONTRACT,
  );
  assert.equal('date_basis' in old.candidates[0], false);
  assert.throws(() =>
    normalizeGeneratedCandidates(
      { candidates: [raw], reason: '不能篡改历史语义' },
      source,
      [],
      GENERATION_RESOURCES_CONTRACT,
    ),
  );
});

test('unknown article dates remain incomplete and no current or event date is inferred', () => {
  const result = assess({ ...raw, event_date: null, event_date_evidence: [] });
  assert.equal(result.candidates[0].event_date, null);
  assert.ok(result.candidates[0].issues.includes('needs_event_time'));
  for (const evidence of [
    [],
    [{ fragment_id: 'missing', quote: 'Published October 20, 2026.' }],
    [{ fragment_id: 'fragment-1', quote: 'Published October 22, 2026.' }],
  ]) {
    assert.equal(assess({ ...raw, event_date_evidence: evidence }).candidates.length, 0);
  }
});

test('enrichment locks the date meaning and preserves existing original-publication dates', () => {
  const original = assess(raw).candidates[0];
  const proposal = {
    event_date: '2026-10-21',
    event_date_evidence: [{ fragment_id: 'fragment-1', quote: 'Updated October 21, 2026.' }],
    persons: [],
    organizations: [],
    resources: [],
  };
  const enriched = assessCandidateEnrichment(proposal, original, source).candidate;
  assert.equal(enriched.date_basis, 'source_published');
  assert.equal(enriched.event_date, '2026-10-20');
  assert.deepEqual(enriched.event_date_evidence, dateEvidence);
  const missing = assess({ ...raw, event_date: null, event_date_evidence: [] }).candidates[0];
  const filled = assessCandidateEnrichment(
    { ...proposal, event_date: raw.event_date, event_date_evidence: dateEvidence },
    missing,
    source,
  ).candidate;
  assert.equal(filled.date_basis, 'source_published');
  assert.equal(filled.event_date, '2026-10-20');
  assert.throws(() =>
    assessCandidateEnrichment({ ...proposal, date_basis: 'event' }, missing, source),
  );
});
