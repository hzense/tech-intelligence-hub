import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareCandidateReview, publicPreparation } from '../lib/candidate-review-preparation.ts';

const candidate = {
  title: 'ChatGPT 推出面向金融行业的新能力',
  summary: 'OpenAI 宣布 ChatGPT 的金融行业能力。',
  event_date: '2026-09-21',
  persons: [{ name: '张三', role: '首席执行官', organization: '示例公司' }],
  organizations: ['示例公司'],
  claims: [
    {
      text: '示例公司发布了新能力。',
      evidence: [{ quote: '正式来源中的逐字证据' }],
    },
  ],
};
const catalog = {
  people: [{ id: 'person-zhang-san', name: '张三', aliases: [] }],
  organizations: [{ id: 'org-example', name: 'Example Corp', aliases: ['示例公司'] }],
  topics: [
    { id: 'topic-language-models', name: 'Language Models' },
    { id: 'topic-artificial-intelligence', name: 'Artificial Intelligence' },
  ],
  evidence: [
    {
      id: 'evidence-1',
      source_url: 'https://example.com/source',
      excerpt: '这是正式来源中的逐字证据，且已经完成公开证据核验。',
    },
  ],
};

test('system preparation builds a complete deterministic review without browser-authored fields', () => {
  const prepared = prepareCandidateReview(candidate, catalog);
  assert.equal(prepared.ready, true);
  assert.deepEqual(prepared.draft.personIds, ['person-zhang-san']);
  assert.deepEqual(prepared.draft.organizationIds, ['org-example']);
  assert.deepEqual(prepared.draft.publicEvidenceIds, ['evidence-1']);
  assert.deepEqual(prepared.draft.claims, [
    { text: '示例公司发布了新能力。', evidenceId: 'evidence-1' },
  ]);
  assert.match(prepared.draft.eventKey, /^event-20260921-[a-f0-9]{20}$/);
  assert.deepEqual(publicPreparation(prepared), {
    ready: true,
    blockers: [],
    enrichment: {
      matched: 5,
      pending: 0,
      checks: [
        { category: 'event_date', label: '事件日期', status: 'matched', detail: '2026-09-21' },
        {
          category: 'person',
          label: '人物：张三',
          status: 'matched',
          detail: '已唯一匹配正式人物实体。',
        },
        {
          category: 'organization',
          label: '组织：示例公司',
          status: 'matched',
          detail: '已唯一匹配正式组织实体。',
        },
        {
          category: 'topic',
          label: '领域分类',
          status: 'matched',
          detail: 'Language Models',
        },
        {
          category: 'public_evidence',
          label: '公开证据：主张 1',
          status: 'matched',
          detail: '已唯一匹配已核验公开证据。',
        },
      ],
    },
    counts: { people: 1, organizations: 1, topics: 1, evidence: 1, claims: 1 },
  });
});

test('system preparation blocks missing or ambiguous formal dependencies', () => {
  const prepared = prepareCandidateReview(candidate, {
    ...catalog,
    people: [],
    evidence: [catalog.evidence[0], { ...catalog.evidence[0], id: 'evidence-2' }],
  });
  assert.equal(prepared.ready, false);
  assert.match(prepared.blockers.join('\n'), /人物“张三”尚未建立正式实体/);
  assert.match(prepared.blockers.join('\n'), /第 1 条主张匹配到多条已核验公开证据/);
  assert.equal(prepared.enrichment.matched, 3);
  assert.equal(prepared.enrichment.pending, 2);
  assert.equal('draft' in prepared, false);
});

test('private source quotations are never promoted when public evidence is absent', () => {
  const prepared = prepareCandidateReview(candidate, { ...catalog, evidence: [] });
  assert.equal(prepared.ready, false);
  assert.match(prepared.blockers.join('\n'), /尚未匹配到已核验公开证据/);
});

test('a claim without quotations never matches catalog evidence', () => {
  const prepared = prepareCandidateReview(
    { ...candidate, claims: [{ text: '没有引用的主张。', evidence: [] }] },
    catalog,
  );
  assert.equal(prepared.ready, false);
  assert.match(prepared.blockers.join('\n'), /尚未匹配到已核验公开证据/);
  assert.deepEqual(
    prepared.enrichment.checks.find((check) => check.category === 'public_evidence'),
    {
      category: 'public_evidence',
      label: '公开证据：主张 1',
      status: 'missing',
      detail: '主张没有可用于匹配的原文引用。',
    },
  );
});
