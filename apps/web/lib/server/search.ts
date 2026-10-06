import 'server-only';

import process from 'node:process';
import { compareSearchResults, type SearchResult, type SearchType } from '@hzense/search/ranking';
import { readSearchMode, searchWithMode } from '../search-mode';
import { getInsightEntries, getTopicTitleMap } from '../content-runtime';
import {
  rankVisibleResourceResults,
  rankVisibleTopicInsightResults,
  searchPublishedContent as searchInProcess,
} from '../search-runtime';
import { getSignalEntries } from '../seed-runtime';
import { getPublicExploration } from '../public-exploration-runtime';
import { searchRuntimeDocuments } from './runtime-reader';
import { readSignalReadMode, mergeCurrentSignalSearch } from '../public-signal-reader-core';
import { searchPublicSignals } from './public-signals';
import { visibleTopicInsights } from './topic-insights';
import { unifiedSignalEnabled } from '../unified-signal-mode';

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
  currentInsights: SearchResult[] = [],
): SearchResult[] {
  const currentInsightUrls = new Set(currentInsights.map((result) => result.href));
  return [
    ...legacy.filter(
      (result) =>
        result.type !== 'resource' &&
        !result.href.startsWith('/resources/') &&
        !currentInsightUrls.has(result.href),
    ),
    ...currentResources,
    ...currentInsights,
  ].sort(compareSearchResults);
}

async function searchCurrentTopicInsights(
  query: string,
  type?: SearchType,
): Promise<SearchResult[]> {
  if (
    process.env.HZENSE_TOPIC_INSIGHTS_ENABLED !== '1' ||
    (type !== undefined && type !== 'insight')
  )
    return [];
  const [signals, topicTitleMap] = await Promise.all([getSignalEntries(), getTopicTitleMap()]);
  return rankVisibleTopicInsightResults(await visibleTopicInsights(signals), query, topicTitleMap);
}

async function searchCurrentResources(query: string, type?: SearchType): Promise<SearchResult[]> {
  if (type !== undefined && type !== 'resource') return [];
  const exploration = await getPublicExploration();
  const topicNames = new Map(exploration.taxonomy.topics.map((topic) => [topic.id, topic.name]));
  return rankVisibleResourceResults(exploration.entities, query, topicNames);
}

export async function searchPublishedContent(query: string, type?: SearchType) {
  if (type === 'daily' || type === 'weekly') return [];
  if (!unifiedSignalEnabled(process.env) && readSignalReadMode(process.env) === 'database') {
    if (type === 'signal') return searchPublicSignals(query);
    const [legacy, current, resources, insights] = await Promise.all([
      searchWithMode({
        query,
        mode: readSearchMode(process.env),
        inProcess: () => searchInProcess(query, type, false),
        database: () => searchRuntimeDocuments(query, type),
      }),
      type ? Promise.resolve([]) : searchPublicSignals(query),
      searchCurrentResources(query, type),
      searchCurrentTopicInsights(query, type),
    ]);
    return mergeCurrentResourceSearch(
      mergeCurrentSignalSearch(await filterRetiredDocuments(legacy), current),
      resources,
      insights,
    );
  }
  // A persisted search document is never authority for a current Signal.
  const [legacy, current, resources, insights] = await Promise.all([
    type === 'signal'
      ? Promise.resolve([])
      : searchWithMode({
          query,
          mode: readSearchMode(process.env),
          inProcess: () => searchInProcess(query, type, false),
          database: () => searchRuntimeDocuments(query, type),
        }),
    !type || type === 'signal' ? searchInProcess(query, 'signal') : Promise.resolve([]),
    searchCurrentResources(query, type),
    searchCurrentTopicInsights(query, type),
  ]);
  return mergeCurrentResourceSearch(
    mergeCurrentSignalSearch(await filterRetiredDocuments(legacy), current),
    resources,
    insights,
  );
}
