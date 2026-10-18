import assert from 'node:assert/strict';
import test from 'node:test';
import { fetchGenerationProgress } from '../lib/generation-progress-client.ts';

const { AbortController, Response, URL } = globalThis;
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
test('one progress request batches IDs and only retains safe scalar updates', async (t) => {
  const requests = [];
  const controller = new AbortController();
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    requests.push({ url, options });
    return Response.json({
      runs: [
        { id: id(2), status: 'running', charged_microusd: '12', snapshot: 'private' },
        {
          id: id(1),
          status: 'pending',
          progress_phase: 'queued',
          result: 'private',
          can_delete: true,
        },
      ],
    });
  });
  const updates = await fetchGenerationProgress([id(1), id(2), id(1)], controller.signal);
  assert.equal(requests.length, 1);
  assert.equal(
    new URL(requests[0].url, 'http://fixture').searchParams.get('progress'),
    `${id(1)},${id(2)}`,
  );
  assert.equal(requests[0].options.signal, controller.signal);
  assert.equal(requests[0].options.cache, 'no-store');
  assert.equal(requests[0].options.method, undefined);
  assert.deepEqual(updates, [
    { id: id(2), status: 'running', charged_microusd: '12' },
    { id: id(1), status: 'pending', progress_phase: 'queued' },
  ]);
});

test('missing, duplicate, unexpected or invalid receipts never replace a tracked task', async (t) => {
  for (const runs of [
    [],
    [{ id: id(1), status: 'running' }],
    [
      { id: id(1), status: 'running' },
      { id: id(1), status: 'running' },
    ],
    [
      { id: id(1), status: 'running' },
      { id: id(3), status: 'running' },
    ],
    [
      { id: id(1), status: 'running' },
      { id: id(2), status: 'invented' },
    ],
    [{ id: id(1), status: 'running' }, null],
  ]) {
    t.mock.method(globalThis, 'fetch', async () => Response.json({ runs }));
    await assert.rejects(fetchGenerationProgress([id(1), id(2)], new AbortController().signal));
    t.mock.restoreAll();
  }
});

test('invalid input fails before fetch and failed HTTP reads remain failures', async (t) => {
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    calls++;
    return new Response('', { status: 503 });
  });
  const signal = new AbortController().signal;
  for (const ids of [[], ['bad'], Array.from({ length: 51 }, (_, n) => id(n))])
    await assert.rejects(fetchGenerationProgress(ids, signal));
  assert.equal(calls, 0);
  await assert.rejects(fetchGenerationProgress([id(1)], signal), /progress_unavailable/);
  assert.equal(calls, 1);
});
