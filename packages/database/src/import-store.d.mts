import type { ImportCapabilities } from '../../ingestion/src/import-manifest.mjs';
export interface ImportItem {
  id: string;
  batch_id: string;
  position: number;
  kind: 'file' | 'url';
  declaration: {
    name?: string;
    size?: number;
    format?: string;
    mime?: string;
    clientItemId?: string;
    url?: string;
  };
  status: string;
  fence: number;
  error_code?: string | null;
  sha256?: string | null;
  lease_until?: string | null;
}
export interface ImportBatch {
  id: string;
  owner_id: string;
  intent: 'preview' | 'generate_publish';
  cancelled: boolean;
  status: string;
  created_at: Date | string;
  items: ImportItem[];
  configuration: { parserVersion: string; batchLimitMicrousd: number };
}
export interface ImportDocument {
  item_id?: string;
  object_key: string;
  object_version: string;
  sha256: string;
  byte_size: number;
  format: string;
}
export interface ImportPool {
  connect(): Promise<{
    query(text: string, values?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
    release(error?: unknown): void;
  }>;
}
interface Owned {
  pool: ImportPool;
  owner: string;
}
interface ItemArgs extends Owned {
  batchId: string;
  itemId: string;
}
export function createImportBatch(
  args: Owned & {
    request: unknown;
    capabilities: ImportCapabilities;
    configuration: { parserVersion: string; batchLimitMicrousd: number };
  },
): Promise<ImportBatch>;
export function getImportBatch(args: Owned & { id: string }): Promise<ImportBatch>;
export function listImportBatches(
  args: Owned & { before?: string; view?: 'all' | 'current' | 'history' },
): Promise<ImportBatch[]>;
export function cancelImportBatch(args: Owned & { id: string }): Promise<ImportBatch>;
export function confirmImportDocument(
  args: ItemArgs & { document: ImportDocument; fence?: number },
): Promise<{ item_id: string; received: boolean }>;
export function claimImportItem(
  args: ItemArgs & { parserVersion: string; reserveMicrousd?: number; dailyLimitMicrousd?: number },
): Promise<{ item: ImportItem; attempt: { fence: number }; document: ImportDocument | null }>;
export function finishImportAttempt(
  args: ItemArgs & {
    fence: number;
    outcome: string;
    output?: unknown;
    chargedMicrousd?: number;
    errorCode?: string | null;
  },
): Promise<{ item_id: string; status: string }>;
export function retryImportItem(args: ItemArgs): Promise<{ item_id: string; status: string }>;
export function expireImportAttempt(args: ItemArgs): Promise<{ changed: boolean; status?: string }>;
export function getImportQueue(args: {
  pool: ImportPool;
  parserVersion: string;
  reserveMicrousd?: number;
}): Promise<{ owner: string; batchId: string; itemId: string; status: string }[]>;
export function getImportOutput(args: ItemArgs): Promise<unknown>;
