// Approved 2026-09-15: original objects only. Derived outputs/audits are retained.
export const IMPORT_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
export function originalExpired(uploadedAt, now = Date.now()) {
  const time = new Date(uploadedAt).getTime();
  if (!Number.isFinite(time) || !Number.isFinite(now)) throw new Error('invalid_retention_time');
  return time + IMPORT_RETENTION_MS <= now;
}
export function assertImportStore(token, storeId) {
  if (
    typeof storeId !== 'string' ||
    !/^[a-zA-Z0-9]+$/.test(storeId) ||
    typeof token !== 'string' ||
    !token.startsWith(`vercel_blob_rw_${storeId}_`)
  )
    throw new Error('import_store_mismatch');
}
