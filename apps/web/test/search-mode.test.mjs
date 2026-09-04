import assert from 'node:assert/strict';
import test from 'node:test';
import { readSearchMode, searchWithMode } from '../lib/search-mode.ts';

const result = {
  id: 'example',
  type: 'insight',
  title: 'Example',
  summary: 'Summary',
  href: '/insights/example',
  keywords: '',
  body: '',
  score: 8,
};

test('defaults to in-process and rejects unknown search modes', () => {
  assert.equal(readSearchMode({}), 'in-process');
  assert.equal(readSearchMode({ HZENSE_SEARCH_MODE: 'shadow' }), 'shadow');
  assert.throws(() => readSearchMode({ HZENSE_SEARCH_MODE: 'fallback' }));
});

test('database mode is fail-closed and does not call the in-process path', async () => {
  let inProcessCalls = 0;
  const actual = await searchWithMode({
    mode: 'database',
    inProcess: async () => {
      inProcessCalls += 1;
      return [];
    },
    database: async () => [result],
  });
  assert.deepEqual(actual, [result]);
  assert.equal(inProcessCalls, 0);
  await assert.rejects(
    searchWithMode({
      mode: 'database',
      inProcess: async () => [],
      database: async () => {
        throw new Error('unavailable');
      },
    }),
    /unavailable/,
  );
});

test('shadow mode returns baseline and logs only bounded parity metadata', async () => {
  const logs = [];
  const actual = await searchWithMode({
    mode: 'shadow',
    inProcess: async () => [result],
    database: async () => [{ ...result, score: 7 }],
    log: (record) => logs.push(record),
  });
  assert.deepEqual(actual, [result]);
  assert.deepEqual(logs, [
    {
      database_count: 1,
      event: 'database_search_shadow',
      in_process_count: 1,
      outcome: 'mismatch',
    },
  ]);
  assert.deepEqual(Object.keys(logs[0]).sort(), [
    'database_count',
    'event',
    'in_process_count',
    'outcome',
  ]);
});
