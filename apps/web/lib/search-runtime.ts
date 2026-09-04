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
} from './content-runtime.ts';
import { formatEntityType } from './resource-presentation.ts';
import {
  getResourceEntries,
  getSeedEntityMap,
  getSeedSourceMap,
  getSignalEntries,
} from './seed-runtime.ts';
import { formatSignalType } from './signal-presentation.ts';
import {
  projectPublishedSearchDocuments,
  toSearchDocument,
  type CanonicalSearchDocument,
  type SearchProjectionCandidate,
} from '@hzense/search/projection';
import {
  rankSearchDocuments,
  type SearchDocument,
  type SearchResult,
  type SearchType,
} from '@hzense/search/ranking';

export {
  isSearchType,
  searchTypeLabels,
  searchTypes,
  type SearchType,
} from '@hzense/search/ranking';

function topicKeywords(ids: string[], topicTitleMap: Map<string, string>): string {
  return ids.map((id) => `${id} ${topicTitleMap.get(id) ?? ''}`).join(' ');
}

function publishedContentCandidate(
  entry: DailyEntry | WeeklyEntry | InsightEntry,
  type: 'daily' | 'weekly' | 'insight',
  href: string,
  documentDate: string,
  topicIds: string[],
  topicTitleMap: Map<string, string>,
  entityIds: string[] = [],
): SearchProjectionCandidate {
  return {
    sourceId: entry.frontMatter.id,
    sourceType: type,
    publication: { kind: 'content', status: entry.frontMatter.status },
    title: entry.frontMatter.title,
    summary: entry.summary,
    href,
    keywords: [
      ...(entry.frontMatter.tags ?? []),
      topicKeywords(topicIds, topicTitleMap),
      entry.sections.map((section) => section.heading).join(' '),
    ].join(' '),
    body: entry.body,
    importance: entry.frontMatter.importance ?? 1,
    documentDate,
    topics: topicIds,
    entities: entityIds,
  };
}

function topicCandidate(
  entry: TopicEntry,
  topicTitleMap: Map<string, string>,
): SearchProjectionCandidate {
  return {
    sourceId: entry.frontMatter.id,
    sourceType: 'topic',
    publication: { kind: 'topic', status: entry.frontMatter.status },
    title: entry.frontMatter.title,
    summary: entry.summary,
    href: `/topics/${entry.frontMatter.id}`,
    keywords: [
      ...(entry.frontMatter.tags ?? []),
      topicKeywords([entry.frontMatter.id], topicTitleMap),
      entry.sections.map((section) => section.heading).join(' '),
    ].join(' '),
    body: entry.body,
    importance: 1,
    documentDate: null,
    topics: [entry.frontMatter.id],
    entities: [],
  };
}

function signalCandidate(
  signal: SeedSignal,
  topicTitleMap: Map<string, string>,
  entityMap: Map<string, SeedEntity>,
  sourceName: string,
): SearchProjectionCandidate {
  return {
    sourceId: signal.id,
    sourceType: 'signal',
    publication: { kind: 'signal', status: signal.status },
    title: signal.title,
    summary: signal.summary,
    href: `/signals/${signal.id}`,
    keywords: [
      formatSignalType(signal.type),
      sourceName,
      topicKeywords(signal.topics, topicTitleMap),
      signal.entities.map((id) => `${id} ${entityMap.get(id)?.name ?? ''}`).join(' '),
    ].join(' '),
    body: '',
    importance: signal.importance,
    documentDate: signal.occurred_at.slice(0, 10),
    topics: signal.topics,
    entities: signal.entities,
  };
}

function resourceCandidate(entity: SeedEntity): SearchProjectionCandidate {
  const typeLabel = formatEntityType(entity.type);
  return {
    sourceId: entity.id,
    sourceType: 'resource',
    publication: { kind: 'resource', status: entity.status },
    title: entity.name,
    summary: `${typeLabel} · HZense 活跃资源`,
    href: `/resources/${entity.id}`,
    keywords: `${entity.id} ${entity.type} ${typeLabel}`,
    body: '',
    importance: 1,
    documentDate: null,
    topics: [],
    entities: [entity.id],
  };
}

export async function getSearchDocumentProjections(): Promise<CanonicalSearchDocument[]> {
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

  const candidates: SearchProjectionCandidate[] = [
    ...dailyEntries.map((entry) =>
      publishedContentCandidate(
        entry,
        'daily',
        `/daily/${entry.frontMatter.date}`,
        entry.frontMatter.date,
        entry.frontMatter.rising_topics,
        topicTitleMap,
      ),
    ),
    ...weeklyEntries.map((entry) =>
      publishedContentCandidate(
        entry,
        'weekly',
        `/weekly/${entry.frontMatter.week}`,
        entry.frontMatter.end_date,
        entry.frontMatter.featured_topics,
        topicTitleMap,
      ),
    ),
    ...insightEntries.map((entry) =>
      publishedContentCandidate(
        entry,
        'insight',
        `/insights/${entry.frontMatter.id}`,
        entry.frontMatter.date,
        entry.frontMatter.topics,
        topicTitleMap,
        [...(entry.frontMatter.companies ?? []), ...(entry.frontMatter.technologies ?? [])],
      ),
    ),
    ...topicEntries.map((entry) => topicCandidate(entry, topicTitleMap)),
    ...signalEntries.map((signal) =>
      signalCandidate(
        signal,
        topicTitleMap,
        entityMap,
        sourceMap.get(signal.source_id)?.name ?? signal.source_id,
      ),
    ),
    ...resourceEntries.map(resourceCandidate),
  ];

  return projectPublishedSearchDocuments(candidates);
}

export async function getSearchDocuments(): Promise<SearchDocument[]> {
  return (await getSearchDocumentProjections()).map(toSearchDocument);
}

export async function searchPublishedContent(
  query: string,
  type?: SearchType,
): Promise<SearchResult[]> {
  return rankSearchDocuments(await getSearchDocuments(), query, type);
}
