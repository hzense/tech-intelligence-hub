import test from 'node:test';
import assert from 'node:assert/strict';
import { createGenerationHandler } from '../lib/admin-signal-generation-handler.ts';
import { SignalGenerationError } from '../../../packages/database/src/signal-generation-store.mjs';

const { Request } = globalThis;
const id = '11111111-1111-4111-8111-111111111111';
const queuedAt = '2026-10-03T09:49:00.000Z';
const payload = { action: 'resolve_queue', id, queuedAt };
function fixture(overrides = {}) {
  const calls = [];
  const handler = createGenerationHandler({
    session: async () => ({ user: { id: 'owner' } }),
    origin: () => 'https://hzense.com',
    dashboard: async () => assert.fail('must not read dashboard'),
    execute: async () => assert.fail('must not call generation executor'),
    enqueue: async () => assert.fail('must not start workflow'),
    resolveQueue: async (...args) => {
      calls.push(args);
      return { id, status: 'failed', progress_at: queuedAt };
    },
    ...overrides,
  });
  const request = (body = payload, headers = {}) =>
    handler(
      new Request('https://hzense.com/api/admin/signal-generation', {
        method: 'POST',
        headers: {
          host: 'hzense.com',
          origin: 'https://hzense.com',
          'content-type': 'application/json',
          ...headers,
        },
        body: JSON.stringify(body),
      }),
    );
  return { request, calls };
}

test('queue resolution binds the authenticated owner and exact dispatch without invoking AI', async () => {
  const f = fixture();
  const response = await f.request();
  assert.equal(response.status, 200);
  assert.deepEqual(f.calls, [['owner', id, queuedAt]]);
  assert.equal((await response.json()).run.status, 'failed');
});

test('queue resolution requires authentication and same-origin mutation guards', async () => {
  const anonymous = fixture({ session: async () => null });
  assert.equal((await anonymous.request()).status, 401);
  assert.deepEqual(anonymous.calls, []);
  for (const headers of [
    { origin: 'https://other.example' },
    { host: 'other.example' },
    { 'sec-fetch-site': 'cross-site' },
  ]) {
    const f = fixture();
    assert.equal((await f.request(payload, headers)).status, 403);
    assert.deepEqual(f.calls, []);
  }
});

test('queue resolution rejects missing, malformed, noncanonical or caller-supplied authority', async () => {
  for (const body of [
    { action: 'resolve_queue', id },
    { ...payload, queuedAt: null },
    { ...payload, queuedAt: 'invalid' },
    { ...payload, queuedAt: '2026-10-03T09:49:00Z' },
    { ...payload, queuedAt: '2026-02-30T09:49:00.000Z' },
    { ...payload, id: 'not-a-uuid' },
    { ...payload, owner: 'someone-else' },
  ]) {
    const f = fixture();
    assert.equal((await f.request(body)).status, 400);
    assert.deepEqual(f.calls, []);
  }
});

test('queue resolution surfaces races and missing configuration without false success', async () => {
  for (const code of ['task_active', 'stale_attempt']) {
    const f = fixture({
      resolveQueue: async () => {
        throw new SignalGenerationError(code);
      },
    });
    const response = await f.request();
    assert.equal(response.status, 409);
    assert.deepEqual(await response.json(), { error: code });
  }
  assert.equal((await fixture({ resolveQueue: undefined }).request()).status, 503);
});
