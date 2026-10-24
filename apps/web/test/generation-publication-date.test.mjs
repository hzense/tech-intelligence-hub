import assert from 'node:assert/strict';
import test from 'node:test';
import {
  GENERATION_METADATA_CONTRACT,
  GENERATION_RESOURCES_CONTRACT,
  GENERATION_SOURCE_PUBLICATION_CONTRACT,
  generationCandidateWithResourcesJsonSchema,
  assessGeneratedCandidates,
  normalizeGeneratedCandidates,
} from '../../../packages/ingestion/src/signal-generation-contract.mjs';
import { candidateReviewMaterialHash } from '../../../packages/database/src/candidate-review-contract.mjs';
import { signalGenerationSourceHash } from '../../../packages/database/src/signal-generation-store.mjs';
import { portableJsonSchema } from '../lib/ai-model-compatibility.ts';
import {
  createSignalGenerationInvoker,
  generationInput,
} from '../lib/signal-generation-provider.ts';

const { Response } = globalThis;
const source = {
  classification: 'private',
  fragments: [
    {
      id: 'fragment-1',
      text: 'Published October 20, 2026. Updated October 21, 2026.',
      locator: { paragraph: 1 },
    },
    {
      id: 'fragment-2',
      text: 'On October 18, 2026, Lab released Chip X.',
      locator: { paragraph: 2 },
    },
  ],
};
const topics = [{ id: 'chips', title: '芯片' }];
const candidate = {
  title: 'Lab 发布 Chip X',
  summary: 'Lab 发布 Chip X。',
  date_basis: 'source_published',
  event_date: '2026-10-20',
  event_date_evidence: [{ fragment_id: 'fragment-1', quote: 'Published October 20, 2026.' }],
  persons: [],
  organizations: ['Lab'],
  claims: [
    {
      text: 'Lab 发布 Chip X。',
      evidence: [{ fragment_id: 'fragment-2', quote: 'Lab released Chip X.' }],
    },
  ],
  signal_type: 'product',
  topic_ids: ['chips'],
  resources: [
    {
      type: 'company',
      name: 'Lab',
      introduction: null,
      event_role: null,
      evidence: [{ fragment_id: 'fragment-2', quote: 'Lab released Chip X.' }],
    },
  ],
};
function example(input) {
  return JSON.parse(input.system.split('\n').find((line) => line.startsWith('{')));
}

test('source-publication contract teaches the original publication date, not the event or updated date', () => {
  const input = generationInput(
    source,
    '提取技术信号',
    topics,
    GENERATION_SOURCE_PUBLICATION_CONTRACT,
  );
  const sample = example(input);
  assert.equal(sample.output.candidates[0].event_date, '2030-04-09');
  assert.equal(sample.output.candidates[0].date_basis, 'source_published');
  assert.deepEqual(sample.output.candidates[0].event_date_evidence, [
    { fragment_id: 'fragment-1', quote: '文章发表于2030-04-09。' },
  ]);
  assert.doesNotThrow(() =>
    normalizeGeneratedCandidates(
      sample.output,
      sample.source,
      sample.enabled_topics,
      GENERATION_SOURCE_PUBLICATION_CONTRACT,
    ),
  );
  assert.match(input.system, /同一篇原始文章生成的所有候选共享该文章的发布日期/);
  assert.match(input.system, /只有更新时间时不得替代发布日期/);
  assert.match(input.system, /不凭当前年份、运行时间、网页链接或事件日期补齐/);
  assert.match(input.system, /无法可靠确定发布日期则 event_date 为 null/);
  assert.doesNotMatch(input.system, /event_date 是事件发生日期/);
  const fields = input.schema.properties.candidates.items;
  assert.ok(fields.required.includes('date_basis'));
  assert.deepEqual(fields.properties.date_basis.enum, ['source_published']);
  assert.deepEqual(JSON.parse(input.prompt).untrusted_source, source);
});

test('source date requirements override an old saved prompt without changing that prompt', () => {
  const oldPrompt = 'event_date 必须是事件发生日期，缺少年份时使用本次运行年份。';
  const before = JSON.stringify({ source, topics });
  const input = generationInput(source, oldPrompt, topics, GENERATION_SOURCE_PUBLICATION_CONTRACT);
  const policy = input.system.slice(input.system.indexOf('不可由配置提示词覆盖的证据要求：'));
  assert.ok(input.system.includes(`配置的提取提示词：\n${oldPrompt}`));
  assert.match(policy, /event_date 表示当前原始新闻／文章的发布日期/);
  assert.match(policy, /不是本站确认发布的日期/);
  assert.match(policy, /本次 date_basis 必须为 source_published/);
  assert.match(policy, /每条证据必须包含真实 fragment_id/);
  assert.equal(JSON.stringify({ source, topics }), before);
});

test('legacy task contracts retain event-date rules, examples and schemas without relabeling historical records', () => {
  for (const contract of [undefined, GENERATION_METADATA_CONTRACT, GENERATION_RESOURCES_CONTRACT]) {
    const input = generationInput(source, '历史配置', topics, contract);
    assert.match(input.system, /event_date 是事件发生日期/);
    assert.doesNotMatch(input.system, /date_basis|source_published/);
    assert.equal(example(input).output.candidates[0].event_date, '2030-04-08');
    assert.equal(input.schema.properties.candidates.items.properties.date_basis, undefined);
    assert.equal(JSON.parse(input.prompt).publication_date_hints, undefined);
  }
  const legacy = generationInput(source, '历史配置', topics, GENERATION_RESOURCES_CONTRACT);
  assert.deepEqual(legacy.schema, portableJsonSchema(generationCandidateWithResourcesJsonSchema));
  assert.throws(
    () => generationInput(source, '提取', undefined, GENERATION_SOURCE_PUBLICATION_CONTRACT),
    {
      code: 'invalid_generation_output',
    },
  );
});

async function invokeFixture(result, sourceInput = source) {
  const calls = [];
  const connection = {
    id: '11111111-1111-4111-8111-111111111111',
    revision: 1,
    protocol: 'openai-compatible',
    base_url: 'https://api.provider.example.com/v1',
    settings: { timeout_ms: 3000 },
  };
  const invoke = createSignalGenerationInvoker({
    resolve: async () => [{ address: '93.184.216.34', family: 4 }],
    request: async (args) => {
      calls.push(args);
      return Response.json({
        id: 'publication-date-fixture',
        model: 'fixture/model',
        choices: [
          {
            message: { role: 'assistant', content: JSON.stringify(result) },
            finish_reason: 'stop',
          },
        ],
        usage: { prompt_tokens: 200, completion_tokens: 100 },
      });
    },
  });
  const response = await invoke({
    source: sourceInput,
    topics,
    outputContract: GENERATION_SOURCE_PUBLICATION_CONTRACT,
    stage: {
      connection_id: connection.id,
      connection_revision: 1,
      model_id: 'fixture/model',
      prompt: '提取信号',
      temperature: 0.7,
      max_output_tokens: 1000,
      require_tools: false,
    },
    connection,
    apiKey: 'synthetic-publication-fixture-key',
    allowedHosts: ['api.provider.example.com'],
  });
  return { response, calls };
}

test('real SDK boundary requests publication schema and retains only validated private results without a live call', async () => {
  const { response, calls } = await invokeFixture({
    candidates: [candidate],
    reason: '原文技术事件',
  });
  assert.equal(response.success, true);
  assert.equal(calls.length, 1);
  assert.equal(response.output.candidates[0].date_basis, 'source_published');
  assert.equal(response.output.candidates[0].event_date, '2026-10-20');
  assert.equal(response.output.candidates[0].classification, 'private');
  const wire = JSON.parse(calls[0].body);
  assert.deepEqual(
    wire.response_format.json_schema.schema.properties.candidates.items.properties.date_basis.enum,
    ['source_published'],
  );
  assert.match(
    wire.messages.find(({ role }) => role === 'system').content,
    /原始新闻／文章的发布日期/,
  );
  assert.equal(wire.tools, undefined);
});

test('missing original publication date remains an explicitly undated private draft', async () => {
  const { response, calls } = await invokeFixture({
    candidates: [{ ...candidate, event_date: null, event_date_evidence: [] }],
    reason: '原文未注明首次发布日期',
  });
  assert.equal(response.success, true);
  assert.equal(calls.length, 1);
  assert.equal(response.output.candidates[0].event_date, null);
  assert.equal(response.output.candidates[0].date_basis, 'source_published');
  assert.equal(response.output.candidates[0].status, 'needs_review');
});

test('new provider contract rejects missing or conflicting date semantics without retrying', async () => {
  for (const date_basis of [undefined, 'event_occurred']) {
    const { response, calls } = await invokeFixture({
      candidates: [{ ...candidate, date_basis }],
      reason: '错误日期语义',
    });
    assert.equal(response.success, false);
    assert.equal(calls.length, 1);
    assert.equal(response.output?.candidates.length ?? 0, 0);
  }
});

const cardSource = {
  classification: 'private',
  fragments: [
    { id: 'fragment-1', text: 'Oct 24, 2026 | Technology newsletter', locator: { paragraph: 1 } },
    ...['Alpha', 'Beta', 'Gamma', 'Delta'].map((name, index) => ({
      id: `fragment-${index + 2}`,
      text: `${name} releases a model\n\n${name} announced its first model.\n\n3 min read\n\nOct ${index === 3 ? '22' : '23'}, 2026`,
      locator: { paragraph: index * 4 + 2 },
    })),
    { id: 'fragment-6', text: '© 2026 Newsletter', locator: { paragraph: 18 } },
  ],
};
const cardCandidates = ['Alpha', 'Beta', 'Gamma', 'Delta'].map((name, index) => ({
  ...candidate,
  title: `${name} 发布模型`,
  summary: `${name} 发布首个模型。`,
  event_date: null,
  event_date_evidence: [],
  organizations: [name],
  claims: [
    {
      text: `${name} 发布首个模型。`,
      evidence: [
        { fragment_id: `fragment-${index + 2}`, quote: `${name} announced its first model.` },
      ],
    },
  ],
  resources: [
    {
      type: 'company',
      name,
      introduction: null,
      event_role: null,
      evidence: [
        { fragment_id: `fragment-${index + 2}`, quote: `${name} announced its first model.` },
      ],
    },
  ],
}));

test('new generation fills omitted dates from the cited news cards without another AI call or changing the source', async () => {
  const original = JSON.stringify(cardSource);
  const hash = signalGenerationSourceHash(cardSource);
  const { response, calls } = await invokeFixture(
    { candidates: cardCandidates, reason: '候选' },
    cardSource,
  );
  assert.equal(response.success, true);
  assert.equal(calls.length, 1);
  assert.equal(response.input_tokens, 200);
  assert.equal(response.output_tokens, 100);
  assert.deepEqual(
    response.output.candidates.map((item) => item.event_date),
    ['2026-10-23', '2026-10-23', '2026-10-23', '2026-10-22'],
  );
  const payload = JSON.parse(
    JSON.parse(calls[0].body).messages.find(({ role }) => role === 'user').content,
  );
  assert.deepEqual(payload.untrusted_source, cardSource);
  assert.equal(payload.publication_date_hints.length, 4);
  for (const item of response.output.candidates) {
    assert.ok(!item.issues.includes('needs_event_time'));
    assert.equal(item.status, 'needs_review');
    assert.equal(item.classification, 'private');
    for (const reference of item.event_date_evidence) {
      assert.ok(
        cardSource.fragments
          .find(({ id }) => id === reference.fragment_id)
          .text.includes(reference.quote),
      );
    }
    // The same assessment used by database finish/read must reproduce the saved result.
    const { index, classification, status, issues, ...raw } = item;
    const normalized = assessGeneratedCandidates(
      { candidates: [raw], reason: response.output.reason },
      cardSource,
      topics,
      GENERATION_SOURCE_PUBLICATION_CONTRACT,
    );
    assert.deepEqual(
      { ...normalized.candidates[0], index },
      { ...raw, index, classification, status, issues },
    );
  }
  assert.equal(JSON.stringify(cardSource), original);
  assert.equal(signalGenerationSourceHash(cardSource), hash);
});

test('publication-date completion does not resurrect rejected candidates or renumber survivors', async () => {
  const invalid = {
    ...cardCandidates[0],
    claims: [
      { text: '伪造主张', evidence: [{ fragment_id: 'fragment-2', quote: 'not in the source' }] },
    ],
  };
  const { response, calls } = await invokeFixture(
    { candidates: [invalid, cardCandidates[1]], reason: '候选' },
    cardSource,
  );
  assert.equal(response.success, true);
  assert.equal(calls.length, 1);
  assert.equal(response.output.rejected[0].index, 0);
  assert.equal(response.output.candidates.length, 1);
  assert.equal(response.output.candidates[0].index, 1);
  assert.equal(response.output.candidates[0].event_date, '2026-10-23');
});

test('read-only assessment and material hashes of saved undated candidates remain unchanged', async () => {
  const oldResult = assessGeneratedCandidates(
    { candidates: cardCandidates, reason: '已保存候选' },
    cardSource,
    topics,
    GENERATION_SOURCE_PUBLICATION_CONTRACT,
  );
  const run = {
    id: '11111111-1111-4111-8111-111111111111',
    owner_id: 'owner',
    status: 'completed',
    source_hash: signalGenerationSourceHash(cardSource),
    snapshot: {
      source: cardSource,
      topics,
      output_contract: GENERATION_SOURCE_PUBLICATION_CONTRACT,
    },
    result: oldResult,
  };
  const before = JSON.stringify(run);
  const hash = candidateReviewMaterialHash(run, 0);
  const { response } = await invokeFixture(
    { candidates: cardCandidates, reason: '新响应' },
    cardSource,
  );
  assert.equal(response.output.candidates[0].event_date, '2026-10-23');
  assert.equal(oldResult.candidates[0].event_date, null);
  assert.ok(oldResult.candidates[0].issues.includes('needs_event_time'));
  assert.equal(candidateReviewMaterialHash(run, 0), hash);
  assert.equal(JSON.stringify(run), before);
});
