import { importUuid } from '../../../packages/ingestion/src/import-task-contract.mjs';

/** Exact per-item scope, conditional deletion; never accept a provider URL as a target. */
export async function removeImportOriginal(
  path: string,
  deps: {
    head(path: string): Promise<{ pathname: string; etag: string }>;
    del(path: string, etag: string): Promise<void>;
    isMissing(error: unknown): boolean;
  },
) {
  const parts = path.split('/');
  if (
    parts.length !== 3 ||
    parts[0] !== 'imports' ||
    importUuid(parts[1]) !== parts[1] ||
    importUuid(parts[2]) !== parts[2]
  )
    throw new Error('invalid_original_path');
  try {
    const metadata = await deps.head(path);
    if (metadata.pathname !== path || !metadata.etag) throw new Error('original_changed');
    await deps.del(path, metadata.etag);
  } catch (error) {
    if (!deps.isMissing(error)) throw error;
  }
}

/** Run only after the durable cancellation/ownership check has succeeded. */
export async function cleanCancelledImportOriginals<T extends { items: { id: string }[] }>(
  batchId: string,
  deps: {
    cancel(): Promise<T>;
    remove(path: string): Promise<void>;
    now(): number;
    cleanupFailed(): void;
  },
) {
  const batch = await deps.cancel();
  const deadline = deps.now() + 30000;
  let pending = false;
  for (const item of batch.items) {
    if (deps.now() >= deadline) {
      pending = true;
      break;
    }
    try {
      await deps.remove(`imports/${importUuid(batchId)}/${importUuid(item.id)}`);
    } catch {
      pending = true;
    }
  }
  if (pending) deps.cleanupFailed();
  return { ...batch, original_cleanup: pending ? 'pending' : 'deleted' };
}
