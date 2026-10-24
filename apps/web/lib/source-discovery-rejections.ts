export const discoveryRejectionReasons = [
  'invalid_article',
  'invalid_url',
  'uncited_url',
  'non_article_url',
  'unexpected_fields',
  'invalid_title',
  'invalid_date_format',
  'invalid_date',
  'date_out_of_window',
] as const;

export type DiscoveryRejectionReason = (typeof discoveryRejectionReasons)[number];

/** Only bounded indices, reason codes and counts; never rejected provider content. */
export interface DiscoveryValidation {
  version: 1;
  returnedCount: number;
  validCitationCount: number;
  rejections: { index: number; reasons: DiscoveryRejectionReason[] }[];
  reasonCounts: Partial<Record<DiscoveryRejectionReason, number>>;
}
