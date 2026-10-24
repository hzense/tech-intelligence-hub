import type { DiscoveryRejectionReason } from './source-discovery-rejections.ts';
import { discoveryAlternativeLimit } from './source-discovery-output.ts';
import { isExplicitNonArticleUrl } from './source-discovery-url-kind.ts';

export interface DiscoverySource {
  url: string;
  title: string;
  publishedAt: string;
}
type ValidationContext = {
  normalizeUrl(value: unknown): string | null;
  cited: ReadonlySet<string>;
  windowStart: string;
  windowEnd: string;
};
type AlternativeRejectionReason =
  DiscoveryRejectionReason | 'invalid_alternatives' | 'too_many_alternatives' | 'duplicate_url';
/** Counts refer to alternatives of selected, valid main articles. No rejected content is kept. */
export interface DiscoveryAlternativeValidation {
  version: 1;
  returnedCount: number;
  acceptedCount: number;
  rejections: {
    index: number;
    alternativeIndex: number | null;
    reasons: AlternativeRejectionReason[];
  }[];
}

export function validateDiscoverySource(
  row: unknown,
  context: ValidationContext,
  allowAlternatives = false,
): { source: DiscoverySource | null; reasons: DiscoveryRejectionReason[] } {
  if (!row || typeof row !== 'object' || Array.isArray(row))
    return { source: null, reasons: ['invalid_article'] };
  const entry = row as Record<string, unknown>;
  const url = context.normalizeUrl(entry.url);
  const reasons: DiscoveryRejectionReason[] = [];
  if (!url) reasons.push('invalid_url');
  else {
    if (!context.cited.has(url)) reasons.push('uncited_url');
    if (isExplicitNonArticleUrl(url)) reasons.push('non_article_url');
  }
  const fields = ['url', 'title', 'publishedAt', ...(allowAlternatives ? ['alternatives'] : [])];
  if (Object.keys(entry).some((key) => !fields.includes(key))) reasons.push('unexpected_fields');
  if (
    typeof entry.title !== 'string' ||
    !entry.title.trim() ||
    [...entry.title].length > 300 ||
    /[\p{Cc}\p{Cf}]/u.test(entry.title)
  )
    reasons.push('invalid_title');
  if (typeof entry.publishedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(entry.publishedAt))
    reasons.push('invalid_date_format');
  else if (
    !Number.isFinite(Date.parse(entry.publishedAt)) ||
    new Date(entry.publishedAt).toISOString().slice(0, 10) !== entry.publishedAt
  )
    reasons.push('invalid_date');
  else if (
    entry.publishedAt < context.windowStart.slice(0, 10) ||
    entry.publishedAt > context.windowEnd.slice(0, 10)
  )
    reasons.push('date_out_of_window');
  return {
    source: reasons.length
      ? null
      : {
          url: url!,
          title: (entry.title as string).trim(),
          publishedAt: entry.publishedAt as string,
        },
    reasons,
  };
}

export function validateDiscoveryAlternatives(
  value: unknown,
  index: number,
  context: ValidationContext,
  seen: Set<string>,
  primaryUrls: ReadonlySet<string>,
  receipt: DiscoveryAlternativeValidation,
): DiscoverySource[] {
  if (!Array.isArray(value) || value.length > discoveryAlternativeLimit) {
    // Reject the whole malformed/oversized collection, without scanning unbounded nested data.
    receipt.rejections.push({
      index,
      alternativeIndex: null,
      reasons: [Array.isArray(value) ? 'too_many_alternatives' : 'invalid_alternatives'],
    });
    if (Array.isArray(value)) receipt.returnedCount += value.length;
    return [];
  }
  receipt.returnedCount += value.length;
  return value.flatMap((row, alternativeIndex) => {
    const { source, reasons } = validateDiscoverySource(row, context);
    if (!source) {
      receipt.rejections.push({ index, alternativeIndex, reasons });
      return [];
    }
    // Main sources win regardless of their order, validity or the configured event limit.
    if (primaryUrls.has(source.url) || seen.has(source.url)) {
      receipt.rejections.push({ index, alternativeIndex, reasons: ['duplicate_url'] });
      return [];
    }
    seen.add(source.url);
    receipt.acceptedCount++;
    return [source];
  });
}
