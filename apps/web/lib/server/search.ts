import 'server-only';

import process from 'node:process';
import type { SearchType } from '@hzense/search/ranking';
import { readSearchMode, searchWithMode } from '../search-mode';
import { searchPublishedContent as searchInProcess } from '../search-runtime';
import { searchRuntimeDocuments } from './runtime-reader';
import { readSignalReadMode, mergeCurrentSignalSearch } from '../public-signal-reader-core';
import { searchPublicSignals } from './public-signals';

export async function searchPublishedContent(query: string, type?: SearchType) {
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
    return mergeCurrentSignalSearch(legacy, current);
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
  return mergeCurrentSignalSearch(legacy, current);
}
