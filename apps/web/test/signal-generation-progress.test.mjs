import test from 'node:test';
import assert from 'node:assert/strict';
import { createGenerationHandler } from '../lib/admin-signal-generation-handler.ts';
import { generationProgressDto } from '../lib/signal-generation-core.ts';
import { SignalGenerationError } from '../../../packages/database/src/signal-generation-store.mjs';

const { Request } = globalThis;
const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const secondId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const request = (query = `progress=${id}`, headers = {}) =>
  new Request(`https://hzense.com/api/admin/signal-generation?${query}`, {
    headers: { host: 'hzense.com', ...headers },
  });

test('progress lookup authenticates, preserves same-origin protection and only calls the small read', async () => {
  const calls = [];
  const deps = {
    session: async () => ({ user: { id: 'admin' } }),
    origin: () => 'https://hzense.com',
    dashboard: async () => assert.fail('must not read dashboard'),
    execute: async () => assert.fail('must not run AI'),
    detail: async () => assert.fail('must not read private task detail'),
    progress: async (owner, ids) => {
      calls.push({ owner, ids });
      return ids.map((id) => ({ id, status: 'running' }));
    },
  };
  const handler = createGenerationHandler(deps);
  assert.equal(
    (await createGenerationHandler({ ...deps, session: async () => null })(request())).status,
    401,
  );
  for (const headers of [
    { host: 'evil.example' },
    { origin: 'https://evil.example' },
    { 'sec-fetch-site': 'cross-site' },
  ])
    assert.equal((await handler(request(undefined, headers))).status, 403);
  assert.equal(calls.length, 0);
  const response = await handler(request(`progress=${id.toUpperCase()},${secondId},${id}`));
  assert.equal(response.status, 200);
  assert.match(response.headers.get('cache-control'), /no-store/);
  assert.deepEqual(calls, [{ owner: 'admin', ids: [id, secondId] }]);
  assert.deepEqual(await response.json(), {
    runs: [
      { id, status: 'running' },
      { id: secondId, status: 'running' },
    ],
  });
  for (const query of [
    'progress=',
    'progress=invalid',
    `progress=${id},`,
    `progress=${id},invalid`,
    `progress=${id}&progress=${id}`,
    `progress=${id}&id=${id}`,
    `progress=${id}&owner=other`,
    `progress=${Array(51).fill(id).join(',')}`,
    `progress=${id}#invalid`,
  ])
    assert.equal((await handler(request(query))).status, 400, query);
  assert.equal(calls.length, 1);
  assert.equal((await handler(request(`progress=${Array(50).fill(id).join(',')}`))).status, 200);
  assert.deepEqual(calls.at(-1).ids, [id]);
  assert.equal(
    (await createGenerationHandler({ ...deps, progress: undefined })(request())).status,
    400,
  );
});

test('missing progress receipts and backend errors are explicit, never an empty successful result', async () => {
  const deps = {
    session: async () => ({ user: { id: 'admin' } }),
    origin: () => 'https://hzense.com',
    dashboard: async () => assert.fail('must not read dashboard'),
    execute: async () => assert.fail('must not run AI'),
  };
  for (const [error, status, code] of [
    [new SignalGenerationError('not_found'), 404, 'not_found'],
    [new Error('PRIVATE_BACKEND_DIAGNOSTIC'), 503, 'unavailable'],
  ]) {
    const response = await createGenerationHandler({
      ...deps,
      progress: async () => {
        throw error;
      },
    })(request());
    assert.equal(response.status, status);
    assert.deepEqual(await response.json(), { error: code });
  }
});

test('progress DTO contains only safe small fields and displays unknown outcomes as failures without changing storage', () => {
  const run = {
    id,
    status: 'running',
    error_code: null,
    lease_until: '2099-01-01T00:00:00Z',
    progress_phase: 'generating',
    progress_at: '2026-10-18T00:00:00Z',
    started_at: '2026-10-18T00:00:00Z',
    finished_at: null,
    created_at: '2026-10-18T00:00:00Z',
    reserved_microusd: '100',
    charged_microusd: '0',
    snapshot: 'PRIVATE_SOURCE',
    configuration: 'PRIVATE_CONFIG',
    result: 'PRIVATE_CANDIDATES',
    owner_id: 'PRIVATE_OWNER',
    lease_token: 'PRIVATE_LEASE',
  };
  const value = generationProgressDto(run);
  assert.equal(value.status, 'running');
  assert.deepEqual(
    Object.keys(value).sort(),
    [
      'id',
      'status',
      'error_code',
      'lease_until',
      'progress_phase',
      'progress_at',
      'started_at',
      'finished_at',
      'created_at',
      'reserved_microusd',
      'charged_microusd',
    ].sort(),
  );
  assert.doesNotMatch(
    JSON.stringify(value),
    /PRIVATE_|snapshot|configuration|result|owner_id|lease_token/,
  );
  for (const lease_until of ['2000-01-01T00:00:00Z', null, 'malformed']) {
    const expired = { ...run, lease_until };
    assert.equal(generationProgressDto(expired).status, 'failed');
    assert.equal(generationProgressDto(expired).error_code, 'outcome_unknown');
    assert.equal(generationProgressDto(expired).charged_microusd, '0');
    assert.equal(expired.status, 'running');
  }
  assert.equal(generationProgressDto({ ...run, status: 'unknown' }).status, 'failed');
  assert.equal(generationProgressDto({ ...run, status: 'pending' }).status, 'pending');
});
