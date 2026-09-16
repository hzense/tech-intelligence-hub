import test from 'node:test';
import assert from 'node:assert/strict';
import {
  retentionApplyMode,
  sweepImportOriginals,
} from '../../../.github/scripts/import-retention.mjs';
import {
  originalExpired,
  IMPORT_RETENTION_MS,
} from '../../../packages/ingestion/src/import-retention.mjs';
const now = Date.parse('2026-09-15T12:00:00Z');
test('manual dry run is independent of deletion enablement; apply remains fail closed', () => {
  for (const enabled of [undefined, '', '0', '1', 'true']) {
    assert.equal(
      retentionApplyMode({
        IMPORT_RETENTION_MODE: 'dry-run',
        HZENSE_IMPORT_RETENTION_ENABLED: enabled,
      }),
      false,
    );
    if (enabled === '1')
      assert.equal(
        retentionApplyMode({
          IMPORT_RETENTION_MODE: 'apply',
          HZENSE_IMPORT_RETENTION_ENABLED: enabled,
        }),
        true,
      );
    else
      assert.throws(
        () =>
          retentionApplyMode({
            IMPORT_RETENTION_MODE: 'apply',
            HZENSE_IMPORT_RETENTION_ENABLED: enabled,
          }),
        /not_configured/,
      );
  }
  for (const mode of [undefined, '', 'dry_run', 'APPLY'])
    assert.throws(
      () =>
        retentionApplyMode({ IMPORT_RETENTION_MODE: mode, HZENSE_IMPORT_RETENTION_ENABLED: '1' }),
      /not_configured/,
    );
});
const path = 'imports/11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222';
const token = 'vercel_blob_rw_synthetic_secret',
  storeId = 'synthetic';
function fixture(overrides = {}) {
  const blob = {
    pathname: path,
    uploadedAt: new Date(now - IMPORT_RETENTION_MS),
    url: `https://synthetic.private.blob.vercel-storage.com/${path}`,
  };
  const deleted = [];
  return {
    deleted,
    blob,
    args: {
      token,
      storeId,
      now,
      sdk: {
        list: async () => ({ blobs: [blob], hasMore: false }),
        head: async () => ({ ...blob, etag: 'original-v1' }),
        del: async (p, options) => deleted.push({ p, options }),
        BlobNotFoundError: class extends Error {},
        ...overrides,
      },
    },
  };
}
test('retention cutoff is exactly seven days and rejects invalid timestamps', () => {
  assert.equal(originalExpired(now - IMPORT_RETENTION_MS, now), true);
  assert.equal(originalExpired(now - IMPORT_RETENTION_MS + 1, now), false);
  assert.throws(() => originalExpired('invalid', now));
});
test('dry run never deletes; apply rechecks metadata and conditionally deletes only the original', async () => {
  const { args, deleted } = fixture();
  assert.equal((await sweepImportOriginals(args)).eligible, 1);
  assert.equal(deleted.length, 0);
  assert.equal((await sweepImportOriginals({ ...args, apply: true })).deleted, 1);
  assert.deepEqual(deleted, [{ p: path, options: { token, ifMatch: 'original-v1' } }]);
});
test('wrong store credentials and out-of-scope paths fail closed before deletion', async () => {
  for (const change of ['token', 'path', 'host', 'date']) {
    const { args, blob, deleted } = fixture();
    if (change === 'token') args.token = 'vercel_blob_rw_other_secret';
    if (change === 'path') blob.pathname = 'other/private.txt';
    if (change === 'host') blob.url = `https://synthetic.public.blob.vercel-storage.com/${path}`;
    if (change === 'date') blob.uploadedAt = 'invalid';
    await assert.rejects(sweepImportOriginals({ ...args, apply: true }));
    assert.equal(deleted.length, 0);
  }
});
test('retention accepts every UUID shape accepted at import creation, including v7', async () => {
  for (const id of [
    '11111111-1111-7111-8111-111111111111',
    '11111111-1111-0111-0111-111111111111',
  ]) {
    const { args, blob, deleted } = fixture();
    blob.pathname = `imports/${id}/${id}`;
    blob.url = `https://synthetic.private.blob.vercel-storage.com/${blob.pathname}`;
    assert.equal((await sweepImportOriginals({ ...args, apply: true })).deleted, 1);
    assert.equal(deleted[0].p, blob.pathname);
  }
});
test('retention still rejects malformed and traversal object paths', async () => {
  for (const invalid of [
    path + '/extra',
    path + '/',
    path.replace('imports/', 'imports/../'),
    path.toUpperCase(),
  ]) {
    const { args, blob, deleted } = fixture();
    blob.pathname = invalid;
    await assert.rejects(
      sweepImportOriginals({ ...args, apply: true }),
      /unexpected_original_path/,
    );
    assert.equal(deleted.length, 0);
  }
});
test('fresh and replaced originals are never deleted', async () => {
  const { args, blob, deleted } = fixture();
  blob.uploadedAt = new Date(now);
  assert.equal((await sweepImportOriginals({ ...args, apply: true })).deleted, 0);
  blob.uploadedAt = new Date(now - IMPORT_RETENTION_MS);
  args.sdk.head = async () => ({ ...blob, uploadedAt: new Date(now), etag: 'replacement' });
  await assert.rejects(sweepImportOriginals({ ...args, apply: true }));
  assert.equal(deleted.length, 0);
});
test('pagination is fully validated before deletion and duplicate cursors stop the job', async () => {
  const { args, blob, deleted } = fixture();
  let calls = 0;
  args.sdk.list = async () =>
    ++calls === 1
      ? { blobs: [blob], hasMore: true, cursor: 'next' }
      : { blobs: [], hasMore: false };
  assert.equal((await sweepImportOriginals({ ...args, apply: true })).deleted, 1);
  assert.equal(calls, 2);
  deleted.length = 0;
  args.sdk.list = async () => ({ blobs: [blob], hasMore: true, cursor: 'same' });
  await assert.rejects(sweepImportOriginals({ ...args, apply: true }));
  assert.equal(deleted.length, 0);
});
