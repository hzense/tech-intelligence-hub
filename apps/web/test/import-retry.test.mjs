import test from 'node:test';
import assert from 'node:assert/strict';
import { retryImportWithSourceCheck } from '../lib/import-retry.ts';
test('received originals cannot retry even when cleanup failed', async () => {
  for (const kind of ['file', 'url']) {
    let retries = 0;
    await assert.rejects(
      retryImportWithSourceCheck('item', {
        getBatch: async () => ({
          cancelled: false,
          items: [
            {
              id: 'item',
              status: 'failed',
              fence: 1,
              kind,
              sha256: 'received',
              error_code: 'parse_failed',
            },
          ],
        }),
        retry: async () => {
          retries++;
        },
      }),
      /retry_not_allowed/,
    );
    assert.equal(retries, 0);
  }
});
test('only an owned, failed URL without an original can retry', async () => {
  const calls = [];
  const item = { id: 'item', status: 'failed', fence: 1, kind: 'url', sha256: 'original' };
  const deps = {
    getBatch: async () => ({ cancelled: false, items: [item] }),
    retry: async () => calls.push('retry'),
  };
  await assert.rejects(retryImportWithSourceCheck('other', deps));
  assert.deepEqual(calls, []);
  await assert.rejects(retryImportWithSourceCheck('item', deps), /retry_not_allowed/);
  assert.deepEqual(calls, []);
  calls.length = 0;
  item.sha256 = null;
  await retryImportWithSourceCheck('item', deps);
  assert.deepEqual(calls, ['retry']);
});
