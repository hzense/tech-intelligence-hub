import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAutomationHandler } from '../lib/admin-automation-handler.ts';
import { AutomationError } from '../../../packages/database/src/automation-contract.mjs';

const origin = 'https://hzense.com';
const request = (method, body, headers = {}, query = '') =>
  new globalThis.Request(`${origin}/api/admin/automation${query}`, {
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
  detail: async () => ({ id: 'run', result: { report: { title: 'Private report' } } }),
  remove: async () => ({ id: 'config', revision: 2, deleted_at: '2026-10-02T10:00:00Z' }),
  trigger: async () => ({ run: { id: 'run', owner_id: 'operator', lease_token: 'secret-token' } }),
  publish: async () => ({ id: 'run', owner_id: 'operator', lease_token: 'secret-token' }),
});
test('result details are explicit owner-scoped GETs and retain authentication and redaction', async () => {
  const id = '11111111-1111-4111-8111-111111111111';
  const calls = [];
  const dependencies = {
    ...deps(),
    detail: async (owner, runId) => {
      calls.push({ owner, id: runId });
      return {
        id: runId,
        result: { report: { title: 'Private report' } },
        owner_id: owner,
        frozen_inputs: { private: true },
        lease_token: 'private-lease',
      };
    },
  };
  const handler = createAutomationHandler(dependencies);
  await handler(request('GET'));
  assert.equal(calls.length, 0);
  for (const query of ['?id=invalid', `?id=${id}&id=${id}`, `?id=${id}&owner=other`])
    assert.equal((await handler(request('GET', undefined, {}, query))).status, 400);
  assert.equal(
    (await handler(request('GET', undefined, { 'sec-fetch-site': 'cross-site' }, `?id=${id}`)))
      .status,
    403,
  );
  assert.equal(
    (
      await createAutomationHandler({ ...dependencies, session: async () => null })(
        request('GET', undefined, {}, `?id=${id}`),
      )
    ).status,
    401,
  );
  assert.equal(calls.length, 0);
  const response = await handler(request('GET', undefined, {}, `?id=${id}`));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    run: { id, result: { report: { title: 'Private report' } } },
  });
  assert.deepEqual(calls, [{ owner: 'operator', id }]);
});
test('execution-disabled response is explicit and does not block configuration saves', async () => {
  const handler = createAutomationHandler({
    ...deps(),
    trigger: async () => {
      throw new AutomationError('execution_disabled');
    },
  });
  assert.equal((await handler(request('POST', { action: 'save', request: {} }))).status, 200);
  const response = await handler(request('POST', { action: 'trigger', request: {} }));
  assert.equal(response.status, 409);
  assert.deepEqual(await response.json(), { error: 'execution_disabled' });
});
test('leaf and per-topic evidence refusal codes are exposed without raw errors', async () => {
  for (const code of [
    'insight_topic_not_leaf',
    'insight_topic_not_tracked',
    'insight_insufficient_evidence',
  ]) {
    for (const action of ['save', 'trigger', 'publish']) {
      const handler = createAutomationHandler({
        ...deps(),
        [action]: async () => {
          throw new AutomationError(code);
        },
      });
      const body =
        action === 'publish' ? { action, id: 'run', confirm: true } : { action, request: {} };
      const response = await handler(request('POST', body));
      assert.equal(response.status, 409);
      assert.deepEqual(await response.json(), { error: code });
    }
  }
});
test('automatic publication unavailable is an explicit safe conflict while inactive settings remain savable', async () => {
  const handler = createAutomationHandler({
    ...deps(),
    trigger: async () => {
      throw new AutomationError('automatic_publication_unavailable');
    },
  });
  assert.equal((await handler(request('POST', { action: 'save', request: {} }))).status, 200);
  const response = await handler(request('POST', { action: 'trigger', request: {} }));
  assert.equal(response.status, 409);
  assert.deepEqual(await response.json(), { error: 'automatic_publication_unavailable' });
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

test('delete is owner-scoped, same-origin and separate from execution', async () => {
  const calls = [];
  const dependencies = {
    ...deps(),
    remove: async (owner, value) => {
      calls.push({ owner, value });
      return { id: value.id, revision: 3, deleted_at: '2026-10-02T10:00:00Z', owner_id: owner };
    },
    trigger: async () => assert.fail('Deletion must not trigger AI'),
    publish: async () => assert.fail('Deletion must not change publication'),
    save: async () => assert.fail('Deletion must not revalidate or save the AI profile'),
  };
  const body = { action: 'delete', request: { id: 'config', expectedRevision: 2, consent: true } };
  assert.equal(
    (
      await createAutomationHandler({ ...dependencies, session: async () => null })(
        request('POST', body),
      )
    ).status,
    401,
  );
  const handler = createAutomationHandler(dependencies);
  for (const headers of [
    { origin: 'https://other.test' },
    { host: 'other.test' },
    { 'sec-fetch-site': 'cross-site' },
  ])
    assert.equal((await handler(request('POST', body, headers))).status, 403);
  assert.equal((await handler(request('POST', { ...body, owner: 'another-user' }))).status, 400);
  assert.equal((await handler(request('DELETE'))).status, 405);
  assert.equal(calls.length, 0);
  const response = await handler(request('POST', body));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    config: { id: 'config', revision: 3, deleted_at: '2026-10-02T10:00:00Z' },
  });
  assert.deepEqual(calls, [{ owner: 'operator', value: body.request }]);
});

test('delete reports safe conflict reasons without database details', async () => {
  for (const code of [
    'config_in_use',
    'config_deletion_unavailable',
    'revision_conflict',
    'not_found',
    'commit_unknown',
    'invalid_request',
    'database_unavailable',
    'automation_role_invalid',
  ]) {
    const handler = createAutomationHandler({
      ...deps(),
      remove: async () => {
        throw new AutomationError(code);
      },
    });
    const response = await handler(request('POST', { action: 'delete', request: {} }));
    const safeCode = code === 'automation_role_invalid' ? 'unavailable' : code;
    assert.deepEqual(await response.json(), { error: safeCode });
    assert.equal(
      response.status,
      safeCode === 'invalid_request'
        ? 400
        : safeCode === 'not_found'
          ? 404
          : ['unavailable', 'database_unavailable'].includes(safeCode)
            ? 503
            : 409,
    );
  }
});
