import type { ImportCapabilities } from './import-manifest.mjs';
export class ImportTaskError extends Error {
  code: string;
  reason?: string;
  constructor(code: string, reason?: string);
}
export function importFail(code?: string, reason?: string): never;
export function importUuid(value: unknown): string;
export function importOwner(value: unknown): string;
export function parseImportCreate(
  value: unknown,
  capabilities: ImportCapabilities,
): {
  id: string;
  intent: string;
  fingerprint: string;
  items: { kind: string; declaration: Record<string, unknown> }[];
};
export interface ImportOutput {
  classification: 'private';
  fragments: { index: number; text: string; locator: Record<string, string | number> }[];
  warnings: string[];
}
export function parseImportOutput(value: unknown): ImportOutput;
export function importBatchStatus(
  batch: { cancelled: boolean },
  items: { status: string }[],
): string;
