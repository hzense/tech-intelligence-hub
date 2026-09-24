/* global Request */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createAdminMaterialHandler } from '../lib/admin-material-handler.ts';
import { createMaterialWorkerHandler } from '../lib/material-worker-handler.ts';

const origin = 'https://hzense.com',
  id = '11111111-1111-4111-8111-111111111111',
  token = 'x'.repeat(32);
const create = () => ({
  id,
  runId: id,
  candidateIndex: 0,
  materialHash: 'a'.repeat(64),
  supplements: [{ batchId: id, itemId: id }],
  consent: true,
});
const confirm = () => ({ requestId: id, reportId: id, planHash: 'a'.repeat(64), consent: true });
const req = (body, headers = {}, path = '/api/admin/materials') =>
  new Request(`${origin}${path}`, {
    method: 'POST',
    headers: { host: 'hzense.com', origin, 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
function admin() {
  const calls = [];
  const deps = {
    session: async () => ({ user: { id: 'owner' } }),
    origin: () => origin,
    read: async (...args) => {
      calls.push(args);
      return {};
    },
    create: async (...args) => {
      calls.push(args);
      return {};
    },
    confirm: async (...args) => {
      calls.push(args);
      return {};
    },
  };
  return { calls, deps, handler: createAdminMaterialHandler(deps) };
}
function worker() {
  const calls = [];
  const deps = {
    token: () => token,
    inbox: async (after) => {
      calls.push(['inbox', after]);
      return { requests: [], nextCursor: null };
    },
    read: async (...args) => {
      calls.push(args);
      return {};
    },
    accept: async (...args) => {
      calls.push(args);
      return {};
    },
  };
  return { calls, deps, handler: createMaterialWorkerHandler(deps) };
}
test('capacity inspection uses session owner and cannot call create; size errors are distinct', async () => {
  const { deps, calls } = admin();
  deps.inspect = async (owner, request) => {
    assert.equal(owner, 'owner');
    assert.deepEqual(request, create());
    return { sourceBytes: 52271, limitBytes: 200000, fragmentCount: 81 };
  };
  const handler = createAdminMaterialHandler(deps);
  const response = await handler(req({ action: 'inspect', request: create() }));
  assert.equal(response.status, 200);
  assert.equal((await response.json()).sourceBytes, 52271);
  assert.equal(calls.length, 0);
  assert.equal(
    (await handler(req({ action: 'inspect', request: { ...create(), owner: 'forged' } }))).status,
    400,
  );
  assert.equal(
    (await handler(req({ action: 'inspect', request: create() }, { origin: 'https://evil.test' })))
      .status,
    403,
  );
  for (const code of [
    'candidate_source_bundle_too_large',
    'candidate_source_bundle_metadata_too_large',
    'generation_source_too_large',
  ]) {
    deps.inspect = async () => {
      throw Object.assign(new Error('private text not exposed'), { code });
    };
    const failed = await createAdminMaterialHandler(deps)(
      req({ action: 'inspect', request: create() }),
    );
    assert.equal(failed.status, 413);
    assert.deepEqual(await failed.json(), { error: code });
  }
});
test('admin authenticates and rejects cross-origin writes before stores', async () => {
  const { calls, deps, handler } = admin();
  deps.session = async () => null;
  assert.equal((await handler(req({ action: 'create', request: create() }))).status, 401);
  deps.session = async () => ({ user: { id: 'owner' } });
  for (const headers of [
    { origin: 'https://evil.test' },
    { host: 'evil.test' },
    { 'sec-fetch-site': 'cross-site' },
  ])
    assert.equal(
      (await handler(req({ action: 'create', request: create() }, headers))).status,
      403,
    );
  assert.equal(calls.length, 0);
});
test('material preparation and approval only accept IDs and explicit confirmation from session owner', async () => {
  const { deps, calls } = admin();
  deps.prepare = async (...args) => {
    calls.push(args);
    return { ready: true };
  };
  deps.approve = async (...args) => {
    calls.push(args);
    return { approved: true };
  };
  const handler = createAdminMaterialHandler(deps);
  assert.equal((await handler(req({ action: 'prepare', request: { requestId: id } }))).status, 200);
  const value = { requestId: id, proposalId: id, proposalHash: 'c'.repeat(64), consent: true };
  assert.equal((await handler(req({ action: 'approve', request: value }))).status, 200);
  assert.equal(calls[1][0], 'owner');
  for (const changed of [
    { ...value, consent: false },
    { ...value, owner: 'attacker' },
    { ...value, plan: {} },
    { ...value, proposalHash: 'bad' },
  ])
    assert.equal((await handler(req({ action: 'approve', request: changed }))).status, 400);
  assert.equal(calls.length, 2);
});
test('admin validates nested exact shape, consent and query uniqueness, and binds session owner', async () => {
  const { calls, handler } = admin();
  for (const request of [
    null,
    [],
    {},
    { ...create(), owner: 'other' },
    { ...create(), consent: false },
    { ...create(), candidateIndex: 5 },
    { ...create(), supplements: [{ batchId: id, itemId: id, source: 'fake' }] },
  ])
    assert.equal((await handler(req({ action: 'create', request }))).status, 400);
  assert.equal(
    (await handler(req({ action: 'confirm', request: { ...confirm(), verified: true } }))).status,
    400,
  );
  assert.equal(
    (
      await handler(
        new Request(`${origin}/api/admin/materials?runId=${id}&candidateIndex=0&candidateIndex=1`, {
          headers: { host: 'hzense.com' },
        }),
      )
    ).status,
    400,
  );
  assert.equal(calls.length, 0);
  const response = await handler(req({ action: 'create', request: create() }));
  assert.equal(response.status, 200);
  assert.match(response.headers.get('cache-control'), /no-store/);
  assert.deepEqual(calls[0], ['owner', create()]);
  assert.equal((await handler(req({ action: 'confirm', request: confirm() }))).status, 200);
});
test('worker authenticates before inbox/read/report and validates exact read identities', async () => {
  const { calls, deps, handler } = worker();
  for (const authorization of ['', `Bearer ${'z'.repeat(32)}`, `Bearer ${token}extra`])
    assert.equal(
      (
        await handler(
          req({ action: 'read', request: { owner: 'owner', requestId: id } }, { authorization }),
        )
      ).status,
      401,
    );
  deps.token = () => '';
  assert.equal(
    (
      await handler(
        new Request(`${origin}/api/worker/materials`, {
          headers: { authorization: `Bearer ${token}` },
        }),
      )
    ).status,
    401,
  );
  deps.token = () => token;
  for (const request of [
    null,
    [],
    { owner: '', requestId: id },
    { owner: 'other\n', requestId: id },
    { owner: 'owner', requestId: [] },
    { owner: 'owner', requestId: id, extra: true },
  ])
    assert.equal(
      (await handler(req({ action: 'read', request }, { authorization: `Bearer ${token}` })))
        .status,
      400,
    );
  assert.equal(calls.length, 0);
  assert.equal(
    (
      await handler(
        req(
          { action: 'read', request: { owner: 'owner', requestId: id } },
          { authorization: `Bearer ${token}` },
        ),
      )
    ).status,
    200,
  );
  assert.deepEqual(calls[0], ['owner', id]);
});
test('worker inbox explicitly pages to the eleventh request without dismissing insufficient material', async () => {
  const { calls, deps, handler } = worker();
  const records = Array.from({ length: 11 }, (_, index) => ({
    id: `11111111-1111-4111-8111-${String(index + 1).padStart(12, '0')}`,
    owner_id: 'owner',
  }));
  deps.inbox = async (after) => {
    calls.push(['inbox', after]);
    return after === records[9].id
      ? { requests: records.slice(10), nextCursor: null }
      : { requests: records.slice(0, 10), nextCursor: records[9].id };
  };
  const get = (query = '') =>
    new Request(`${origin}/api/worker/materials${query}`, {
      headers: { authorization: `Bearer ${token}` },
    });
  for (const query of [
    '?after=',
    '?after=bad',
    `?after=${id}&after=${id}`,
    `?after=${id}&skip=true`,
    '?skip=true',
  ])
    assert.equal((await handler(get(query))).status, 400);
  assert.equal(calls.length, 0);
  const first = await (await handler(get())).json();
  assert.equal(first.requests.length, 10);
  assert.deepEqual(calls, [['inbox', undefined]]);
  const second = await (await handler(get(`?after=${first.nextCursor}`))).json();
  assert.deepEqual(second, { requests: records.slice(10), nextCursor: null });
  // Reading another page does not mark the unresolved first page successful or failed.
  assert.deepEqual(await (await handler(get())).json(), first);
  assert.deepEqual(
    calls.map((call) => call[1]),
    [undefined, records[9].id, undefined],
  );
});
test('worker report requires exact envelope, delegates signature validation, and strips errors', async () => {
  const { calls, deps, handler } = worker();
  const report = {
    owner: 'owner',
    requestId: id,
    plan: { version: 'material-registration-v1' },
    attestation: { keyId: 'key', payload: 'data', signature: 'signature' },
  };
  for (const request of [
    null,
    [],
    { ...report, plan: [] },
    { ...report, verified: true },
    { ...report, attestation: { ...report.attestation, verified: true } },
    { ...report, attestation: { ...report.attestation, signature: '' } },
  ])
    assert.equal(
      (await handler(req({ action: 'report', request }, { authorization: `Bearer ${token}` })))
        .status,
      400,
    );
  assert.equal(calls.length, 0);
  assert.equal(
    (
      await handler(
        req({ action: 'report', request: report }, { authorization: `Bearer ${token}` }),
      )
    ).status,
    200,
  );
  deps.accept = async () => {
    throw new Error('SECRET_DATABASE_URL');
  };
  const response = await handler(
    req({ action: 'report', request: report }, { authorization: `Bearer ${token}` }),
  );
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: 'unavailable' });
});
test('both handlers return 413 for oversized actual bodies without store calls', async () => {
  const a = admin(),
    w = worker();
  assert.equal(
    (await a.handler(req({ action: 'create', request: { text: 'x'.repeat(9000) } }))).status,
    413,
  );
  assert.equal(
    (
      await w.handler(
        req(
          { action: 'report', request: { text: 'x'.repeat(300001) } },
          { authorization: `Bearer ${token}` },
        ),
      )
    ).status,
    413,
  );
  assert.equal(a.calls.length + w.calls.length, 0);
});
