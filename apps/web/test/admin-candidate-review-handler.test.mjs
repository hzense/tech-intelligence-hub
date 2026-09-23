/* global Request */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createCandidateReviewHandler } from '../lib/admin-candidate-review-handler.ts';
const origin = 'https://hzense.com',
  id = '11111111-1111-4111-8111-111111111111';
const request = (body, extra = {}) =>
  new Request(`${origin}/api/admin/candidate-review`, {
    method: 'POST',
    headers: { host: 'hzense.com', origin, 'content-type': 'application/json', ...extra },
    body: JSON.stringify(body),
  });
test('review writes authenticate and check origin before accessing stores', async () => {
  let calls = 0;
  const deps = {
    session: async () => null,
    origin: () => origin,
    read: async () => {
      calls++;
    },
    confirm: async () => {
      calls++;
    },
    enrich: async () => {
      calls++;
    },
    operate: async () => {
      calls++;
    },
  };
  assert.equal(
    (await createCandidateReviewHandler(deps)(request({ action: 'confirm', request: {} }))).status,
    401,
  );
  deps.session = async () => ({ user: { id: 'owner' } });
  assert.equal(
    (
      await createCandidateReviewHandler(deps)(
        request({ action: 'confirm', request: {} }, { origin: 'https://evil.test' }),
      )
    ).status,
    403,
  );
  assert.equal(calls, 0);
});
test('review dispatch binds session owner and strips errors', async () => {
  const calls = [];
  const handler = createCandidateReviewHandler({
    session: async () => ({ user: { id: 'owner' } }),
    origin: () => origin,
    read: async (...args) => {
      calls.push(args);
      return { reviews: [] };
    },
    confirm: async (...args) => {
      calls.push(args);
      return { revision: 1 };
    },
    enrich: async (...args) => {
      calls.push(args);
      return { status: 'pending' };
    },
    operate: async () => {
      throw new Error('SECRET_DATABASE_URL');
    },
  });
  const confirmed = await handler(request({ action: 'confirm', request: { runId: id } }));
  assert.equal(confirmed.status, 200);
  assert.equal(calls[0][0], 'owner');
  assert.match(confirmed.headers.get('cache-control'), /no-store/);
  assert.equal((await handler(request({ action: 'save', request: { runId: id } }))).status, 400);
  const failed = await handler(request({ action: 'publish', request: {} }));
  assert.deepEqual(await failed.json(), { error: 'unavailable' });
  assert.equal((await handler(request({ action: 'approve', request: {} }))).status, 400);
  const enriched = await handler(request({ action: 'enrich', request: { id } }));
  assert.equal(enriched.status, 202);
  assert.deepEqual(calls[1], ['owner', { id }]);
  const read = await handler(
    new Request(`${origin}/api/admin/candidate-review?runId=${id}&candidateIndex=0`, {
      headers: { host: 'hzense.com' },
    }),
  );
  assert.equal(read.status, 200);
  assert.deepEqual(calls[2], ['owner', id, 0]);
});

test('review boundary rejects oversized bodies and duplicate query keys before stores', async () => {
  let calls = 0;
  const handler = createCandidateReviewHandler({
    session: async () => ({ user: { id: 'owner' } }),
    origin: () => origin,
    read: async () => {
      calls++;
    },
    confirm: async () => {
      calls++;
    },
    enrich: async () => {
      calls++;
    },
    operate: async () => {
      calls++;
    },
  });
  assert.equal(
    (await handler(request({ action: 'confirm', request: { text: 'x'.repeat(65537) } }))).status,
    413,
  );
  assert.equal(
    (
      await handler(
        new Request(
          `${origin}/api/admin/candidate-review?runId=${id}&candidateIndex=0&candidateIndex=1`,
          { headers: { host: 'hzense.com' } },
        ),
      )
    ).status,
    400,
  );
  assert.equal(calls, 0);
});
