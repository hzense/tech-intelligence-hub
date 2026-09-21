import type { ImportPool } from './import-store.mjs';
export function assertCandidateReviewRole(
  client: Pick<Awaited<ReturnType<ImportPool['connect']>>, 'query'>,
): Promise<void>;
