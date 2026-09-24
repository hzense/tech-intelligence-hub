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
      allowed_hosts: ['example.com'],
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
    materials: prepared.materials,
    preparationHash: prepared.preparationHash,
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

test('materials expose exact entity, taxonomy, source and quote bindings without full excerpts', () => {
  const prepared = prepareCandidateReview(candidate, catalog);
  const material = prepared.materials;
  assert.equal(material.title, candidate.title);
  assert.equal(material.summary, candidate.summary);
  assert.deepEqual(material.items.find((item) => item.key === 'person:张三').matches, [
    { id: 'person-zhang-san', name: '张三' },
  ]);
  const claim = material.items.find((item) => item.key === 'claim:0');
  assert.equal(claim.proposed, candidate.claims[0].text);
  assert.equal(claim.matches[0].sourceUrl, catalog.evidence[0].source_url);
  assert.deepEqual(claim.references, candidate.claims[0].evidence);
  assert.equal(JSON.stringify(material).includes(catalog.evidence[0].excerpt), false);
  assert.match(prepared.preparationHash, /^[a-f0-9]{64}$/);
  assert.equal(
    prepareCandidateReview(candidate, catalog).preparationHash,
    prepared.preparationHash,
  );
});

test('preparation fingerprint changes when an association, proposal or quoted material changes', () => {
  const original = prepareCandidateReview(candidate, catalog);
  for (const changed of [
    { ...catalog, people: [{ ...catalog.people[0], id: 'person-other' }] },
    { ...catalog, evidence: [{ ...catalog.evidence[0], source_url: 'https://example.com/other' }] },
    { ...catalog, people: [] },
    { ...catalog, topics: [] },
  ])
    assert.notEqual(
      prepareCandidateReview(candidate, changed).preparationHash,
      original.preparationHash,
    );
  assert.notEqual(
    prepareCandidateReview({ ...candidate, event_date: '2026-09-20' }, catalog).preparationHash,
    original.preparationHash,
  );
  const withProof = {
    ...candidate,
    persons: [
      {
        ...candidate.persons[0],
        evidence: [{ fragment_id: 'fragment-1', quote: '张三任职的原文依据' }],
      },
    ],
  };
  assert.notEqual(
    prepareCandidateReview(withProof, catalog).preparationHash,
    original.preparationHash,
  );
});

test('missing or ambiguous materials stay visible with specific next steps, never fabricated IDs', () => {
  const absent = prepareCandidateReview(
    { ...candidate, persons: [], event_date: null },
    { ...catalog, organizations: [], evidence: [] },
  );
  assert.equal(absent.ready, false);
  for (const key of ['event_date', 'person:missing', 'organization:示例公司', 'claim:0']) {
    const item = absent.materials.items.find((item) => item.key === key);
    assert.equal(item.status, 'missing');
    assert.equal(item.matches.length, 0);
    assert.ok(item.nextStep.length);
  }
  const ambiguous = prepareCandidateReview(candidate, {
    ...catalog,
    people: [...catalog.people, { id: 'person-other', name: '张三' }],
  });
  const person = ambiguous.materials.items.find((item) => item.key === 'person:张三');
  assert.equal(person.status, 'ambiguous');
  assert.equal(person.matches.length, 2);
  assert.equal(ambiguous.ready, false);
});

test('only HTTPS evidence on a registered source host can be associated', () => {
  for (const row of [
    { source_url: 'javascript:alert(1)' },
    { source_url: 'https://user:password@example.com/source' },
    { source_url: 'http://example.com/source' },
    { source_url: 'https://example.com/source#fragment' },
    { source_url: 'https://different.example/source' },
    { allowed_hosts: [] },
    { allowed_hosts: undefined },
  ]) {
    const prepared = prepareCandidateReview(candidate, {
      ...catalog,
      evidence: [{ ...catalog.evidence[0], ...row }],
    });
    assert.equal(prepared.ready, false);
    assert.equal(prepared.materials.items.find((item) => item.key === 'claim:0').matches.length, 0);
  }
});
