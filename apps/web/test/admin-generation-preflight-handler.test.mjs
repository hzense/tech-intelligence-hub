import test from 'node:test';
import assert from 'node:assert/strict';
import { createGenerationPreflightHandler } from '../lib/admin-generation-preflight-handler.ts';

const { Request } = globalThis;

const origin = 'https://hzense.example';
const success = {
  status: 'ok',
  checks: {
    configuration: true,
    connection: true,
    tls: true,
    identity: true,
    readOnly: true,
    permissions: true,
  },
};
function fixture(overrides = {}) {
  let calls = 0;
  const handler = createGenerationPreflightHandler({
    session: async () => ({ user: { id: 'fixture-admin' } }),
    origin: () => origin,
    preflight: async () => {
      calls++;
      return success;
    },
    ...overrides,
  });
  return { handler, calls: () => calls };
}
function request(options = {}) {
  const { method = 'POST', body = '{}', headers = {}, suffix = '' } = options;
  return new Request(`${origin}/api/admin/signal-generation/preflight${suffix}`, {
    method,
    ...(method === 'GET' ? {} : { body }),
    headers: {
      host: 'hzense.example',
      origin,
      'sec-fetch-site': 'same-origin',
      'content-type': 'application/json',
      ...headers,
    },
  });
}
test('preflight requires an explicit authenticated same-origin POST and empty declaration', async () => {
  const f = fixture();
  const response = await f.handler(request());
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), success);
  assert.equal(response.headers.get('cache-control'), 'private, no-store, max-age=0');
  assert.equal(response.headers.get('x-robots-tag'), 'noindex, nofollow');
  assert.equal(f.calls(), 1);
  for (const [options, status] of [
    [{ method: 'GET' }, 405],
    [{ headers: { origin: 'https://evil.example' } }, 403],
    [{ headers: { origin: '' } }, 403],
    [{ headers: { host: 'evil.example' } }, 403],
    [{ headers: { 'sec-fetch-site': 'cross-site' } }, 403],
    [{ suffix: '?database=another' }, 400],
    [{ body: '{"connectionString":"secret"}' }, 400],
    [{ body: 'null' }, 400],
    [{ body: '[]' }, 400],
  ]) {
    assert.equal((await f.handler(request(options))).status, status);
    assert.equal(f.calls(), 1);
  }
});
test('anonymous calls and dependency errors never expose secrets or reach the database', async () => {
  const anonymous = fixture({ session: async () => null });
  assert.equal((await anonymous.handler(request())).status, 401);
  assert.equal(anonymous.calls(), 0);
  const f = fixture({
    preflight: async () => {
      throw new Error('SYNTHETIC_DB_PASSWORD');
    },
  });
  const response = await f.handler(request());
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: 'preflight_unavailable' });
});
test('an unavailable preflight cannot return a successful HTTP status', async () => {
  const value = { ...success, status: 'unavailable', error: 'permissions_invalid' };
  const f = fixture({ preflight: async () => value });
  const response = await f.handler(request());
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), value);
});
