import assert from 'node:assert/strict';
import test from 'node:test';
import { createLocalAutomationSchedulerHandler } from '../lib/local-automation-scheduler-handler.ts';
import { localDatabaseEnvironmentRoles } from '../lib/local-development.ts';

const origin = 'http://127.0.0.1:3000';
function environment() {
  return {
    NODE_ENV: 'development',
    VERCEL_ENV: 'development',
    PORT: '3000',
    NEXTAUTH_URL: origin,
    HZENSE_LOCAL_DEVELOPMENT: '1',
    HZENSE_LOCAL_AI_MODE: 'real',
    HZENSE_RUNTIME_EXPECTED_HOST: '127.0.0.1',
    HZENSE_RUNTIME_EXPECTED_PORT: '55432',
    HZENSE_RUNTIME_EXPECTED_NAME: 'hzense_local',
    HZENSE_RUNTIME_EXPECTED_USER: 'hzense_runtime',
    HZENSE_AUTOMATION_ENABLED: '1',
    WORKFLOW_TARGET_WORLD: 'local',
    HZENSE_LOCAL_AUTOMATION_SCHEDULER_ENABLED: '1',
    ...Object.fromEntries(
      Object.entries(localDatabaseEnvironmentRoles).map(([key, role]) => [
        key,
        `postgresql://${role}:${'a'.repeat(64)}@127.0.0.1:55432/hzense_local`,
      ]),
    ),
  };
}
function request(options = {}) {
  return new globalThis.Request(options.url ?? `${origin}/api/admin/local-automation-scheduler`, {
    method: options.method ?? 'POST',
    headers: { host: '127.0.0.1:3000', origin, ...options.headers },
  });
}

test('local scheduler accepts only explicit isolated real mode before dispatching', async () => {
  let env = environment(),
    calls = 0;
  const handler = createLocalAutomationSchedulerHandler({
    environment: () => env,
    dispatch: async () => {
      calls++;
      return { dispatched: 2, failed: 1 };
    },
  });
  const ok = await handler(request());
  assert.equal(ok.status, 200);
  assert.deepEqual(await ok.json(), { dispatched: 2, failed: 1 });
  assert.match(ok.headers.get('cache-control'), /no-store/);
  assert.equal(calls, 1);
  for (const patch of [
    { HZENSE_LOCAL_AUTOMATION_SCHEDULER_ENABLED: undefined },
    { HZENSE_LOCAL_AUTOMATION_SCHEDULER_ENABLED: '0' },
    { HZENSE_LOCAL_AI_MODE: 'mock' },
    { HZENSE_LOCAL_AI_MODE: undefined },
    { HZENSE_LOCAL_DEVELOPMENT: undefined },
    { NODE_ENV: 'production' },
    { VERCEL_ENV: 'production' },
    { VERCEL: '1' },
    { WORKFLOW_TARGET_WORLD: 'vercel' },
    { HZENSE_AUTOMATION_ENABLED: '0' },
    { HZENSE_AUTOMATION_DATABASE_URL: 'postgresql://remote.invalid/db' },
  ]) {
    env = { ...environment(), CRON_SECRET: 'synthetic-cron-secret-with-24-characters', ...patch };
    const denied = await handler(
      request({ headers: { authorization: `Bearer ${env.CRON_SECRET}` } }),
    );
    assert.equal(denied.status, 403);
    assert.deepEqual(await denied.json(), { error: 'execution_disabled' });
  }
  assert.equal(calls, 1, 'Cron credentials never bypass local scheduler admission');
});

test('local scheduler rejects methods and forged request authorities before side effects', async () => {
  let calls = 0;
  const handler = createLocalAutomationSchedulerHandler({
    environment,
    dispatch: async () => {
      calls++;
      return { dispatched: 0, failed: 0 };
    },
  });
  for (const method of ['GET', 'HEAD', 'OPTIONS', 'PUT', 'DELETE', 'PATCH'])
    assert.equal((await handler(request({ method }))).status, 405);
  for (const options of [
    { headers: { host: 'localhost:3000' } },
    { headers: { host: 'evil.invalid', 'x-forwarded-host': '127.0.0.1:3000' } },
    { headers: { origin: 'http://evil.invalid' } },
    { headers: { origin: '' } },
    { headers: { origin: 'null' } },
    { headers: { origin: 'http://127.0.0.1:3001' } },
    { headers: { 'sec-fetch-site': 'cross-site' } },
    { headers: { forwarded: 'host=127.0.0.1:3000' } },
    { headers: { 'x-forwarded-host': 'evil.invalid' } },
    { headers: { 'x-forwarded-proto': 'https' } },
    { headers: { 'x-forwarded-port': '3001' } },
    { url: 'https://evil.invalid/api/admin/local-automation-scheduler' },
  ]) {
    const denied = await handler(request(options));
    assert.equal(denied.status, 403);
    assert.deepEqual(await denied.json(), { error: 'forbidden' });
  }
  const missingOrigin = request();
  missingOrigin.headers.delete('origin');
  assert.equal((await handler(missingOrigin)).status, 403);
  for (const suffix of ['?token=synthetic-private', '#unexpected'])
    assert.equal(
      (await handler(request({ url: `${origin}/api/admin/local-automation-scheduler${suffix}` })))
        .status,
      400,
    );
  assert.equal(calls, 0);
  assert.equal(
    (await handler(request({ url: 'http://localhost:3000/api/admin/local-automation-scheduler' })))
      .status,
    200,
    'NextURL loopback canonicalization remains compatible with the strict Host and Origin checks',
  );
});

test('local scheduler hides dependency errors and returns only dispatch counters', async () => {
  const failed = createLocalAutomationSchedulerHandler({
    environment,
    dispatch: async () => {
      throw Error('synthetic-private-credential');
    },
  });
  const response = await failed(request());
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: 'unavailable' });
  const safe = createLocalAutomationSchedulerHandler({
    environment,
    dispatch: async () => ({
      dispatched: 1,
      failed: 0,
      privateValue: 'synthetic-private-credential',
    }),
  });
  assert.deepEqual(await (await safe(request())).json(), { dispatched: 1, failed: 0 });
});
