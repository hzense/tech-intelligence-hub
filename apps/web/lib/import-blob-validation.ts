import { importFail } from '../../../packages/ingestion/src/import-task-contract.mjs';
export function assertImportBlobMetadata(
  path: string,
  metadata: { pathname: string; size: number },
) {
  if (metadata.pathname !== path) importFail('document_conflict', 'blob_path_mismatch');
  if (!Number.isSafeInteger(metadata.size) || metadata.size < 1 || metadata.size > 25 * 1024 * 1024)
    importFail('document_conflict', 'blob_size_invalid');
}
export function assertImportBlobVersion(status: number, actual: string, expected: string) {
  if (status !== 200) importFail('document_conflict', 'blob_status_invalid');
  if (!actual || !expected) importFail('document_conflict', 'blob_etag_missing');
  if (actual !== expected) {
    const unquote = (value: string) => value.replace(/^"(.*)"$/, '$1');
    // Diagnose representation differences without accepting a mismatched version.
    importFail(
      'document_conflict',
      unquote(actual) === unquote(expected) ? 'blob_etag_format_mismatch' : 'blob_etag_mismatch',
    );
  }
}
