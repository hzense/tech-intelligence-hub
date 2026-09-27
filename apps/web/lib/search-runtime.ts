import type { SeedEntity, SeedSignal } from '@hzense/content';
import {
  getInsightEntries,
  getTopicEntries,
  getTopicTitleMap,
  type InsightEntry,
  type TopicEntry,
} from './content-runtime.ts';
import {
  formatEntityType,
  resourceHref,
  resourceIntroduction,
  resourceTopics,
} from './resource-presentation.ts';
import type { PublicEntitySummary } from './public-exploration-core.ts';
import {
  getResourceEntries,
  getSeedEntityMap,
  getSeedSourceMap,
  getSignalEntries,
} from './seed-runtime.ts';
import { formatSignalType } from './signal-presentation.ts';
import { searchSignalEntries } from './editorial-signal-reader-core.ts';
import { compareSearchResults } from '@hzense/search/ranking';
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
import type { TopicInsightResult } from './topic-insight-core.ts';

export {
  isSearchType,
  searchTypeLabels,
  searchTypes,
  type SearchType,
} from '@hzense/search/ranking';

type VisibleTopicInsightSearchEntry = {
  id: string;
  result: TopicInsightResult;
  published_at: string;
};

/** The caller must pass only rows validated against the current public Signal reader. */
export function rankVisibleTopicInsightResults(
  rows: readonly VisibleTopicInsightSearchEntry[],
  query: string,
  topicTitleMap: ReadonlyMap<string, string>,
): SearchResult[] {
  const documents: SearchDocument[] = rows.map((row) => ({
    id: `published-topic-insight-${row.id}`,
    type: 'insight',
    title: row.result.report.title,
    summary: row.result.report.summary,
    href: `/topics/${row.result.topicIds[0]}/editions/${row.id}`,
    date: row.published_at.slice(0, 10),
    keywords: [
      topicKeywords(row.result.topicIds, topicTitleMap),
      row.result.report.sections.map((section) => section.heading).join(' '),
    ].join(' '),
    body: [
      ...row.result.report.sections.map((section) => section.body),
      ...row.result.report.uncertainties,
    ].join('\n'),
  }));
  return rankSearchDocuments(documents, query, 'insight');
}

/** Search only entities represented in the same current public directory as /resources. */
export function rankVisibleResourceResults(
  entities: readonly PublicEntitySummary[],
  query: string,
  topicNames: ReadonlyMap<string, string>,
): SearchResult[] {
  const documents: SearchDocument[] = entities
    .filter(
      (entity) =>
        entity.signals.length > 0 &&
        (entity.type === 'company' || entity.type === 'institution' || entity.type === 'person'),
    )
    .map((entity) => ({
      id: `searchdoc-resource-${entity.id}`,
      type: 'resource' as const,
      title: entity.name,
      summary: resourceIntroduction(entity, topicNames),
      href: resourceHref(entity),
      ...(entity.latestAt ? { date: entity.latestAt.slice(0, 10) } : {}),
      keywords: [
        entity.id,
        entity.type,
        formatEntityType(entity.type),
        ...resourceTopics(entity, topicNames).map((topic) => `${topic.id} ${topic.name}`),
      ].join(' '),
      body: '',
    }));
  return rankSearchDocuments(documents, query, 'resource');
}

function topicKeywords(ids: string[], topicTitleMap: ReadonlyMap<string, string>): string {
  return ids.map((id) => `${id} ${topicTitleMap.get(id) ?? ''}`).join(' ');
}

function publishedContentCandidate(
  entry: InsightEntry,
  type: 'insight',
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
    href: resourceHref(entity),
    keywords: `${entity.id} ${entity.type} ${typeLabel}`,
    body: '',
    importance: 1,
    documentDate: null,
    topics: [],
    entities: [entity.id],
  };
}

export async function getSearchDocumentProjections(
  includeSignals = true,
): Promise<CanonicalSearchDocument[]> {
  const [
    insightEntries,
    topicEntries,
    signalEntries,
    resourceEntries,
    topicTitleMap,
    entityMap,
    sourceMap,
  ] = await Promise.all([
    getInsightEntries(),
    getTopicEntries(),
    includeSignals ? getSignalEntries() : Promise.resolve([]),
    getResourceEntries(),
    getTopicTitleMap(),
    getSeedEntityMap(),
    getSeedSourceMap(),
  ]);

  const candidates: SearchProjectionCandidate[] = [
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
    ...signalEntries
      .filter((signal): signal is SeedSignal => signal.publication_basis !== 'manual_confirmation')
      .map((signal) =>
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

export async function getSearchDocuments(includeSignals = true): Promise<SearchDocument[]> {
  return (await getSearchDocumentProjections(includeSignals)).map(toSearchDocument);
}

export async function searchPublishedContent(
  query: string,
  type?: SearchType,
  includeSignals = true,
): Promise<SearchResult[]> {
  const legacy = rankSearchDocuments(await getSearchDocuments(includeSignals), query, type);
  if (!includeSignals || (type && type !== 'signal')) return legacy;
  const editorial = (await getSignalEntries()).filter(
    (entry) => entry.publication_basis === 'manual_confirmation',
  );
  return [...legacy, ...searchSignalEntries(editorial, query)].sort(compareSearchResults);
}
