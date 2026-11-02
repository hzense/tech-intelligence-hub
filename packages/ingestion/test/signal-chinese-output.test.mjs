import assert from 'node:assert/strict';
import test from 'node:test';
import {
  GENERATION_CHINESE_CONTRACT,
  GENERATION_EVENT_TYPES_CONTRACT,
  assessGeneratedCandidates,
  normalizeGeneratedCandidates,
  generationCandidateWithChineseJsonSchema,
  generationCandidateWithEventTypesJsonSchema,
  hasGenerationEventTypes,
  hasGenerationResources,
  hasSourcePublicationDate,
} from '../src/signal-generation-contract.mjs';
import { SIGNAL_EVENT_TYPES } from '../src/signal-types.mjs';

const quote = 'Published November 2, 2026. OpenAI released GPT-6.';
const evidence = [{ fragment_id: 'fragment-1', quote }];
const source = {
  classification: 'private',
  fragments: [{ id: 'fragment-1', text: quote, locator: { paragraph: 1 } }],
};
const candidate = {
  title: 'OpenAI 发布 GPT-6',
  summary: 'OpenAI 发布了 GPT-6 模型。本条记录模型发布，不推断其未获验证的性能。',
  event_date: '2026-11-02',
  event_date_evidence: evidence,
  date_basis: 'source_published',
  persons: [],
  organizations: [],
  resources: [],
  topic_ids: [],
  signal_type: 'product',
  claims: [{ text: 'OpenAI 发布 GPT-6。', evidence }],
};
const assess = (value, contract = GENERATION_CHINESE_CONTRACT) =>
  assessGeneratedCandidates({ candidates: [value], reason: '测试候选' }, source, [], contract);

test('Chinese contract inherits dates, resources and the 13 event types without mutating historical schema', () => {
  assert.equal(hasGenerationEventTypes(GENERATION_CHINESE_CONTRACT), true);
  assert.equal(hasSourcePublicationDate(GENERATION_CHINESE_CONTRACT), true);
  assert.equal(hasGenerationResources(GENERATION_CHINESE_CONTRACT), true);
  const fields = generationCandidateWithChineseJsonSchema.properties.candidates.items;
  const prior = generationCandidateWithEventTypesJsonSchema.properties.candidates.items;
  assert.deepEqual(fields.properties.signal_type.enum, SIGNAL_EVENT_TYPES);
  assert.deepEqual(fields.required, prior.required);
  for (const field of ['title', 'summary']) {
    assert.match(fields.properties[field].description, /中文/);
    assert.equal(prior.properties[field].description, undefined);
  }
});

test('Chinese narrative can retain English proper nouns and exact untranslated source evidence', () => {
  const before = JSON.stringify(candidate);
  const result = assess(candidate);
  assert.equal(result.candidates.length, 1);
  assert.equal(result.candidates[0].title, candidate.title);
  assert.equal(result.candidates[0].summary, candidate.summary);
  assert.deepEqual(result.candidates[0].event_date_evidence, evidence);
  assert.deepEqual(result.candidates[0].claims[0].evidence, evidence);
  assert.equal(JSON.stringify(candidate), before);
});

for (const field of ['title', 'summary']) {
  test(`new contract rejects English-dominant ${field} with safe field diagnostics`, () => {
    const input = {
      ...candidate,
      [field]: 'OpenAI releases a new model with improved performance 中文',
    };
    const result = assess(input);
    assert.equal(result.candidates.length, 0);
    assert.deepEqual(result.rejected[0].errors, [
      {
        field,
        code: 'invalid_field',
        path: field,
        reason: 'language_not_chinese',
      },
    ]);
    assert.doesNotMatch(JSON.stringify(result), /OpenAI releases/);
    assert.throws(
      () =>
        normalizeGeneratedCandidates(
          { candidates: [input], reason: 'test' },
          source,
          [],
          GENERATION_CHINESE_CONTRACT,
        ),
      { code: 'invalid_generation_output' },
    );
  });
}

test('historical event-type candidates retain English content and the original assessment', () => {
  const input = {
    ...candidate,
    title: 'OpenAI releases GPT-6',
    summary: 'OpenAI released its new model.',
  };
  const before = JSON.stringify(input);
  const result = assess(input, GENERATION_EVENT_TYPES_CONTRACT);
  assert.equal(result.candidates.length, 1);
  assert.equal(result.candidates[0].title, input.title);
  assert.equal(result.candidates[0].summary, input.summary);
  assert.equal(JSON.stringify(input), before);
  assert.equal(assess(input).rejected[0].errors.length, 2);
});
