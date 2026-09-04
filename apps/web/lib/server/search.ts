import 'server-only';

import process from 'node:process';
import type { SearchType } from '@hzense/search/ranking';
import { readSearchMode, searchWithMode } from '../search-mode';
import { searchPublishedContent as searchInProcess } from '../search-runtime';
import { searchRuntimeDocuments } from './runtime-reader';

export function searchPublishedContent(query: string, type?: SearchType) {
  return searchWithMode({
    mode: readSearchMode(process.env),
    inProcess: () => searchInProcess(query, type),
    database: () => searchRuntimeDocuments(query, type),
  });
}
