import assert from 'node:assert/strict';
import test from 'node:test';
import { markRecoverableImports } from '../lib/import-resume.ts';

test('mark only never-claimed URLs with matching terminal batch or item receipts', async () => {
  const url = { id: 'a', kind: 'url', status: 'queued', fence: 0 };
  const primary = {
    id: 'primary',
    intent: 'preview',
    items: [
      url,
      { ...url, id: 'retried', fence: 1 },
      { ...url, id: 'file', kind: 'file' },
      { ...url, id: 'unknown', status: 'unknown' },
    ],
  };
  const fallback = { id: 'fallback', intent: 'preview', items: [url, { ...url, id: 'other' }] };
  const manual = { id: 'manual', intent: 'preview', items: [url] };
  const cancelled = { ...primary, id: 'cancelled', cancelled: true };
  const hidden = { ...primary, id: 'hidden', deleted_at: new Date().toISOString() };
  const publish = { ...primary, id: 'publish', intent: 'generate_publish' };
  const batches = [primary, fallback, manual, cancelled, hidden, publish];
  const marked = await markRecoverableImports(batches, async (batchIds) => {
    assert.deepEqual(batchIds, ['primary', 'fallback', 'manual']);
    return [
      { batchId: 'primary', itemId: null },
      { batchId: 'fallback', itemId: 'a' },
    ];
  });
  assert.deepEqual(
    marked.flatMap((batch) =>
      batch.items.filter((item) => item.recovery_available).map((item) => [batch.id, item.id]),
    ),
    [
      ['primary', 'a'],
      ['fallback', 'a'],
    ],
  );
  assert.equal(url.recovery_available, undefined);
});

test('a page with only parsed or previously claimed items needs no automation query', async () => {
  const batches = [{ id: 'batch', items: [{ kind: 'url', status: 'completed', fence: 1 }] }];
  assert.equal(
    await markRecoverableImports(batches, () => assert.fail('unexpected lookup')),
    batches,
  );
});
