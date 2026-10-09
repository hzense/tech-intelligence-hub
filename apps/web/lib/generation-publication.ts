import type { EditorialSignalStatus } from '../../../packages/database/src/editorial-signal-store.mjs';

export type GenerationPublication = {
  state: 'available' | 'unavailable';
  candidates: Array<{
    index: number;
    status: 'unpublished' | 'draft' | 'published' | 'withdrawn';
    publicId: string | null;
  }>;
};

type Run = { id: string; status: string; result: unknown };
const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const unavailable = (): GenerationPublication => ({ state: 'unavailable', candidates: [] });

/** These are saved, accepted candidate identities, not a new publication approval. */
function candidateIndexes(run: Run): number[] | null {
  if (!uuid.test(run.id) || !run.result || typeof run.result !== 'object') return null;
  const result = run.result as Record<string, unknown>;
  if (
    result.classification !== 'private' ||
    !Array.isArray(result.candidates) ||
    result.candidates.length > 5
  )
    return null;
  const indexes: number[] = [];
  for (const value of result.candidates) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const candidate = value as Record<string, unknown>;
    if (
      candidate.classification !== 'private' ||
      candidate.status !== 'needs_review' ||
      typeof candidate.index !== 'number' ||
      !Number.isInteger(candidate.index) ||
      candidate.index < 0 ||
      candidate.index > 4 ||
      indexes.includes(candidate.index)
    )
      return null;
    indexes.push(candidate.index);
  }
  return indexes;
}

function publicationForRun(
  indexes: number[],
  record: EditorialSignalStatus | undefined,
): GenerationPublication {
  // A missing owned run is not proof that its candidates are unpublished.
  if (!record || !Array.isArray(record.candidates)) return unavailable();
  const latest = new Map<number, EditorialSignalStatus['candidates'][number]>();
  for (const candidate of record.candidates) {
    if (
      !candidate ||
      !indexes.includes(candidate.candidate_index) ||
      latest.has(candidate.candidate_index) ||
      !Number.isSafeInteger(candidate.revision) ||
      candidate.revision < 1 ||
      !['draft', 'publish', 'withdraw'].includes(candidate.action) ||
      (candidate.action === 'publish'
        ? typeof candidate.public_id !== 'string' ||
          !/^editorial-[a-f0-9]{32}$/.test(candidate.public_id)
        : candidate.public_id !== null)
    )
      return unavailable();
    latest.set(candidate.candidate_index, candidate);
  }
  return {
    state: 'available',
    candidates: indexes.map((index) => {
      const candidate = latest.get(index);
      return {
        index,
        status:
          candidate?.action === 'publish'
            ? 'published'
            : candidate?.action === 'withdraw'
              ? 'withdrawn'
              : candidate?.action === 'draft'
                ? 'draft'
                : 'unpublished',
        publicId: candidate?.action === 'publish' ? candidate.public_id : null,
      };
    }),
  };
}

/** One batch read, preserving original generation receipts even when publication is unreadable. */
export async function withGenerationPublications<T extends Run>(
  runs: T[],
  read: (runIds: string[]) => Promise<EditorialSignalStatus[]>,
): Promise<Array<T & { publication?: GenerationPublication }>> {
  const completed = runs.filter((run) => run.status === 'completed');
  const indexes = new Map(completed.map((run) => [run.id, candidateIndexes(run)]));
  const ids = [
    ...new Set(completed.filter((run) => indexes.get(run.id) !== null).map((run) => run.id)),
  ];
  let records: Map<string, EditorialSignalStatus> | null = null;
  if (ids.length) {
    try {
      const result = await read(ids);
      if (
        Array.isArray(result) &&
        result.every((record) => record && ids.includes(record.run_id)) &&
        new Set(result.map((record) => record.run_id)).size === result.length
      )
        records = new Map(result.map((record) => [record.run_id, record]));
    } catch {
      // Never hide private task history or manufacture an unpublished result.
    }
  }
  return runs.map((run) => {
    if (run.status !== 'completed') return run;
    const acceptedIndexes = indexes.get(run.id);
    return {
      ...run,
      publication:
        acceptedIndexes && records
          ? publicationForRun(acceptedIndexes, records.get(run.id))
          : unavailable(),
    };
  });
}
