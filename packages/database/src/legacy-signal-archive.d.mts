export interface LegacySignalArchiveRow {
  signal_id: string;
  signal: Record<string, unknown>;
  references: {
    source: Record<string, unknown>;
    entities: Record<string, unknown>[];
    topics: Record<string, unknown>[];
  };
  projection: Record<string, unknown> | null;
  content_hash: string;
  record_hash: string;
}
export interface LegacySignalArchivePlan {
  schema_version: '1.0.0';
  rows: LegacySignalArchiveRow[];
  count: number;
  plan_hash: string;
}
export interface LegacySignalArchiveClient {
  query(sql: string, parameters?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
}
export function canonicalLegacyArchiveJson(value: unknown): string;
export function buildLegacySignalArchivePlan(
  catalog: {
    signals: { id: string; [key: string]: unknown }[];
    entities: { id: string; [key: string]: unknown }[];
    sources: { id: string; [key: string]: unknown }[];
    topics: { id: string; [key: string]: unknown }[];
  },
  projections: { id: string; [key: string]: unknown }[],
): LegacySignalArchivePlan;
export function assertLegacySignalArchivePlan(plan: unknown): LegacySignalArchivePlan;
export const legacySignalArchiveReadQuery: string;
export function reconcileLegacySignalArchive(
  client: LegacySignalArchiveClient,
  plan: LegacySignalArchivePlan,
): Promise<{ existing: number; missing: string[]; count: number; plan_hash: string }>;
export function applyLegacySignalArchive(
  client: LegacySignalArchiveClient,
  plan: LegacySignalArchivePlan,
): Promise<{ inserted: number; existing: number; count: number; plan_hash: string }>;
