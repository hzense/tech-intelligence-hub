import assert from 'node:assert/strict';
import test from 'node:test';
import { Buffer } from 'node:buffer';
import { EventEmitter } from 'node:events';
import { setTimeout, clearTimeout } from 'node:timers';
import { createAiProbeInvoker, aiProbeSentinel, validAiModelId } from '../lib/ai-provider.ts';
import {
  validateAiBaseUrl,
  isPublicAiAddress,
  createPinnedAiFetch,
  pinnedAiRequestOptions,
  createAiWireRequest,
  aiResponseMaximumBytes,
  AiProbeError,
} from '../lib/ai-provider-transport.ts';
const { Response, AbortController, AbortSignal, URL, queueMicrotask } = globalThis;
const apiKey = 'synthetic-probe-key-only';
const baseUrl = 'https://api.provider.example.com/v1';
const allowedHosts = ['api.provider.example.com'];
const fixture = (kind = 'connection') => ({
  connection: {
    id: 'fixture',
    revision: 1,
    protocol: 'openai-compatible',
    base_url: baseUrl,
    settings: { timeout_ms: 3000 },
  },
  apiKey,
  kind,
  modelId: 'provider/fixture-model',
  allowedHosts,
});
const resolve = async () => [{ address: '93.184.216.34', family: 4 }];
const response = (message, extra = {}) =>
  Response.json({
    id: 'synthetic-response',
    model: 'provider/fixture-model',
    choices: [{ message: { role: 'assistant', content: message }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 11, completion_tokens: 5, total_tokens: 16 },
    ...extra,
  });
const config = () => ({ baseUrl, allowedHosts, apiKey, signal: new AbortController().signal });

test('base URL rejects authority, normalization, path and server allowlist bypasses', () => {
  assert.equal(validateAiBaseUrl(baseUrl, allowedHosts).hostname, allowedHosts[0]);
  assert.equal(validateAiBaseUrl(`${baseUrl}/`, allowedHosts).pathname, '/v1');
  assert.equal(validateAiBaseUrl('https://api.provider.example.com:443/v1', allowedHosts).port, '');
  for (const value of [
    'http://api.provider.example.com/v1',
    'https://127.0.0.1/v1',
    'https://2130706433/v1',
    'https://0x7f000001/v1',
    'https://[::1]/v1',
    'https://user:pass@api.provider.example.com/v1',
    `${baseUrl}?key=x`,
    `${baseUrl}#fragment`,
    `${baseUrl}/../v2`,
    `${baseUrl}//other`,
    'https://api.provider.example.com:444/v1',
    'https://api.provider.example.com:0443/v1',
    'https://api.provider.example.com./v1',
    'https://API.provider.example.com/v1',
    'https://api.provider.example.com.evil.com/v1',
    'https://api%2eprovider.example.com/v1',
    'https://api.provider.example.com\\@evil.com/v1',
    `${baseUrl}/%2e%2e`,
    `${baseUrl}\n`,
    'https://localhost/v1',
    'https://metadata.google.internal/v1',
  ])
    assert.throws(() => validateAiBaseUrl(value, allowedHosts), AiProbeError, value);
  for (const list of [
    [],
    ['*.example.com'],
    ['localhost'],
    ['127.0.0.1'],
    ['x.local'],
    ['x.internal'],
  ])
    assert.throws(() => validateAiBaseUrl(baseUrl, list), AiProbeError);
});

test('globally routable classifier rejects IPv4/IPv6 private, reserved, mapped and metadata ranges', () => {
  for (const address of [
    '93.184.216.34',
    '8.8.8.8',
    '1.1.1.1',
    '2606:4700:4700::1111',
    '2001:4860:4860::8888',
  ])
    assert.equal(isPublicAiAddress(address), true, address);
  for (const address of [
    '0.0.0.0',
    '10.1.2.3',
    '127.0.0.1',
    '169.254.169.254',
    '100.100.100.200',
    '172.16.0.1',
    '192.168.1.1',
    '192.0.0.192',
    '192.0.2.1',
    '198.18.0.1',
    '198.51.100.3',
    '203.0.113.4',
    '224.0.0.1',
    '255.255.255.255',
    '168.63.129.16',
    '::',
    '::1',
    'fc00::1',
    'fe80::1',
    '::ffff:127.0.0.1',
    '::ffff:8.8.8.8',
    '64:ff9b::808:808',
    '2001:db8::1',
    '2002:0808:0808::1',
    '2001::1',
    '3fff::1',
    'ff00::1',
    'fe80::1%en0',
    'not-an-ip',
  ])
    assert.equal(isPublicAiAddress(address), false, address);
});

test('all DNS answers are checked and request lookup remains pinned with TLS identity intact', async () => {
  let requests = 0;
  const blocked = createPinnedAiFetch(config(), {
    resolve: async () => [
      { address: '93.184.216.34', family: 4 },
      { address: '::ffff:127.0.0.1', family: 6 },
    ],
    request: async () => {
      requests++;
      return Response.json({ data: [] });
    },
  });
  await assert.rejects(() => blocked(`${baseUrl}/models`), { code: 'blocked_target' });
  assert.equal(requests, 0);
  let resolutions = 0;
  const pinned = createPinnedAiFetch(config(), {
    resolve: async () => {
      resolutions++;
      return resolve();
    },
    request: async (input) => {
      requests++;
      const options = pinnedAiRequestOptions(input);
      assert.equal(options.hostname, allowedHosts[0]);
      assert.equal(options.servername, allowedHosts[0]);
      assert.equal(options.rejectUnauthorized, true);
      assert.equal(options.agent, false);
      assert.equal(options.port, 443);
      assert.equal(options.family, 4);
      assert.equal(options.headers.Authorization, `Bearer ${apiKey}`);
      options.lookup('attacker-rebinding.example.com', { all: false }, (error, address, family) => {
        assert.equal(error, null);
        assert.equal(address, '93.184.216.34');
        assert.equal(family, 4);
      });
      options.lookup(allowedHosts[0], { all: true }, (error, addresses) => {
        assert.equal(error, null);
        assert.deepEqual(addresses, [{ address: '93.184.216.34', family: 4 }]);
      });
      return Response.json({ data: [] });
    },
  });
  await pinned(`${baseUrl}/models`);
  assert.equal(resolutions, 1);
  assert.equal(requests, 1);
});

test('SDK fetch cannot move credentials to another endpoint, origin, query or redirect', async () => {
  let calls = 0;
  const transport = createPinnedAiFetch(config(), {
    resolve,
    request: async () => {
      calls++;
      return Response.json({ data: [] });
    },
  });
  for (const [url, init] of [
    ['https://evil.example.com/v1/models'],
    [`${baseUrl}/models?x=1`],
    [`${baseUrl}/responses`, { method: 'POST', body: '{}' }],
    [`${baseUrl}/models`, { method: 'POST', body: '{}' }],
    [`${baseUrl}/chat/completions`],
    [`${baseUrl}/%2e%2e/models`],
  ])
    await assert.rejects(() => transport(url, init), { code: 'blocked_target' });
  assert.equal(calls, 0);
  const redirects = createPinnedAiFetch(config(), {
    resolve,
    request: async () =>
      new Response(null, { status: 302, headers: { location: 'https://evil.example.com' } }),
  });
  await assert.rejects(() => redirects(`${baseUrl}/models`), { code: 'redirect_blocked' });
});

test('transport keeps probe request limits and separately bounds generation before DNS or wire calls', async () => {
  for (const [requestPurpose, maximum] of [
    [undefined, 32768],
    ['probe', 32768],
    ['signal-generation', 3 * 1024 * 1024],
    ['candidate-enrichment', 256 * 1024],
  ]) {
    let dnsCalls = 0;
    let wireCalls = 0;
    const transport = createPinnedAiFetch(
      { ...config(), requestPurpose },
      {
        resolve: async () => {
          dnsCalls++;
          return resolve();
        },
        request: async () => {
          wireCalls++;
          return Response.json({ data: [] });
        },
      },
    );
    await assert.rejects(
      () =>
        transport(`${baseUrl}/chat/completions`, {
          method: 'POST',
          body: 'x'.repeat(maximum + 1),
        }),
      { code: 'invalid_configuration' },
    );
    assert.equal(dnsCalls, 0);
    assert.equal(wireCalls, 0);
    await transport(`${baseUrl}/chat/completions`, { method: 'POST', body: 'x'.repeat(maximum) });
    assert.equal(dnsCalls, 1);
    assert.equal(wireCalls, 1);
  }
});

test('transport bounds responses and redacts echoed keys including JSON escapes', async () => {
  const huge = createPinnedAiFetch(config(), {
    resolve,
    request: async () => new Response('x'.repeat(aiResponseMaximumBytes + 1)),
  });
  await assert.rejects(() => huge(`${baseUrl}/models`), { code: 'response_too_large' });
  const quotedKey = 'synthetic-"quoted-key';
  const transport = createPinnedAiFetch(
    { ...config(), apiKey: quotedKey },
    {
      resolve,
      request: async () =>
        Response.json({ value: quotedKey, nested: JSON.stringify({ key: quotedKey }) }),
    },
  );
  const text = await (await transport(`${baseUrl}/models`)).text();
  assert.equal(text.includes(quotedKey), false);
  assert.equal(text.includes(JSON.stringify(quotedKey).slice(1, -1)), false);
  const decoded = JSON.parse(text);
  assert.equal(JSON.parse(decoded.nested).key, '[REDACTED]');
  const deep = JSON.stringify({ key: JSON.stringify({ key: quotedKey }) });
  const nested = createPinnedAiFetch(
    { ...config(), apiKey: quotedKey },
    { resolve, request: async () => Response.json({ value: deep, [quotedKey]: quotedKey }) },
  );
  const cleaned = await (await nested(`${baseUrl}/models`)).json();
  assert.equal(JSON.parse(JSON.parse(cleaned.value).key).key, '[REDACTED]');
  assert.equal(cleaned['[REDACTED]'], '[REDACTED]');
  for (const invalid of ['not-json', '{"value":', new Uint8Array([0xff, 0xfe])]) {
    const broken = createPinnedAiFetch(config(), {
      resolve,
      request: async () => new Response(invalid),
    });
    await assert.rejects(() => broken(`${baseUrl}/models`), { code: 'invalid_response' });
  }
});

test('native HTTPS streaming rejects redirect/error bodies and oversized/incomplete responses', async () => {
  const run = async ({ status = 200, headers = {}, chunks = ['{}'], abort = false } = {}) => {
    let requests = 0;
    let bytesEmitted = 0;
    let requestDestroyed = false;
    let responseDestroyed = false;
    const native = (options, onResponse) => {
      requests++;
      assert.equal(options.rejectUnauthorized, true);
      assert.equal(options.agent, false);
      const request = new EventEmitter();
      request.destroy = () => {
        requestDestroyed = true;
      };
      request.end = () =>
        queueMicrotask(() => {
          const stream = new EventEmitter();
          stream.statusCode = status;
          stream.headers = { 'content-type': 'application/json', ...headers };
          stream.destroy = () => {
            responseDestroyed = true;
          };
          onResponse(stream);
          for (const chunk of chunks) {
            if (responseDestroyed) break;
            const buffer = Buffer.from(chunk);
            bytesEmitted += buffer.length;
            stream.emit('data', buffer);
          }
          if (!responseDestroyed) stream.emit(abort ? 'aborted' : 'end');
        });
      return request;
    };
    const wire = createAiWireRequest(native);
    let response;
    let error;
    try {
      response = await wire({
        url: new URL(`${baseUrl}/models`),
        address: (await resolve())[0],
        method: 'GET',
        body: undefined,
        apiKey,
        signal: new AbortController().signal,
      });
    } catch (caught) {
      error = caught;
    }
    return { response, error, requests, bytesEmitted, requestDestroyed, responseDestroyed };
  };
  const good = await run();
  assert.equal(await good.response.text(), '{}');
  assert.equal(good.requests, 1);
  for (const [options, code] of [
    [{ status: 302 }, 'redirect_blocked'],
    [{ status: 429 }, 'provider_rejected'],
    [{ status: 204 }, 'invalid_response'],
    [{ headers: { 'content-type': 'text/html' } }, 'invalid_response'],
    [{ headers: { 'content-encoding': 'gzip' } }, 'invalid_response'],
    [{ headers: { 'content-length': String(aiResponseMaximumBytes + 1) } }, 'response_too_large'],
  ]) {
    const result = await run(options);
    assert.equal(result.error.code, code);
    assert.equal(result.requests, 1);
    assert.equal(result.bytesEmitted, 0);
    assert.equal(result.requestDestroyed, true);
    assert.equal(result.responseDestroyed, true);
  }
  const oversized = await run({ chunks: ['x'.repeat(aiResponseMaximumBytes), 'y', 'not-read'] });
  assert.equal(oversized.error.code, 'response_too_large');
  assert.equal(oversized.bytesEmitted, aiResponseMaximumBytes + 1);
  assert.equal(oversized.requestDestroyed, true);
  assert.equal(oversized.responseDestroyed, true);
  assert.equal((await run({ abort: true })).error.code, 'network_error');
});

test('native HTTPS abort destroys the socket and never opens a request after cancellation', async () => {
  let calls = 0;
  let destroyed = false;
  const wire = createAiWireRequest(() => {
    calls++;
    const request = new EventEmitter();
    request.destroy = () => {
      destroyed = true;
    };
    request.end = () => {};
    return request;
  });
  const controller = new AbortController();
  const input = {
    url: new URL(`${baseUrl}/models`),
    address: (await resolve())[0],
    method: 'GET',
    body: undefined,
    apiKey,
    signal: controller.signal,
  };
  const pending = wire(input);
  controller.abort();
  await assert.rejects(() => pending, { code: 'timeout' });
  assert.equal(destroyed, true);
  assert.equal(calls, 1);
  await assert.rejects(() => wire(input), { code: 'timeout' });
  assert.equal(calls, 1);
});

test('models only returns bounded strict IDs, not arbitrary provider metadata', async () => {
  let calls = 0;
  const invoke = createAiProbeInvoker({
    resolve,
    request: async (request) => {
      calls++;
      assert.equal(request.method, 'GET');
      assert.equal(request.url.pathname, '/v1/models');
      return Response.json({
        data: Array.from({ length: 250 }, (_, index) => ({
          id: `vendor/model-${index}`,
          secret: apiKey,
        })),
      });
    },
  });
  const result = await invoke(fixture('models'));
  assert.equal(result.success, true);
  assert.equal(result.model_id, null);
  assert.equal(result.result.count, 200);
  assert.equal(result.result.truncated, true);
  assert.equal(result.result.models.length, 200);
  assert.equal(result.input_tokens, null);
  assert.equal(JSON.stringify(result).includes(apiKey), false);
  assert.equal(calls, 1);
  assert.ok(Buffer.byteLength(JSON.stringify(result.result)) < 16384);
  for (const id of [
    '',
    'has space',
    'id\n',
    '~',
    '~~vendor/model',
    '~vendor/~model',
    '~vendor/model+variant',
    '~vendor/model\n',
    'x'.repeat(201),
    apiKey,
  ]) {
    const invalid = createAiProbeInvoker({
      resolve,
      request: async () => Response.json({ data: [{ id }] }),
    });
    assert.equal((await invalid(fixture('models'))).success, false);
  }
  assert.equal(validAiModelId('provider/fixture-model:variant'), true);
  const duplicates = createAiProbeInvoker({
    resolve,
    request: async () => Response.json({ data: [{ id: 'vendor/model' }, { id: 'vendor/model' }] }),
  });
  assert.deepEqual((await duplicates(fixture('models'))).result, {
    models: [{ id: 'vendor/model' }],
    count: 1,
    truncated: false,
  });
  const longIds = createAiProbeInvoker({
    resolve,
    request: async () =>
      Response.json({
        data: Array.from({ length: 100 }, (_, i) => ({ id: `${i}`.padEnd(200, 'x') })),
      }),
  });
  const bounded = await longIds(fixture('models'));
  assert.equal(bounded.result.truncated, true);
  assert.equal(bounded.result.count, 60);
  assert.ok(Buffer.byteLength(JSON.stringify(bounded.result)) < 16384);
});

test('catalog aliases retain a single leading tilde through parsing and exact model invocation', async () => {
  const aliases = [
    '~openai/gpt-astra-latest',
    '~openai/gpt-sol-latest',
    '~openai/gpt-terra-latest',
    '~openai/gpt-luna-latest',
  ];
  const models = [
    { id: 'provider/fixture-model' },
    { id: 'provider/another-model' },
    ...aliases.map((id) => ({ id })),
  ];
  let directoryCalls = 0;
  const directory = createAiProbeInvoker({
    resolve,
    request: async (request) => {
      directoryCalls++;
      assert.equal(request.method, 'GET');
      assert.equal(request.url.pathname, '/v1/models');
      return Response.json({ data: models });
    },
  });
  const listed = await directory(fixture('models'));
  assert.equal(listed.success, true);
  assert.deepEqual(listed.result, { models, count: models.length, truncated: false });
  assert.equal(directoryCalls, 1);

  const requestedModels = [];
  const invoke = createAiProbeInvoker({
    resolve,
    request: async (request) => {
      assert.equal(request.method, 'POST');
      assert.equal(request.url.pathname, '/v1/chat/completions');
      const body = JSON.parse(request.body);
      requestedModels.push(body.model);
      return response(aiProbeSentinel, { model: body.model });
    },
  });
  for (const modelId of aliases) {
    assert.equal(validAiModelId(modelId), true);
    const result = await invoke({ ...fixture(), modelId });
    assert.equal(result.success, true);
    assert.equal(result.model_id, modelId);
  }
  assert.deepEqual(requestedModels, aliases);
});

test('invalid configuration and model IDs fail before any DNS or HTTP work', async () => {
  let resolutions = 0;
  let requests = 0;
  const invoke = createAiProbeInvoker({
    resolve: async () => {
      resolutions++;
      return resolve();
    },
    request: async () => {
      requests++;
      return response(aiProbeSentinel);
    },
  });
  for (const modelId of [
    undefined,
    '',
    'x'.repeat(201),
    'vendor/model\n',
    '~',
    '~~vendor/model',
    '~vendor/~model',
    '~vendor/model\n',
    apiKey,
  ]) {
    const result = await invoke({ ...fixture(), modelId });
    assert.equal(result.success, false);
    assert.equal(result.error_code, 'invalid_model');
    assert.equal(result.model_id, null);
  }
  for (const patch of [
    { protocol: 'unknown' },
    { settings: { timeout_ms: 2999 } },
    { settings: { timeout_ms: 20001 } },
    { settings: { timeout_ms: 3500.5 } },
  ])
    assert.equal(
      (await invoke({ ...fixture(), connection: { ...fixture().connection, ...patch } }))
        .error_code,
      'invalid_configuration',
    );
  for (const key of ['', 'short', 'synthetic-key\r\ninjected', 'x'.repeat(4097)])
    assert.equal((await invoke({ ...fixture(), apiKey: key })).error_code, 'invalid_configuration');
  assert.equal(resolutions, 0);
  assert.equal(requests, 0);
});

test('DNS failures and mixed invalid answers do not fall back to another resolver or address', async () => {
  let requests = 0;
  for (const answers of [
    [],
    [{ address: '93.184.216.34', family: 6 }],
    [
      { address: '93.184.216.34', family: 4 },
      { address: '10.0.0.1', family: 4 },
    ],
    Array.from({ length: 65 }, () => ({ address: '93.184.216.34', family: 4 })),
  ]) {
    const invoke = createAiProbeInvoker({
      resolve: async () => answers,
      request: async () => {
        requests++;
        return response(aiProbeSentinel);
      },
    });
    assert.equal((await invoke(fixture())).error_code, 'blocked_target');
  }
  const broken = createAiProbeInvoker({
    resolve: async () => {
      throw Error(`untrusted ${apiKey}`);
    },
    request: async () => {
      requests++;
      return response(aiProbeSentinel);
    },
  });
  const failed = await broken(fixture());
  assert.equal(failed.error_code, 'dns_failed');
  assert.equal(JSON.stringify(failed).includes(apiKey), false);
  assert.equal(requests, 0);
});

test('connection uses current SDK once, fixed sentinel, 2048 tokens and no automatic fallback', async () => {
  let calls = 0;
  const invoke = createAiProbeInvoker({
    resolve,
    request: async (request) => {
      calls++;
      const body = JSON.parse(request.body);
      assert.equal(request.url.pathname, '/v1/chat/completions');
      assert.equal(body.model, 'provider/fixture-model');
      assert.equal(body.max_tokens, 2048);
      assert.equal(body.stream, undefined);
      assert.equal(body.messages.at(-1).content.includes(aiProbeSentinel), true);
      return response(aiProbeSentinel);
    },
  });
  assert.deepEqual(await invoke(fixture()), {
    success: true,
    model_id: 'provider/fixture-model',
    input_tokens: 11,
    output_tokens: 5,
    result: { sentinel_matched: true },
  });
  assert.equal(calls, 1);
  calls = 0;
  const failing = createAiProbeInvoker({
    resolve,
    request: async () => {
      calls++;
      return new Response(apiKey, { status: 503 });
    },
  });
  const result = await failing(fixture());
  assert.equal(result.success, false);
  assert.equal(calls, 1);
  assert.equal(JSON.stringify(result).includes(apiKey), false);
});

test('OpenRouter probes share catalog routing and keep their budgeted output limit', async () => {
  let posts = 0;
  const input = fixture('structured_output');
  input.connection.base_url = 'https://openrouter.ai/api/v1';
  input.allowedHosts = ['openrouter.ai'];
  const invoke = createAiProbeInvoker({
    resolve,
    request: async (request) => {
      if (request.url.pathname.endsWith('/models'))
        return Response.json({
          data: [
            {
              id: input.modelId,
              supported_parameters: [
                'max_tokens',
                'response_format',
                'structured_outputs',
                'reasoning',
              ],
              reasoning: { mandatory: true, supported_efforts: ['low', 'high'] },
            },
          ],
        });
      posts++;
      const body = JSON.parse(request.body);
      assert.deepEqual(body.provider, { require_parameters: true });
      assert.deepEqual(body.reasoning, { exclude: true, effort: 'low' });
      assert.equal(body.max_tokens, 2048);
      assert.equal(body.temperature, undefined);
      assert.equal(body.response_format.json_schema.schema.properties.ok.enum, undefined);
      const returned = await response(
        JSON.stringify({ sentinel: aiProbeSentinel, ok: true }),
      ).json();
      returned.usage.cost = 0.001234;
      return Response.json(returned);
    },
  });
  const result = await invoke(input);
  assert.equal(result.success, true);
  assert.equal(result.provider_cost_microusd, 1234);
  assert.equal(posts, 1);
});

test('structured output sends real json_schema and requires exact validated sentinel object', async () => {
  let calls = 0;
  const invoke = createAiProbeInvoker({
    resolve,
    request: async (request) => {
      calls++;
      const body = JSON.parse(request.body);
      assert.equal(body.response_format.type, 'json_schema');
      assert.equal(body.response_format.json_schema.schema.additionalProperties, false);
      assert.deepEqual(body.response_format.json_schema.schema.properties.sentinel.enum, [
        aiProbeSentinel,
      ]);
      return response(JSON.stringify({ sentinel: aiProbeSentinel, ok: true }));
    },
  });
  assert.equal((await invoke(fixture('structured_output'))).success, true);
  assert.equal(calls, 1);
  for (const content of [
    aiProbeSentinel,
    JSON.stringify({ sentinel: aiProbeSentinel, ok: false }),
    JSON.stringify({ sentinel: aiProbeSentinel, ok: true, extra: 'unvalidated' }),
  ]) {
    const bad = createAiProbeInvoker({ resolve, request: async () => response(content) });
    const failed = await bad(fixture('structured_output'));
    assert.equal(failed.success, false);
    assert.equal(failed.input_tokens, 11);
    assert.equal(failed.output_tokens, 5);
  }
});

test('tool capability needs an actual single echo call with strict input and never executes model tools', async () => {
  let calls = 0;
  const toolResponse = (name = 'echo', args = { sentinel: aiProbeSentinel, ok: true }) =>
    response(null, {
      choices: [
        {
          message: {
            role: 'assistant',
            content: null,
            tool_calls: [
              {
                id: 'probe-call',
                type: 'function',
                function: { name, arguments: JSON.stringify(args) },
              },
            ],
          },
          finish_reason: 'tool_calls',
        },
      ],
    });
  const invoke = createAiProbeInvoker({
    resolve,
    request: async (request) => {
      calls++;
      const body = JSON.parse(request.body);
      assert.equal(body.tools.length, 1);
      assert.equal(body.tools[0].function.name, 'echo');
      assert.deepEqual(body.tool_choice, { type: 'function', function: { name: 'echo' } });
      return toolResponse();
    },
  });
  const result = await invoke(fixture('tool_calling'));
  assert.equal(result.success, true);
  assert.deepEqual(result.result, { tool_called: true, arguments_valid: true });
  assert.equal(calls, 1);
  for (const wire of [
    () => response(aiProbeSentinel),
    () => toolResponse('shell'),
    () => toolResponse('echo', { ok: true }),
    () => toolResponse('echo', { sentinel: aiProbeSentinel, ok: true, command: 'untrusted' }),
  ]) {
    const invalid = createAiProbeInvoker({ resolve, request: async () => wire() });
    assert.equal((await invalid(fixture('tool_calling'))).success, false);
  }
});

test('deadline covers stalled DNS and HTTP, with no requests after DNS timeout', async () => {
  let requests = 0;
  const invoke = createAiProbeInvoker({
    resolve: async () => new Promise(() => {}),
    request: async () => {
      requests++;
      return response(aiProbeSentinel);
    },
  });
  const started = Date.now();
  assert.equal((await invoke(fixture())).error_code, 'timeout');
  assert.ok(Date.now() - started < 4500);
  assert.equal(requests, 0);
  const http = createPinnedAiFetch(
    { ...config(), signal: AbortSignal.timeout(10) },
    { resolve, request: async () => new Promise(() => {}) },
  );
  const keepAlive = setTimeout(() => {}, 100);
  try {
    await assert.rejects(() => http(`${baseUrl}/models`), { code: 'timeout' });
  } finally {
    clearTimeout(keepAlive);
  }
});
