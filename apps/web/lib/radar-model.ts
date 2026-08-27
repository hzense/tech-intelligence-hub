import type { SeedRadarSnapshot } from '@hzense/content';

export interface RadarFilters {
  domain?: SeedRadarSnapshot['domain'];
  maturity?: SeedRadarSnapshot['maturity'];
  trend?: SeedRadarSnapshot['trend'];
}

export function filterLatestRadarSnapshots(
  snapshots: SeedRadarSnapshot[],
  filters: RadarFilters = {},
): SeedRadarSnapshot[] {
  const latestByTopic = new Map<string, SeedRadarSnapshot>();
  for (const snapshot of snapshots) {
    if (!latestByTopic.has(snapshot.topic)) latestByTopic.set(snapshot.topic, snapshot);
  }
  return [...latestByTopic.values()]
    .filter((snapshot) => !filters.domain || snapshot.domain === filters.domain)
    .filter((snapshot) => !filters.maturity || snapshot.maturity === filters.maturity)
    .filter((snapshot) => !filters.trend || snapshot.trend === filters.trend);
}

export function getRadarNodePosition(snapshot: SeedRadarSnapshot): {
  bottom: string;
  left: string;
} {
  const maturityPositions: Record<SeedRadarSnapshot['maturity'], number> = {
    research: 10,
    early: 28,
    emerging: 48,
    growth: 70,
    mature: 90,
  };
  return {
    bottom: `${Math.max(12, Math.min(88, snapshot.attention))}%`,
    left: `${maturityPositions[snapshot.maturity]}%`,
  };
}
