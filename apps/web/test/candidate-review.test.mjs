import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCandidateReview, candidateReviewSummaries } from '../lib/candidate-review.ts';
import { signalGenerationSourceHash } from '../../../packages/database/src/signal-generation-store.mjs';
import { assessGeneratedCandidates } from '../../../packages/ingestion/src/signal-generation-contract.mjs';
const { structuredClone } = globalThis;

const source = {
  classification: 'private',
  fragments: [
    { id: 'fragment-1', text: '张三于2026年9月20日宣布发布新产品。', locator: { paragraph: 1 } },
    { id: 'fragment-2', text: '未引用的私有内容', locator: { paragraph: 2 } },
  ],
};
const evidence = [{ fragment_id: 'fragment-1', quote: '张三于2026年9月20日宣布发布新产品。' }];
function fixture() {
  const result = assessGeneratedCandidates(
    {
      candidates: [
        {
          title: '新产品发布',
          summary: '张三宣布发布新产品。',
          event_date: '2026-09-20',
          event_date_evidence: evidence,
          persons: [{ name: '张三', role: '发布者', organization: null, evidence }],
          organizations: [],
          claims: [{ text: '宣布发布新产品', evidence }],
        },
      ],
      reason: '不应出现在审核材料中的模型自由文本',
    },
    source,
  );
  return {
    id: '11111111-1111-4111-8111-111111111111',
    owner_id: 'private-owner',
    status: 'completed',
    deleted_at: null,
    source_hash: signalGenerationSourceHash(source),
    snapshot: {
      source: structuredClone(source),
      connection: { apiKey: 'never-expose-key' },
      profile: { private: true },
    },
    lease_token: 'never-expose-token',
    result,
  };
}
test('review packet binds immutable source and candidate without leaking internal snapshots', () => {
  const run = fixture(),
    before = JSON.stringify(run);
  const packet = buildCandidateReview(run, 0);
  assert.equal(packet.canPublish, false);
  assert.equal(packet.candidate.status, 'needs_review');
  assert.equal(packet.fragments.length, 1);
  assert.equal(packet.materialHash.length, 64);
  assert.equal(packet.checks.length, 6);
  assert.equal(JSON.stringify(run), before);
  for (const secret of [
    'never-expose-key',
    'never-expose-token',
    'private-owner',
    '未引用的私有内容',
    run.result.reason,
  ])
    assert.equal(JSON.stringify(packet).includes(secret), false);
  assert.equal(buildCandidateReview(run, 0).materialHash, packet.materialHash);
  run.result.candidates[0].summary = '另一份摘要';
  assert.notEqual(buildCandidateReview(run, 0).materialHash, packet.materialHash);
});
test('original candidate index survives partial acceptance; array offset is not identity', () => {
  const run = fixture();
  run.result.candidates[0].index = 3;
  assert.throws(() => buildCandidateReview(run, 0));
  assert.equal(buildCandidateReview(run, 3).candidateIndex, 3);
  assert.deepEqual(
    candidateReviewSummaries(run).map((row) => row.index),
    [3],
  );
});
test('reject nonterminal, failed, deleted, malformed and duplicate identities', () => {
  for (const status of ['pending', 'running', 'unknown', 'failed', 'cancelled']) {
    const run = fixture();
    run.status = status;
    assert.throws(() => buildCandidateReview(run, 0), /candidate_review_unavailable/);
    assert.deepEqual(candidateReviewSummaries(run), []);
  }
  for (const change of [
    (run) => {
      run.deleted_at = '2026-09-21';
    },
    (run) => {
      run.result.candidates.push(run.result.candidates[0]);
    },
    (run) => {
      run.result.candidates[0].status = 'approved';
    },
    (run) => {
      run.result.classification = 'public';
    },
    (run) => {
      run.source_hash = 'bad';
    },
    (run) => {
      run.snapshot.source.fragments[0].text = 'changed';
    },
    (run) => {
      run.result.candidates[0].claims[0].evidence[0].quote = 'fabricated';
    },
    (run) => {
      run.result.candidates[0].title = '文'.repeat(81);
    },
  ]) {
    const run = structuredClone(fixture());
    change(run);
    assert.throws(() => buildCandidateReview(run, 0), /candidate_review_unavailable/);
  }
  for (const index of [-1, 5, 0.5, '0', NaN])
    assert.throws(() => buildCandidateReview(fixture(), index));
});
test('recompute missing evidence instead of trusting saved/model supplied issue list', () => {
  const run = fixture();
  Object.assign(run.result.candidates[0], {
    persons: [],
    event_date: null,
    event_date_evidence: [],
    issues: [],
  });
  const packet = buildCandidateReview(run, 0);
  assert.deepEqual(packet.candidate.issues, [
    'needs_public_evidence',
    'needs_person_evidence',
    'needs_event_time',
  ]);
  assert.equal(packet.canPublish, false);
  assert.ok(packet.checks.find((row) => row.code === 'event_time'));
});
