import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { URL } from 'node:url';

import {
  createLazyRuntimeTopicReader,
  createRuntimeReaderHealthHandler,
  readRuntimeReaderConfig,
  runtimeTopicLimit,
  runtimeTopicQuery,
} from '../lib/runtime-reader-core.ts';

const pooledHost = 'ep-runtime-reader-pooler.us-east-1.aws.neon.tech';
const databaseSecret = 'not-a-real-password';

function runtimeEnvironment(overrides = {}) {
  return {
    HZENSE_RUNTIME_DATABASE_URL:
      `postgresql://hzense_runtime:${databaseSecret}@${pooledHost}:5432/hzense` +
      '?sslmode=verify-full&channel_binding=prefer',
    HZENSE_RUNTIME_EXPECTED_HOST: pooledHost,
    HZENSE_RUNTIME_EXPECTED_NAME: 'hzense',
    HZENSE_RUNTIME_EXPECTED_PORT: '5432',
    HZENSE_RUNTIME_EXPECTED_USER: 'hzense_runtime',
    VERCEL_ENV: 'production',
    ...overrides,
  };
}

function topic(overrides = {}) {
  return {
    id: 'ai-agents',
    parentId: null,
    runtimeEnabled: true,
    status: 'watching',
    title: 'AI Agents',
    ...overrides,
  };
}

function assertRuntimeError(code) {
  return (error) => {
    assert.equal(error?.name, 'RuntimeReaderError');
    assert.equal(error?.code, code);
    assert.equal(error?.message, 'Runtime reader is unavailable');
    return true;
  };
}

test('accepts only the reviewed production pooled target and fixed runtime role', () => {
  const config = readRuntimeReaderConfig(runtimeEnvironment());

  assert.equal(config.host, pooledHost);
  assert.equal(config.port, 5432);
  assert.equal(config.database, 'hzense');
  assert.equal(config.user, 'hzense_runtime');
  assert.match(config.connectionString, /^postgresql:\/\//);
});

test('fails closed outside Vercel Production without reading a generic database URL', () => {
  assert.throws(
    () =>
      readRuntimeReaderConfig({
        DATABASE_URL:
          `postgresql://hzense_runtime:${databaseSecret}@${pooledHost}:5432/hzense` +
          '?sslmode=verify-full',
        VERCEL_ENV: 'preview',
      }),
    assertRuntimeError('not_production'),
  );

  assert.throws(
    () =>
      readRuntimeReaderConfig({ DATABASE_URL: 'postgresql://ignored', VERCEL_ENV: 'production' }),
    assertRuntimeError('missing_configuration'),
  );
});

test('requires verify-full TLS, channel-binding preference, and no named Node TLS bypass', () => {
  assert.throws(
    () =>
      readRuntimeReaderConfig(
        runtimeEnvironment({
          HZENSE_RUNTIME_DATABASE_URL:
            `postgresql://hzense_runtime:${databaseSecret}@${pooledHost}:5432/hzense` +
            '?sslmode=require',
        }),
      ),
    assertRuntimeError('tls_required'),
  );
  assert.throws(
    () =>
      readRuntimeReaderConfig(
        runtimeEnvironment({
          HZENSE_RUNTIME_DATABASE_URL:
            `postgresql://hzense_runtime:${databaseSecret}@${pooledHost}:5432/hzense` +
            '?sslmode=verify-full',
        }),
      ),
    assertRuntimeError('tls_required'),
  );
  assert.throws(
    () => readRuntimeReaderConfig(runtimeEnvironment({ NODE_TLS_REJECT_UNAUTHORIZED: '0' })),
    assertRuntimeError('tls_required'),
  );

  assert.throws(
    () =>
      readRuntimeReaderConfig(
        runtimeEnvironment({
          HZENSE_RUNTIME_DATABASE_URL:
            `postgresql://hzense_runtime:${databaseSecret}@${pooledHost}:5432/hzense` +
            '?sslmode=verify-full&channel_binding=require',
        }),
      ),
    assertRuntimeError('tls_required'),
  );
});

test('rejects direct endpoints, implicit ports, target drift, and non-runtime roles', () => {
  const directHost = 'ep-runtime-reader.us-east-1.aws.neon.tech';
  assert.throws(
    () =>
      readRuntimeReaderConfig(
        runtimeEnvironment({
          HZENSE_RUNTIME_DATABASE_URL:
            `postgresql://hzense_runtime:${databaseSecret}@${directHost}:5432/hzense` +
            '?sslmode=verify-full&channel_binding=prefer',
          HZENSE_RUNTIME_EXPECTED_HOST: directHost,
        }),
      ),
    assertRuntimeError('pooled_endpoint_required'),
  );
  assert.throws(
    () =>
      readRuntimeReaderConfig(
        runtimeEnvironment({
          HZENSE_RUNTIME_DATABASE_URL:
            `postgresql://hzense_runtime:${databaseSecret}@${pooledHost}/hzense` +
            '?sslmode=verify-full&channel_binding=prefer',
        }),
      ),
    assertRuntimeError('target_mismatch'),
  );
  assert.throws(
    () =>
      readRuntimeReaderConfig(
        runtimeEnvironment({ HZENSE_RUNTIME_EXPECTED_NAME: 'another_database' }),
      ),
    assertRuntimeError('target_mismatch'),
  );
  assert.throws(
    () =>
      readRuntimeReaderConfig(runtimeEnvironment({ HZENSE_RUNTIME_EXPECTED_USER: 'neondb_owner' })),
    assertRuntimeError('runtime_role_required'),
  );
  assert.throws(
    () =>
      readRuntimeReaderConfig(
        runtimeEnvironment({
          HZENSE_RUNTIME_DATABASE_URL:
            `postgresql://hzense_runtime:${databaseSecret}@runtime-pooler.example.com:5432/hzense` +
            '?sslmode=verify-full&channel_binding=prefer',
          HZENSE_RUNTIME_EXPECTED_HOST: 'runtime-pooler.example.com',
        }),
      ),
    assertRuntimeError('pooled_endpoint_required'),
  );
});

test('creates one lazy pg-compatible pool and always uses the fixed parameterized query', async () => {
  const createdOptions = [];
  const queries = [];
  const reader = createLazyRuntimeTopicReader({
    createPool(options) {
      createdOptions.push(options);
      return {
        idleCount: 1,
        totalCount: 1,
        waitingCount: 0,
        async query(queryText, values) {
          queries.push({ queryText, values });
          return { rows: [topic()] };
        },
      };
    },
    environment: () => runtimeEnvironment(),
  });

  assert.equal(reader.hasPool(), false);
  assert.deepEqual(reader.poolStats(), { idle: 0, total: 0, waiting: 0 });

  assert.deepEqual(await reader.readTopics(2), [topic()]);
  assert.deepEqual(await reader.readTopics(50), [topic()]);

  assert.equal(reader.hasPool(), true);
  assert.equal(createdOptions.length, 1);
  assert.equal(createdOptions[0].max, 1);
  assert.equal(createdOptions[0].allowExitOnIdle, true);
  assert.equal(createdOptions[0].application_name, 'hzense-web-runtime');
  assert.equal(createdOptions[0].enableChannelBinding, true);
  assert.equal(createdOptions[0].query_timeout, 3_000);
  assert.equal('statement_timeout' in createdOptions[0], false);
  assert.equal('ssl' in createdOptions[0], false);
  assert.deepEqual(reader.poolStats(), { idle: 1, total: 1, waiting: 0 });
  assert.deepEqual(queries, [
    { queryText: runtimeTopicQuery, values: [2] },
    { queryText: runtimeTopicQuery, values: [50] },
  ]);
  assert.match(runtimeTopicQuery, /WHERE runtime_enabled IS TRUE/);
  assert.match(runtimeTopicQuery, /FROM ONLY public\.topics/);
  assert.match(runtimeTopicQuery, /ORDER BY id/);
  assert.match(runtimeTopicQuery, /LIMIT \$1::integer$/);
  assert.doesNotMatch(runtimeTopicQuery, /metadata/i);
});

test('enforces the Topic query limit before creating a pool', async () => {
  for (const value of [0, -1, 51, 1.5, Number.NaN, '1']) {
    assert.throws(() => runtimeTopicLimit(value), assertRuntimeError('invalid_limit'));
  }
  assert.equal(runtimeTopicLimit(1), 1);
  assert.equal(runtimeTopicLimit(50), 50);

  let poolCreations = 0;
  const reader = createLazyRuntimeTopicReader({
    createPool() {
      poolCreations += 1;
      throw new Error('must not create a pool');
    },
    environment: () => runtimeEnvironment(),
  });
  await assert.rejects(reader.readTopics(51), assertRuntimeError('invalid_limit'));
  assert.equal(poolCreations, 0);
});

test('health returns only status ok, disables caching, and emits a bounded safe log', async () => {
  const logs = [];
  const clockValues = [100, 125];
  const handler = createRuntimeReaderHealthHandler({
    clock: () => clockValues.shift(),
    log: (record) => logs.push(record),
    poolStats: () => ({ idle: 1, total: 1, waiting: 0 }),
    readTopics: async (limit) => {
      assert.equal(limit, 1);
      return [topic()];
    },
  });

  const response = await handler({
    headers: {
      get: (name) => (name.toLowerCase() === 'x-vercel-id' ? 'iad1::unit-test' : null),
    },
  });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(response.headers.get('retry-after'), null);
  assert.equal(await response.text(), '{"status":"ok"}');
  assert.deepEqual(logs, [
    {
      duration_ms: 25,
      event: 'runtime_reader_health',
      outcome: 'ok',
      pool_idle: 1,
      pool_total: 1,
      pool_waiting: 0,
      request_id: 'iad1::unit-test',
    },
  ]);
});

test('health returns a generic 503 and never logs database error details or secrets', async () => {
  const leakedSecret = `postgresql://hzense_runtime:${databaseSecret}@${pooledHost}:5432/hzense`;
  const databaseError = Object.assign(new Error(`connection failed: ${leakedSecret}`), {
    code: '28P01',
    connectionString: leakedSecret,
  });
  const logs = [];
  const handler = createRuntimeReaderHealthHandler({
    clock: () => 200,
    log: (record) => logs.push(record),
    poolStats: () => ({ idle: 0, total: 1, waiting: 1 }),
    readTopics: async () => {
      throw databaseError;
    },
  });

  const response = await handler();
  assert.equal(response.status, 503);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(response.headers.get('retry-after'), '5');
  assert.equal(await response.text(), '{"status":"unavailable"}');
  assert.deepEqual(logs, [
    {
      duration_ms: 0,
      error_code: 'query_failed',
      event: 'runtime_reader_health',
      outcome: 'unavailable',
      pool_idle: 0,
      pool_total: 1,
      pool_waiting: 1,
      sqlstate: '28P01',
    },
  ]);
  const serializedLog = JSON.stringify(logs);
  assert.doesNotMatch(serializedLog, /not-a-real-password/);
  assert.doesNotMatch(serializedLog, /neon\.tech/);
  assert.doesNotMatch(serializedLog, /connection failed/);
});

test('health treats an empty runtime projection as unavailable', async () => {
  const logs = [];
  const handler = createRuntimeReaderHealthHandler({
    log: (record) => logs.push(record),
    poolStats: () => ({ idle: 1, total: 1, waiting: 0 }),
    readTopics: async () => [],
  });

  const response = await handler();
  assert.equal(response.status, 503);
  assert.equal(await response.text(), '{"status":"unavailable"}');
  assert.equal(logs[0].error_code, 'empty_projection');
});

test('route and server module preserve the Node-only, request-time deployment boundary', async () => {
  const routeSource = await readFile(
    new URL('../app/api/health/database/route.ts', import.meta.url),
    'utf8',
  );
  const serverSource = await readFile(
    new URL('../lib/server/runtime-reader.ts', import.meta.url),
    'utf8',
  );
  const vercelConfig = JSON.parse(
    await readFile(new URL('../vercel.json', import.meta.url), 'utf8'),
  );

  assert.match(routeSource, /export const runtime = 'nodejs'/);
  assert.match(routeSource, /export const dynamic = 'force-dynamic'/);
  assert.match(routeSource, /export const maxDuration = 10/);
  assert.doesNotMatch(routeSource, /preferredRegion/);
  assert.deepEqual(vercelConfig, {
    $schema: 'https://openapi.vercel.sh/vercel.json',
    regions: ['iad1'],
  });
  assert.match(serverSource, /import 'server-only'/);
  assert.match(serverSource, /new Pool\(options\)/);
  assert.doesNotMatch(serverSource, /DATABASE_DIRECT_URL|DATABASE_URL|NEXT_PUBLIC_/);
});
