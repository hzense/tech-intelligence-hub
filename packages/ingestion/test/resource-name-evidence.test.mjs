import assert from 'node:assert/strict';
import test from 'node:test';
import {
  completeResourceNameEvidence,
  resourceNameMention,
} from '../src/resource-name-evidence.mjs';
import {
  assessGeneratedCandidates,
  normalizeGeneratedCandidates,
  GENERATION_RESOURCES_CONTRACT,
} from '../src/signal-generation-contract.mjs';

const ref = (quote, fragment_id = 'fragment-1') => ({ fragment_id, quote });
const fragments = (text, other = '') =>
  new Map([
    ['fragment-1', { text }],
    ['fragment-2', { text: other }],
  ]);

test('resource matching accepts typography without changing names or quote bytes', () => {
  for (const [name, quote] of [
    ['ACME Lab', 'ＡＣＭＥ　Ｌａｂ announced a product.'],
    ["Ada O'Neil", 'Ada O’Neil announced a product.'],
    ['ACME-Lab', 'ACME‑Lab announced a product.'],
    ['Ada Lee', 'Ada\tLee announced a product.'],
    ['AMD', 'AMD公司公布产品。'],
    ['Ada', '公司由Ada演示产品。'],
  ])
    assert.equal(resourceNameMention(name, quote), true, name);
  for (const [name, quote] of [
    ['Ann', 'Anna announced a product.'],
    ['AMD', 'XAMD announced a product.'],
    ['AMD', 'AMD64 announced a product.'],
    ['AMD', '_AMD announced a product.'],
    ['AMD', 'Advanced Micro Devices announced a product.'],
    ['A.B', 'AB announced a product.'],
    ['Ada Lee', 'Ada Li announced a product.'],
  ])
    assert.equal(resourceNameMention(name, quote), false, name);
});

test('completion prepends only an adjacent clause-leading name from the referenced fragment', () => {
  const text = 'Header. ACME Lab announced a product. Another item.';
  const evidence = [ref('announced a product.')];
  const result = completeResourceNameEvidence('ACME Lab', evidence, fragments(text), [], 500);
  assert.deepEqual(result, [ref('ACME Lab announced a product.')]);
  assert.deepEqual(evidence, [ref('announced a product.')]);
  assert.ok(text.includes(result[0].quote));
});

test('completion refuses ambiguous, distant, oversized, alias and invalid anchors', () => {
  for (const { name = 'ACME', text, quote, other = '', otherNames = [] } of [
    { text: 'ACME exists. Example announced a product.', quote: 'announced a product.' },
    { text: 'ACME is unrelated.OtherCo announced a product.', quote: 'announced a product.' },
    { text: 'ACME\rOtherCo announced a product.', quote: 'announced a product.' },
    { text: 'ACME exists\nExample announced a product.', quote: 'announced a product.' },
    { text: 'ACME exists\n\nExample announced a product.', quote: 'announced a product.' },
    { text: 'OtherCo announced a product.', quote: 'announced a product.', other: 'ACME exists.' },
    {
      text: 'ACME announced a product. OtherCo announced a product.',
      quote: 'announced a product.',
    },
    { text: 'ACME announced X.', quote: 'X' },
    { text: 'ACME announced a product.', quote: 'forged product statement' },
    {
      text: 'ACME denied involvement, while OtherCo announced a product.',
      quote: 'announced a product.',
    },
    {
      text: 'ACME denied involvement; OtherCo announced a product.',
      quote: 'announced a product.',
    },
    {
      text: 'ACME denied involvement but OtherCo announced a product.',
      quote: 'announced a product.',
    },
    { text: 'ACME’s competitor OtherCo announced a product.', quote: 'announced a product.' },
    { text: 'Ada at ACME announced a product.', quote: 'announced a product.' },
    {
      text: 'ACME announced a product, while OtherCo denied involvement.',
      quote: 'announced a product, while OtherCo denied involvement.',
    },
    { text: `ACME ${'x'.repeat(500)} announced a product.`, quote: 'announced a product.' },
    { name: 'Ann', text: 'Anna announced a product.', quote: 'announced a product.' },
    {
      name: 'Ada',
      text: 'Ada and Grace announced a product.',
      quote: 'announced a product.',
      otherNames: ['Grace'],
    },
    {
      text: 'ACME and OtherCo announced a product.',
      quote: 'announced a product.',
      otherNames: ['OtherCo'],
    },
    {
      name: 'Advanced Micro Devices',
      text: 'AMD announced a product.',
      quote: 'announced a product.',
    },
  ]) {
    const evidence = [ref(quote)];
    assert.equal(
      completeResourceNameEvidence(name, evidence, fragments(text, other), otherNames, 500),
      evidence,
      text,
    );
  }
  const duplicate = [ref('announced a product.'), ref('ACME announced a product.')];
  assert.equal(
    completeResourceNameEvidence(
      'ACME',
      duplicate,
      fragments('ACME announced a product.'),
      [],
      500,
    ),
    duplicate,
  );
});

test('a valid clause-leading name can follow a separate clause without borrowing its subject', () => {
  const text = 'OtherCo declined; ACME announced a product.';
  const evidence = [ref('announced a product.')];
  assert.deepEqual(completeResourceNameEvidence('ACME', evidence, fragments(text), [], 500), [
    ref('ACME announced a product.'),
  ]);
});

function fixture(text = 'ACME Lab announced a product.') {
  const source = {
    classification: 'private',
    fragments: [{ id: 'fragment-1', text, locator: { paragraph: 1 } }],
  };
  const row = {
    title: 'Product announcement',
    summary: 'ACME Lab announced a product.',
    event_date: null,
    event_date_evidence: [],
    persons: [],
    organizations: ['ACME Lab'],
    claims: [{ text: 'Product announcement', evidence: [ref('announced a product.')] }],
    signal_type: 'product',
    topic_ids: [],
    resources: [
      {
        type: 'company',
        name: 'ACME Lab',
        introduction: null,
        event_role: null,
        evidence: [ref('announced a product.')],
      },
    ],
  };
  return { source, row };
}

test('new assessment repairs evidence once; strict normalization accepts the repaired result unchanged', () => {
  const { source, row } = fixture('ＡＣＭＥ　Ｌａｂ announced a product.');
  const value = { candidates: [row], reason: 'Synthetic evidence test' };
  const before = JSON.stringify({ value, source });
  const assessed = assessGeneratedCandidates(value, source, [], GENERATION_RESOURCES_CONTRACT);
  assert.deepEqual(assessed.rejected, []);
  assert.equal(assessed.candidates.length, 1);
  const evidence = assessed.candidates[0].resources[0].evidence;
  assert.deepEqual(evidence, [ref('ＡＣＭＥ　Ｌａｂ announced a product.')]);
  const strictInput = { ...row, resources: assessed.candidates[0].resources };
  const saved = normalizeGeneratedCandidates(
    { candidates: [strictInput], reason: value.reason },
    source,
    [],
    GENERATION_RESOURCES_CONTRACT,
  );
  assert.deepEqual(saved.candidates[0].resources[0].evidence, evidence);
  assert.equal(JSON.stringify({ value, source }), before);
});

test('resource completion never repairs invalid original quotations or substitutes for missing claims', () => {
  const { source, row } = fixture();
  for (const [candidate, field, reason] of [
    [{ ...row, claims: [] }, 'claims', 'missing_items'],
    [
      { ...row, resources: [{ ...row.resources[0], evidence: [ref('invented statement')] }] },
      'resources',
      'quote_mismatch',
    ],
    [
      {
        ...row,
        resources: [{ ...row.resources[0], evidence: [ref('announced a product.', 'fragment-2')] }],
      },
      'resources',
      'unknown_fragment',
    ],
  ]) {
    const assessed = assessGeneratedCandidates(
      { candidates: [candidate], reason: 'Invalid candidate' },
      source,
      [],
      GENERATION_RESOURCES_CONTRACT,
    );
    assert.equal(assessed.candidates.length, 0);
    assert.ok(
      assessed.rejected[0].errors.some((error) => error.field === field && error.reason === reason),
    );
  }
});

test('assessment never turns an unrelated named organization into the source of an event', () => {
  for (const text of [
    'ACME Lab denied involvement, while OtherCo announced a product.',
    'ACME Lab is unrelated.OtherCo announced a product.',
    'ACME Lab\rOtherCo announced a product.',
    'ACME Lab’s competitor OtherCo announced a product.',
  ]) {
    const { source, row } = fixture(text);
    row.resources[0].event_role = 'developer';
    const assessed = assessGeneratedCandidates(
      { candidates: [row], reason: 'Unrelated subject' },
      source,
      [],
      GENERATION_RESOURCES_CONTRACT,
    );
    assert.equal(assessed.candidates.length, 0);
    assert.deepEqual(assessed.rejected[0].errors, [
      {
        field: 'resources',
        code: 'invalid_field',
        path: 'resources[0].name',
        reason: 'missing_evidence',
      },
    ]);
  }
});
