import type { ImportBatch } from '../../../packages/database/src/import-store.mjs';
import { importFail } from '../../../packages/ingestion/src/import-task-contract.mjs';

// Verify ownership/state before contacting storage; do not reserve or queue work
// until an existing original has passed its current server-side availability check.
export async function retryImportWithSourceCheck<T>(
  itemId: string,
  dependencies: {
    getBatch: () => Promise<ImportBatch>;
    checkOriginal: () => Promise<unknown>;
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
    item.error_code === 'source_unavailable'
  )
    importFail('retry_not_allowed');
  // URL fetch failures may legitimately precede storage of any original.
  if (item.kind === 'file' || item.sha256) await dependencies.checkOriginal();
  return dependencies.retry();
}
