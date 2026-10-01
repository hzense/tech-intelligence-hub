import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeAutomationConfig } from '../../../packages/database/src/automation-contract.mjs';
import {
  discoveryWindow,
  discoveryUrl,
  parseDiscoveryResponse,
} from '../lib/source-discovery-core.ts';
import { createDiscoveryInvoker, discoveryEstimate } from '../lib/source-discovery-provider.ts';

const id = '11111111-1111-4111-8111-111111111111';
const config = {
  name: 'AI news',
  kind: 'source_collection',
  enabled: false,
  frequency: 'daily',
  sourceUrls: [],
  topicIds: ['topic-ai'],
  profileId: id,
  profileRevision: 1,
  discovery: { keywords: [], lookbackDays: 2, maxSources: 5 },
};
const window = discoveryWindow(config, '2026-09-30T01:00:00Z');
const article = (url = 'https://example.com/news', publishedAt = '2026-09-29') => ({
  url,
  title: '原始技术发布',
  publishedAt,
});
const envelope = (articles = [article()], annotations = articles.map((a) => a.url)) => ({
  choices: [
    {
      finish_reason: 'stop',
      message: {
        content: JSON.stringify({ articles }),
        annotations: annotations.map((url) => ({ type: 'url_citation', url_citation: { url } })),
      },
    },
  ],
  usage: { cost: 0.025, server_tool_use: { web_search_requests: 1 } },
});
test('discovery config needs topics, not URLs; legacy schedules retain their meaning', () => {
  assert.deepEqual(normalizeAutomationConfig(config), config);
  const legacy = { ...config };
  delete legacy.discovery;
  assert.equal(
    normalizeAutomationConfig({ ...legacy, sourceUrls: ['https://example.com'] }).discovery,
    undefined,
  );
  for (const patch of [
    { topicIds: [] },
    { sourceUrls: ['https://example.com'] },
    { profileId: null },
    { kind: 'topic_insight' },
    { discovery: { ...config.discovery, maxSources: 9 } },
    { discovery: { ...config.discovery, lookbackDays: 0 } },
    { discovery: { ...config.discovery, keywords: [''] } },
    { discovery: { ...config.discovery, keywords: ['a', 'a'] } },
    { discovery: { ...config.discovery, arbitraryInstruction: 'publish' } },
  ])
    assert.throws(() => normalizeAutomationConfig({ ...config, ...patch }));
});
test('only cited public recent originals survive; tracking variants and existing URLs deduplicate', () => {
  const articles = [
    article(),
    article('https://example.com/news?utm_source=x'),
    article('https://example.com/invented'),
    article('http://127.0.0.1/'),
    article('https://example.com/old', '2026-08-01'),
    article('https://example.com/future', '2026-10-01'),
  ];
  const result = parseDiscoveryResponse(
    envelope(
      articles,
      articles.filter((a) => !a.url.includes('invented')).map((a) => a.url),
    ),
    config,
    window,
    [],
  );
  assert.deepEqual(result.articles, [article()]);
  assert.equal(result.rejected, 4);
  assert.equal(result.duplicates, 1);
  assert.equal(
    parseDiscoveryResponse(envelope(), config, window, ['https://example.com/news']).articles
      .length,
    0,
  );
  assert.equal(discoveryUrl('https://user:secret@example.com/'), null);
});
test('no actual search, missing citations, malformed JSON and truncated outputs do not invent sources', () => {
  const noSearch = envelope();
  noSearch.usage.server_tool_use.web_search_requests = 0;
  assert.throws(() => parseDiscoveryResponse(noSearch, config, window, []), /search_unconfirmed/);
  assert.equal(
    parseDiscoveryResponse(envelope([article()], []), config, window, []).articles.length,
    0,
  );
  const malformed = envelope();
  malformed.choices[0].message.content = '<think>reason</think>';
  assert.throws(() => parseDiscoveryResponse(malformed, config, window, []), /invalid_output/);
  const truncated = envelope();
  truncated.choices[0].finish_reason = 'length';
  assert.throws(() => parseDiscoveryResponse(truncated, config, window, []), /invalid_output/);
  assert.deepEqual(parseDiscoveryResponse(envelope([]), config, window, []).articles, []);
});

const access = {
  apiKey: 'synthetic-test-secret',
  connection: {
    id,
    revision: 1,
    protocol: 'openai-compatible',
    base_url: 'https://openrouter.ai/api/v1',
    settings: {
      input_price_microusd_per_million: 1000000,
      output_price_microusd_per_million: 2000000,
    },
  },
  profile: {
    stages: { analyze: { connection_id: id, connection_revision: 1, model_id: 'test/model' } },
  },
};
function harness(response = envelope(), parameters = ['max_tokens', 'tools', 'tool_choice']) {
  const calls = [];
  let fenced = false;
  const invoke = createDiscoveryInvoker({
    resolve: async () => [{ address: '8.8.8.8', family: 4 }],
    request: async (request) => {
      calls.push(request);
      if (request.method === 'GET')
        return globalThis.Response.json({
          data: [{ id: 'test/model', supported_parameters: parameters, context_length: 128000 }],
        });
      assert.equal(fenced, true, 'paid request must follow persisted fence');
      if (response instanceof Error) throw response;
      return globalThis.Response.json(response);
    },
  });
  return {
    calls,
    run: (patch = {}) =>
      invoke({
        access,
        config,
        now: window.windowEnd,
        topics: [{ id: 'topic-ai', name: '人工智能' }],
        knownUrls: [],
        allowedHosts: ['openrouter.ai'],
        beforeCall: async () => {
          fenced = true;
        },
        ...patch,
      }),
  };
}
test('provider uses one bounded server-tool request with no credential or reasoning in receipts', async () => {
  const h = harness();
  const result = await h.run();
  assert.equal(h.calls.length, 2);
  const body = JSON.parse(h.calls[1].body);
  assert.equal(body.tools[0].type, 'openrouter:web_search');
  assert.equal(body.tools[0].parameters.engine, 'exa');
  assert.equal(body.tools[0].parameters.max_uses, 3);
  assert.equal(body.max_tool_calls, 3);
  assert.equal(body.reasoning.exclude, true);
  assert.equal(
    body.messages.some((m) => m.content.includes('人工智能')),
    true,
  );
  assert.equal(JSON.stringify(result).includes(access.apiKey), false);
  assert.equal(result.costMicrousd, 25000);
  assert.equal(result.costSource, 'provider');
});
test('cost receipt survives invalid output; missing cost uses bounded estimate', async () => {
  const bad = envelope();
  bad.choices[0].message.content = 'bad json';
  await assert.rejects(harness(bad).run(), (error) => error.called && error.costMicrousd === 25000);
  const missing = envelope();
  delete missing.usage.cost;
  const result = await harness(missing).run();
  assert.equal(result.costMicrousd, discoveryEstimate(access));
  assert.equal(result.costSource, 'estimate');
});
test('unsupported model and duplicate fence never call AI; network failure never retries', async () => {
  const unsupported = harness(envelope(), ['max_tokens']);
  await assert.rejects(
    unsupported.run(),
    (error) => !error.called && error.code === 'capability_failed',
  );
  assert.equal(unsupported.calls.length, 1);
  const duplicate = harness();
  await assert.rejects(
    duplicate.run({
      beforeCall: async () => {
        throw new Error('stale_attempt');
      },
    }),
    /stale_attempt/,
  );
  assert.equal(duplicate.calls.length, 1);
  const failed = harness(new Error('network_error'));
  await assert.rejects(failed.run(), (error) => error.called && error.costMicrousd === null);
  assert.equal(failed.calls.length, 2);
});
