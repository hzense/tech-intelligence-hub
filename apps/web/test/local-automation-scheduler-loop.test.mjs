import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import { startLocalAutomationScheduler } from '../../../scripts/local-automation-scheduler.mjs';

function harness(
  fetchImpl = async () => ({ ok: true, json: async () => ({ dispatched: 0, failed: 0 }) }),
) {
  const timers = new Map();
  const calls = [];
  const logs = [];
  const signals = new EventEmitter();
  const scheduler = startLocalAutomationScheduler({
    port: 3001,
    signals,
    fetchImpl: async (...args) => {
      calls.push(args);
      return fetchImpl(...args);
    },
    log: (message) => logs.push(message),
    setTimer: (callback, delay) => {
      const handle = { unref() {} };
      timers.set(handle, { callback, delay });
      return handle;
    },
    clearTimer: (handle) => timers.delete(handle),
  });
  function fire(delay) {
    const entry = [...timers].find(([, timer]) => timer.delay === delay);
    assert.ok(entry, `missing timer ${delay}`);
    timers.delete(entry[0]);
    return entry[1].callback();
  }
  return { scheduler, timers, calls, logs, signals, fire };
}

test('loop is delayed, loopback-only, same-origin POST and does not log empty checks', async () => {
  const h = harness();
  assert.equal(h.calls.length, 0);
  assert.equal(h.timers.size, 1);
  await h.fire(60_000);
  const [url, init] = h.calls[0];
  assert.equal(url, 'http://127.0.0.1:3001/api/admin/local-automation-scheduler');
  assert.equal(init.method, 'POST');
  assert.deepEqual(init.headers, { Origin: 'http://127.0.0.1:3001' });
  assert.equal(init.redirect, 'error');
  assert.equal(init.body, undefined);
  assert.deepEqual(h.logs, []);
  assert.equal(h.timers.size, 1);
  h.scheduler.stop();
  assert.equal(h.timers.size, 0);
  assert.equal(h.signals.listenerCount('SIGINT'), 0);
  assert.equal(h.signals.listenerCount('SIGTERM'), 0);
});

test('slow dispatch checks never overlap; stop aborts the outstanding request', async () => {
  const h = harness(
    (_url, { signal }) =>
      new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(new Error('private abort message')), {
          once: true,
        });
      }),
  );
  const pending = h.fire(60_000);
  assert.equal(h.calls.length, 1);
  assert.deepEqual(
    [...h.timers.values()].map((timer) => timer.delay),
    [45_000],
  );
  h.signals.emit('SIGINT');
  await pending;
  assert.equal(h.calls[0][1].signal.aborted, true);
  assert.equal(h.timers.size, 0);
  assert.deepEqual(h.logs, []);
  h.scheduler.stop();
});

test('timeout clears the request and schedules one new due check, never a task retry', async () => {
  const h = harness(
    (_url, { signal }) =>
      new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(new Error('secret provider detail')), {
          once: true,
        });
      }),
  );
  const pending = h.fire(60_000);
  h.fire(45_000);
  await pending;
  assert.equal(h.calls.length, 1);
  assert.deepEqual(
    [...h.timers.values()].map((timer) => timer.delay),
    [60_000],
  );
  assert.equal(h.logs.length, 1);
  assert.doesNotMatch(h.logs.join(''), /secret|provider/);
  h.scheduler.stop();
});

test('unavailable checks are reported once, recovery logs aggregate counters only', async () => {
  let count = 0;
  const h = harness(async () => {
    count += 1;
    if (count <= 2)
      return {
        ok: false,
        json: async () => {
          throw new Error('must not read errors');
        },
      };
    return {
      ok: true,
      json: async () => ({ dispatched: 2, failed: 1, private: 'private-secret' }),
    };
  });
  await h.fire(60_000);
  await h.fire(60_000);
  assert.equal(h.logs.length, 1);
  await h.fire(60_000);
  assert.equal(h.logs.length, 3);
  assert.match(h.logs[1], /恢复/);
  assert.match(h.logs[2], /派发 2 项，派发失败 1 项/);
  assert.doesNotMatch(h.logs.join(''), /private-secret/);
  h.signals.emit('SIGTERM');
  assert.equal(h.timers.size, 0);
});

test('invalid responses and unsafe ports cannot change the endpoint or leak details', async () => {
  for (const port of [0, 65536, '3000', NaN, 1.5])
    assert.throws(() => startLocalAutomationScheduler({ port }));
  const h = harness(async () => ({
    ok: true,
    json: async () => ({ dispatched: 'private-secret', failed: 0 }),
  }));
  await h.fire(60_000);
  assert.equal(h.logs.length, 1);
  assert.doesNotMatch(h.logs[0], /private-secret/);
  h.scheduler.stop();
});
