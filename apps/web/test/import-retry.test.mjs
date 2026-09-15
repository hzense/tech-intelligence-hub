import test from 'node:test';
import assert from 'node:assert/strict';
import { retryImportWithSourceCheck } from '../lib/import-retry.ts';
import { ImportIOError } from '../lib/import-io.ts';
test('expired, missing, or failed storage checks never requeue or charge a retry', async () => {
  for (const error of [new ImportIOError('source_unavailable'), new Error('storage unavailable')]) {
    let retries = 0;
    await assert.rejects(
      retryImportWithSourceCheck('item', {
        getBatch: async () => ({
          cancelled: false,
          items: [
            { id: 'item', status: 'failed', fence: 1, kind: 'file', error_code: 'parse_failed' },
          ],
        }),
        checkOriginal: async () => {
          throw error;
        },
        retry: async () => {
          retries++;
        },
      }),
      error,
    );
    assert.equal(retries, 0);
  }
});
test('ownership/state precedes storage and existing URL originals are checked', async () => {
  const calls = [];
  const item = { id: 'item', status: 'failed', fence: 1, kind: 'url', sha256: 'original' };
  const deps = {
    getBatch: async () => ({ cancelled: false, items: [item] }),
    checkOriginal: async () => calls.push('check'),
    retry: async () => calls.push('retry'),
  };
  await assert.rejects(retryImportWithSourceCheck('other', deps));
  assert.deepEqual(calls, []);
  await retryImportWithSourceCheck('item', deps);
  assert.deepEqual(calls, ['check', 'retry']);
  calls.length = 0;
  item.sha256 = null;
  await retryImportWithSourceCheck('item', deps);
  assert.deepEqual(calls, ['retry']);
});
