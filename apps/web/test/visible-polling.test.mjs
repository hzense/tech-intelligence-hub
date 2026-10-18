import assert from 'node:assert/strict';
import test from 'node:test';
import { ADMIN_POLL_INTERVAL_MS, startVisiblePolling } from '../lib/visible-polling.ts';

const { EventTarget, Event } = globalThis;
const flush = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
};
function environment(t, initial = 'visible') {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'document');
  const document = new EventTarget();
  document.visibilityState = initial;
  Object.defineProperty(globalThis, 'document', { configurable: true, value: document });
  t.mock.timers.enable({ apis: ['setTimeout'] });
  t.after(() => {
    if (original) Object.defineProperty(globalThis, 'document', original);
    else delete globalThis.document;
  });
  return (state) => {
    document.visibilityState = state;
    document.dispatchEvent(new Event('visibilitychange'));
  };
}

test('polling waits 15 seconds, never overlaps, and stops on terminal receipt', async (t) => {
  environment(t);
  assert.equal(ADMIN_POLL_INTERVAL_MS, 15_000);
  let calls = 0;
  let complete;
  const stop = startVisiblePolling({
    poll: () => {
      calls++;
      return new Promise((resolve) => {
        complete = resolve;
      });
    },
    onError: () => assert.fail('unexpected error'),
  });
  t.after(stop);
  t.mock.timers.tick(14_999);
  assert.equal(calls, 0);
  t.mock.timers.tick(1);
  assert.equal(calls, 1);
  t.mock.timers.tick(90_000);
  assert.equal(calls, 1);
  complete(true);
  await flush();
  t.mock.timers.tick(15_000);
  assert.equal(calls, 2);
  complete(false);
  await flush();
  t.mock.timers.tick(90_000);
  assert.equal(calls, 2);
});

test('hidden tabs do not poll and visibility resumes with one immediate request', async (t) => {
  const visibility = environment(t, 'hidden');
  let calls = 0;
  const stop = startVisiblePolling({
    poll: async () => {
      calls++;
    },
    onError: assert.fail,
  });
  t.after(stop);
  t.mock.timers.tick(90_000);
  assert.equal(calls, 0);
  visibility('visible');
  t.mock.timers.tick(0);
  await flush();
  assert.equal(calls, 1);
  visibility('hidden');
  t.mock.timers.tick(90_000);
  assert.equal(calls, 1);
  visibility('visible');
  t.mock.timers.tick(0);
  await flush();
  assert.equal(calls, 2);
  stop();
  visibility('hidden');
  visibility('visible');
  t.mock.timers.tick(90_000);
  assert.equal(calls, 2);
});

test('hiding aborts the old request and waits for settlement before resuming', async (t) => {
  const visibility = environment(t);
  const requests = [];
  let settle;
  const errors = [];
  const stop = startVisiblePolling({
    poll: (signal) => {
      requests.push(signal);
      return new Promise((resolve, reject) => {
        settle = { resolve, reject };
      });
    },
    onError: (error) => errors.push(error),
  });
  t.after(stop);
  t.mock.timers.tick(15_000);
  visibility('hidden');
  assert.equal(requests[0].aborted, true);
  visibility('visible');
  t.mock.timers.tick(90_000);
  assert.equal(requests.length, 1);
  settle.reject(new Error('aborted request'));
  await flush();
  assert.deepEqual(errors, []);
  t.mock.timers.tick(0);
  assert.equal(requests.length, 2);
  stop();
  assert.equal(requests[1].aborted, true);
  settle.resolve(true);
  await flush();
  t.mock.timers.tick(90_000);
  assert.equal(requests.length, 2);
});

test('a failed read stops automatic traffic without retrying on tab focus', async (t) => {
  const visibility = environment(t);
  let calls = 0;
  const errors = [];
  const stop = startVisiblePolling({
    poll: async () => {
      calls++;
      throw new Error('unavailable');
    },
    onError: (error) => errors.push(error.message),
  });
  t.after(stop);
  t.mock.timers.tick(15_000);
  await flush();
  visibility('hidden');
  visibility('visible');
  t.mock.timers.tick(90_000);
  assert.equal(calls, 1);
  assert.deepEqual(errors, ['unavailable']);
});
