import type { SeedRadarSnapshot } from '@hzense/content';

export interface RadarFilters {
  domain?: SeedRadarSnapshot['domain'];
  maturity?: SeedRadarSnapshot['maturity'];
  trend?: SeedRadarSnapshot['trend'];
}

export interface RadarNodePosition {
  bottom: string;
  left: string;
}

const maturityPositions: Record<SeedRadarSnapshot['maturity'], number> = {
  research: 10,
  early: 28,
  emerging: 48,
  growth: 70,
  mature: 90,
};

const minimumNodePosition = 12;
const maximumNodePosition = 88;
const maximumNodeHorizontalOffset = 6;

export function getRadarAttentionPosition(attention: number): number {
  return minimumNodePosition + (attention / 100) * (maximumNodePosition - minimumNodePosition);
}

export function getRadarMaturityPosition(maturity: SeedRadarSnapshot['maturity']): number {
  return maturityPositions[maturity];
}

export function filterLatestRadarSnapshots(
  snapshots: SeedRadarSnapshot[],
  filters: RadarFilters = {},
): SeedRadarSnapshot[] {
  const latestByTopic = new Map<string, SeedRadarSnapshot>();
  for (const snapshot of snapshots) {
    const current = latestByTopic.get(snapshot.topic);
    if (!current || snapshot.date > current.date) latestByTopic.set(snapshot.topic, snapshot);
  }
  return [...latestByTopic.values()]
    .filter((snapshot) => !filters.domain || snapshot.domain === filters.domain)
    .filter((snapshot) => !filters.maturity || snapshot.maturity === filters.maturity)
    .filter((snapshot) => !filters.trend || snapshot.trend === filters.trend);
}

export function getLatestRadarSnapshotDate(
  snapshots: readonly SeedRadarSnapshot[],
): string | undefined {
  return snapshots.reduce<string | undefined>(
    (latest, snapshot) => (!latest || snapshot.date > latest ? snapshot.date : latest),
    undefined,
  );
}

export function getRadarNodePositions(
  snapshots: readonly SeedRadarSnapshot[],
): Map<string, RadarNodePosition> {
  const snapshotsByMaturity = new Map<SeedRadarSnapshot['maturity'], SeedRadarSnapshot[]>();
  for (const snapshot of snapshots) {
    const lane = snapshotsByMaturity.get(snapshot.maturity) ?? [];
    lane.push(snapshot);
    snapshotsByMaturity.set(snapshot.maturity, lane);
  }

  const positions = new Map<string, RadarNodePosition>();
  for (const [maturity, lane] of snapshotsByMaturity) {
    const orderedLane = [...lane].sort(
      (left, right) => right.attention - left.attention || left.topic.localeCompare(right.topic),
    );
    orderedLane.forEach((snapshot, index) => {
      const horizontalOffset =
        orderedLane.length === 1
          ? 0
          : -maximumNodeHorizontalOffset +
            (index / (orderedLane.length - 1)) * maximumNodeHorizontalOffset * 2;
      positions.set(snapshot.id, {
        bottom: `${getRadarAttentionPosition(snapshot.attention)}%`,
        left: `${getRadarMaturityPosition(maturity) + horizontalOffset}%`,
      });
    });
  }

  return positions;
}
