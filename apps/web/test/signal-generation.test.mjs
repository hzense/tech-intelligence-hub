import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createSignalGenerationInvoker } from '../lib/signal-generation-provider.ts';
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
function providerFixture(value = result) {
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
  });
  return {
    calls,
    invoke: () =>
      invoke({ source, stage, connection, apiKey, allowedHosts: ['api.provider.example.com'] }),
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
