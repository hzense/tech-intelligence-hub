import { assertSearchQuery, normalizeSearchText, type SearchResult } from '@hzense/search/ranking';

export type SearchMode = 'in-process' | 'shadow' | 'database';

export interface SearchParityLog {
  database_count?: number;
  event: 'database_search_shadow';
  in_process_count: number;
  outcome: 'match' | 'mismatch' | 'unavailable';
}

export function readSearchMode(
  environment: Readonly<Record<string, string | undefined>>,
): SearchMode {
  const value = environment.HZENSE_SEARCH_MODE ?? 'in-process';
  if (value === 'in-process' || value === 'shadow' || value === 'database') return value;
  throw new Error('HZENSE_SEARCH_MODE must be in-process, shadow or database');
}

function resultContract(results: readonly SearchResult[]) {
  return results.map((result) => [
    result.type,
    result.id,
    result.title,
    result.summary,
    result.href,
    result.date ?? null,
    result.keywords,
    result.body,
    result.score,
  ]);
}

export async function searchWithMode({
  query,
  mode,
  inProcess,
  database,
  log = (record) => console.info(JSON.stringify(record)),
}: {
  query: string;
  mode: SearchMode;
  inProcess: () => Promise<SearchResult[]>;
  database: () => Promise<SearchResult[]>;
  log?: (record: SearchParityLog) => void;
}): Promise<SearchResult[]> {
  // Validate before choosing a provider so invalid input cannot become a shadow outage.
  assertSearchQuery(query);
  if (!normalizeSearchText(query)) return [];
  if (mode === 'in-process') return inProcess();
  if (mode === 'database') return database();

  const [baseline, databaseOutcome] = await Promise.all([
    inProcess(),
    database()
      .then((results) => ({ ok: true as const, results }))
      .catch(() => ({ ok: false as const })),
  ]);
  if (databaseOutcome.ok) {
    const candidate = databaseOutcome.results;
    const matches =
      JSON.stringify(resultContract(baseline)) === JSON.stringify(resultContract(candidate));
    log({
      database_count: candidate.length,
      event: 'database_search_shadow',
      in_process_count: baseline.length,
      outcome: matches ? 'match' : 'mismatch',
    });
  } else {
    log({
      event: 'database_search_shadow',
      in_process_count: baseline.length,
      outcome: 'unavailable',
    });
  }
  return baseline;
}
