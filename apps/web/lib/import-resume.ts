import type { ImportBatch } from '../../../packages/database/src/import-store.mjs';

type RecoveryReceipt = { batchId: string; itemId: string | null };

export function matchesRecoveryReceipt(
  receipts: RecoveryReceipt[],
  batchId: string,
  itemId: string,
) {
  return receipts.some(
    (ref) => ref.batchId === batchId && (ref.itemId === null || ref.itemId === itemId),
  );
}

export async function markRecoverableImports(
  batches: ImportBatch[],
  findReceipts: (batchIds: string[]) => Promise<RecoveryReceipt[]>,
): Promise<ImportBatch[]> {
  const unclaimed = (item: ImportBatch['items'][number]) =>
    item.kind === 'url' && item.status === 'queued' && item.fence === 0;
  const relevant = batches.filter(
    (batch) =>
      batch.intent === 'preview' &&
      !batch.cancelled &&
      !batch.deleted_at &&
      batch.items.some(unclaimed),
  );
  if (!relevant.length) return batches;
  const receipts = await findReceipts(relevant.map((batch) => batch.id));
  if (!receipts.length) return batches;
  return batches.map((batch) => {
    if (!relevant.includes(batch)) return batch;
    return {
      ...batch,
      items: batch.items.map((item) =>
        unclaimed(item) && matchesRecoveryReceipt(receipts, batch.id, item.id)
          ? { ...item, recovery_available: true }
          : item,
      ),
    };
  });
}
