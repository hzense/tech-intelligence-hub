import type { SignalEntry } from './public-signal-reader-core.ts';
import { signalDomainIds, type ExplorationTopic } from './public-exploration-core.ts';
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
}

export interface RadarSubtopicObservation {
  id: string;
  name: string;
  domainId: string;
  domainName: string;
  totalCount: number;
  recentCount: number;
}

/**
 * One projection of every signal supplied by the configured public reader.
 * The reader is responsible for public eligibility; Seed review status is not
 * treated as a publication grant. Counts describe the observed sample only.
 */
export function buildSignalRadar(
  signals: readonly SignalEntry[],
  topics: readonly ExplorationTopic[],
  { now = new Date() }: { now?: Date } = {},
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
    }));
  const domainMap = new Map(domains.map((domain) => [domain.id, domain]));
  const topicMap = new Map(topics.map((topic) => [topic.id, topic]));
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
          },
        ]
      : [];
  });
  const subtopicMap = new Map(subtopics.map((topic) => [topic.id, topic]));
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
    const subtopicIds = new Set<string>();
    for (const id of entry.topics) {
      let topic = topicMap.get(id);
      const visited = new Set<string>();
      while (topic && !subtopicMap.has(topic.id) && topic.parentId) {
        if (visited.has(topic.id)) break;
        visited.add(topic.id);
        topic = topicMap.get(topic.parentId);
      }
      if (topic && subtopicMap.has(topic.id)) subtopicIds.add(topic.id);
    }
    for (const id of subtopicIds) {
      const subtopic = subtopicMap.get(id);
      if (!subtopic) continue;
      subtopic.totalCount++;
      if (occurred >= recentStart) subtopic.recentCount++;
    }
    if (!ids.length) unmappedCount++;
    if (occurred >= recentStart) recentCount++;
    else if (occurred >= previousStart) previousCount++;
    const index = monthIndex.get(monthKey(occurred));
    for (const id of ids) {
      const domain = domainMap.get(id);
      if (!domain) continue;
      domain.totalCount++;
      if (occurred >= recentStart) domain.recentCount++;
      else if (occurred >= previousStart) domain.previousCount++;
      if (index !== undefined) domain.monthlyCounts[index] = (domain.monthlyCounts[index] ?? 0) + 1;
      if (domain.latestAt === null || occurredAt > domain.latestAt) domain.latestAt = occurredAt;
    }
  }
  const focusDomains = [...domains].sort(
    (left, right) =>
      right.recentCount - left.recentCount ||
      right.totalCount - left.totalCount ||
      compareId(left.id, right.id),
  );
  subtopics.sort(
    (left, right) =>
      right.totalCount - left.totalCount ||
      right.recentCount - left.recentCount ||
      compareId(left.id, right.id),
  );

  const latestSignals: RadarSignal[] = eligible
    .sort(
      (left, right) =>
        Date.parse(right.occurred_at) - Date.parse(left.occurred_at) ||
        compareId(left.id, right.id),
    )
    .slice(0, 10)
    .map((signal) => {
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
    observedDomainCount: domains.filter((domain) => domain.totalCount > 0).length,
    domains,
    focusDomains,
    subtopics,
    latestSignals,
    exclusions: { invalidDates, futureDates, duplicateCount },
    unmappedCount,
  };
}

export type SignalRadarModel = ReturnType<typeof buildSignalRadar>;
