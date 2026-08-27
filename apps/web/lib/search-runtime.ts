import type { SeedEntity, SeedSignal } from '@hzense/content';
import {
  getDailyEntries,
  getInsightEntries,
  getTopicEntries,
  getTopicTitleMap,
  getWeeklyEntries,
  type DailyEntry,
  type InsightEntry,
  type TopicEntry,
  type WeeklyEntry,
} from '@/lib/content-runtime';
import { formatEntityType } from '@/lib/resource-presentation';
import {
  getResourceEntries,
  getSeedEntityMap,
  getSeedSourceMap,
  getSignalEntries,
} from '@/lib/seed-runtime';
import { formatSignalType } from '@/lib/signal-presentation';
import {
  rankSearchDocuments,
  type SearchDocument,
  type SearchResult,
  type SearchType,
} from '@/lib/search-ranking';

export { isSearchType, searchTypeLabels, searchTypes, type SearchType } from '@/lib/search-ranking';

function topicKeywords(ids: string[], topicTitleMap: Map<string, string>): string {
  return ids.map((id) => `${id} ${topicTitleMap.get(id) ?? ''}`).join(' ');
}

function contentDocument(
  entry: DailyEntry | WeeklyEntry | InsightEntry | TopicEntry,
  type: SearchType,
  href: string,
  date: string | undefined,
  topicIds: string[],
  topicTitleMap: Map<string, string>,
): SearchDocument {
  return {
    id: entry.frontMatter.id,
    type,
    title: entry.frontMatter.title,
    summary: entry.summary,
    href,
    ...(date ? { date } : {}),
    keywords: [
      ...(entry.frontMatter.tags ?? []),
      topicKeywords(topicIds, topicTitleMap),
      entry.sections.map((section) => section.heading).join(' '),
    ].join(' '),
    body: entry.body,
  };
}

function signalDocument(
  signal: SeedSignal,
  topicTitleMap: Map<string, string>,
  entityMap: Map<string, SeedEntity>,
  sourceName: string,
): SearchDocument {
  return {
    id: signal.id,
    type: 'signal',
    title: signal.title,
    summary: signal.summary,
    href: `/signals/${signal.id}`,
    date: signal.occurred_at.slice(0, 10),
    keywords: [
      formatSignalType(signal.type),
      sourceName,
      topicKeywords(signal.topics, topicTitleMap),
      signal.entities.map((id) => `${id} ${entityMap.get(id)?.name ?? ''}`).join(' '),
    ].join(' '),
    body: '',
  };
}

function resourceDocument(entity: SeedEntity): SearchDocument {
  const typeLabel = formatEntityType(entity.type);
  return {
    id: entity.id,
    type: 'resource',
    title: entity.name,
    summary: `${typeLabel} · HZense 活跃资源`,
    href: `/resources/${entity.id}`,
    keywords: `${entity.id} ${entity.type} ${typeLabel}`,
    body: '',
  };
}

export async function getSearchDocuments(): Promise<SearchDocument[]> {
  const [
    dailyEntries,
    weeklyEntries,
    insightEntries,
    topicEntries,
    signalEntries,
    resourceEntries,
    topicTitleMap,
    entityMap,
    sourceMap,
  ] = await Promise.all([
    getDailyEntries(),
    getWeeklyEntries(),
    getInsightEntries(),
    getTopicEntries(),
    getSignalEntries(),
    getResourceEntries(),
    getTopicTitleMap(),
    getSeedEntityMap(),
    getSeedSourceMap(),
  ]);

  return [
    ...dailyEntries.map((entry) =>
      contentDocument(
        entry,
        'daily',
        `/daily/${entry.frontMatter.date}`,
        entry.frontMatter.date,
        entry.frontMatter.rising_topics,
        topicTitleMap,
      ),
    ),
    ...weeklyEntries.map((entry) =>
      contentDocument(
        entry,
        'weekly',
        `/weekly/${entry.frontMatter.week}`,
        entry.frontMatter.end_date,
        entry.frontMatter.featured_topics,
        topicTitleMap,
      ),
    ),
    ...insightEntries.map((entry) =>
      contentDocument(
        entry,
        'insight',
        `/insights/${entry.frontMatter.id}`,
        entry.frontMatter.date,
        entry.frontMatter.topics,
        topicTitleMap,
      ),
    ),
    ...topicEntries.map((entry) =>
      contentDocument(
        entry,
        'topic',
        `/topics/${entry.frontMatter.id}`,
        undefined,
        [entry.frontMatter.id],
        topicTitleMap,
      ),
    ),
    ...signalEntries.map((signal) =>
      signalDocument(
        signal,
        topicTitleMap,
        entityMap,
        sourceMap.get(signal.source_id)?.name ?? signal.source_id,
      ),
    ),
    ...resourceEntries.map(resourceDocument),
  ];
}

export async function searchPublishedContent(
  query: string,
  type?: SearchType,
): Promise<SearchResult[]> {
  return rankSearchDocuments(await getSearchDocuments(), query, type);
}
