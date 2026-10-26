export interface CollectionPublicationWindow {
  runId: string;
  windowStart: string;
  windowEnd: string;
  sourceUrl: string;
  discoveredPublishedAt: string;
}
export function parseCollectionPublicationWindow(
  value: unknown,
): CollectionPublicationWindow | null;
export function collectionPublicationDateIssue(
  collection: unknown,
  eventDate: unknown,
  sourceUrls: unknown,
): 'invalid_collection_window' | 'collection_source_mismatch' | 'source_date_out_of_window' | null;
