import test from 'node:test';
import assert from 'node:assert/strict';
import {
  removeImportOriginal,
  cleanCancelledImportOriginals,
} from '../lib/import-original-cleanup.ts';
const path = 'imports/11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222';
test('original cleanup deletes only the exact validated path with the observed ETag', async () => {
  const calls = [];
  await removeImportOriginal(path, {
    head: async (key) => {
      assert.equal(key, path);
      return { pathname: key, etag: 'v1' };
    },
    del: async (...args) => {
      calls.push(args);
    },
    isMissing: () => false,
  });
  assert.deepEqual(calls, [[path, 'v1']]);
});
test('cancellation must commit before deletion and cleanup failures preserve the cancelled batch', async () => {
  const [, batchId, itemId] = path.split('/');
  const events = [];
  const deps = {
    cancel: async () => {
      events.push('cancel');
      return { cancelled: true, items: [{ id: itemId }] };
    },
    remove: async (key) => {
      events.push(key);
    },
    now: () => 0,
    cleanupFailed: () => {
      events.push('pending');
    },
  };
  const result = await cleanCancelledImportOriginals(batchId, deps);
  assert.equal(result.original_cleanup, 'deleted');
  assert.deepEqual(events, ['cancel', path]);
  events.length = 0;
  await assert.rejects(
    cleanCancelledImportOriginals(batchId, {
      ...deps,
      cancel: async () => {
        throw new Error('not_owned');
      },
    }),
    /not_owned/,
  );
  assert.deepEqual(events, []);
  const pending = await cleanCancelledImportOriginals(batchId, {
    ...deps,
    remove: async () => {
      throw new Error('storage_failure');
    },
  });
  assert.equal(pending.cancelled, true);
  assert.equal(pending.original_cleanup, 'pending');
  assert.deepEqual(events, ['cancel', 'pending']);
});
test('large cancellation cleanup has a time budget and does not claim all originals deleted', async () => {
  const [, batchId, itemId] = path.split('/');
  let now = 0,
    removals = 0;
  const result = await cleanCancelledImportOriginals(batchId, {
    cancel: async () => ({ items: [{ id: itemId }, { id: itemId }] }),
    remove: async () => {
      removals++;
      now = 31000;
    },
    now: () => now,
    cleanupFailed: () => {},
  });
  assert.equal(removals, 1);
  assert.equal(result.original_cleanup, 'pending');
});
test('missing objects are idempotent; malformed targets and replaced objects fail closed', async () => {
  const missing = new Error('missing');
  let deleted = 0;
  const deps = {
    head: async () => {
      throw missing;
    },
    del: async () => {
      deleted++;
    },
    isMissing: (error) => error === missing,
  };
  await removeImportOriginal(path, deps);
  for (const target of ['imports/', 'https://example.com/file', `${path}/extra`])
    await assert.rejects(removeImportOriginal(target, deps));
  for (const metadata of [
    { pathname: 'other', etag: 'v2' },
    { pathname: path, etag: '' },
  ])
    await assert.rejects(removeImportOriginal(path, { ...deps, head: async () => metadata }));
  await assert.rejects(
    removeImportOriginal(path, {
      ...deps,
      head: async () => ({ pathname: path, etag: 'v1' }),
      del: async () => {
        throw new Error('etag changed');
      },
    }),
    /etag changed/,
  );
  assert.equal(deleted, 0);
});
