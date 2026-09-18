import { createRequire } from 'node:module';
import { pathToFileURL, URL } from 'node:url';
import process from 'node:process';
import console from 'node:console';
import { importUuid } from '../../packages/ingestion/src/import-task-contract.mjs';
import {
  assertImportStore,
  originalExpired,
} from '../../packages/ingestion/src/import-retention.mjs';

function isOriginalPath(pathname) {
  if (typeof pathname !== 'string') return false;
  const parts = pathname.split('/');
  if (parts.length !== 3 || parts[0] !== 'imports') return false;
  try {
    // Exactly the same identifier contract as import creation and objectPath().
    return importUuid(parts[1]) === parts[1] && importUuid(parts[2]) === parts[2];
  } catch {
    return false;
  }
}
// Separate cloud job: only a dedicated Blob credential, never database/AI secrets.
export async function sweepImportOriginals({
  token,
  storeId,
  apply = false,
  now = Date.now(),
  sdk,
}) {
  assertImportStore(token, storeId);
  if (typeof apply !== 'boolean') throw new Error('invalid_mode');
  const candidates = new Map();
  const cursors = new Set();
  let cursor,
    pages = 0,
    scanned = 0;
  do {
    if (++pages > 1000) throw new Error('retention_scan_limit');
    const page = await sdk.list({ prefix: 'imports/', limit: 1000, cursor, token });
    for (const blob of page.blobs) {
      scanned++;
      // Unexpected paths cannot expand the deletion scope; fail before deleting anything.
      if (!isOriginalPath(blob.pathname)) throw new Error('unexpected_original_path');
      const url = new URL(blob.url);
      if (
        url.protocol !== 'https:' ||
        url.host !== `${storeId.toLowerCase()}.private.blob.vercel-storage.com` ||
        url.username ||
        url.password ||
        url.search ||
        url.hash ||
        url.pathname !== `/${blob.pathname}`
      )
        throw new Error('unexpected_original_store');
      if (originalExpired(blob.uploadedAt, now)) candidates.set(blob.pathname, true);
    }
    if (!page.hasMore) break;
    if (!page.cursor || cursors.has(page.cursor)) throw new Error('retention_cursor_invalid');
    cursors.add(page.cursor);
    cursor = page.cursor;
  } while (cursor);
  let deleted = 0;
  if (apply)
    for (const pathname of candidates.keys()) {
      // Recheck age/version after listing. Never delete a replaced or recently uploaded object.
      let current;
      try {
        current = await sdk.head(pathname, { token });
      } catch (error) {
        if (error instanceof sdk.BlobNotFoundError) continue;
        throw error;
      }
      if (
        current.pathname !== pathname ||
        !originalExpired(current.uploadedAt, now) ||
        !current.etag
      )
        throw new Error('retention_object_changed');
      await sdk.del(pathname, { token, ifMatch: current.etag });
      deleted++;
    }
  return {
    mode: apply ? 'apply' : 'dry-run',
    retentionDays: 1,
    scanned,
    eligible: candidates.size,
    deleted,
  };
}

export function retentionApplyMode(env) {
  if (env.IMPORT_RETENTION_MODE === 'dry-run') return false;
  if (env.IMPORT_RETENTION_MODE === 'apply' && env.HZENSE_IMPORT_RETENTION_ENABLED === '1')
    return true;
  throw new Error('not_configured');
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  try {
    const apply = retentionApplyMode(process.env);
    const require = createRequire(new URL('../../apps/web/package.json', import.meta.url));
    const result = await sweepImportOriginals({
      token: process.env.HZENSE_IMPORT_BLOB_TOKEN,
      storeId: process.env.HZENSE_IMPORT_BLOB_STORE_ID,
      apply,
      sdk: require('@vercel/blob'),
    });
    console.log(JSON.stringify(result));
  } catch {
    console.error(
      'import_retention_failed; inspect the run before retrying; partial deletion is possible',
    );
    process.exitCode = 1;
  }
}
