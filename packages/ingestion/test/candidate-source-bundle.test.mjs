import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import {
  buildCandidateSourceBundle,
  validateCandidateSourceBundle,
} from '../src/candidate-source-bundle.mjs';
import { normalizeGeneratedCandidates } from '../src/signal-generation-contract.mjs';

const canonical = (value) =>
  Array.isArray(value)
    ? value.map(canonical)
    : value && typeof value === 'object'
      ? Object.fromEntries(
          Object.keys(value)
            .sort()
            .map((key) => [key, canonical(value[key])]),
        )
      : value;
const hash = (value) =>
  createHash('sha256')
    .update(JSON.stringify(canonical(value)))
    .digest('hex');
const source = (...texts) => ({
  classification: 'private',
  fragments: texts.map((text, index) => ({
    id: `fragment-${index + 1}`,
    text,
    locator: { paragraph: index + 1 },
  })),
});
const base = source('原候选事件：发布研究报告。', '原文第二段。');
const supplement = (text = '研究作者李明公布研究结果。', number = 1) => {
  const content = source(text, `补充段落 ${number}`);
  return {
    batchId: '11111111-1111-4111-8111-111111111111',
    itemId: `22222222-2222-4222-8222-${String(number).padStart(12, '0')}`,
    fence: 1,
    contentHash: hash(content),
    sourceUrl: 'https://example.com/research',
    source: content,
  };
};
const input = () => ({
  baseMaterialHash: 'a'.repeat(64),
  source: JSON.parse(JSON.stringify(base)),
  supplements: [supplement()],
});
const rejects = (operation) =>
  assert.throws(operation, { code: 'invalid_candidate_source_bundle' });
const rehash = (bundle) => {
  const payload = { ...bundle };
  delete payload.sourceBundleHash;
  bundle.sourceBundleHash = hash(payload);
  return bundle;
};

test('pins every original fragment and appends renumbered private sources without mutating inputs', () => {
  const value = input(),
    before = JSON.parse(JSON.stringify(value));
  const bundle = buildCandidateSourceBundle(value);
  assert.deepEqual(value, before);
  assert.deepEqual(bundle.source.fragments.slice(0, 2), base.fragments);
  assert.deepEqual(
    bundle.source.fragments.map((fragment) => fragment.id),
    ['fragment-1', 'fragment-2', 'fragment-3', 'fragment-4'],
  );
  assert.equal(bundle.provenance[2].originalFragmentId, 'fragment-1');
  assert.equal(bundle.provenance[2].itemId, value.supplements[0].itemId);
  assert.equal(bundle.source.classification, 'private');
  assert.deepEqual(validateCandidateSourceBundle(bundle), bundle);
  value.source.fragments[0].text = 'later mutation';
  value.supplements[0].source.fragments[0].locator.paragraph = 99;
  assert.deepEqual(bundle.source.fragments.slice(0, 2), base.fragments);
  assert.equal(bundle.source.fragments[2].locator.paragraph, 1);
});

test('accepts no supplements and three distinct supplements, with stable canonical hashes', () => {
  const value = input();
  value.supplements = [];
  assert.deepEqual(validateCandidateSourceBundle(buildCandidateSourceBundle(value)).source, base);
  value.supplements = [supplement('one', 1), supplement('two', 2), supplement('three', 3)];
  const bundle = buildCandidateSourceBundle(value);
  assert.deepEqual(validateCandidateSourceBundle(bundle), bundle);
  const { sourceBundleHash, ...payload } = bundle;
  assert.equal(sourceBundleHash, hash(payload));
});

test('rejects duplicate items, duplicate supplements, unlocated original copies, and wrong hashes', () => {
  const value = input();
  const cases = [
    [supplement(), { ...supplement('different'), batchId: '33333333-3333-4333-8333-333333333333' }],
    [supplement(), { ...supplement(), itemId: supplement('unused', 2).itemId }],
    [{ ...supplement(), source: base, contentHash: hash(base), sourceUrl: null }],
    [{ ...supplement(), contentHash: 'b'.repeat(64) }],
  ];
  for (const supplements of cases)
    rejects(() => buildCandidateSourceBundle({ ...value, supplements }));
});

test('accepts one declared URL attribution for identical original text while retaining private provenance', () => {
  const attribution = { ...supplement(), source: base, contentHash: hash(base) };
  const bundle = buildCandidateSourceBundle({ ...input(), supplements: [attribution] });
  assert.equal(bundle.source.classification, 'private');
  assert.deepEqual(bundle.source.fragments.slice(0, base.fragments.length), base.fragments);
  assert.equal(bundle.provenance[2].kind, 'supplement');
  assert.equal(bundle.provenance[2].sourceUrl, attribution.sourceUrl);
  assert.equal(bundle.provenance[2].contentHash, hash(base));
  assert.deepEqual(validateCandidateSourceBundle(bundle), bundle);
  // Another URL with the same text still needs a separate request, not duplicate
  // evidence slots that can masquerade as independent corroboration in this one.
  const second = {
    ...attribution,
    itemId: supplement('unused', 2).itemId,
    sourceUrl: 'https://example.org/other',
  };
  rejects(() => buildCandidateSourceBundle({ ...input(), supplements: [attribution, second] }));
  for (const sourceUrl of [null, 'http://example.com/', 'https://localhost/'])
    rejects(() =>
      buildCandidateSourceBundle({ ...input(), supplements: [{ ...attribution, sourceUrl }] }),
    );
  const large = source('x'.repeat(13000), 'y'.repeat(13000));
  rejects(() =>
    buildCandidateSourceBundle({
      ...input(),
      source: large,
      supplements: [{ ...attribution, source: large, contentHash: hash(large) }],
    }),
  );
});

test('rejects invalid identities, URLs, extra fields, accessors, and non-private material', () => {
  for (const patch of [
    { batchId: 'bad' },
    { itemId: 'bad' },
    { fence: 0 },
    { fence: 1.5 },
    { fence: Number.MAX_SAFE_INTEGER + 1 },
    { contentHash: 'A'.repeat(64) },
    ...[
      'http://example.com/',
      'https://user:pass@example.com/',
      'https://example.com/#',
      'https://localhost/',
      'https://127.0.0.1/',
      'https://[::1]/',
      'https://service.local/',
      'https://service.internal/',
    ].map((sourceUrl) => ({ sourceUrl })),
  ])
    rejects(() =>
      buildCandidateSourceBundle({ ...input(), supplements: [{ ...supplement(), ...patch }] }),
    );
  rejects(() => buildCandidateSourceBundle({ ...input(), verified: true }));
  rejects(() =>
    buildCandidateSourceBundle({ ...input(), source: { ...base, classification: 'public' } }),
  );
  let called = false;
  const malicious = input();
  Object.defineProperty(malicious.supplements[0], 'sourceUrl', {
    enumerable: true,
    get() {
      called = true;
      return null;
    },
  });
  rejects(() => buildCandidateSourceBundle(malicious));
  assert.equal(called, false);
  const nullable = input();
  nullable.supplements[0].sourceUrl = null;
  assert.equal(buildCandidateSourceBundle(nullable).provenance[2].sourceUrl, null);
});

test('rejects tampered bundles, including rehashed inconsistent provenance and content', () => {
  for (const mutate of [
    (b) => {
      b.baseMaterialHash = 'b'.repeat(64);
    },
    (b) => {
      b.source.fragments[0].text = 'changed original';
    },
    (b) => {
      b.source.fragments[2].text = 'changed supplement';
      rehash(b);
    },
    (b) => {
      b.provenance[2].originalFragmentId = 'fragment-2';
      rehash(b);
    },
    (b) => {
      b.provenance[2].fragmentId = 'fragment-1';
      rehash(b);
    },
    (b) => {
      b.provenance[3].fence = 2;
      rehash(b);
    },
    (b) => {
      b.provenance[0].sourceUrl = 'https://example.com/';
      rehash(b);
    },
    (b) => {
      b.provenance.pop();
      rehash(b);
    },
    (b) => {
      b.provenance[3].kind = 'original';
      rehash(b);
    },
    (b) => {
      b.verified = true;
    },
    (b) => {
      b.version = 'candidate-source-bundle-v2';
    },
  ]) {
    const bundle = buildCandidateSourceBundle(input());
    mutate(bundle);
    rejects(() => validateCandidateSourceBundle(bundle));
  }
});

test('enforces supplement count, source size, fragment size, and original source completeness', () => {
  rejects(() =>
    buildCandidateSourceBundle({
      ...input(),
      supplements: [1, 2, 3, 4].map((n) => supplement(`text ${n}`, n)),
    }),
  );
  const large = source('x'.repeat(18000), 'y'.repeat(18000));
  rejects(() =>
    buildCandidateSourceBundle({
      ...input(),
      source: large,
      supplements: [supplement('z'.repeat(15000))],
    }),
  );
  rejects(() => buildCandidateSourceBundle({ ...input(), source: source('x'.repeat(20001)) }));
  rejects(() => buildCandidateSourceBundle({ ...input(), source: source() }));
  const malformed = input();
  malformed.source.fragments[1].id = 'fragment-8';
  rejects(() => buildCandidateSourceBundle(malformed));
});

test('renumbering prevents a supplement quote from resolving against an original fragment ID', () => {
  const bundle = buildCandidateSourceBundle(input());
  const candidate = (fragmentId) => ({
    candidates: [
      {
        title: '研究报告',
        summary: '发布研究报告。',
        event_date: null,
        event_date_evidence: [],
        persons: [],
        organizations: [],
        claims: [
          {
            text: '研究作者公布结果',
            evidence: [{ fragment_id: fragmentId, quote: '研究作者李明' }],
          },
        ],
      },
    ],
    reason: '私有补证测试',
  });
  assert.throws(() => normalizeGeneratedCandidates(candidate('fragment-1'), bundle.source));
  assert.equal(
    normalizeGeneratedCandidates(candidate('fragment-3'), bundle.source).candidates.length,
    1,
  );
});
