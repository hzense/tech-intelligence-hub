import type { SourceDirectoryReference, SourceDirectoryRow } from './source-directory.ts';

export function summarizeSourceReferences(references: SourceDirectoryReference[]) {
  return {
    references,
    signalCount: references.length,
    urlCount: new Set(references.flatMap((reference) => reference.urls)).size,
    // The full directory keeps references ordered by date, newest first.
    latestDate: references[0]?.date ?? null,
  };
}

export function compareSourceRows(a: SourceDirectoryRow, b: SourceDirectoryRow): number {
  return (
    b.signalCount - a.signalCount || b.urlCount - a.urlCount || a.domain.localeCompare(b.domain)
  );
}

/** Retain the site's full coverage while narrowing counts and evidence to the selected domain. */
export function filterSourceDirectoryRows(rows: SourceDirectoryRow[], domainKey: string) {
  if (domainKey === 'all') return rows;
  return rows
    .filter((row) => row.domainIds.includes(domainKey))
    .map((row) => ({
      ...row,
      ...summarizeSourceReferences(
        row.references.filter((ref) => ref.domainIds.includes(domainKey)),
      ),
    }))
    .sort(compareSourceRows);
}
