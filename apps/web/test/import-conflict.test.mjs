import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assertImportBlobMetadata,
  assertImportBlobVersion,
} from '../lib/import-blob-validation.ts';
import { importError } from '../lib/admin-import-core.ts';
import { ImportTaskError } from '../../../packages/ingestion/src/import-task-contract.mjs';
import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import {
  ImportClientError,
  canUploadAfterConfirmError,
  importFailureHint,
} from '../lib/import-client-error.ts';

test('blob conflicts identify the failed check without accepting differing ETags', () => {
  for (const [fn, reason] of [
    [() => assertImportBlobMetadata('a', { pathname: 'b', size: 3 }), 'blob_path_mismatch'],
    [() => assertImportBlobMetadata('a', { pathname: 'a', size: 0 }), 'blob_size_invalid'],
    [() => assertImportBlobVersion(304, 'a', 'a'), 'blob_status_invalid'],
    [() => assertImportBlobVersion(200, '', 'a'), 'blob_etag_missing'],
    [() => assertImportBlobVersion(200, 'a', 'b'), 'blob_etag_mismatch'],
    [() => assertImportBlobVersion(200, '"a"', 'a'), 'blob_etag_format_mismatch'],
  ])
    assert.throws(fn, (e) => e.code === 'document_conflict' && e.reason === reason);
  assertImportBlobMetadata('a', { pathname: 'a', size: 1 });
  assertImportBlobVersion(200, '"a"', '"a"');
});
test('API only exposes fixed diagnostic reasons and never arbitrary provider data', async () => {
  const response = importError(new ImportTaskError('document_conflict', 'blob_etag_mismatch'));
  assert.equal(response.status, 409);
  assert.deepEqual(await response.json(), {
    error: 'document_conflict',
    reason: 'blob_etag_mismatch',
  });
  for (const reason of ['secret/path/token', undefined]) {
    assert.deepEqual(await importError(new ImportTaskError('document_conflict', reason)).json(), {
      error: 'document_conflict',
    });
  }
});
test('confirmation conflict or unavailable service never falls through to another upload', () => {
  assert.equal(canUploadAfterConfirmError(new ImportClientError('source_unavailable')), true);
  for (const error of [
    new Error('source_unavailable'),
    new ImportClientError('document_conflict'),
    new ImportClientError('unavailable'),
    new ImportClientError('cancelled'),
    new ImportClientError('source_expired'),
  ]) {
    assert.equal(canUploadAfterConfirmError(error), false);
  }
  const error = new ImportClientError('document_conflict', 'blob_etag_mismatch');
  assert.match(error.message, /blob_etag_mismatch/);
  assert.match(importFailureHint(error), /已停止重传/);
  assert.equal(new ImportClientError('document_conflict', 'secret').message, 'document_conflict');
  assert.match(importFailureHint(new ImportClientError('source_expired')), /不能在原批次重传/);
});
test('production reader classifies existing expired originals separately from missing ones', () => {
  const source = readFileSync(new URL('../lib/server/import-service.ts', import.meta.url), 'utf8');
  assert.match(
    source,
    /originalExpired\(metadata.uploadedAt\)\) throw new ImportIOError\('source_expired'\)/,
  );
});
