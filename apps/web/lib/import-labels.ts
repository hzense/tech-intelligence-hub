import type { ImportBatch, ImportItem } from '../../../packages/database/src/import-store.mjs';
export function importItemName(item: ImportItem) {
  return item.declaration.name ?? item.declaration.url ?? '未命名资料';
}
export function importBatchName(batch: ImportBatch) {
  const names = batch.items.map(importItemName);
  return names.length > 1 ? `${names[0]} 等 ${names.length} 项资料` : (names[0] ?? '空批次');
}
export function importBatchLabel(batch: ImportBatch) {
  const date =
    batch.created_at instanceof Date
      ? batch.created_at.toISOString().slice(0, 10)
      : batch.created_at?.slice(0, 10);
  return [importBatchName(batch), date, batch.id.slice(0, 8)].filter(Boolean).join(' · ');
}
