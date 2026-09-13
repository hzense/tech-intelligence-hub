import assert from 'node:assert/strict';
import test from 'node:test';
const { Request, ReadableStream } = globalThis;
import {
  createPublicationHandler,
  validPublicationCommand,
  readPublisherConfiguration,
  PublisherConfigurationError,
  PublicationOutcomeUnknownError,
} from '../lib/admin-publication-core.ts';

const origin = 'https://hzense.com';
const publish = {
  request_key: 'request-1',
  signal_id: 'test-signal',
  source_version: 2,
  target_version: 3,
  expected_revision: 0,
  reason_code: 'initial_publication',
  run_id: 'aaaaaaaa-1111-2222-3333-444444444444',
  lease_owner: 'bbbbbbbb-1111-2222-3333-444444444444',
  fencing_token: 1,
};
const withdraw = {
  request_key: 'withdraw-1',
  signal_id: 'test-signal',
  target_version: 3,
  expected_revision: 1,
  reason_code: 'privacy',
};
const request = (body, extra = {}) =>
  new Request(`${origin}/api/admin/signals/publish`, {
    method: 'POST',
    headers: { origin, 'content-type': 'application/json', ...extra },
    body: JSON.stringify(body),
  });

test('strict commands accept identifiers only and reject caller authority/material', () => {
  assert.ok(validPublicationCommand(publish, 'publish'));
  assert.ok(validPublicationCommand(withdraw, 'withdraw'));
  for (const key of [
    'title',
    'analysis',
    'actor',
    'verification_id',
    'verified',
    'checks',
    'pool',
  ]) {
    assert.equal(validPublicationCommand({ ...publish, [key]: true }, 'publish'), false);
  }
  for (const replacement of [
    { target_version: 2 },
    { expected_revision: -1 },
    { fencing_token: 0 },
    { run_id: 'fake' },
    { signal_id: 'id\n' },
    { source_version: '2' },
    { request_key: 'key\n' },
  ]) {
    assert.equal(validPublicationCommand({ ...publish, ...replacement }, 'publish'), false);
  }
  assert.equal(validPublicationCommand({ ...withdraw, run_id: publish.run_id }, 'withdraw'), false);
});

test('ambiguous commit confirmation is not described as a rolled-back write', async () => {
  const handle = createPublicationHandler({
    authenticate: async () => true,
    origin: () => origin,
    execute: async () => {
      throw new PublicationOutcomeUnknownError();
    },
  });
  const response = await handle(request(publish), 'publish');
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: 'publication_outcome_unknown' });
});

test('unauthenticated and cross-origin requests never execute or parse private commands', async () => {
  let calls = 0;
  const handle = createPublicationHandler({
    authenticate: async () => null,
    origin: () => origin,
    execute: async () => {
      calls++;
    },
  });
  const denied = await handle(request(publish), 'publish');
  assert.equal(denied.status, 401);
  assert.equal(denied.headers.get('cache-control'), 'private, no-store');
  const authenticated = createPublicationHandler({
    authenticate: async () => ({ user: { id: 'server-only' } }),
    origin: () => origin,
    execute: async () => {
      calls++;
    },
  });
  for (const headers of [
    { origin: 'https://evil.example' },
    { origin: 'null' },
    { origin: `${origin}.evil.example` },
    { 'sec-fetch-site': 'cross-site' },
    { 'sec-fetch-site': 'same-site' },
  ]) {
    assert.equal((await authenticated(request(publish, headers), 'publish')).status, 403);
  }
  assert.equal(calls, 0);
});

test('body format and actual streamed size are bounded before DB work', async () => {
  let calls = 0;
  const handle = createPublicationHandler({
    authenticate: async () => true,
    origin: () => origin,
    execute: async () => {
      calls++;
    },
  });
  assert.equal(
    (await handle(request(publish, { 'content-type': 'text/plain' }), 'publish')).status,
    415,
  );
  assert.equal(
    (await handle(request({ ...publish, title: 'x'.repeat(5000) }), 'publish')).status,
    400,
  );
  assert.equal(
    (await handle(request(publish, { 'content-length': '9000' }), 'publish')).status,
    400,
  );
  assert.equal((await handle(request({ ...publish, verified: true }), 'publish')).status, 400);
  const streaming = new Request(`${origin}/api/admin/signals/publish`, {
    method: 'POST',
    headers: { origin, 'content-type': 'application/json', 'content-length': '1' },
    duplex: 'half',
    body: new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array(4097));
        controller.close();
      },
    }),
  });
  assert.equal((await handle(streaming, 'publish')).status, 400);
  assert.equal(calls, 0);
});

test('withdrawal has no task/auto-publish dependency; replay is returned as historical receipt', async () => {
  const receipt = {
    outcome: 'replay',
    status: 'withdrawn',
    publication_revision: 2,
    current_public: false,
  };
  const handle = createPublicationHandler({
    authenticate: async () => true,
    origin: () => origin,
    execute: async (operation, command) => {
      assert.equal(operation, 'withdraw');
      assert.deepEqual(command, withdraw);
      return receipt;
    },
  });
  const response = await handle(request(withdraw), 'withdraw');
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), receipt);
});

test('no SQL diagnostics, evidence or credentials are exposed in failure responses', async () => {
  for (const error of [
    new Error('postgresql://private-secret evidence text'),
    new PublisherConfigurationError(),
  ]) {
    const handle = createPublicationHandler({
      authenticate: async () => true,
      origin: () => origin,
      execute: async () => {
        throw error;
      },
    });
    const response = await handle(request(publish), 'publish');
    assert.equal(response.status, error instanceof PublisherConfigurationError ? 503 : 409);
    assert.doesNotMatch(await response.text(), /private-secret|postgresql|evidence text/);
  }
});

const env = {
  VERCEL_ENV: 'production',
  HZENSE_RUNTIME_EXPECTED_HOST: 'ep-test-pooler.eu-central-1.aws.neon.tech',
  HZENSE_RUNTIME_EXPECTED_PORT: '5432',
  HZENSE_RUNTIME_EXPECTED_NAME: 'testdb',
  HZENSE_RUNTIME_EXPECTED_USER: 'hzense_runtime',
  HZENSE_PUBLISHER_DATABASE_URL:
    'postgresql://hzense_publisher:fixture-only@ep-test-pooler.eu-central-1.aws.neon.tech:5432/testdb?sslmode=verify-full&channel_binding=prefer',
};
test('publisher requires independent role, approved production target and verified TLS', () => {
  assert.equal(readPublisherConfiguration(env), env.HZENSE_PUBLISHER_DATABASE_URL);
  for (const patch of [
    { VERCEL_ENV: 'preview' },
    { VERCEL_ENV: 'development' },
    { HZENSE_PUBLISHER_DATABASE_URL: undefined },
    {
      HZENSE_PUBLISHER_DATABASE_URL: env.HZENSE_PUBLISHER_DATABASE_URL.replace(
        'hzense_publisher',
        'hzense_migrator',
      ),
    },
    {
      HZENSE_PUBLISHER_DATABASE_URL: env.HZENSE_PUBLISHER_DATABASE_URL.replace(
        'verify-full',
        'require',
      ),
    },
    {
      HZENSE_PUBLISHER_DATABASE_URL: env.HZENSE_PUBLISHER_DATABASE_URL.replace(
        '/testdb?',
        '/other?',
      ),
    },
    {
      HZENSE_PUBLISHER_DATABASE_URL: env.HZENSE_PUBLISHER_DATABASE_URL.replace(
        'fixture-only',
        'fixture\n-only',
      ),
    },
    { NODE_TLS_REJECT_UNAUTHORIZED: '0' },
  ]) {
    assert.throws(
      () => readPublisherConfiguration({ ...env, ...patch }),
      PublisherConfigurationError,
    );
  }
});
