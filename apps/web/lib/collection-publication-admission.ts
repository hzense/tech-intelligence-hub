import type { AutomationRun } from '../../../packages/database/src/automation-store.mjs';
import { automationStableId } from '../../../packages/database/src/automation-contract.mjs';
import {
  parseCollectionPublicationWindow,
  type CollectionPublicationWindow,
} from '../../../packages/database/src/collection-publication-window.mjs';
import { discoveryWindow } from './source-discovery-core.ts';
import { readAutomationSourceFallbacks } from './automation-source-fallbacks.ts';

/** Internal workflow context. Never accepted as a browser request field. */
export type CollectionPublicationRun = Pick<
  AutomationRun,
  'id' | 'owner_id' | 'created_at' | 'snapshot' | 'result'
>;

/** Bind the admitted original (including a selected fallback) to the saved
 * collection window. The model's discovered date is evidence, not the final
 * publication date: the latter must still be checked after extraction. */
export function bindCollectionPublicationWindow(
  run: CollectionPublicationRun,
  owner: string,
  request: { id: string; batchId: string; itemId: string },
  sourceUrls: string[],
): CollectionPublicationWindow | null {
  const config = run.snapshot;
  if (
    run.owner_id !== owner ||
    config.kind !== 'source_collection' ||
    config.publicationMode !== 'automatic' ||
    !config.discovery ||
    !Number.isInteger(config.discovery.lookbackDays) ||
    config.discovery.lookbackDays < 1 ||
    config.discovery.lookbackDays > 30 ||
    sourceUrls.length !== 1 ||
    request.id !== automationStableId({ runId: run.id, itemId: request.itemId, kind: 'generation' })
  )
    return null;
  let window;
  try {
    window = discoveryWindow(config, run.created_at);
  } catch {
    return null;
  }
  const discovery = run.result?.discovery as Record<string, unknown> | undefined;
  if (
    !discovery ||
    discovery.windowStart !== window.windowStart ||
    discovery.windowEnd !== window.windowEnd ||
    !Array.isArray(discovery.articles) ||
    discovery.articles.length > 8
  )
    return null;
  const sourceUrl = sourceUrls[0]!;
  let articles: unknown[] = discovery.articles;
  if (run.result?.batchId !== request.batchId) {
    const receipt = readAutomationSourceFallbacks(run.result?.sourceFallbacks).find(
      (row) =>
        row.batchId === request.batchId && row.itemId === request.itemId && row.url === sourceUrl,
    );
    if (!receipt) return null;
    const primary = articles.find(
      (row) => !!row && typeof row === 'object' && 'url' in row && row.url === receipt.originalUrl,
    ) as { alternatives?: unknown } | undefined;
    if (!Array.isArray(primary?.alternatives) || primary.alternatives.length > 2) return null;
    articles = primary.alternatives;
  }
  const matches = articles.filter(
    (row) => !!row && typeof row === 'object' && 'url' in row && row.url === sourceUrl,
  ) as Array<{ publishedAt?: unknown }>;
  if (matches.length !== 1) return null;
  return parseCollectionPublicationWindow({
    runId: run.id,
    ...window,
    sourceUrl,
    discoveredPublishedAt: matches[0]!.publishedAt,
  });
}
