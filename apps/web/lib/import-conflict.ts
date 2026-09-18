// Fixed vocabulary only: never expose a path, filename, hash, token or provider error.
const reasons = new Set([
  'blob_path_mismatch',
  'blob_size_invalid',
  'blob_status_invalid',
  'blob_etag_mismatch',
  'blob_etag_missing',
  'blob_etag_format_mismatch',
  'blob_byte_size_mismatch',
  'receipt_mismatch',
  'item_state_mismatch',
  'declared_size_mismatch',
  'declared_format_mismatch',
]);
export function safeImportConflictReason(value: unknown) {
  return typeof value === 'string' && reasons.has(value) ? value : undefined;
}
