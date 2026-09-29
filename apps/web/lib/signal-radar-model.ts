import type { SignalEntry } from './public-signal-reader-core.ts';
import {
  signalDomainIds,
  type ExplorationTopic,
  type PublicEntitySummary,
} from './public-exploration-core.ts';
import { signalPublication, toUnifiedSignal } from './unified-signal-core.ts';

export const radarRankingVersion = 'radar-event-time-v2';
export const radarTrendVersion = 'radar-monthly-observation-v2';

const day = 86_400_000;
const recentDays = 30;
const normalize = (value: string) =>
  value.normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('zh-CN');
const compareId = (left: string, right: string) => (left < right ? -1 : left > right ? 1 : 0);
const version = (entry: SignalEntry) => entry.publication_revision ?? entry.public_version ?? 0;
const publicationPriority = (entry: SignalEntry) =>
  signalPublication(entry).state === 'published' ? 1 : 0;
const monthKey = (timestamp: number) => new Date(timestamp).toISOString().slice(0, 7);

export interface RadarSignal {
  signal: SignalEntry;
  domainIds: string[];
  importance: number | null;
}

export interface RadarDomainObservation {
  id: string;
  name: string;
  totalCount: number;
  recentCount: number;
  previousCount: number;
  monthlyCounts: number[];
  latestAt: string | null;
  signalIds: string[];
}

export interface RadarSubtopicObservation {
  id: string;
  name: string;
  domainId: string;
  domainName: string;
  totalCount: number;
  recentCount: number;
  signalIds: string[];
}

export interface RadarCategoryObservation {
  id: string;
  name: string;
  parentId: string;
  domainId: string;
  depth: number;
  totalCount: number;
  recentCount: number;
  signalIds: string[];
}

export interface RadarResourceObservation {
  id: string;
  name: string;
  type: 'person' | 'company';
  /** Distinct events in the trailing 30 days, not a composite industry score. */
  recentCount: number;
  totalCount: number;
  signalIds: string[];
}

export interface RadarSignalIndexEntry {
  id: string;
  title: string;
  summary: string;
  occurredAt: string;
  domainIds: string[];
}

/**
 * One projection of every signal supplied by the configured public reader.
 * The reader is responsible for public eligibility; Seed review status is not
 * treated as a publication grant. Counts describe the observed sample only.
 */
export function buildSignalRadar(
  signals: readonly SignalEntry[],
  topics: readonly ExplorationTopic[],
  {
    now = new Date(),
    entities = [],
  }: { now?: Date; entities?: readonly Pick<PublicEntitySummary, 'id' | 'name' | 'type'>[] } = {},
) {
  const asOf = now.getTime();
  if (!Number.isFinite(asOf)) throw new Error('Invalid radar cutoff');
  const recentStart = asOf - recentDays * day;
  const previousStart = recentStart - recentDays * day;
  const months = Array.from({ length: 6 }, (_, index) => {
    const at = Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (5 - index), 1);
    const date = new Date(at);
    return {
      key: monthKey(at),
      label: `${date.getUTCFullYear()}/${String(date.getUTCMonth() + 1).padStart(2, '0')}`,
    };
  });
  const monthIndex = new Map(months.map((month, index) => [month.key, index]));

  // Revisions of one identity collapse first; exact duplicate content across
  // identities then prefers an actively published version over a Seed archive.
  const byId = new Map<string, SignalEntry>();
  for (const entry of signals) {
    const old = byId.get(entry.id);
    if (
      !old ||
      version(entry) > version(old) ||
      (version(entry) === version(old) && publicationPriority(entry) > publicationPriority(old))
    )
      byId.set(entry.id, entry);
  }
  let invalidDates = 0;
  let futureDates = 0;
  let duplicateCount = signals.length - byId.size;
  const fingerprints = new Set<string>();
  const eligible: SignalEntry[] = [];
  const preferred = [...byId.values()].sort(
    (left, right) =>
      publicationPriority(right) - publicationPriority(left) ||
      version(right) - version(left) ||
      compareId(left.id, right.id),
  );
  for (const entry of preferred) {
    const occurred = Date.parse(entry.occurred_at);
    if (!Number.isFinite(occurred)) {
      invalidDates++;
      continue;
    }
    if (occurred >= asOf) {
      futureDates++;
      continue;
    }
    const fingerprint = JSON.stringify([
      new Date(occurred).toISOString(),
      normalize(entry.title),
      normalize(entry.summary),
    ]);
    if (fingerprints.has(fingerprint)) {
      duplicateCount++;
      continue;
    }
    fingerprints.add(fingerprint);
    eligible.push(entry);
  }
  eligible.sort(
    (left, right) =>
      Date.parse(right.occurred_at) - Date.parse(left.occurred_at) || compareId(left.id, right.id),
  );

  const domains: RadarDomainObservation[] = topics
    .filter((topic) => topic.parentId === null)
    .map((topic) => ({
      id: topic.id,
      name: topic.name,
      totalCount: 0,
      recentCount: 0,
      previousCount: 0,
      monthlyCounts: months.map(() => 0),
      latestAt: null,
      signalIds: [],
    }));
  const domainMap = new Map(domains.map((domain) => [domain.id, domain]));
  const topicMap = new Map(topics.map((topic) => [topic.id, topic]));
  // Keep the full taxonomy path: an event tagged at depth three contributes
  // once to each ancestor category, but never twice through sibling tags.
  const topicPaths = new Map<string, ExplorationTopic[]>();
  for (const topic of topics) {
    const path: ExplorationTopic[] = [];
    const visited = new Set<string>();
    let current: ExplorationTopic | undefined = topic;
    while (current && !visited.has(current.id)) {
      path.push(current);
      visited.add(current.id);
      if (current.parentId === null) break;
      current = topicMap.get(current.parentId);
    }
    if (current?.parentId === null && domainMap.has(current.id)) {
      topicPaths.set(topic.id, path.reverse());
    }
  }
  const categories: RadarCategoryObservation[] = topics.flatMap((topic) => {
    const path = topicPaths.get(topic.id);
    return topic.parentId && path && path.length > 1
      ? [
          {
            id: topic.id,
            name: topic.name,
            parentId: topic.parentId,
            domainId: path[0]!.id,
            depth: path.length - 1,
            totalCount: 0,
            recentCount: 0,
            signalIds: [],
          },
        ]
      : [];
  });
  const categoryMap = new Map(categories.map((category) => [category.id, category]));
  const subtopics: RadarSubtopicObservation[] = topics.flatMap((topic) => {
    const domain = topic.parentId ? domainMap.get(topic.parentId) : undefined;
    return domain
      ? [
          {
            id: topic.id,
            name: topic.name,
            domainId: domain.id,
            domainName: domain.name,
            totalCount: 0,
            recentCount: 0,
            signalIds: [],
          },
        ]
      : [];
  });
  const subtopicMap = new Map(subtopics.map((topic) => [topic.id, topic]));
  const resources: RadarResourceObservation[] = entities.flatMap((entity) =>
    entity.type === 'person' || entity.type === 'company'
      ? [
          {
            id: entity.id,
            name: entity.name,
            type: entity.type,
            totalCount: 0,
            recentCount: 0,
            signalIds: [],
          },
        ]
      : [],
  );
  const resourceMap = new Map(resources.map((resource) => [resource.id, resource]));
  const domainsBySignal = new Map<string, string[]>();
  let unmappedCount = 0;
  let recentCount = 0;
  let previousCount = 0;
  let earliestAt: string | null = null;
  let latestAt: string | null = null;
  for (const entry of eligible) {
    const occurred = Date.parse(entry.occurred_at);
    const occurredAt = new Date(occurred).toISOString();
    if (earliestAt === null || occurredAt < earliestAt) earliestAt = occurredAt;
    if (latestAt === null || occurredAt > latestAt) latestAt = occurredAt;
    const ids = signalDomainIds(entry, topics);
    domainsBySignal.set(entry.id, ids);
    const categoryIds = new Set<string>();
    for (const id of entry.topics) {
      for (const topic of topicPaths.get(id)?.slice(1) ?? []) categoryIds.add(topic.id);
    }
    for (const id of categoryIds) {
      const category = categoryMap.get(id);
      if (category) {
        category.totalCount++;
        if (occurred >= recentStart) category.recentCount++;
        category.signalIds.push(entry.id);
      }
      const subtopic = subtopicMap.get(id);
      if (!subtopic) continue;
      subtopic.totalCount++;
      if (occurred >= recentStart) subtopic.recentCount++;
      subtopic.signalIds.push(entry.id);
    }
    const resourceIds = new Set(
      signalPublication(entry).state === 'published'
        ? [
            ...toUnifiedSignal(entry).people.map((person) => person.id),
            ...toUnifiedSignal(entry).organizations.map((organization) => organization.id),
          ]
        : entry.entities,
    );
    for (const id of resourceIds) {
      if (id === null) continue;
      const resource = resourceMap.get(id);
      if (!resource) continue;
      resource.totalCount++;
      if (occurred >= recentStart) resource.recentCount++;
      resource.signalIds.push(entry.id);
    }
    if (!ids.length) unmappedCount++;
    if (occurred >= recentStart) recentCount++;
    else if (occurred >= previousStart) previousCount++;
    const index = monthIndex.get(monthKey(occurred));
    for (const id of ids) {
      const domain = domainMap.get(id);
      if (!domain) continue;
      domain.totalCount++;
      domain.signalIds.push(entry.id);
      if (occurred >= recentStart) domain.recentCount++;
      else if (occurred >= previousStart) domain.previousCount++;
      if (index !== undefined) domain.monthlyCounts[index] = (domain.monthlyCounts[index] ?? 0) + 1;
      if (domain.latestAt === null || occurredAt > domain.latestAt) domain.latestAt = occurredAt;
    }
  }
  // The taxonomy defines possible directions; the public radar only shows
  // directions actually represented by an eligible Signal. Older events still
  // count, even when the trailing 30-day window is quiet.
  const observedDomains = domains.filter((domain) => domain.totalCount > 0);
  const observedSubtopics = subtopics.filter((subtopic) => subtopic.totalCount > 0);
  const observedCategories = categories.filter((category) => category.totalCount > 0);
  const focusDomains = [...observedDomains].sort(
    (left, right) =>
      right.recentCount - left.recentCount ||
      right.totalCount - left.totalCount ||
      compareId(left.id, right.id),
  );
  observedSubtopics.sort(
    (left, right) =>
      right.totalCount - left.totalCount ||
      right.recentCount - left.recentCount ||
      compareId(left.id, right.id),
  );
  observedCategories.sort(
    (left, right) =>
      compareId(left.domainId, right.domainId) ||
      left.depth - right.depth ||
      right.recentCount - left.recentCount ||
      right.totalCount - left.totalCount ||
      compareId(left.id, right.id),
  );
  const topResources = resources
    .filter((resource) => resource.totalCount > 0)
    .sort(
      (left, right) =>
        right.recentCount - left.recentCount ||
        right.totalCount - left.totalCount ||
        compareId(left.id, right.id),
    )
    .slice(0, 5);
  const signalIndex: RadarSignalIndexEntry[] = eligible.map((signal) => ({
    id: signal.id,
    title: signal.title,
    summary: signal.summary,
    occurredAt: signal.occurred_at,
    domainIds: domainsBySignal.get(signal.id) ?? [],
  }));

  const latestSignals: RadarSignal[] = eligible.slice(0, 10).map((signal) => {
    const importance = toUnifiedSignal(signal).assessment?.importance;
    return {
      signal,
      domainIds: domainsBySignal.get(signal.id) ?? [],
      importance:
        typeof importance === 'number' &&
        Number.isInteger(importance) &&
        importance >= 1 &&
        importance <= 5
          ? importance
          : null,
    };
  });
  return {
    asOf: now.toISOString(),
    rankingVersion: radarRankingVersion,
    trendVersion: radarTrendVersion,
    recentStart: new Date(recentStart).toISOString(),
    previousStart: new Date(previousStart).toISOString(),
    months,
    totalCount: eligible.length,
    recentCount,
    previousCount,
    earliestAt,
    latestAt,
    observedDomainCount: observedDomains.length,
    domains: observedDomains,
    focusDomains,
    subtopics: observedSubtopics,
    categories: observedCategories,
    topResources,
    signalIndex,
    latestSignals,
    exclusions: { invalidDates, futureDates, duplicateCount },
    unmappedCount,
  };
}

export type SignalRadarModel = ReturnType<typeof buildSignalRadar>;
