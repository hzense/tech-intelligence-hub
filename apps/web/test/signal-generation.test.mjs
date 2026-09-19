import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import { createSignalGenerationInvoker } from '../lib/signal-generation-provider.ts';
import { generationTimeoutMs } from '../lib/signal-generation-diagnostics.ts';
import { AiProbeError } from '../lib/ai-provider-transport.ts';
import { createAiProbeInvoker } from '../lib/ai-provider.ts';
import { createGenerationExecutor, generationDto } from '../lib/signal-generation-core.ts';
import { createGenerationHandler } from '../lib/admin-signal-generation-handler.ts';
import { readGenerationConfiguration } from '../lib/signal-generation-config.ts';
import { SignalGenerationError as ContractError } from '../../../packages/ingestion/src/signal-generation-contract.mjs';
import { signalGenerationSourceHash } from '../../../packages/database/src/signal-generation-store.mjs';
import { buildGenerationSource } from '../../../packages/ingestion/src/signal-generation-contract.mjs';
import { parseImportOutput } from '../../../packages/ingestion/src/import-task-contract.mjs';
const { Response, Request, structuredClone } = globalThis;
const output = parseImportOutput({
  fragments: [{ text: 'Alice presented the Example processor.', locator: { paragraph: 1 } }],
});
const source = buildGenerationSource(output);
const apiKey = 'synthetic-generation-key-only';
const settings = {
  timeout_ms: 3000,
  max_concurrency: 1,
  daily_budget_microusd: 1000000,
  input_price_microusd_per_million: 1000000,
  output_price_microusd_per_million: 2000000,
};
const connection = {
  id: randomUUID(),
  revision: 1,
  protocol: 'openai-compatible',
  base_url: 'https://api.provider.example.com/v1',
  settings,
};
const stage = {
  connection_id: connection.id,
  connection_revision: 1,
  model_id: 'fixture/model',
  prompt: 'Extract private candidates.',
  temperature: 0.7,
  max_output_tokens: 1000,
  require_tools: false,
};
const profile = {
  id: randomUUID(),
  revision: 1,
  name: 'fixture',
  stages: { extract: stage, verify: stage, analyze: stage },
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
  readiness: { ready: true, reasons: [] },
};
const candidate = {
  title: 'Example processor announcement',
  summary: 'Alice presented a processor.',
  event_date: null,
  event_date_evidence: [],
  organizations: [],
  persons: [
    {
      name: 'Alice',
      role: 'presenter',
      organization: null,
      evidence: [{ fragment_id: 'fragment-1', quote: 'Alice presented' }],
    },
  ],
  claims: [
    {
      text: 'Alice presented a processor.',
      evidence: [{ fragment_id: 'fragment-1', quote: 'Alice presented the Example processor.' }],
    },
  ],
};
const result = { candidates: [candidate], reason: 'One event in the supplied source.' };
test('generation requires explicit production enablement, dedicated target identity and independent bounded budgets', () => {
  const env = {
    VERCEL_ENV: 'production',
    HZENSE_SIGNAL_GENERATION_ENABLED: '1',
    HZENSE_RUNTIME_EXPECTED_HOST: 'ep-test-pooler.eu-central-1.aws.neon.tech',
    HZENSE_RUNTIME_EXPECTED_PORT: '5432',
    HZENSE_RUNTIME_EXPECTED_NAME: 'testdb',
    HZENSE_RUNTIME_EXPECTED_USER: 'hzense_runtime',
    HZENSE_GENERATION_DATABASE_URL:
      'postgresql://hzense_generation_admin:fixture-only@ep-test-pooler.eu-central-1.aws.neon.tech:5432/testdb?sslmode=verify-full&channel_binding=prefer',
    HZENSE_GENERATION_BATCH_LIMIT_MICROUSD: '1000000',
    HZENSE_GENERATION_DAILY_LIMIT_MICROUSD: '5000000',
  };
  assert.equal(readGenerationConfiguration(env).batch, 1000000);
  for (const change of [
    { HZENSE_SIGNAL_GENERATION_ENABLED: '0' },
    { VERCEL_ENV: 'preview' },
    { HZENSE_GENERATION_BATCH_LIMIT_MICROUSD: undefined },
    { HZENSE_GENERATION_DAILY_LIMIT_MICROUSD: '50000001' },
    { HZENSE_GENERATION_BATCH_LIMIT_MICROUSD: '10000001' },
    { HZENSE_GENERATION_BATCH_LIMIT_MICROUSD: '6000000' },
    {
      HZENSE_GENERATION_DATABASE_URL: env.HZENSE_GENERATION_DATABASE_URL.replace(
        'hzense_generation_admin',
        'hzense_migrator',
      ),
    },
    {
      HZENSE_GENERATION_DATABASE_URL: env.HZENSE_GENERATION_DATABASE_URL.replace(
        'verify-full',
        'require',
      ),
    },
  ])
    assert.throws(() => readGenerationConfiguration({ ...env, ...change }), {
      code: 'not_configured',
    });
});
function providerFixture(value = result, overrides = {}) {
  const calls = [];
  const invoke = createSignalGenerationInvoker({
    resolve: async () => [{ address: '93.184.216.34', family: 4 }],
    request: async (args) => {
      calls.push(args);
      return Response.json({
        id: 'fixture',
        model: stage.model_id,
        choices: [
          { message: { role: 'assistant', content: JSON.stringify(value) }, finish_reason: 'stop' },
        ],
        usage: { prompt_tokens: 200, completion_tokens: 100, total_tokens: 300 },
      });
    },
    ...overrides,
  });
  return {
    calls,
    invoke: (overrides = {}) =>
      invoke({
        source,
        stage,
        connection,
        apiKey,
        allowedHosts: ['api.provider.example.com'],
        ...overrides,
      }),
  };
}
test('real SDK structured extraction yields only private candidates and exact evidence', async () => {
  const f = providerFixture();
  const value = await f.invoke();
  assert.equal(value.success, true);
  assert.equal(value.output.classification, 'private');
  assert.deepEqual(value.output.candidates[0].issues, [
    'needs_public_evidence',
    'needs_event_time',
  ]);
  assert.equal(value.input_tokens, 200);
  assert.equal(f.calls.length, 1);
  const request = JSON.parse(f.calls[0].body);
  const system = request.messages.find((message) => message.role === 'system').content;
  assert.match(system, /单次最多 5 条候选/);
  assert.match(system, /标题最多 50 字，摘要最多 500 字/);
  assert.equal(value.diagnostic.code, null);
  assert.equal(value.diagnostic.timeout_ms, 285000);
  assert.ok(Number.isSafeInteger(value.diagnostic.elapsed_ms));
});

test('extraction forwards the configured 8192 token allowance and enforces 500 character summaries', async () => {
  const f = providerFixture({
    ...result,
    candidates: [{ ...candidate, summary: '中'.repeat(500) }],
  });
  const value = await f.invoke({ stage: { ...stage, max_output_tokens: 8192 } });
  assert.equal(value.success, true);
  const request = JSON.parse(f.calls[0].body);
  assert.equal(request.max_tokens, 8192);
  assert.equal(
    request.response_format.json_schema.schema.properties.candidates.items.properties.summary
      .maxLength,
    500,
  );
  assert.equal(f.calls.length, 1);
});

test('business generation survives the old probe and 45s cutoffs without changing its connection', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let release, wire;
  const ready = Promise.withResolvers();
  let calls = 0;
  const f = providerFixture(result, {
    request: async (args) => {
      calls++;
      wire = args;
      ready.resolve();
      return new Promise((resolve) => {
        release = resolve;
      });
    },
  });
  const pending = f.invoke({
    connection: { ...connection, settings: { ...settings, timeout_ms: 10000 } },
  });
  await ready.promise;
  t.mock.timers.tick(284999);
  assert.equal(wire.signal.aborted, false);
  release(
    Response.json({
      id: 'fixture',
      model: stage.model_id,
      choices: [
        { message: { role: 'assistant', content: JSON.stringify(result) }, finish_reason: 'stop' },
      ],
      usage: { prompt_tokens: 200, completion_tokens: 100, total_tokens: 300 },
    }),
  );
  assert.equal((await pending).success, true);
  assert.equal(calls, 1);
  const body = JSON.parse(wire.body);
  assert.equal(body.max_tokens, stage.max_output_tokens);
  assert.equal(body.tools, undefined);
});

test('five-minute route leaves bookkeeping headroom and fits the existing lease', () => {
  const route = readFileSync(
    new URL('../app/api/admin/signal-generation/route.ts', import.meta.url),
    'utf8',
  );
  const store = readFileSync(
    new URL('../../../packages/database/src/signal-generation-store.mjs', import.meta.url),
    'utf8',
  );
  const routeSeconds = Number(route.match(/export const maxDuration = (\d+);/)[1]);
  const leaseMinutes = Number(
    store.match(/lease_until=clock_timestamp\(\)\+interval '(\d+) minutes'/)[1],
  );
  assert.equal(routeSeconds, 300);
  assert.equal(generationTimeoutMs, 285000);
  assert.equal(routeSeconds * 1000 - generationTimeoutMs, 15000);
  assert.ok(leaseMinutes * 60 > routeSeconds);
});

test('business deadline aborts exactly once, retains unknown usage and never retries a late response', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const ready = Promise.withResolvers();
  let calls = 0,
    wire,
    release;
  const f = providerFixture(result, {
    request: async (args) => {
      calls++;
      wire = args;
      ready.resolve();
      return new Promise((resolve) => {
        release = resolve;
      });
    },
  });
  const pending = f.invoke();
  await ready.promise;
  t.mock.timers.tick(generationTimeoutMs - 1);
  assert.equal(wire.signal.aborted, false);
  t.mock.timers.tick(1);
  const value = await pending;
  assert.equal(wire.signal.aborted, true);
  assert.equal(value.success, false);
  assert.equal(value.error_code, 'generation_unknown');
  assert.equal(value.diagnostic.code, 'generation_timeout');
  assert.equal(value.input_tokens, null);
  assert.equal(value.output, undefined);
  release(Response.json({ private: apiKey }));
  await Promise.resolve();
  assert.equal(calls, 1);
  assert.equal(value.output, undefined);
  assert.equal(JSON.stringify(value).includes(apiKey), false);
});

test('business deadline also bounds DNS without reaching the wire', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const ready = Promise.withResolvers();
  const f = providerFixture(result, {
    resolve: async () => {
      ready.resolve();
      return new Promise(() => {});
    },
  });
  const pending = f.invoke();
  await ready.promise;
  t.mock.timers.tick(generationTimeoutMs);
  assert.equal((await pending).diagnostic.code, 'generation_timeout');
  assert.equal(f.calls.length, 0);
});

test('capability probes retain their separate connection-specific deadline', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const ready = Promise.withResolvers();
  let calls = 0;
  const invoke = createAiProbeInvoker({
    resolve: async () => [{ address: '93.184.216.34', family: 4 }],
    request: async () => {
      calls++;
      ready.resolve();
      return new Promise(() => {});
    },
  });
  const pending = invoke({
    connection,
    apiKey,
    kind: 'connection',
    modelId: stage.model_id,
    allowedHosts: ['api.provider.example.com'],
  });
  await ready.promise;
  t.mock.timers.tick(settings.timeout_ms);
  const value = await pending;
  assert.equal(value.error_code, 'timeout');
  assert.equal(calls, 1);
});

test('transport and SDK failures keep bounded classifications without raw messages or retries', async () => {
  for (const code of [
    'provider_rejected',
    'network_error',
    'dns_failed',
    'timeout',
    'blocked_target',
    'redirect_blocked',
    'response_too_large',
    'invalid_response',
  ]) {
    let calls = 0;
    const f = providerFixture(result, {
      request: async () => {
        calls++;
        const cause = new AiProbeError(code);
        cause.message = `${apiKey} private source https://secret.example`;
        throw new Error('raw SDK wrapper', { cause });
      },
    });
    const value = await f.invoke();
    assert.equal(value.diagnostic.code, `generation_${code}`);
    assert.equal(value.error_code, 'generation_unknown');
    assert.equal(calls, 1);
    assert.doesNotMatch(
      JSON.stringify(value),
      /synthetic-generation-key|private source|secret\.example|raw SDK wrapper/,
    );
  }
  const f = providerFixture(result, {
    request: async () => {
      throw new Error(apiKey);
    },
  });
  assert.equal((await f.invoke()).diagnostic.code, 'generation_sdk_error');
});

test('invalid candidate structure and evidence have a separate output classification', async () => {
  for (const bad of [
    { not_candidates: apiKey },
    { ...result, candidates: [{ ...candidate, title: '中'.repeat(51) }] },
    { ...result, candidates: [{ ...candidate, summary: '中'.repeat(501) }] },
    { ...result, candidates: Array.from({ length: 6 }, () => ({ ...candidate })) },
    {
      ...result,
      candidates: [
        {
          ...candidate,
          claims: [
            { text: 'x', evidence: [{ fragment_id: 'fragment-1', quote: 'invented quote' }] },
          ],
        },
      ],
    },
  ]) {
    const value = await providerFixture(bad).invoke();
    assert.equal(value.success, false);
    assert.equal(value.diagnostic.code, 'generation_invalid_output');
    assert.equal(value.output, undefined);
    assert.equal(JSON.stringify(value).includes(apiKey), false);
  }
});
test('legal large sources and maximum extraction prompts fit the bounded SDK request after JSON escaping', async () => {
  for (const [text, prompt] of [
    ['x'.repeat(19000), 'p'.repeat(16000)],
    ['"\\'.repeat(4750), '"\\'.repeat(8000)],
    ['中'.repeat(6500), '中'.repeat(16000)],
    ['x'.repeat(19000), '\ud800'.repeat(16000)],
  ]) {
    const largeSource = buildGenerationSource(
      parseImportOutput({
        fragments: [1, 2].map((paragraph) => ({ text, locator: { paragraph } })),
      }),
    );
    const sourceBytes = Buffer.byteLength(JSON.stringify(largeSource));
    assert.ok(sourceBytes > 32768 && sourceBytes <= 48000);
    const f = providerFixture({ candidates: [], reason: 'No supported event.' });
    const value = await f.invoke({ source: largeSource, stage: { ...stage, prompt } });
    assert.equal(value.success, true);
    assert.equal(f.calls.length, 1);
    const wireBytes = Buffer.byteLength(f.calls[0].body);
    assert.ok(wireBytes > 32768 && wireBytes <= 256 * 1024);
  }
});
test('fabricated quotes, injected status, and credential echo cannot become saved candidates', async () => {
  for (const mutation of [
    {
      ...candidate,
      claims: [
        { text: 'claim', evidence: [{ fragment_id: 'fragment-1', quote: 'not in original' }] },
      ],
    },
    { ...candidate, verified: true },
    { ...candidate, title: apiKey },
  ]) {
    const f = providerFixture({ ...result, candidates: [mutation] });
    const value = await f.invoke();
    assert.equal(value.success, false, JSON.stringify({ mutation, value }));
    assert.equal(value.output, undefined);
    assert.equal(f.calls.length, 1);
    assert.equal(JSON.stringify(value).includes(apiKey), false);
  }
});
function coreFixture(overrides = {}) {
  let run = {
    id: randomUUID(),
    owner_id: 'admin',
    batch_id: randomUUID(),
    item_id: randomUUID(),
    profile_id: profile.id,
    profile_revision: 1,
    source_fence: 1,
    source_hash: signalGenerationSourceHash(source),
    snapshot: { source, profile, connection },
    status: 'pending',
    lease_token: randomUUID(),
    reserved_microusd: '2000',
    charged_microusd: '2000',
    result: null,
    created_at: '2026-01-01',
    error_code: null,
  };
  let calls = 0;
  const finishes = [];
  const deps = {
    source: async () => ({ fence: 1, output }),
    access: async (_id, _revision, credentials) =>
      structuredClone({ profile, connection, ...(credentials ? { apiKey } : {}) }),
    create: async (_owner, args) => {
      run = { ...run, ...args };
      return run;
    },
    get: async () => run,
    claim: async () => {
      const claimed = run.status === 'pending';
      if (claimed) run.status = 'running';
      return { claimed, run: structuredClone(run) };
    },
    finish: async (_owner, args) => {
      finishes.push(args);
      run.status = args.outcome;
      run.result = args.result;
      return run;
    },
    cancel: async () => {
      run.status = 'cancelled';
      return run;
    },
    invoke: async () => {
      calls++;
      return {
        success: true,
        output: { classification: 'private', candidates: [], reason: 'none' },
        input_tokens: 2,
        output_tokens: 1,
      };
    },
    allowedHosts: ['api.provider.example.com'],
    ...overrides,
  };
  return {
    execute: createGenerationExecutor(deps),
    deps,
    run: () => run,
    calls: () => calls,
    finishes,
  };
}
test('committed admission precedes one model call, replay and detail never regenerate', async () => {
  const f = coreFixture(),
    id = f.run().id;
  const receipt = await f.execute('admin', { action: 'run', id });
  assert.equal(receipt.status, 'completed');
  assert.equal(f.calls(), 1);
  await f.execute('admin', { action: 'run', id });
  await f.execute('admin', { action: 'detail', id });
  assert.equal(f.calls(), 1);
  const dto = generationDto(f.run());
  for (const key of ['owner_id', 'snapshot', 'lease_token', 'source_hash'])
    assert.equal(key in dto, false);
});
test('unknown reservation commit, changed source, revoked profile and cancellation block external calls', async () => {
  for (const overrides of [
    {
      claim: async () => {
        throw new Error('commit_unknown');
      },
    },
    { source: async () => ({ fence: 2, output }) },
    {
      access: async () => {
        throw new Error('profile_not_ready');
      },
    },
  ]) {
    const f = coreFixture(overrides);
    await f.execute('admin', { action: 'run', id: f.run().id }).catch(() => {});
    assert.equal(f.calls(), 0);
  }
  const f = coreFixture();
  await f.execute('admin', { action: 'cancel', id: f.run().id });
  await f.execute('admin', { action: 'run', id: f.run().id });
  assert.equal(f.calls(), 0);
});
test('request cannot supply source text, owner, snapshot or skip affirmative consent', async () => {
  const f = coreFixture();
  const body = {
    action: 'create',
    id: randomUUID(),
    batchId: randomUUID(),
    itemId: randomUUID(),
    profileId: profile.id,
    profileRevision: 1,
    consent: true,
  };
  for (const extra of [
    { source: 'injected' },
    { owner: 'other' },
    { snapshot: {} },
    { consent: false },
  ]) {
    await assert.rejects(f.execute('admin', { ...body, ...extra }));
  }
  const created = await f.execute('admin', body);
  assert.equal(created.status, 'pending');
  assert.equal(f.calls(), 0);
});
test('unknown completion commit never retries provider or submits contradictory completion', async () => {
  let finishes = 0;
  const f = coreFixture({
    finish: async () => {
      finishes++;
      throw new Error('commit_unknown');
    },
  });
  await assert.rejects(f.execute('admin', { action: 'run', id: f.run().id }));
  assert.equal(f.calls(), 1);
  assert.equal(finishes, 1);
});

test('persisted diagnostic classification does not change unknown accounting or replay safety', async () => {
  const events = [];
  let calls = 0;
  const f = coreFixture({
    report: (event) => events.push(event),
    invoke: async () => {
      calls++;
      return {
        success: false,
        input_tokens: null,
        output_tokens: null,
        error_code: 'generation_unknown',
        diagnostic: { code: 'generation_timeout', elapsed_ms: 285000, timeout_ms: 285000 },
      };
    },
  });
  const id = f.run().id;
  await f.execute('admin', { action: 'run', id });
  await f.execute('admin', { action: 'run', id });
  assert.equal(calls, 1);
  assert.equal(f.finishes.length, 1);
  assert.equal(f.finishes[0].outcome, 'unknown');
  assert.equal(f.finishes[0].errorCode, 'generation_timeout');
  assert.equal(f.finishes[0].chargedMicrousd, undefined);
  assert.deepEqual(
    events.map(({ phase }) => phase),
    ['provider', 'completion'],
  );
  assert.deepEqual(
    Object.keys(events[0]).sort(),
    ['event', 'run_id', 'phase', 'outcome', 'code', 'elapsed_ms', 'timeout_ms'].sort(),
  );
  assert.equal(events[0].run_id, id);
  assert.equal(events[0].code, 'generation_timeout');
  assert.doesNotMatch(
    JSON.stringify(events),
    /synthetic-generation-key|Alice|api\.provider|snapshot|lease_token/,
  );
});

test('untrusted diagnostic strings and broken logging cannot change completion or expose secrets', async () => {
  const f = coreFixture({
    report: () => {
      throw new Error('logger failed');
    },
    invoke: async () => ({
      success: false,
      input_tokens: null,
      output_tokens: null,
      error_code: 'generation_unknown',
      diagnostic: { code: apiKey },
    }),
  });
  await f.execute('admin', { action: 'run', id: f.run().id });
  assert.equal(f.finishes.length, 1);
  assert.equal(f.finishes[0].errorCode, 'generation_unknown');
});

test('postflight failures and completion uncertainty are distinguishable without logging raw errors', async () => {
  const events = [];
  let checks = 0;
  const f = coreFixture({
    report: (event) => events.push(event),
    source: async () => {
      if (++checks === 2) throw new Error(apiKey);
      return { fence: 1, output };
    },
  });
  await f.execute('admin', { action: 'run', id: f.run().id });
  assert.equal(f.finishes[0].outcome, 'unknown');
  assert.equal(f.finishes[0].errorCode, 'generation_postflight_failed');
  assert.deepEqual(
    events.map(({ phase }) => phase),
    ['provider', 'postflight', 'completion'],
  );
  assert.equal(JSON.stringify(events).includes(apiKey), false);
  const uncertain = coreFixture({
    report: (event) => events.push(event),
    finish: async () => {
      throw new Error(apiKey);
    },
  });
  await assert.rejects(uncertain.execute('admin', { action: 'run', id: uncertain.run().id }));
  assert.equal(events.at(-1).code, 'completion_unconfirmed');
  assert.equal(uncertain.calls(), 1);
  assert.equal(JSON.stringify(events).includes(apiKey), false);
});
test('generation API denies anonymous, cross-site, host spoofing and client source before dispatch', async () => {
  let called = 0;
  const deps = {
    session: async () => ({ user: { id: 'trusted-admin' } }),
    origin: () => 'https://hzense.com',
    dashboard: async () => {
      called++;
      return {};
    },
    execute: async (owner) => {
      assert.equal(owner, 'trusted-admin');
      called++;
      return {};
    },
  };
  const request = (headers = {}, body = '{}') =>
    new Request('https://hzense.com/api/admin/signal-generation', {
      method: 'POST',
      headers: {
        host: 'hzense.com',
        origin: 'https://hzense.com',
        'content-type': 'application/json',
        ...headers,
      },
      body,
    });
  assert.equal(
    (await createGenerationHandler({ ...deps, session: async () => null })(request())).status,
    401,
  );
  const handler = createGenerationHandler(deps);
  assert.equal((await handler(request({ origin: 'https://evil.example' }))).status, 403);
  assert.equal((await handler(request({ host: 'evil.example' }))).status, 403);
  assert.equal((await handler(request({ 'sec-fetch-site': 'cross-site' }))).status, 403);
  assert.equal((await handler(request({}, 'x'.repeat(4097)))).status, 400);
  assert.equal(called, 0);
  const good = await handler(request());
  assert.equal(good.status, 200);
  assert.match(good.headers.get('cache-control'), /no-store/);
  assert.equal(called, 1);
});
test('source contract failures have bounded actionable 400 responses', async () => {
  for (const [code, expected] of [
    ['generation_source_too_large', 'input_too_large'],
    ['invalid_generation_source', 'invalid_source'],
  ]) {
    const handler = createGenerationHandler({
      session: async () => ({ user: { id: 'admin' } }),
      origin: () => 'https://hzense.com',
      dashboard: async () => ({}),
      execute: async () => {
        throw new ContractError(code);
      },
    });
    const result = await handler(
      new Request('https://hzense.com/api/admin/signal-generation', {
        method: 'POST',
        headers: {
          host: 'hzense.com',
          origin: 'https://hzense.com',
          'content-type': 'application/json',
        },
        body: '{}',
      }),
    );
    assert.equal(result.status, 400);
    assert.deepEqual(await result.json(), { error: expected });
  }
});
