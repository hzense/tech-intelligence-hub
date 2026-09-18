import 'server-only';
import pg from 'pg';
import { createHash } from 'node:crypto';
import { get, head, put, del, BlobNotFoundError } from '@vercel/blob';
import { Sandbox } from '@vercel/sandbox';
import { importParserSource } from '../../../../packages/ingestion/src/import-parser-source.mjs';
import * as store from '../../../../packages/database/src/import-store.mjs';
import { assertImportRole } from '../../../../packages/database/src/import-role.mjs';
import {
  importFail,
  importUuid,
} from '../../../../packages/ingestion/src/import-task-contract.mjs';
import { diagnoseImportConfiguration } from '../import-config';
import { ImportIOError, readImportBytes } from '../import-io';
import { assertImportBlobMetadata, assertImportBlobVersion } from '../import-blob-validation';
import { importBlobReadOptions } from '../import-blob-read-options';
import { fetchImportURL } from '../import-fetch';
import { runImportProcessing } from '../import-worker-core';
import { retryImportWithSourceCheck } from '../import-retry';
import { originalExpired } from '../../../../packages/ingestion/src/import-retention.mjs';
import { removeImportOriginal, cleanCancelledImportOriginals } from '../import-original-cleanup';
export const importCapabilities = {
  parsers: ['pdf', 'docx', 'markdown', 'text', 'html', 'csv', 'xlsx'] as const,
  ocr: false,
  urlFetch: true,
};
function parserVersion(snapshot: string) {
  return `isolated-v1/${createHash('sha256').update(snapshot).update(importParserSource).digest('hex').slice(0, 32)}`;
}
export function importConfig() {
  if (!importConfigurationDiagnostics().ready) throw new ImportIOError('not_configured');
  return {
    url: process.env.HZENSE_IMPORT_DATABASE_URL!,
    token: process.env.HZENSE_IMPORT_BLOB_TOKEN!,
    snapshot: process.env.HZENSE_IMPORT_PARSER_SNAPSHOT_ID!,
    reserve: Number(process.env.HZENSE_IMPORT_RESERVE_MICROUSD),
    daily: Number(process.env.HZENSE_IMPORT_DAILY_LIMIT_MICROUSD),
    batch: Number(process.env.HZENSE_IMPORT_BATCH_LIMIT_MICROUSD),
  };
}
export function importConfigurationDiagnostics() {
  return diagnoseImportConfiguration(process.env);
}
export function importsConfigured() {
  try {
    importConfig();
    return true;
  } catch {
    return false;
  }
}
let pool: pg.Pool | undefined;
let poolURL: string | undefined;
export const importPool = {
  async connect() {
    const config = importConfig();
    if (poolURL && poolURL !== config.url) importFail('not_configured');
    if (!pool) {
      poolURL = config.url;
      pool = new pg.Pool({
        connectionString: config.url,
        max: 2,
        idleTimeoutMillis: 10000,
        connectionTimeoutMillis: 3500,
        query_timeout: 15000,
        allowExitOnIdle: true,
        enableChannelBinding: true,
        application_name: 'hzense-import',
      });
      pool.on('error', () => console.error('import_pool_unavailable'));
    }
    const client = await pool.connect();
    try {
      // Fail closed on identity, memberships, powerful attributes and ambient application ACL.
      await assertImportRole(client);
      return client;
    } catch (error) {
      client.release(true);
      throw error;
    }
  },
};
function key(batchId: string, itemId: string) {
  return `imports/${importUuid(batchId)}/${importUuid(itemId)}`;
}
async function removeOriginal(path: string) {
  const { token } = importConfig();
  await removeImportOriginal(path, {
    head: (pathname) => head(pathname, { token, abortSignal: AbortSignal.timeout(15000) }),
    del: (pathname, etag) =>
      del(pathname, { token, ifMatch: etag, abortSignal: AbortSignal.timeout(15000) }),
    isMissing: (error) => error instanceof BlobNotFoundError,
  });
}
function cleanupFailed() {
  console.error('import_original_cleanup_pending');
}
async function inspectImportOriginal(path: string) {
  const { token } = importConfig();
  let metadata;
  try {
    metadata = await head(path, { token, abortSignal: AbortSignal.timeout(15000) });
  } catch (error) {
    if (error instanceof BlobNotFoundError) throw new ImportIOError('source_unavailable');
    throw error;
  }
  if (originalExpired(metadata.uploadedAt)) throw new ImportIOError('source_expired');
  assertImportBlobMetadata(path, metadata);
  return metadata;
}
export async function readImportObject(path: string) {
  const { token } = importConfig();
  const metadata = await inspectImportOriginal(path);
  let result;
  try {
    result = await get(path, importBlobReadOptions(token));
  } catch (error) {
    if (error instanceof BlobNotFoundError) throw new ImportIOError('source_unavailable');
    throw error;
  }
  if (!result) throw new ImportIOError('source_unavailable');
  assertImportBlobVersion(result.statusCode, result.blob.etag, metadata.etag);
  const bytes = await readImportBytes(result.stream, 25 * 1024 * 1024);
  if (bytes.length !== metadata.size) importFail('document_conflict', 'blob_byte_size_mismatch');
  return {
    bytes,
    version: metadata.etag,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  };
}
export async function uploadItem(owner: string, batchId: string, itemId: string) {
  const batch = await store.getImportBatch({ pool: importPool, owner, id: importUuid(batchId) });
  const item = batch.items.find((i) => i.id === importUuid(itemId));
  if (batch.cancelled || !item || item.kind !== 'file' || item.status !== 'awaiting_upload')
    importFail('not_claimable');
  return item;
}
export async function confirmImportUpload(owner: string, batchId: string, itemId: string) {
  const batch = await store.getImportBatch({ pool: importPool, owner, id: importUuid(batchId) });
  const item = batch.items.find((i) => i.id === importUuid(itemId));
  if (!item || item.kind !== 'file') importFail('not_claimable');
  if (batch.cancelled || ['completed', 'failed', 'unknown', 'cancelled'].includes(item.status)) {
    // A signed upload callback can arrive after cancellation or processing.
    await removeOriginal(key(batchId, itemId));
    return { item_id: item.id, received: true };
  }
  const path = key(batchId, itemId),
    object = await readImportObject(path);
  return store.confirmImportDocument({
    pool: importPool,
    owner,
    batchId,
    itemId,
    document: {
      object_key: path,
      object_version: object.version,
      sha256: object.sha256,
      byte_size: object.bytes.length,
      format: item.declaration.format!,
    },
  });
}
async function parseIsolated(bytes: Buffer, format: string) {
  const { snapshot } = importConfig();
  const sandbox = await Sandbox.create({
    source: { type: 'snapshot', snapshotId: snapshot },
    persistent: false,
    networkPolicy: 'deny-all',
    timeout: 120000,
    resources: { vcpus: 2 },
  });
  try {
    await sandbox.writeFiles([
      { path: '/tmp/import-parser.py', content: Buffer.from(importParserSource) },
      { path: '/tmp/import-source', content: bytes },
    ]);
    const command = await sandbox.runCommand('python3', [
      '-I',
      '/tmp/import-parser.py',
      '/tmp/import-source',
      format,
      '/tmp/import-result.json',
    ]);
    if (command.exitCode !== 0) throw new ImportIOError('parse_failed');
    const stream = await sandbox.readFile({ path: '/tmp/import-result.json' });
    if (!stream) throw new ImportIOError('parse_failed');
    let size = 0;
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      const b = Buffer.from(chunk);
      size += b.length;
      if (size > 2000000) throw new ImportIOError('limit_exceeded');
      chunks.push(b);
    }
    const result = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (result.error)
      throw new ImportIOError(
        ['ocr_required', 'limit_exceeded', 'unsupported_content'].includes(result.error)
          ? result.error
          : 'parse_failed',
      );
    return result.output;
  } finally {
    await sandbox.stop();
  }
}
/** One durable item per invocation. No local timer or fire-and-forget background work. */
export async function runImportItem(owner: string, batchId: string, itemId: string) {
  const config = importConfig();
  const args = {
    pool: importPool,
    owner,
    batchId: importUuid(batchId),
    itemId: importUuid(itemId),
  };
  return runImportProcessing(key(batchId, itemId), config.reserve, {
    expire: () => store.expireImportAttempt(args),
    claim: () =>
      store.claimImportItem({
        ...args,
        parserVersion: parserVersion(config.snapshot),
        reserveMicrousd: config.reserve,
        dailyLimitMicrousd: config.daily,
      }),
    read: readImportObject,
    fetch: fetchImportURL,
    parse: parseIsolated,
    confirm: (document, fence) => store.confirmImportDocument({ ...args, document, fence }),
    finish: (completion) => store.finishImportAttempt({ ...args, ...completion }),
    remove: removeOriginal,
    cleanupFailed,
    put: (path, bytes) =>
      put(path, bytes, {
        access: 'private',
        token: config.token,
        addRandomSuffix: false,
        allowOverwrite: false,
        contentType: 'application/octet-stream',
      }),
  });
}
export async function executeImportAdmin(owner: string, method: string, body: unknown) {
  if (method === 'GET') {
    const before =
      body && typeof body === 'object' && 'before' in body ? importUuid(body.before) : undefined;
    return {
      batches: await store.listImportBatches({
        pool: importPool,
        owner,
        ...(before === undefined ? {} : { before }),
      }),
    };
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) importFail();
  const value = body as Record<string, unknown>;
  if (Object.keys(value).some((k) => !['action', 'batchId', 'itemId', 'request'].includes(k)))
    importFail();
  if (value.action === 'create') {
    const c = importConfig();
    return store.createImportBatch({
      pool: importPool,
      owner,
      request: value.request,
      capabilities: importCapabilities,
      configuration: { parserVersion: parserVersion(c.snapshot), batchLimitMicrousd: c.batch },
    });
  }
  const batchId = importUuid(value.batchId);
  if (value.action === 'detail')
    return store.getImportBatch({ pool: importPool, owner, id: batchId });
  if (value.action === 'cancel') {
    return cleanCancelledImportOriginals(batchId, {
      cancel: () => store.cancelImportBatch({ pool: importPool, owner, id: batchId }),
      remove: removeOriginal,
      now: Date.now,
      cleanupFailed,
    });
  }
  const itemId = importUuid(value.itemId),
    args = { pool: importPool, owner, batchId, itemId };
  if (value.action === 'confirm') return confirmImportUpload(owner, batchId, itemId);
  if (value.action === 'retry')
    return retryImportWithSourceCheck(itemId, {
      getBatch: () => store.getImportBatch({ pool: importPool, owner, id: batchId }),
      retry: () => store.retryImportItem(args),
    });
  if (value.action === 'recover') return store.expireImportAttempt(args);
  if (value.action === 'output') return store.getImportOutput(args);
  if (value.action === 'run') return runImportItem(owner, batchId, itemId);
  importFail();
}
export async function importQueue() {
  const config = importConfig();
  return store.getImportQueue({
    pool: importPool,
    parserVersion: parserVersion(config.snapshot),
    reserveMicrousd: config.reserve,
  });
}
