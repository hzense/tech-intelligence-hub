import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAutomationHandler } from '../lib/admin-automation-handler.ts';

const origin = 'https://hzense.com';
const request = (method, body, headers = {}) =>
  new globalThis.Request(`${origin}/api/admin/automation`, {
    method,
    headers: {
      host: 'hzense.com',
      ...(method === 'POST' ? { origin, 'content-type': 'application/json' } : {}),
      ...headers,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
const deps = () => ({
  session: async () => ({ user: { id: 'operator' } }),
  origin: () => origin,
  dashboard: async () => ({
    configs: [],
    runs: [
      {
        id: 'run',
        owner_id: 'operator',
        lease_token: 'secret-token',
        frozen_inputs: { inputs: ['x'] },
        snapshot: { kind: 'topic_insight' },
      },
    ],
  }),
  save: async () => ({ id: 'config' }),
  trigger: async () => ({ run: { id: 'run', owner_id: 'operator', lease_token: 'secret-token' } }),
  publish: async () => ({ id: 'run', owner_id: 'operator', lease_token: 'secret-token' }),
});
test('automation admin API checks session and origin before execution', async () => {
  let calls = 0;
  const handler = createAutomationHandler({
    ...deps(),
    session: async () => null,
    dashboard: async () => {
      calls++;
      return {};
    },
  });
  assert.equal((await handler(request('GET'))).status, 401);
  assert.equal(calls, 0);
  const h = createAutomationHandler({
    ...deps(),
    save: async () => {
      calls++;
      return {};
    },
  });
  assert.equal(
    (await h(request('POST', { action: 'save', request: {} }, { origin: 'https://attacker.test' })))
      .status,
    403,
  );
  assert.equal(calls, 0);
});
test('automation admin API hides worker leases and rejects extra action fields', async () => {
  const handler = createAutomationHandler(deps());
  const listing = await (await handler(request('GET'))).json();
  assert.equal(listing.runs[0].lease_token, undefined);
  assert.equal(listing.runs[0].frozen_inputs, undefined);
  assert.equal(listing.runs[0].owner_id, undefined);
  assert.equal(
    (await handler(request('POST', { action: 'publish', id: 'x', confirm: true, extra: 'x' })))
      .status,
    400,
  );
  const triggered = await (
    await handler(request('POST', { action: 'trigger', request: {} }))
  ).json();
  assert.equal(triggered.run.lease_token, undefined);
});
