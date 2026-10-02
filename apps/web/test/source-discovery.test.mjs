import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeAutomationConfig } from '../../../packages/database/src/automation-contract.mjs';
import {
  discoveryWindow,
  discoveryUrl,
  discoveryTopics,
  parseDiscoveryResponse,
} from '../lib/source-discovery-core.ts';
import { createDiscoveryInvoker, discoveryEstimate } from '../lib/source-discovery-provider.ts';
import {
  readDiscoveryDiagnostics,
  discoveryDiagnosticItems,
} from '../lib/source-discovery-diagnostics.ts';

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
test('discovery config permits no topic filter; insight and legacy contracts remain intact', () => {
  assert.deepEqual(normalizeAutomationConfig(config), config);
  assert.deepEqual(normalizeAutomationConfig({ ...config, topicIds: [] }).topicIds, []);
  const legacy = { ...config };
  delete legacy.discovery;
  assert.equal(
    normalizeAutomationConfig({ ...legacy, sourceUrls: ['https://example.com'] }).discovery,
    undefined,
  );
  for (const patch of [
    { topicIds: Array.from({ length: 6 }, (_, i) => `topic-${i}`) },
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
  assert.throws(() =>
    normalizeAutomationConfig({ ...legacy, kind: 'topic_insight', topicIds: [] }),
  );
});
test('unspecified topics use every taxonomy root; explicit filters do not silently broaden', () => {
  const catalog = [
    { id: 'topic-ai', name: '人工智能', parentId: null },
    { id: 'topic-agents', name: '智能体', parentId: 'topic-ai' },
    { id: 'topic-chips', name: '半导体', parentId: null },
  ];
  assert.deepEqual(discoveryTopics([], catalog), [
    { id: 'topic-ai', name: '人工智能' },
    { id: 'topic-chips', name: '半导体' },
  ]);
  assert.deepEqual(discoveryTopics(['topic-agents'], catalog), [
    { id: 'topic-agents', name: '智能体' },
  ]);
  assert.throws(() => discoveryTopics(['unknown'], catalog), /discovery_topic_invalid/);
  assert.throws(() => discoveryTopics([], []), /discovery_topic_invalid/);
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
  assert.equal(result.searchEvidence, 'search_count');
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
  assert.throws(() => parseDiscoveryResponse(truncated, config, window, []), /output_truncated/);
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
  assert.equal(body.tool_choice, 'required');
  assert.equal(body.max_tokens, 2048);
  assert.equal(body.tools.length, 1);
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

test('malformed, zero and over-limit search receipts still fail even with valid citations', () => {
  for (const [value, status, saved] of [
    [null, 'invalid', null],
    ['1', 'invalid', null],
    [{ secret: 'private' }, 'invalid', null],
    [true, 'invalid', null],
    [-1, 'invalid', null],
    [1.5, 'invalid', null],
    [NaN, 'invalid', null],
    [Infinity, 'invalid', null],
    [Number.MAX_SAFE_INTEGER + 1, 'invalid', null],
    [0, 'zero', 0],
    [4, 'exceeded', 4],
  ]) {
    const body = envelope();
    body.usage.server_tool_use.web_search_requests = value;
    const diagnostics = readDiscoveryDiagnostics(body);
    assert.equal(diagnostics.searchCountStatus, status);
    assert.equal(diagnostics.searchRequests, saved);
    assert.throws(() => parseDiscoveryResponse(body, config, window, []), /search_unconfirmed/);
  }
  for (const value of [1, 2, 3]) {
    const body = envelope();
    body.usage.server_tool_use.web_search_requests = value;
    assert.equal(parseDiscoveryResponse(body, config, window, []).searchRequests, value);
  }
});

test('only an absent counter with valid provider citations enables the compatibility path', () => {
  for (const usage of [undefined, {}, { cost: 0.025 }, { server_tool_use: {} }]) {
    const body = envelope();
    body.usage = usage;
    const diagnostics = readDiscoveryDiagnostics(body);
    assert.equal(diagnostics.searchCountStatus, 'missing');
    assert.equal(diagnostics.searchRequests, null);
    const result = parseDiscoveryResponse(body, config, window, []);
    assert.deepEqual(result.articles, [article()]);
    assert.equal(result.searchRequests, null);
    assert.equal(result.searchEvidence, 'provider_url_citations');
    assert.equal(JSON.parse(JSON.stringify(result)).searchRequests, null);
  }
});

test('missing counters do not accept body URLs, arbitrary annotations or unsafe citation URLs', () => {
  for (const annotations of [
    undefined,
    [],
    Array.from({ length: 8 }, () => ({ type: 'other', url_citation: { url: article().url } })),
    [null, 'https://example.com/news', { url: article().url }, { type: 'url_citation' }],
    ...[
      'http://127.0.0.1/',
      'http://169.254.169.254/latest/meta-data/',
      'https://localhost/news',
      'https://user:password@example.com/news',
      'file:///etc/passwd',
      'javascript:alert(1)',
    ].map((url) => [{ type: 'url_citation', url_citation: { url } }]),
  ]) {
    const body = envelope();
    delete body.usage.server_tool_use;
    body.choices[0].message.annotations = annotations;
    assert.throws(() => parseDiscoveryResponse(body, config, window, []), /search_unconfirmed/);
  }
});

test('malformed usage containers are not misclassified as missing search counters', () => {
  for (const value of [null, false, [], 'private usage', 1]) {
    for (const usage of [value, { server_tool_use: value }]) {
      const body = envelope();
      body.usage = usage;
      assert.equal(readDiscoveryDiagnostics(body).searchCountStatus, 'invalid');
      assert.throws(() => parseDiscoveryResponse(body, config, window, []), /search_unconfirmed/);
    }
  }
});

test('one valid provider citation suffices among unrelated or invalid annotations', () => {
  const body = envelope();
  delete body.usage.server_tool_use;
  body.choices[0].message.annotations.unshift(
    null,
    { type: 'other', url_citation: { url: article().url } },
    { type: 'url_citation', url_citation: { url: 'http://127.0.0.1/private' } },
  );
  const result = parseDiscoveryResponse(body, config, window, []);
  assert.deepEqual(result.articles, [article()]);
  assert.equal(result.searchEvidence, 'provider_url_citations');
  assert.equal(result.searchRequests, null);
});

test('citation fallback retains URL matching, time window, deduplication and result limits', () => {
  const articles = [
    article(),
    article('https://example.com/news?utm_source=x'),
    article('https://example.com/uncited'),
    article('https://example.com/old', '2026-08-01'),
    article('https://example.com/future', '2026-10-01'),
    article('https://example.com/known'),
    article('https://example.com/second'),
  ];
  const body = envelope(
    articles,
    articles.filter((a) => !a.url.endsWith('uncited')).map((a) => a.url),
  );
  delete body.usage.server_tool_use;
  const result = parseDiscoveryResponse(
    body,
    { ...config, discovery: { ...config.discovery, maxSources: 1 } },
    window,
    ['https://example.com/known'],
  );
  assert.deepEqual(result.articles, [article()]);
  assert.equal(result.rejected, 3);
  assert.equal(result.duplicates, 2);
  assert.equal(result.searchRequests, null);
  assert.equal(result.searchEvidence, 'provider_url_citations');
  const empty = envelope([], [article().url]);
  delete empty.usage.server_tool_use;
  assert.deepEqual(parseDiscoveryResponse(empty, config, window, []).articles, []);
});

test('missing counters cannot bypass strict JSON or annotation shape validation', () => {
  for (const content of [
    'bad json',
    '```json\n{"articles":[]}\n```',
    '{}',
    '{"articles":[],"other":true}',
    '{"articles":null}',
  ]) {
    const body = envelope();
    delete body.usage.server_tool_use;
    body.choices[0].message.content = content;
    assert.throws(() => parseDiscoveryResponse(body, config, window, []), /invalid_output/);
  }
  const body = envelope();
  delete body.usage.server_tool_use;
  body.choices[0].message.annotations = { url_citation: { url: article().url } };
  assert.throws(() => parseDiscoveryResponse(body, config, window, []), /invalid_output/);
});

test('citation fallback preserves the unknown count, provider cost and single paid request', async () => {
  const body = envelope();
  delete body.usage.server_tool_use;
  for (const cost of [0, 0.0077, undefined]) {
    body.usage.cost = cost;
    const h = harness(body);
    const receipt = await h.run();
    assert.equal(receipt.result.searchRequests, null);
    assert.equal(receipt.result.searchEvidence, 'provider_url_citations');
    assert.equal(receipt.diagnostics.searchCountStatus, 'missing');
    assert.equal(receipt.diagnostics.searchRequests, null);
    assert.equal(
      receipt.costMicrousd,
      cost === undefined ? discoveryEstimate(access) : Math.round(cost * 1_000_000),
    );
    assert.equal(receipt.costSource, cost === undefined ? 'estimate' : 'provider');
    assert.equal(h.calls.filter((call) => call.method === 'POST').length, 1);
  }
});

test('explicit provider errors and truncation are not masked by missing search counts', async () => {
  const truncated = envelope();
  delete truncated.usage.server_tool_use;
  truncated.choices[0].finish_reason = 'length';
  for (const [body, code] of [
    [truncated, 'discovery_output_truncated'],
    [
      { error: { code: 429, message: 'private provider message' }, usage: { cost: 0.01 } },
      'discovery_provider_error',
    ],
    [
      { choices: [{ finish_reason: 'error', error: { code: 502, message: 'private' } }] },
      'discovery_provider_error',
    ],
    [{ choices: {} }, 'discovery_invalid_output'],
    [{ choices: [null] }, 'discovery_invalid_output'],
    [[], 'discovery_invalid_output'],
  ]) {
    const h = harness(body);
    await assert.rejects(h.run(), (error) => {
      assert.equal(error.code, code);
      assert.equal(error.called, true);
      assert.equal(error.diagnostics.searchCountStatus, 'missing');
      assert.equal(JSON.stringify(error).includes('private'), false);
      return true;
    });
    assert.equal(h.calls.filter((call) => call.method === 'POST').length, 1);
  }
});

test('failed receipts persist only allowlisted diagnostics and provider cost, including zero', async () => {
  const body = envelope();
  body.id = 'gen-1790970223-AbCd01234567';
  delete body.usage.server_tool_use;
  body.choices[0].message.content = `private answer ${access.apiKey}`;
  body.choices[0].message.reasoning = 'private thinking';
  body.choices[0].message.annotations[0].url_citation.url = 'https://private.invalid/source';
  for (const cost of [0, 0.0642, undefined]) {
    body.usage.cost = cost;
    const h = harness(body);
    await assert.rejects(h.run(), (error) => {
      assert.equal(error.code, 'discovery_invalid_output');
      assert.equal(error.costMicrousd, cost === undefined ? null : Math.round(cost * 1_000_000));
      assert.deepEqual(error.diagnostics, {
        version: 1,
        responseId: body.id,
        searchRequests: null,
        searchCountStatus: 'missing',
        finishReason: 'stop',
        choiceCount: 1,
        annotationCount: 1,
        providerError: false,
        providerErrorCode: null,
      });
      const saved = JSON.stringify(error);
      for (const secret of [access.apiKey, 'private answer', 'private thinking', 'private.invalid'])
        assert.equal(saved.includes(secret), false);
      return true;
    });
    assert.equal(h.calls.length, 2, 'one catalog check and one paid attempt; no auto retry');
  }
});

test('diagnostic readback omits untrusted fields and handles legacy or malformed records', () => {
  assert.deepEqual(discoveryDiagnosticItems(undefined), []);
  assert.deepEqual(discoveryDiagnosticItems({ version: 2 }), []);
  const diagnostics = readDiscoveryDiagnostics({
    id: 'secret-value',
    choices: [{ finish_reason: 'private reason', message: { annotations: 'private' } }],
    error: { code: 'private code', message: 'private error' },
  });
  assert.equal(diagnostics.responseId, null);
  assert.equal(diagnostics.finishReason, 'other');
  assert.equal(diagnostics.providerErrorCode, null);
  assert.equal(diagnostics.annotationCount, null);
  assert.equal(JSON.stringify(diagnostics).includes('private'), false);
  const items = discoveryDiagnosticItems({
    ...diagnostics,
    searchCountStatus: { toString: null },
    rawBody: 'private',
  });
  assert.ok(items.includes('搜索回执：搜索回执不可读'));
  assert.equal(items.join('').includes('private'), false);
});
