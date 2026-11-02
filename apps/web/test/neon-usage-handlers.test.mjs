import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createNeonUsageAdminHandler,
  createNeonUsageScheduledHandler,
} from '../lib/neon-usage-handlers.ts';
import { makeNeonUsageDashboard, NeonUsageError } from '../lib/neon-usage-core.ts';

const { Request } = globalThis;

const origin = 'https://hzense.example.invalid';
const dashboard = makeNeonUsageDashboard({
  history: null,
  now: new Date('2026-11-02T12:00:00Z'),
  projectId: null,
});
function request(method = 'GET', headers = {}, search = '') {
  return new Request(`${origin}/api/admin/neon-usage${search}`, { method, headers });
}

test('administrator reads authenticate and never sample; writes require exact Origin', async () => {
  let signedIn = false,
    samples = 0,
    reads = 0;
  const handler = createNeonUsageAdminHandler({
    authenticate: async () => signedIn,
    origin: () => origin,
    dashboard: async () => {
      reads++;
      return dashboard;
    },
    sample: async () => {
      samples++;
      return 'sampled';
    },
  });
  assert.equal((await handler(request())).status, 401);
  assert.equal(reads, 0);
  signedIn = true;
  const result = await handler(request());
  assert.equal(result.status, 200);
  assert.match(result.headers.get('cache-control'), /private.*no-store/);
  assert.deepEqual(await result.json(), dashboard);
  assert.equal(samples, 0);
  for (const headers of [
    {},
    { origin: 'https://attacker.invalid' },
    { origin, 'sec-fetch-site': 'cross-site' },
  ])
    assert.equal((await handler(request('POST', headers))).status, 403);
  assert.equal(samples, 0);
  assert.equal((await handler(request('POST', { origin }))).status, 200);
  assert.equal(samples, 1);
  assert.equal((await handler(request('GET', {}, '?project_id=other'))).status, 400);
  assert.equal((await handler(request('DELETE', { origin }))).status, 405);
});

test('administrator API sanitizes provider and storage failures', async () => {
  for (const [error, status, code] of [
    [new Error('private-token-host-owner'), 503, 'storage_unavailable'],
    [new NeonUsageError('provider_rate_limited'), 429, 'provider_rate_limited'],
    [new NeonUsageError('provider_unauthorized'), 503, 'provider_unauthorized'],
  ]) {
    const handler = createNeonUsageAdminHandler({
      authenticate: async () => true,
      origin: () => origin,
      dashboard: async () => dashboard,
      sample: async () => {
        throw error;
      },
    });
    const response = await handler(request('POST', { origin }));
    assert.equal(response.status, status);
    assert.deepEqual(await response.json(), { error: code });
  }
});

test('AI ledger owner comes only from the authenticated session, never request input', async () => {
  const session = { user: { id: 'authenticated-administrator' } };
  const seen = [];
  const handler = createNeonUsageAdminHandler({
    authenticate: async () => session,
    origin: () => origin,
    dashboard: async (authenticated) => {
      seen.push(authenticated.user.id);
      return dashboard;
    },
    sample: async () => 'recent',
  });
  assert.equal((await handler(request('GET', {}, '?owner=someone-else'))).status, 400);
  assert.equal(seen.length, 0);
  assert.equal(
    (
      await handler(
        new Request(`${origin}/api/admin/neon-usage`, {
          method: 'POST',
          headers: { origin, 'content-type': 'application/json' },
          body: JSON.stringify({ owner: 'someone-else' }),
        }),
      )
    ).status,
    200,
  );
  assert.deepEqual(seen, ['authenticated-administrator']);
});

test('scheduled endpoint requires separate long bearer token and rejects malformed Unicode safely', async () => {
  const secret = 's'.repeat(40);
  let calls = 0;
  let configured = secret;
  const handler = createNeonUsageScheduledHandler({
    secret: () => configured,
    sample: async () => {
      calls++;
      return 'recent';
    },
  });
  for (const authorization of [
    '',
    `Bearer ${'x'.repeat(40)}`,
    `Bearer ${'é'.repeat(40)}`,
    `bearer ${secret}`,
  ]) {
    const response = await handler(request('POST', { authorization }));
    assert.equal(response.status, 401);
  }
  assert.equal(calls, 0);
  const headers = { authorization: `Bearer ${secret}` };
  const result = await handler(request('POST', headers));
  assert.equal(result.status, 200);
  assert.deepEqual(await result.json(), { status: 'recent' });
  assert.match(result.headers.get('cache-control'), /no-store/);
  assert.equal(calls, 1);
  assert.equal((await handler(request('GET', headers))).status, 405);
  assert.equal((await handler(request('POST', headers, '?project=other'))).status, 400);
  configured = 'short';
  assert.equal((await handler(request('POST', { authorization: 'Bearer short' }))).status, 401);
  configured = undefined;
  assert.equal((await handler(request('POST', headers))).status, 401);
  assert.equal(calls, 1);
});
