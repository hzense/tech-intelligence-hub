import type { ImportBatch } from '../../../packages/database/src/import-store.mjs';
import { importFail } from '../../../packages/ingestion/src/import-task-contract.mjs';

// Verify ownership/state before any retry. Originals are no longer retained;
// only a URL fetch that never received an original can be requeued.
export async function retryImportWithSourceCheck<T>(
  itemId: string,
  dependencies: {
    getBatch: () => Promise<ImportBatch>;
    retry: () => Promise<T>;
  },
) {
  const batch = await dependencies.getBatch();
  const item = batch.items.find((entry) => entry.id === itemId);
  if (
    batch.cancelled ||
    !item ||
    item.status !== 'failed' ||
    item.fence >= 5 ||
    item.error_code === 'source_unavailable' ||
    item.kind === 'file' ||
    Boolean(item.sha256)
  )
    importFail('retry_not_allowed');
  // Only URL failures before receiving any original can retry. Received originals
  // are deleted on completion/failure and must never be read again for a retry.
  return dependencies.retry();
}
