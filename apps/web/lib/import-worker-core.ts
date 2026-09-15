import { createHash } from 'node:crypto';
import type { ImportDocument, ImportItem } from '../../../packages/database/src/import-store.mjs';
import { ImportIOError } from './import-io.ts';
import { parseImportOutput } from '../../../packages/ingestion/src/import-task-contract.mjs';
interface ObjectReceipt {
  bytes: Buffer;
  version: string;
  sha256: string;
}
interface Completion {
  fence: number;
  outcome: string;
  output?: unknown;
  errorCode?: string;
  chargedMicrousd: number;
}
export interface ImportWorkerDependencies {
  expire(): Promise<unknown>;
  claim(): Promise<{
    item: ImportItem;
    attempt: { fence: number };
    document: ImportDocument | null;
  }>;
  read(path: string): Promise<ObjectReceipt>;
  fetch(url: string): Promise<{ bytes: Buffer; format: string }>;
  put(path: string, bytes: Buffer): Promise<unknown>;
  confirm(document: ImportDocument, fence: number): Promise<unknown>;
  parse(bytes: Buffer, format: string): Promise<unknown>;
  finish(completion: Completion): Promise<unknown>;
}
export async function runImportProcessing(
  path: string,
  reserve: number,
  deps: ImportWorkerDependencies,
) {
  await deps.expire();
  const claim = await deps.claim(); // No external work unless the durable budget/lease claim succeeds.
  let completion: Completion;
  let processingStarted = false;
  try {
    let document = claim.document;
    if (!document) {
      if (claim.item.kind !== 'url' || !claim.item.declaration.url)
        throw new Error('document_missing');
      processingStarted = true;
      const fetched = await deps.fetch(claim.item.declaration.url);
      await deps.put(path, fetched.bytes);
      const receipt = await deps.read(path);
      if (receipt.sha256 !== createHash('sha256').update(fetched.bytes).digest('hex'))
        throw new Error('document_conflict');
      document = {
        object_key: path,
        object_version: receipt.version,
        sha256: receipt.sha256,
        byte_size: receipt.bytes.length,
        format: fetched.format,
      };
      await deps.confirm(document, claim.attempt.fence);
    }
    if (document.object_key !== path) throw new Error('document_conflict');
    const receipt = await deps.read(path);
    if (
      receipt.version !== document.object_version ||
      receipt.sha256 !== document.sha256 ||
      receipt.bytes.length !== document.byte_size
    )
      throw new Error('document_conflict');
    processingStarted = true;
    const output = await deps.parse(receipt.bytes, document.format);
    // Deterministic parser contract failures must be persisted as failed, not left running.
    // Keep the original input shape: persistence independently validates and normalizes it.
    try {
      parseImportOutput(output);
    } catch {
      throw new ImportIOError('parse_failed');
    }
    completion = {
      fence: claim.attempt.fence,
      outcome: 'completed',
      output,
      chargedMicrousd: reserve,
    };
  } catch (error) {
    const known =
      error instanceof ImportIOError &&
      [
        'parse_failed',
        'fetch_failed',
        'unsupported_content',
        'limit_exceeded',
        'ocr_required',
        'source_unavailable',
      ].includes(error.code);
    completion = {
      fence: claim.attempt.fence,
      outcome: known ? 'failed' : 'unknown',
      errorCode: known ? error.code : 'outcome_unknown',
      chargedMicrousd:
        known && error.code === 'source_unavailable' && !processingStarted ? 0 : reserve,
    };
  }
  // An ambiguous completion commit must not trigger a second competing completion.
  return deps.finish(completion);
}
