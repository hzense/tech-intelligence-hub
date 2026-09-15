import assert from 'node:assert/strict';
import { test } from 'node:test';
import { URLSearchParams } from 'node:url';
import { NextRequest } from 'next/server.js';
import {
  createSignalWorkbenchHandler,
  parseSignalWorkbenchQuery,
  readSignalWorkbenchConfiguration,
  signalWorkbenchSearchParams,
  SignalWorkbenchConfigurationError,
} from '../lib/admin-signal-workbench-core.ts';

const origin = 'https://admin.example.test';
const { Request } = globalThis;
const request = (path = '/api/admin/signals', options = {}) =>
  new Request(`${origin}${path}`, {
    ...options,
    headers: { host: 'admin.example.test', ...options.headers },
  });
const environment = () => ({
  VERCEL_ENV: 'production',
  HZENSE_SIGNAL_ADMIN_DATABASE_URL:
    'postgresql://hzense_signal_admin_reader:synthetic@ep-test-pooler.eu-central-1.aws.neon.tech:5432/hzense?sslmode=verify-full&channel_binding=prefer',
  HZENSE_RUNTIME_EXPECTED_HOST: 'ep-test-pooler.eu-central-1.aws.neon.tech',
  HZENSE_RUNTIME_EXPECTED_PORT: '5432',
  HZENSE_RUNTIME_EXPECTED_NAME: 'hzense',
  HZENSE_RUNTIME_EXPECTED_USER: 'hzense_runtime',
});

test('workbench parses bounded GET queries and preserves SSR duplicates', () => {
  assert.deepEqual(parseSignalWorkbenchQuery(new URLSearchParams(), 'list'), { limit: 25 });
  assert.deepEqual(
    parseSignalWorkbenchQuery(new URLSearchParams('q=+AI+&after=signal-a&limit=50'), 'list'),
    { q: 'AI', after: 'signal-a', limit: 50 },
  );
  assert.deepEqual(
    parseSignalWorkbenchQuery(new URLSearchParams('version=2'), 'detail', 'signal-a'),
    { signal_id: 'signal-a', version: 2 },
  );
  assert.deepEqual(parseSignalWorkbenchQuery(new URLSearchParams(), 'detail', 'signal-a'), {
    signal_id: 'signal-a',
  });
  const duplicates = signalWorkbenchSearchParams({ q: ['one', 'two'], ignored: undefined });
  assert.deepEqual(duplicates.getAll('q'), ['one', 'two']);
  assert.throws(() => parseSignalWorkbenchQuery(duplicates, 'list'));
});

for (const query of [
  'q=a&q=b',
  'unknown=yes',
  'version=1',
  'limit=0',
  'limit=-1',
  'limit=51',
  'limit=1.2',
  'limit=01',
  'limit=1e1',
  'limit=',
  'limit=9007199254740993',
  'after=../private',
  'after=foo%2Fbar',
  'q=%00',
  'q=%C2%85',
  `q=${'a'.repeat(101)}`,
  `q=${'x'.repeat(2049)}`,
]) {
  test(`workbench rejects invalid list query ${query.slice(0, 55)}`, () => {
    assert.throws(() => parseSignalWorkbenchQuery(new URLSearchParams(query), 'list'));
  });
}
for (const query of [
  'version=0',
  'version=01',
  'version=2147483648',
  'version=1&version=2',
  'q=hello',
]) {
  test(`workbench rejects invalid version query ${query}`, () => {
    assert.throws(() =>
      parseSignalWorkbenchQuery(new URLSearchParams(query), 'detail', 'signal-a'),
    );
  });
}
test('workbench requires valid detail ID and rejects a list ID', () => {
  for (const id of ['', '../x', 'A', 'foo/bar', 'x'.repeat(201), undefined])
    assert.throws(() => parseSignalWorkbenchQuery(new URLSearchParams(), 'detail', id));
  assert.throws(() => parseSignalWorkbenchQuery(new URLSearchParams(), 'list', 'signal-a'));
});

test('workbench uses only its dedicated read credential with the production target contract', () => {
  const env = environment();
  assert.equal(
    readSignalWorkbenchConfiguration(env).connectionString,
    env.HZENSE_SIGNAL_ADMIN_DATABASE_URL,
  );
  assert.equal(env.HZENSE_RUNTIME_DATABASE_URL, undefined);
  for (const values of [
    { VERCEL_ENV: 'preview' },
    { VERCEL_ENV: 'development' },
    { VERCEL_ENV: undefined },
    { HZENSE_SIGNAL_ADMIN_DATABASE_URL: undefined },
    { NODE_TLS_REJECT_UNAUTHORIZED: '0' },
    { HZENSE_RUNTIME_EXPECTED_NAME: 'other' },
    { HZENSE_RUNTIME_EXPECTED_PORT: '6543' },
    { HZENSE_RUNTIME_EXPECTED_HOST: 'ep-other-pooler.eu-central-1.aws.neon.tech' },
    { HZENSE_RUNTIME_EXPECTED_USER: 'neondb_owner' },
  ])
    assert.throws(
      () => readSignalWorkbenchConfiguration({ ...env, ...values }),
      SignalWorkbenchConfigurationError,
    );
  for (const value of [
    env.HZENSE_SIGNAL_ADMIN_DATABASE_URL.replace('hzense_signal_admin_reader', 'hzense_ai_admin'),
    env.HZENSE_SIGNAL_ADMIN_DATABASE_URL.replace('hzense_signal_admin_reader', 'hzense_runtime'),
    env.HZENSE_SIGNAL_ADMIN_DATABASE_URL.replace('-pooler.', '.'),
    env.HZENSE_SIGNAL_ADMIN_DATABASE_URL.replace('verify-full', 'require'),
    env.HZENSE_SIGNAL_ADMIN_DATABASE_URL.replace(':5432', ''),
    env.HZENSE_SIGNAL_ADMIN_DATABASE_URL.replace(':synthetic@', '@'),
    `${env.HZENSE_SIGNAL_ADMIN_DATABASE_URL}&options=-csearch_path=private`,
    `${env.HZENSE_SIGNAL_ADMIN_DATABASE_URL}&sslmode=verify-full`,
    `${env.HZENSE_SIGNAL_ADMIN_DATABASE_URL}#private`,
  ])
    assert.throws(
      () => readSignalWorkbenchConfiguration({ ...env, HZENSE_SIGNAL_ADMIN_DATABASE_URL: value }),
      SignalWorkbenchConfigurationError,
    );
});

test('workbench authenticates before parsing, origin and database access', async () => {
  let accessed = false;
  const handle = createSignalWorkbenchHandler({
    authenticate: async () => null,
    origin: () => {
      accessed = true;
      throw new Error('must not inspect config');
    },
    execute: async () => {
      accessed = true;
      throw new Error('must not query');
    },
  });
  assert.equal((await handle(request('?q=a&q=b'), 'list')).status, 401);
  assert.equal(accessed, false);
  assert.equal(
    (await handle(request('/api/admin/signals', { method: 'POST' }), 'list')).status,
    405,
  );
});

test('workbench enforces request origin and query before execute', async () => {
  let calls = 0;
  const handle = createSignalWorkbenchHandler({
    authenticate: async () => ({}),
    origin: () => origin,
    execute: async () => {
      calls++;
      return { items: [] };
    },
  });
  for (const headers of [
    { origin: 'https://evil.test' },
    { origin: 'null' },
    { 'sec-fetch-site': 'cross-site' },
    { 'sec-fetch-site': 'same-site' },
  ])
    assert.equal((await handle(request('/api/admin/signals', { headers }), 'list')).status, 403);
  assert.equal((await handle(request('/api/admin/signals?q=a&q=b'), 'list')).status, 400);
  assert.equal(calls, 0);
  for (const badHost of [
    '',
    'attacker.example',
    'admin.example.test, attacker.example',
    'admin.example.test/',
  ]) {
    assert.equal(
      (
        await handle(
          request('/api/admin/signals', {
            headers: { host: badHost, origin, 'x-forwarded-host': 'admin.example.test' },
          }),
          'list',
        )
      ).status,
      403,
    );
  }
  assert.equal((await handle(new Request(`${origin}/api/admin/signals`), 'list')).status, 403);
  for (const headers of [{}, { origin, 'sec-fetch-site': 'same-origin' }]) {
    const response = await handle(request('/api/admin/signals', { headers }), 'list');
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'private, no-store');
    assert.equal(response.headers.get('x-robots-tag'), 'noindex, nofollow');
    assert.deepEqual(await response.json(), { items: [] });
  }
});

test('real NextRequest loopback normalization does not replace the trusted authentication origin', async () => {
  const localOrigin = 'http://127.0.0.1:3000';
  let calls = 0;
  const handle = createSignalWorkbenchHandler({
    authenticate: async () => ({}),
    origin: () => localOrigin,
    execute: async () => {
      calls++;
      return { items: [] };
    },
  });
  const normalized = new NextRequest(`${localOrigin}/api/admin/signals`, {
    headers: { host: '127.0.0.1:3000', origin: localOrigin, 'sec-fetch-site': 'same-origin' },
  });
  assert.equal(new globalThis.URL(normalized.url).hostname, 'localhost');
  assert.equal((await handle(normalized, 'list')).status, 200);
  const hostile = new NextRequest(`${localOrigin}/api/admin/signals`, {
    headers: {
      host: '127.0.0.1:3000',
      origin: 'https://attacker.example',
      'x-forwarded-host': '127.0.0.1:3000',
    },
  });
  assert.equal((await handle(hostile, 'list')).status, 403);
  assert.equal(
    (
      await handle(
        new NextRequest(`${localOrigin}/api/admin/signals`, {
          headers: { host: 'localhost:3000', origin: localOrigin },
        }),
        'list',
      )
    ).status,
    403,
  );
  assert.equal(calls, 1);
});

test('workbench dispatches list and pinned detail without bodies', async () => {
  const commands = [];
  const handle = createSignalWorkbenchHandler({
    authenticate: async () => ({}),
    origin: () => origin,
    execute: async (...args) => {
      commands.push(args);
      return {};
    },
  });
  await handle(request('/api/admin/signals?q=AI&after=signal-a&limit=2'), 'list');
  await handle(request('/api/admin/signals/signal-a?version=2'), 'detail', 'signal-a');
  assert.deepEqual(commands, [
    ['list', { q: 'AI', after: 'signal-a', limit: 2 }],
    ['detail', { signal_id: 'signal-a', version: 2 }],
  ]);
});

test('workbench errors redact database, credentials, properties and provider details', async () => {
  for (const [error, status, code] of [
    [new SignalWorkbenchConfigurationError(), 503, 'workbench_not_configured'],
    [Object.assign(new Error('secret connection URL'), { code: 'not_found' }), 404, 'not_found'],
    [Object.assign(new Error('secret payload'), { code: 'invalid_request' }), 400, 'invalid_query'],
    [
      Object.assign(new Error('unsafe identifier'), { code: 'incompatible_data' }),
      503,
      'workbench_incompatible_data',
    ],
    [
      Object.assign(new Error('secret connection URL'), { code: '42501' }),
      503,
      'workbench_unavailable',
    ],
    [
      Object.defineProperty({}, 'code', {
        get() {
          throw new Error('getter must never run');
        },
      }),
      503,
      'workbench_unavailable',
    ],
    [
      new Proxy(
        {},
        {
          getOwnPropertyDescriptor() {
            throw new Error('trap must never run');
          },
        },
      ),
      503,
      'workbench_unavailable',
    ],
  ]) {
    const handle = createSignalWorkbenchHandler({
      authenticate: async () => ({}),
      origin: () => origin,
      execute: async () => {
        throw error;
      },
    });
    const response = await handle(request(), 'list');
    assert.equal(response.status, status);
    assert.deepEqual(await response.json(), { error: code });
    assert.equal(response.headers.get('cache-control'), 'private, no-store');
  }
});

test('workbench distinguishes unavailable authentication and missing trusted origin', async () => {
  const execute = async () => {
    throw new Error('must not query');
  };
  const authFailure = createSignalWorkbenchHandler({
    authenticate: async () => {
      throw new Error('secret');
    },
    origin: () => origin,
    execute,
  });
  assert.deepEqual(await (await authFailure(request(), 'list')).json(), {
    error: 'authentication_unavailable',
  });
  for (const configuredOrigin of [
    () => null,
    () => {
      throw new Error('secret');
    },
  ]) {
    const handle = createSignalWorkbenchHandler({
      authenticate: async () => ({}),
      origin: configuredOrigin,
      execute,
    });
    const response = await handle(request(), 'list');
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { error: 'workbench_not_configured' });
  }
});
