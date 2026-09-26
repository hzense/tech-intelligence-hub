import type { SignalEntry } from './public-signal-reader-core.ts';
import {
  isCurrentSignal,
  signalDomainIds,
  type ExplorationTopic,
} from './public-exploration-core.ts';

export const radarRankingVersion = 'radar-recency-v1';
export const radarTrendVersion = 'radar-observation-v1';
export const radarRanges = {
  '24h': { hours: 24, label: '24 小时' },
  '7d': { hours: 168, label: '7 天' },
  '30d': { hours: 720, label: '30 天' },
} as const;
export type RadarRange = keyof typeof radarRanges;
export function parseRadarRange(value: string | string[] | undefined): RadarRange {
  const first = Array.isArray(value) ? value[0] : value;
  return first === '24h' || first === '30d' ? first : '7d';
}

const day = 86_400_000;
const normalize = (value: string) =>
  value.normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('zh-CN');
const compareId = (left: string, right: string) => (left < right ? -1 : left > right ? 1 : 0);
const version = (entry: SignalEntry) => entry.publication_revision ?? entry.public_version ?? 0;

export interface RadarRankedSignal {
  signal: SignalEntry;
  recencyScore: number;
  ageHours: number;
  importance: number | null;
  hotnessScore: null;
  independentSourceCount: null;
  domainIds: string[];
}
export interface RadarDomainObservation {
  id: string;
  name: string;
  currentCount: number;
  previousCount: number;
  state: 'no_observations' | 'insufficient_sample' | 'coverage_unverified';
  dailyCounts: number[];
}

/** Deterministic, request-scoped observations of the current public set. No publication inference. */
export function buildSignalRadar(
  signals: readonly SignalEntry[],
  topics: readonly ExplorationTopic[],
  { now = new Date(), range = '7d' }: { now?: Date; range?: RadarRange } = {},
) {
  const asOf = now.getTime();
  if (!Number.isFinite(asOf)) throw new Error('Invalid radar cutoff');
  const start = asOf - radarRanges[range].hours * 3_600_000;
  const trendEnd = Math.floor(asOf / day) * day;
  const trendStart = trendEnd - 7 * day;
  const previousStart = trendStart - 7 * day;
  const current = signals.filter(isCurrentSignal);
  const byId = new Map<string, SignalEntry>();
  for (const entry of current) {
    const old = byId.get(entry.id);
    if (!old || version(entry) > version(old)) byId.set(entry.id, entry);
  }
  let invalidDates = 0,
    futureDates = 0,
    duplicateCount = current.length - byId.size;
  const fingerprints = new Set<string>();
  const eligible: SignalEntry[] = [];
  for (const entry of [...byId.values()].sort((a, b) => compareId(a.id, b.id))) {
    const occurred = Date.parse(entry.occurred_at);
    if (!Number.isFinite(occurred)) {
      invalidDates++;
      continue;
    }
    if (occurred >= asOf) {
      futureDates++;
      continue;
    }
    // Exact content repetitions only. A URL, organization name or similar title
    // alone cannot establish event identity; no fuzzy merge is attempted.
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
  const domains = topics
    .filter((topic) => topic.parentId === null)
    .map((topic): RadarDomainObservation => ({
      id: topic.id,
      name: topic.name,
      currentCount: 0,
      previousCount: 0,
      state: 'no_observations',
      dailyCounts: Array.from({ length: 14 }, () => 0),
    }));
  const domainMap = new Map(domains.map((domain) => [domain.id, domain]));
  const domainsBySignal = new Map<string, string[]>();
  let unmappedCount = 0;
  for (const entry of eligible) {
    const ids = signalDomainIds(entry, topics);
    domainsBySignal.set(entry.id, ids);
    const occurred = Date.parse(entry.occurred_at);
    if (occurred < previousStart || occurred >= trendEnd) continue;
    if (!ids.length) unmappedCount++;
    for (const id of ids) {
      const observation = domainMap.get(id);
      if (!observation) continue;
      if (occurred >= trendStart) observation.currentCount++;
      else observation.previousCount++;
      const index = Math.floor((occurred - previousStart) / day);
      observation.dailyCounts[index] = (observation.dailyCounts[index] ?? 0) + 1;
    }
  }
  for (const observation of domains) {
    const total = observation.currentCount + observation.previousCount;
    observation.state =
      total === 0
        ? 'no_observations'
        : observation.previousCount < 3 || total < 6
          ? 'insufficient_sample'
          : 'coverage_unverified';
  }
  domains.sort(
    (a, b) =>
      b.currentCount - a.currentCount || b.previousCount - a.previousCount || compareId(a.id, b.id),
  );
  const ranked: RadarRankedSignal[] = eligible
    .filter((entry) => Date.parse(entry.occurred_at) >= start)
    .map((signal) => {
      const ageHours = (asOf - Date.parse(signal.occurred_at)) / 3_600_000;
      const importance = signal.importance;
      return {
        signal,
        ageHours,
        recencyScore: 100 * 2 ** (-ageHours / 48),
        importance:
          typeof importance === 'number' &&
          Number.isInteger(importance) &&
          importance >= 1 &&
          importance <= 5
            ? importance
            : null,
        hotnessScore: null,
        independentSourceCount: null,
        domainIds: domainsBySignal.get(signal.id) ?? [],
      };
    })
    .sort(
      (a, b) =>
        b.recencyScore - a.recencyScore ||
        b.signal.occurred_at.localeCompare(a.signal.occurred_at) ||
        compareId(a.signal.id, b.signal.id),
    );
  return {
    asOf: now.toISOString(),
    range,
    rangeStart: new Date(start).toISOString(),
    rankingVersion: radarRankingVersion,
    trendVersion: radarTrendVersion,
    trendStart: new Date(trendStart).toISOString(),
    trendEnd: new Date(trendEnd).toISOString(),
    previousStart: new Date(previousStart).toISOString(),
    currentCount: byId.size,
    recentCount: ranked.length,
    rankings: ranked.slice(0, 10),
    domains,
    exclusions: {
      legacy: signals.length - current.length,
      invalidDates,
      futureDates,
      duplicateCount,
      outsideWindow: eligible.length - ranked.length,
    },
    unmappedCount,
  };
}
export type SignalRadarModel = ReturnType<typeof buildSignalRadar>;
