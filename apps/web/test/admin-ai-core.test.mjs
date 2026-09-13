import assert from 'node:assert/strict';
import test from 'node:test';
import { Buffer } from 'node:buffer';
import {
  createAiAdminHandler,
  readAiBackendConfiguration,
  readAiAllowedHosts,
  AiBackendConfigurationError,
  aiAdminErrorStatus,
} from '../lib/admin-ai-core.ts';
import {
  AiConfigError,
  aiConfigErrorCodes,
} from '../../../packages/database/src/ai-config-contract.mjs';
const { Request, ReadableStream } = globalThis;
const origin = 'https://hzense.com';
const id = '11111111-1111-4111-8111-111111111111';
const secret = 'synthetic-never-expose-diagnostic';
const request = (body = {}, headers = {}, method = 'POST', query = '') =>
  new Request(`${origin}/api/admin/ai/connections${query}`, {
    method,
    headers: { origin, 'content-type': 'application/json', ...headers },
    ...(method === 'GET' ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }),
  });
function setup(overrides = {}) {
  let calls = 0;
  const handle = createAiAdminHandler({
    authenticate: async () => true,
    origin: () => origin,
    execute: async () => {
      calls++;
      return { ok: true };
    },
    ...overrides,
  });
  return {
    handle,
    get calls() {
      return calls;
    },
  };
}
function secureHeaders(response) {
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
  assert.equal(response.headers.get('x-robots-tag'), 'noindex, nofollow');
}

test('authentication precedes body access, trusted origin lookup and database/provider execution', async () => {
  let bodyReads = 0,
    originReads = 0,
    executeCalls = 0;
  const input = request();
  Object.defineProperty(input, 'body', {
    get() {
      bodyReads++;
      throw new Error(secret);
    },
  });
  const handler = createAiAdminHandler({
    authenticate: async () => null,
    origin: () => {
      originReads++;
      return origin;
    },
    execute: async () => {
      executeCalls++;
      throw new Error(secret);
    },
  });
  const result = await handler(input, 'create-connection');
  assert.equal(result.status, 401);
  secureHeaders(result);
  assert.deepEqual(await result.json(), { error: 'unauthorized' });
  assert.equal(bodyReads, 0);
  assert.equal(originReads, 0);
  assert.equal(executeCalls, 0);
});
test('authentication failures return safe 503 without reading the request body', async () => {
  const f = setup({
    authenticate: async () => {
      throw new Error(secret);
    },
  });
  const input = request();
  Object.defineProperty(input, 'body', {
    get() {
      throw new Error('body evaluated');
    },
  });
  const result = await f.handle(input, 'create-connection');
  assert.equal(result.status, 503);
  secureHeaders(result);
  assert.deepEqual(await result.json(), { error: 'authentication_unavailable' });
  assert.equal(f.calls, 0);
});
test('method mismatch does not authenticate or open the backend', async () => {
  let authentication = 0;
  const f = setup({
    authenticate: async () => {
      authentication++;
      return true;
    },
  });
  const response = await f.handle(request({}, {}, 'GET'), 'create-connection');
  assert.equal(response.status, 405);
  secureHeaders(response);
  assert.equal(authentication, 0);
  assert.equal(f.calls, 0);
});
for (const headers of [
  { origin: 'https://evil.example' },
  { origin: 'null' },
  { origin: `${origin}.evil.example` },
  { 'sec-fetch-site': 'cross-site' },
  { 'sec-fetch-site': 'same-site' },
  { 'sec-fetch-site': 'none' },
]) {
  test(`write rejects origin/fetch metadata ${JSON.stringify(headers)}`, async () => {
    const f = setup();
    const response = await f.handle(request({}, headers), 'create-connection');
    assert.equal(response.status, 403);
    secureHeaders(response);
    assert.equal(f.calls, 0);
  });
}
test('write requires exact Origin; same-origin metadata and ordinary JSON charset are accepted', async () => {
  const f = setup();
  const absent = request();
  absent.headers.delete('origin');
  assert.equal((await f.handle(absent, 'create-connection')).status, 403);
  const valid = await f.handle(
    request(
      { name: 'Test' },
      { 'sec-fetch-site': 'same-origin', 'content-type': 'Application/JSON; charset=utf-8' },
    ),
    'create-connection',
  );
  assert.equal(valid.status, 200);
  secureHeaders(valid);
  assert.equal(f.calls, 1);
});
test('GET permits no Origin but rejects cross-site Origin or Fetch Metadata before backend', async () => {
  const f = setup();
  const local = request({}, {}, 'GET');
  local.headers.delete('origin');
  assert.equal((await f.handle(local, 'list-connections')).status, 200);
  assert.equal(
    (await f.handle(request({}, { origin: 'https://evil.example' }, 'GET'), 'list-connections'))
      .status,
    403,
  );
  assert.equal(
    (await f.handle(request({}, { 'sec-fetch-site': 'cross-site' }, 'GET'), 'list-connections'))
      .status,
    403,
  );
  assert.equal(f.calls, 1);
});
test('missing canonical origin fails closed', async () => {
  const f = setup({ origin: () => null });
  const response = await f.handle(request(), 'create-connection');
  assert.equal(response.status, 403);
  assert.equal(f.calls, 0);
});
test('origin configuration exceptions are sanitized', async () => {
  const f = setup({
    origin: () => {
      throw new Error(secret);
    },
  });
  const response = await f.handle(request(), 'create-connection');
  assert.equal(response.status, 503);
  secureHeaders(response);
  assert.doesNotMatch(await response.text(), new RegExp(secret));
  assert.equal(f.calls, 0);
});
for (const body of [
  '[]',
  'null',
  'true',
  '1',
  '"text"',
  '{',
  '{"__proto__":{"polluted":true}}',
  '{"headers":{"authorization":"secret"}}',
]) {
  test(`rejects JSON or unsupported root fields ${body}`, async () => {
    const f = setup();
    const result = await f.handle(request(body), 'create-connection');
    assert.equal(result.status, 400);
    secureHeaders(result);
    assert.equal(f.calls, 0);
  });
}
for (const type of ['text/plain', 'application/json; charset=latin1', 'multipart/form-data', '']) {
  test(`requires exact JSON content type ${type}`, async () => {
    const f = setup();
    assert.equal(
      (await f.handle(request({}, { 'content-type': type }), 'create-connection')).status,
      415,
    );
    assert.equal(f.calls, 0);
  });
}
test('actual streamed bytes enforce 32 KiB even when Content-Length claims one byte', async () => {
  const f = setup();
  let cancelled = false;
  const input = new Request(`${origin}/api/admin/ai/connections`, {
    method: 'POST',
    headers: { origin, 'content-type': 'application/json', 'content-length': '1' },
    duplex: 'half',
    body: new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array(16000));
        controller.enqueue(new Uint8Array(18000));
      },
      cancel() {
        cancelled = true;
      },
    }),
  });
  const response = await f.handle(input, 'create-connection');
  assert.equal(response.status, 400);
  assert.equal(cancelled, true);
  assert.equal(f.calls, 0);
  secureHeaders(response);
});
test('exactly 32 KiB valid JSON is accepted at the transport boundary', async () => {
  const f = setup();
  const body = JSON.stringify({ name: 'x'.repeat(32757) });
  assert.equal(Buffer.byteLength(body), 32768);
  assert.equal((await f.handle(request(body), 'create-connection')).status, 200);
  assert.equal(f.calls, 1);
});
for (const length of ['32769', '-1', '1e6', 'nope']) {
  test(`rejects invalid declared body length ${length}`, async () => {
    const f = setup();
    assert.equal(
      (await f.handle(request({}, { 'content-length': length }), 'create-connection')).status,
      400,
    );
    assert.equal(f.calls, 0);
  });
}
test('rejects malformed UTF-8, absent bodies and failed streams without diagnostics', async () => {
  const f = setup();
  for (const body of [
    new Uint8Array([0xff]),
    null,
    new ReadableStream({
      start(controller) {
        controller.error(new Error(secret));
      },
    }),
  ]) {
    const input = new Request(`${origin}/api/admin/ai/connections`, {
      method: 'POST',
      headers: { origin, 'content-type': 'application/json' },
      body,
      duplex: 'half',
    });
    const response = await f.handle(input, 'create-connection');
    assert.equal(response.status, 400);
    assert.doesNotMatch(await response.text(), new RegExp(secret));
  }
  assert.equal(f.calls, 0);
});
test('GET path UUID passes as a single command and queries never reach backend', async () => {
  let command;
  const f = setup({
    execute: async (_operation, value) => {
      command = value;
      return {};
    },
  });
  assert.equal((await f.handle(request({}, {}, 'GET'), 'get-probe', id)).status, 200);
  assert.deepEqual(command, { id });
  for (const bad of [
    'bad',
    `${id}\n`,
    `../${id}`,
    id.toUpperCase().replace('11111111', 'AAAAAAAA'),
  ])
    assert.equal((await f.handle(request({}, {}, 'GET'), 'get-probe', bad)).status, 400);
  const queries = setup();
  for (const query of ['?key=value', '?api_key=secret', '?id=' + id])
    assert.equal(
      (await queries.handle(request({}, {}, 'GET', query), 'list-connections')).status,
      400,
    );
  assert.equal(queries.calls, 0);
});
test('allows only the selected operation field set', async () => {
  const f = setup();
  for (const [operation, body, method] of [
    ['run-probe', { id, api_key: secret }, 'POST'],
    ['save-profile', { name: 'X', capabilities: { tools: true } }, 'POST'],
    ['update-connection', { id, expected_revision: 1, connection_id: id }, 'PATCH'],
  ])
    assert.equal((await f.handle(request(body, {}, method), operation)).status, 400);
  assert.equal(f.calls, 0);
});
for (const code of aiConfigErrorCodes) {
  test(`fixed service error ${code} has a safe defined HTTP status`, async () => {
    assert.ok(Object.hasOwn(aiAdminErrorStatus, code));
    const f = setup({
      execute: async () => {
        throw new AiConfigError(code);
      },
    });
    const response = await f.handle(request(), 'create-connection');
    assert.equal(response.status, aiAdminErrorStatus[code]);
    secureHeaders(response);
    assert.deepEqual(await response.json(), { error: code });
  });
}
for (const error of [
  new Error(secret),
  { code: secret, message: secret },
  { code: '__proto__' },
  { code: 'constructor' },
  { code: 'toString' },
  Object.create({ code: 'not_found' }),
]) {
  test(`unknown or prototype error maps to fixed unavailable ${String(error.code ?? 'Error')}`, async () => {
    const f = setup({
      execute: async () => {
        throw error;
      },
    });
    const response = await f.handle(request(), 'create-connection');
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { error: 'ai_unavailable' });
    secureHeaders(response);
  });
}
test('error property accessors, proxies and coercion are not evaluated', async () => {
  let touched = 0;
  const getter = {};
  Object.defineProperty(getter, 'code', {
    get() {
      touched++;
      throw new Error(secret);
    },
  });
  const coercion = {
    code: {
      toString() {
        touched++;
        throw new Error(secret);
      },
    },
  };
  const proxy = new Proxy(
    {},
    {
      has() {
        touched++;
        throw new Error(secret);
      },
      get() {
        touched++;
        throw new Error(secret);
      },
      getOwnPropertyDescriptor() {
        touched++;
        throw new Error(secret);
      },
    },
  );
  for (const error of [getter, coercion, proxy]) {
    const f = setup({
      execute: async () => {
        throw error;
      },
    });
    const response = await f.handle(request(), 'create-connection');
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { error: 'ai_unavailable' });
  }
  assert.equal(touched, 0);
});
test('explicit backend configuration errors stay fixed and private', async () => {
  const f = setup({
    execute: async () => {
      throw new AiBackendConfigurationError();
    },
  });
  const response = await f.handle(request(), 'create-connection');
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: 'ai_not_configured' });
  secureHeaders(response);
});

const env = {
  VERCEL_ENV: 'production',
  HZENSE_RUNTIME_EXPECTED_HOST: 'ep-test-pooler.eu-central-1.aws.neon.tech',
  HZENSE_RUNTIME_EXPECTED_PORT: '5432',
  HZENSE_RUNTIME_EXPECTED_NAME: 'testdb',
  HZENSE_RUNTIME_EXPECTED_USER: 'hzense_runtime',
  HZENSE_AI_ALLOWED_HOSTS: 'ai-gateway.vercel.sh',
  HZENSE_AI_DATABASE_URL:
    'postgresql://hzense_ai_admin:fixture-only@ep-test-pooler.eu-central-1.aws.neon.tech:5432/testdb?sslmode=verify-full&channel_binding=prefer',
  HZENSE_AI_KEYRING: JSON.stringify({
    active: 'v1',
    keys: { v1: Buffer.alloc(32, 7).toString('base64') },
  }),
};
test('backend uses only a dedicated approved production identity, validated keyring and exact hosts', () => {
  const config = readAiBackendConfiguration(env);
  assert.equal(config.connectionString, env.HZENSE_AI_DATABASE_URL);
  assert.equal(config.keyring.active, 'v1');
  assert.deepEqual(config.allowedHosts, ['ai-gateway.vercel.sh']);
  assert.deepEqual(readAiAllowedHosts('example.com,other.example,example.com'), [
    'example.com',
    'other.example',
  ]);
});
const invalidEnvironment = [
  { VERCEL_ENV: 'preview' },
  { VERCEL_ENV: 'development' },
  { VERCEL_ENV: undefined },
  { HZENSE_AI_DATABASE_URL: undefined },
  {
    HZENSE_AI_DATABASE_URL: env.HZENSE_AI_DATABASE_URL.replace('hzense_ai_admin', 'hzense_runtime'),
  },
  {
    HZENSE_AI_DATABASE_URL: env.HZENSE_AI_DATABASE_URL.replace(
      'hzense_ai_admin',
      'hzense_migrator',
    ),
  },
  { HZENSE_AI_DATABASE_URL: env.HZENSE_AI_DATABASE_URL.replace('verify-full', 'require') },
  { HZENSE_AI_DATABASE_URL: env.HZENSE_AI_DATABASE_URL.replace('&channel_binding=prefer', '') },
  { HZENSE_AI_DATABASE_URL: env.HZENSE_AI_DATABASE_URL + '&options=secret' },
  { HZENSE_AI_DATABASE_URL: env.HZENSE_AI_DATABASE_URL + '&sslmode=verify-full' },
  { HZENSE_AI_DATABASE_URL: env.HZENSE_AI_DATABASE_URL.replace('-pooler.', '.') },
  { HZENSE_AI_DATABASE_URL: env.HZENSE_AI_DATABASE_URL.replace(':5432/', '/') },
  { HZENSE_AI_DATABASE_URL: env.HZENSE_AI_DATABASE_URL.replace('/testdb?', '/other?') },
  { HZENSE_AI_DATABASE_URL: env.HZENSE_AI_DATABASE_URL.replace('fixture-only', '') },
  { HZENSE_AI_DATABASE_URL: env.HZENSE_AI_DATABASE_URL + '#secret' },
  { HZENSE_AI_DATABASE_URL: ' ' + env.HZENSE_AI_DATABASE_URL },
  { HZENSE_AI_DATABASE_URL: env.HZENSE_AI_DATABASE_URL.replace('fixture-only', 'fixture%0Akey') },
  { HZENSE_AI_KEYRING: undefined },
  { HZENSE_AI_KEYRING: '{}' },
  { HZENSE_AI_KEYRING: 'bad' },
  {
    HZENSE_AI_KEYRING: JSON.stringify({
      active: 'missing',
      keys: { v1: Buffer.alloc(32, 7).toString('base64') },
    }),
  },
  { HZENSE_RUNTIME_EXPECTED_HOST: 'wrong-pooler.neon.tech' },
  { HZENSE_AI_ALLOWED_HOSTS: undefined },
  { HZENSE_AI_ALLOWED_HOSTS: '' },
  { HZENSE_AI_ALLOWED_HOSTS: 'https://example.com' },
  { HZENSE_AI_ALLOWED_HOSTS: 'localhost' },
];
for (const [index, patch] of invalidEnvironment.entries())
  test(`backend fails closed for invalid environment case ${index + 1}`, () => {
    assert.throws(
      () => readAiBackendConfiguration({ ...env, ...patch }),
      (error) =>
        error instanceof AiBackendConfigurationError && error.message === 'ai_not_configured',
    );
  });
for (const value of [
  '',
  'Example.com',
  ' example.com',
  'example.com ',
  'https://example.com',
  'example.com:443',
  'example.com/path',
  'localhost',
  '127.0.0.1',
  '[::1]',
  'service.internal',
  'service.invalid',
  Array.from({ length: 21 }, (_, i) => `example${i}.com`).join(','),
])
  test(`host allowlist rejects ${value.slice(0, 80)}`, () => {
    assert.throws(() => readAiAllowedHosts(value), AiBackendConfigurationError);
  });

test('missing allowlist does not authorize an implicit provider', () => {
  assert.throws(() => readAiAllowedHosts(undefined), AiBackendConfigurationError);
});
