import 'server-only';

import process from 'node:process';
import type { SearchResult, SearchType } from '@hzense/search/ranking';
import { readSearchMode, searchWithMode } from '../search-mode';
import { getInsightEntries } from '../content-runtime';
import { searchPublishedContent as searchInProcess } from '../search-runtime';
import { searchRuntimeDocuments } from './runtime-reader';
import { readSignalReadMode, mergeCurrentSignalSearch } from '../public-signal-reader-core';
import { searchPublicSignals } from './public-signals';

async function filterRetiredDocuments(results: SearchResult[]): Promise<SearchResult[]> {
  const visibleInsights = results.some((result) => result.type === 'insight')
    ? new Set((await getInsightEntries()).map((entry) => `/insights/${entry.frontMatter.id}`))
    : undefined;
  return results.filter(
    (result) =>
      result.type !== 'daily' &&
      result.type !== 'weekly' &&
      (result.type !== 'insight' || visibleInsights?.has(result.href)),
  );
}

export async function searchPublishedContent(query: string, type?: SearchType) {
  if (type === 'daily' || type === 'weekly') return [];
  if (readSignalReadMode(process.env) === 'database') {
    if (type === 'signal') return searchPublicSignals(query);
    const [legacy, current] = await Promise.all([
      searchWithMode({
        query,
        mode: readSearchMode(process.env),
        inProcess: () => searchInProcess(query, type, false),
        database: () => searchRuntimeDocuments(query, type),
      }),
      type ? Promise.resolve([]) : searchPublicSignals(query),
    ]);
    return mergeCurrentSignalSearch(await filterRetiredDocuments(legacy), current);
  }
  // A persisted search document is never authority for a current Signal.
  const [legacy, current] = await Promise.all([
    type === 'signal'
      ? Promise.resolve([])
      : searchWithMode({
          query,
          mode: readSearchMode(process.env),
          inProcess: () => searchInProcess(query, type, false),
          database: () => searchRuntimeDocuments(query, type),
        }),
    !type || type === 'signal' ? searchInProcess(query, 'signal') : Promise.resolve([]),
  ]);
  return mergeCurrentSignalSearch(await filterRetiredDocuments(legacy), current);
}
