import { createHash } from 'node:crypto';
import { canonicalLegacyArchiveJson } from '../../../packages/database/src/legacy-signal-archive.mjs';
import { legacyArchiveProjectionHashes } from '../../../packages/database/src/legacy-signal-archive-manifest.mjs';
import {
  PublicSignalReaderError,
  type PublicSignalQueryClient,
  type SignalEntry,
} from './public-signal-reader-core.ts';

/** Independent from qualified publication: database residency grants no new publication basis. */
export function readLegacySignalArchiveMode(
  environment: Readonly<Record<string, string | undefined>>,
): 'seed' | 'database' {
  const mode = environment.HZENSE_LEGACY_SIGNAL_ARCHIVE_MODE;
  if (mode === undefined || mode === 'seed') return 'seed';
  if (mode === 'database' && environment.HZENSE_SIGNAL_READ_MODE !== 'database') return mode;
  throw new PublicSignalReaderError();
}

export const legacySignalArchiveQuery = `SELECT signal_id, content, content_hash
FROM public.legacy_public_signals ORDER BY signal_id LIMIT $1`;

/** The frozen migration manifest makes partial, modified or foreign snapshots fail closed. */
export function mapLegacySignalArchiveRows(rows: unknown[]): SignalEntry[] {
  const expected = new Map(Object.entries(legacyArchiveProjectionHashes));
  if (!Array.isArray(rows) || rows.length !== expected.size) throw new PublicSignalReaderError();
  const seen = new Set<string>();
  const entries = rows.map((value) => {
    if (!value || typeof value !== 'object' || Array.isArray(value))
      throw new PublicSignalReaderError();
    const row = value as Record<string, unknown>;
    const id = row.signal_id;
    const content = row.content;
    if (
      typeof id !== 'string' ||
      seen.has(id) ||
      !expected.has(id) ||
      row.content_hash !== expected.get(id) ||
      !content ||
      typeof content !== 'object' ||
      Array.isArray(content)
    )
      throw new PublicSignalReaderError();
    const digest = createHash('sha256').update(canonicalLegacyArchiveJson(content)).digest('hex');
    if (digest !== row.content_hash || (content as { id?: unknown }).id !== id)
      throw new PublicSignalReaderError();
    seen.add(id);
    // The immutable manifest is generated and tested against the validated Seed
    // projection. These entries intentionally have no public_version or new basis.
    return content as SignalEntry;
  });
  return entries.sort(
    (left, right) =>
      right.occurred_at.localeCompare(left.occurred_at) ||
      (right.importance ?? 0) - (left.importance ?? 0) ||
      left.title.localeCompare(right.title),
  );
}

export function createLegacySignalArchiveReader(client: PublicSignalQueryClient) {
  return {
    async list(): Promise<SignalEntry[]> {
      try {
        const result = await client.query(legacySignalArchiveQuery, [
          Object.keys(legacyArchiveProjectionHashes).length + 1,
        ]);
        return mapLegacySignalArchiveRows(result.rows);
      } catch {
        throw new PublicSignalReaderError();
      }
    },
  };
}
