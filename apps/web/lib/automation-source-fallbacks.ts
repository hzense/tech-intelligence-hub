import { discoveryUrl } from './source-discovery-core.ts';
import { discoveryAlternativeLimit } from './source-discovery-output.ts';
import { readImportFetchDiagnostic } from '../../../packages/ingestion/src/import-fetch-diagnostic.mjs';

export const sourceFallbackLimit = discoveryAlternativeLimit;
const receiptLimit = 8 * sourceFallbackLimit;
export interface AutomationSourceFallback {
  primaryItemId: string;
  originalUrl: string;
  batchId: string;
  url: string;
  itemId?: string;
}
const uuid = (value: unknown): value is string =>
  typeof value === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value);

/** These are attempt receipts, not proof that an import or generation succeeded. */
export function readAutomationSourceFallbacks(value: unknown): AutomationSourceFallback[] {
  if (!Array.isArray(value)) return [];
  const result: AutomationSourceFallback[] = [];
  const seen = new Set<string>();
  for (const row of value.slice(0, receiptLimit)) {
    if (!row || typeof row !== 'object' || Array.isArray(row)) continue;
    const originalUrl = discoveryUrl(row.originalUrl);
    const url = discoveryUrl(row.url);
    if (
      !uuid(row.primaryItemId) ||
      !uuid(row.batchId) ||
      !originalUrl ||
      !url ||
      originalUrl === url ||
      seen.has(row.batchId) ||
      (row.itemId !== undefined && !uuid(row.itemId)) ||
      result.filter((entry) => entry.primaryItemId === row.primaryItemId).length >=
        sourceFallbackLimit
    )
      continue;
    seen.add(row.batchId);
    result.push({
      primaryItemId: row.primaryItemId,
      originalUrl,
      batchId: row.batchId,
      url,
      ...(row.itemId ? { itemId: row.itemId } : {}),
    });
  }
  return result;
}

/** Read only alternatives already admitted by the original discovery call.
 * No URLs inferred from titles, synthesized mirrors or new paid searches. */
export function sourceFallbackUrls(discovery: unknown, primaryUrl: string): string[] {
  if (!discovery || typeof discovery !== 'object' || Array.isArray(discovery)) return [];
  const result = discovery as Record<string, unknown>;
  if (!Array.isArray(result.articles) || result.articles.length > 8) return [];
  const primary = result.articles.find((row) => row?.url === primaryUrl);
  if (!primary || !Array.isArray(primary.alternatives)) return [];
  const primaryUrls = new Set(result.articles.map((row) => discoveryUrl(row?.url)));
  const seen = new Set<string>();
  return primary.alternatives.slice(0, sourceFallbackLimit).flatMap((row: unknown) => {
    if (!row || typeof row !== 'object' || Array.isArray(row)) return [];
    const alternative = row as Record<string, unknown>;
    const url = discoveryUrl(alternative.url);
    const date = alternative.publishedAt;
    if (
      !url ||
      primaryUrls.has(url) ||
      seen.has(url) ||
      typeof alternative.title !== 'string' ||
      !alternative.title.trim() ||
      [...alternative.title].length > 300 ||
      /[\p{Cc}\p{Cf}]/u.test(alternative.title) ||
      typeof date !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
      !Number.isFinite(Date.parse(date)) ||
      new Date(date).toISOString().slice(0, 10) !== date ||
      typeof result.windowStart !== 'string' ||
      typeof result.windowEnd !== 'string' ||
      date < result.windowStart.slice(0, 10) ||
      date > result.windowEnd.slice(0, 10)
    )
      return [];
    seen.add(url);
    return [url];
  });
}

/** Only confirmed source access failures admit a different source. Cancellation,
 * parser failures, policy refusals and unknown commit outcomes never do. */
export function canTrySourceFallback(failure: unknown): boolean {
  if (!failure || typeof failure !== 'object' || Array.isArray(failure)) return false;
  const row = failure as Record<string, unknown>;
  if (row.phase !== 'import_source' || row.code !== 'fetch_failed') return false;
  const diagnostic = readImportFetchDiagnostic(row.fetchDiagnostic);
  return diagnostic?.reason === 'http_status'
    ? [401, 403, 404, 410, 429, 500, 502, 503, 504].includes(diagnostic.status)
    : diagnostic?.reason === 'timeout' || diagnostic?.reason === 'network';
}
