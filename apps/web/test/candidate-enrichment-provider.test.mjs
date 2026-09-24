import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { createCandidateEnrichmentInvoker } from '../lib/candidate-enrichment-provider.ts';

const { Response } = globalThis;

const source = {
  classification: 'private',
  fragments: [
    {
      id: 'fragment-1',
      text: '2026-09-20，研究作者李明在示例研究所发布模型评测。',
      locator: { paragraph: 1 },
    },
  ],
};
const candidate = {
  index: 0,
  title: '示例研究所发布模型评测',
  summary: '示例研究所发布模型评测，仍待审核。',
  event_date: null,
  event_date_evidence: [],
  persons: [],
  organizations: [],
  claims: [
    {
      text: '发布模型评测',
      evidence: [{ fragment_id: 'fragment-1', quote: '发布模型评测' }],
    },
  ],
  classification: 'private',
  status: 'needs_review',
  issues: ['needs_public_evidence', 'needs_person_evidence', 'needs_event_time'],
};
const connectionId = randomUUID();
const connection = {
  id: connectionId,
  revision: 2,
  protocol: 'openai-compatible',
  base_url: 'https://api.provider.example.com/v1',
  settings: {
    timeout_ms: 3000,
    max_concurrency: 1,
    daily_budget_microusd: 1000000,
    input_price_microusd_per_million: 1000000,
    output_price_microusd_per_million: 2000000,
  },
};
const stage = {
  connection_id: connectionId,
  connection_revision: 2,
  model_id: 'fixture/model',
  prompt: '独立核对原文证据。',
  temperature: 0.7,
  max_output_tokens: 2048,
  require_tools: false,
};

test('candidate enrichment invokes one structured request and saves only validated private fields', async () => {
  const calls = [];
  const invoke = createCandidateEnrichmentInvoker({
    resolve: async () => [{ address: '93.184.216.34', family: 4 }],
    request: async (args) => {
      calls.push(args);
      return Response.json({
        id: 'fixture',
        model: stage.model_id,
        choices: [
          {
            message: {
              role: 'assistant',
              content: JSON.stringify({
                event_date: '2026-09-20',
                event_date_evidence: [{ fragment_id: 'fragment-1', quote: '2026-09-20' }],
                persons: [
                  {
                    name: '李明',
                    role: '研究作者',
                    organization: '示例研究所',
                    evidence: [{ fragment_id: 'fragment-1', quote: '研究作者李明在示例研究所' }],
                  },
                ],
                organizations: ['示例研究所'],
              }),
            },
            finish_reason: 'stop',
          },
        ],
        usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
      });
    },
  });
  const result = await invoke({
    source,
    candidate,
    stage,
    connection,
    apiKey: 'synthetic-private-key',
    allowedHosts: ['api.provider.example.com'],
  });
  assert.equal(result.success, true);
  assert.equal(calls.length, 1);
  assert.equal(result.output.classification, 'private');
  assert.equal(result.output.candidate.title, candidate.title);
  assert.equal(result.output.candidate.event_date, '2026-09-20');
  const request = JSON.parse(calls[0].body);
  assert.equal(request.response_format.type, 'json_schema');
  assert.equal(request.tools, undefined);
  assert.equal(request.max_tokens ?? request.max_completion_tokens, 2048);
  assert.match(request.messages[0].content, /不输出思考过程/);
});

test('candidate enrichment rejects invented quotations without a second provider call', async () => {
  let calls = 0;
  const invoke = createCandidateEnrichmentInvoker({
    resolve: async () => [{ address: '93.184.216.34', family: 4 }],
    request: async () => {
      calls++;
      return Response.json({
        id: 'fixture',
        model: stage.model_id,
        choices: [
          {
            message: {
              role: 'assistant',
              content: JSON.stringify({
                event_date: '2026-09-20',
                event_date_evidence: [{ fragment_id: 'fragment-1', quote: '不存在的原文证据' }],
                persons: [],
                organizations: [],
              }),
            },
            finish_reason: 'stop',
          },
        ],
        usage: { prompt_tokens: 100, completion_tokens: 30, total_tokens: 130 },
      });
    },
  });
  const result = await invoke({
    source,
    candidate,
    stage,
    connection,
    apiKey: 'synthetic-private-key',
    allowedHosts: ['api.provider.example.com'],
  });
  assert.equal(result.success, false);
  assert.equal(result.error_code, 'enrichment_failed');
  assert.equal(calls, 1);
});

test('material enrichment uses the saved source and enabled catalog with one bounded provider call', async () => {
  let calls = 0;
  let sent;
  const evidence = [{ fragment_id: 'fragment-1', quote: '研究作者李明在示例研究所发布模型评测' }];
  const invoke = createCandidateEnrichmentInvoker({
    resolve: async () => [{ address: '93.184.216.34', family: 4 }],
    request: async (args) => {
      calls++;
      sent = JSON.parse(args.body);
      return Response.json({
        id: 'fixture-material',
        model: stage.model_id,
        choices: [
          {
            message: {
              role: 'assistant',
              content: JSON.stringify({
                event_date: '2026-09-20',
                event_date_evidence: [{ fragment_id: 'fragment-1', quote: '2026-09-20' }],
                persons: [{ name: '李明', role: '研究作者', organization: '示例研究所', evidence }],
                organizations: ['示例研究所'],
                claim_evidence: [evidence],
                organization_identities: [
                  {
                    name: '示例研究所',
                    type: 'institution',
                    evidence: [{ fragment_id: 'fragment-1', quote: '示例研究所是一个研究机构。' }],
                  },
                ],
                topic_ids: ['topic-ai'],
              }),
            },
            finish_reason: 'stop',
          },
        ],
        usage: { prompt_tokens: 100, completion_tokens: 100 },
      });
    },
  });
  const result = await invoke({
    source: {
      ...source,
      fragments: source.fragments.map((f) => ({
        ...f,
        text: f.text + '示例研究所是一个研究机构。',
      })),
    },
    candidate,
    stage,
    connection,
    apiKey: 'synthetic-private-key',
    allowedHosts: ['api.provider.example.com'],
    materialContext: { topics: [{ id: 'topic-ai', title: 'Artificial Intelligence' }] },
  });
  assert.equal(result.success, true);
  assert.equal(calls, 1);
  assert.deepEqual(result.output.materialHints.topicIds, ['topic-ai']);
  assert.equal(result.output.candidate.title, candidate.title);
  assert.equal(result.output.candidate.claims[0].text, candidate.claims[0].text);
  assert.match(JSON.stringify(sent.messages), /enabled_topics/);
  assert.match(JSON.stringify(sent.response_format), /organization_identities/);
  assert.equal(sent.tools, undefined);
});

test('OpenRouter enrichment sends routing and reasoning controls and retains API cost', async () => {
  const posts = [];
  const invoke = createCandidateEnrichmentInvoker({
    resolve: async () => [{ address: '93.184.216.34', family: 4 }],
    request: async (args) => {
      if (args.method === 'GET')
        return Response.json({
          data: [
            {
              id: stage.model_id,
              supported_parameters: [
                'max_tokens',
                'structured_outputs',
                'response_format',
                'reasoning',
              ],
              reasoning: { mandatory: true, supported_efforts: ['low', 'high'] },
            },
          ],
        });
      posts.push(JSON.parse(args.body));
      return Response.json({
        id: 'fixture',
        model: stage.model_id,
        choices: [
          {
            message: {
              role: 'assistant',
              content: JSON.stringify({
                event_date: null,
                event_date_evidence: [],
                persons: [],
                organizations: [],
              }),
            },
            finish_reason: 'stop',
          },
        ],
        usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120, cost: 0.0002 },
      });
    },
  });
  const result = await invoke({
    source,
    candidate,
    stage,
    connection: { ...connection, base_url: 'https://openrouter.ai/api/v1' },
    apiKey: 'synthetic-private-key',
    allowedHosts: ['openrouter.ai'],
  });
  assert.equal(result.success, true);
  assert.equal(result.provider_cost_microusd, 200);
  assert.equal(posts.length, 1);
  assert.deepEqual(posts[0].provider, { require_parameters: true });
  assert.deepEqual(posts[0].reasoning, { exclude: true, effort: 'low' });
  assert.equal(posts[0].temperature, undefined);
});
