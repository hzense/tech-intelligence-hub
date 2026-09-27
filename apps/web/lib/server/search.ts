import 'server-only';

import process from 'node:process';
import { compareSearchResults, type SearchResult, type SearchType } from '@hzense/search/ranking';
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

function mergeCurrentResourceSearch(
  legacy: SearchResult[],
  currentResources: SearchResult[],
): SearchResult[] {
  return [
    ...legacy.filter(
      (result) => result.type !== 'resource' && !result.href.startsWith('/resources/'),
    ),
    ...currentResources,
  ].sort(compareSearchResults);
}

export async function searchPublishedContent(query: string, type?: SearchType) {
  if (type === 'daily' || type === 'weekly') return [];
  if (readSignalReadMode(process.env) === 'database') {
    if (type === 'signal') return searchPublicSignals(query);
    const [legacy, current, resources] = await Promise.all([
      searchWithMode({
        query,
        mode: readSearchMode(process.env),
        inProcess: () => searchInProcess(query, type, false),
        database: () => searchRuntimeDocuments(query, type),
      }),
      type ? Promise.resolve([]) : searchPublicSignals(query),
      !type || type === 'resource'
        ? searchInProcess(query, 'resource', false)
        : Promise.resolve([]),
    ]);
    return mergeCurrentResourceSearch(
      mergeCurrentSignalSearch(await filterRetiredDocuments(legacy), current),
      resources,
    );
  }
  // A persisted search document is never authority for a current Signal.
  const [legacy, current, resources] = await Promise.all([
    type === 'signal'
      ? Promise.resolve([])
      : searchWithMode({
          query,
          mode: readSearchMode(process.env),
          inProcess: () => searchInProcess(query, type, false),
          database: () => searchRuntimeDocuments(query, type),
        }),
    !type || type === 'signal' ? searchInProcess(query, 'signal') : Promise.resolve([]),
    !type || type === 'resource' ? searchInProcess(query, 'resource', false) : Promise.resolve([]),
  ]);
  return mergeCurrentResourceSearch(
    mergeCurrentSignalSearch(await filterRetiredDocuments(legacy), current),
    resources,
  );
}
