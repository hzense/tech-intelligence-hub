import test from 'node:test';
import assert from 'node:assert/strict';
import { createRuntimeReaderHealthHandler } from '../lib/runtime-reader-core.ts';

test('database signal health checks the real view even when legacy search is healthy', async () => {
  let probes = 0;
  const handle = createRuntimeReaderHealthHandler({
    log: () => {},
    poolStats: () => ({ idle: 0, total: 0, waiting: 0 }),
    readTopics: async () => [
      { id: 'topic-test', title: 'Test', status: 'active', runtimeEnabled: true, parentId: null },
    ],
    signalReadMode: () => 'database',
    probePublicSignals: async () => {
      probes++;
      throw new Error('sensitive DB diagnostic');
    },
  });
  const result = await handle();
  assert.equal(result.status, 503);
  assert.deepEqual(await result.json(), { status: 'unavailable' });
  assert.equal(probes, 1);
});

test('legacy signal mode never connects to the new view; an empty valid view is healthy', async () => {
  let probes = 0;
  for (const mode of ['legacy', 'database']) {
    const handle = createRuntimeReaderHealthHandler({
      log: () => {},
      poolStats: () => ({ idle: 0, total: 0, waiting: 0 }),
      readTopics: async () => [
        { id: 'topic-test', title: 'Test', status: 'active', runtimeEnabled: true, parentId: null },
      ],
      signalReadMode: () => mode,
      probePublicSignals: async () => {
        probes++;
      },
    });
    assert.equal((await handle()).status, 200);
  }
  assert.equal(probes, 1);
});
