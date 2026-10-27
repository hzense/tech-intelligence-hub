import type { RadarExplorerData, filterRadarWindow } from './radar-window.ts';
import type { RadarResourceObservation } from './signal-radar-model.ts';
import { radarTopicLabel } from './radar-topic-labels.ts';

export type RadarHotspotTrendState =
  'rising' | 'falling' | 'steady' | 'new' | 'insufficient' | 'unavailable';

export interface RadarHotspot {
  id: string;
  name: string;
  /** Explain a parent-only subset in details without changing its topic label. */
  scopeNote?: string;
  domainName: string;
  kind: 'domain' | 'category';
  recentCount: number;
  previousCount: number | null;
  signalIds: string[];
  trend: { state: RadarHotspotTrendState; label: string; delta: number | null };
  series: { start: string; end: string; count: number }[];
  resources: RadarResourceObservation[];
}

const compareId = (left: string, right: string) => (left < right ? -1 : left > right ? 1 : 0);

function trend(current: number, previous: number | null): RadarHotspot['trend'] {
  if (previous === null) return { state: 'unavailable', label: '仅展示历史', delta: null };
  const delta = current - previous;
  // A first observation is not evidence of a technology's birth; sparse counts
  // must not imply a sustained or statistically established development trend.
  if (current + previous < 4) return { state: 'insufficient', label: '样本较少', delta };
  if (previous === 0) return { state: 'new', label: '新收录', delta };
  if (delta > 0) return { state: 'rising', label: '升温', delta };
  if (delta < 0) return { state: 'falling', label: '降温', delta };
  return { state: 'steady', label: '平稳', delta };
}

function rankResources(
  resources: RadarExplorerData['resources'],
  currentIds: Set<string>,
  allIds: Set<string>,
): RadarResourceObservation[] {
  const ranked = resources
    .map((resource) => {
      const ids = [...new Set(resource.signalIds)];
      const signalIds = ids.filter((id) => currentIds.has(id));
      return {
        ...resource,
        signalIds,
        recentCount: signalIds.length,
        totalCount: ids.filter((id) => allIds.has(id)).length,
      };
    })
    .filter((resource) => resource.recentCount > 0)
    .sort((a, b) => b.recentCount - a.recentCount || compareId(a.id, b.id));
  const selected = ranked.slice(0, 5);
  // Do not let five organizations hide the only person (or vice versa).
  // The display explains association, not a claim of leadership or employment.
  for (const person of [true, false]) {
    if (selected.some((resource) => (resource.type === 'person') === person)) continue;
    const representative = ranked.find((resource) => (resource.type === 'person') === person);
    if (representative) {
      if (selected.length === 5) selected.pop();
      selected.push(representative);
    }
  }
  return selected.sort((a, b) => b.recentCount - a.recentCount || compareId(a.id, b.id));
}

/**
 * Build concrete, evidenced cloud terms from the same public snapshot as the
 * time selector. Ancestor totals do not become duplicate words: descendants
 * own their signals, while parent-only assignments retain the original label
 * and explain their narrower scope in the detail view.
 * Multiple sibling/cross-domain tags remain non-additive observations.
 */
export function buildRadarHotspots(
  source: RadarExplorerData,
  window: ReturnType<typeof filterRadarWindow>,
): RadarHotspot[] {
  const start = Date.parse(window.rangeStart);
  const end = Date.parse(window.rangeEnd);
  const asOf = Date.parse(source.asOf);
  if (![start, end, asOf].every(Number.isFinite) || start >= end || end > asOf) return [];
  const priorStart = start - (end - start);
  const hasPrevious = window.previousLabel !== null;
  const timestamps = new Map(
    source.signalIndex.flatMap((signal) => {
      const at = Date.parse(signal.occurredAt);
      return Number.isFinite(at) && at < asOf ? [[signal.id, at] as const] : [];
    }),
  );
  const children = new Map<string, Set<string>>();
  for (const category of source.categories) {
    const ids = children.get(category.parentId) ?? new Set<string>();
    for (const id of category.signalIds) ids.add(id);
    children.set(category.parentId, ids);
  }
  const domainNames = new Map(
    source.domains.map((domain) => [domain.id, radarTopicLabel(domain.id, domain.name)]),
  );
  const candidates = [
    ...source.categories.map((category) => ({
      ...category,
      kind: 'category' as const,
      domainName: domainNames.get(category.domainId) ?? radarTopicLabel(category.id, category.name),
    })),
    ...source.domains.map((domain) => ({
      ...domain,
      kind: 'domain' as const,
      domainName: radarTopicLabel(domain.id, domain.name),
    })),
  ];
  const hotspots: RadarHotspot[] = [];
  for (const candidate of candidates) {
    const childIds = children.get(candidate.id);
    const allIds = new Set(
      candidate.signalIds.filter((id) => timestamps.has(id) && !childIds?.has(id)),
    );
    const signalIds = [...allIds].filter((id) => {
      const at = timestamps.get(id)!;
      return at >= start && at < end;
    });
    const previousCount = hasPrevious
      ? [...allIds].filter((id) => {
          const at = timestamps.get(id)!;
          return at >= priorStart && at < start;
        }).length
      : null;
    // Every visible word must open at least one Signal in the selected window.
    if (!signalIds.length) continue;
    const series = Array.from({ length: 8 }, (_, index) => ({
      start: new Date(start + Math.ceil(((end - start) * index) / 8)).toISOString(),
      end: new Date(start + Math.ceil(((end - start) * (index + 1)) / 8)).toISOString(),
      count: 0,
    }));
    for (const id of signalIds) {
      const index = Math.min(7, Math.floor(((timestamps.get(id)! - start) / (end - start)) * 8));
      series[index]!.count++;
    }
    hotspots.push({
      id: candidate.id,
      name: radarTopicLabel(candidate.id, candidate.name),
      ...(childIds?.size
        ? {
            scopeNote:
              '此处仅展示归入该分类、尚未细分到其子分类的信号；数量不包含子分类，已细分的信号请查看对应词语。',
          }
        : {}),
      domainName: candidate.domainName,
      kind: candidate.kind,
      recentCount: signalIds.length,
      previousCount,
      signalIds,
      trend: trend(signalIds.length, previousCount),
      series,
      resources: rankResources(source.resources, new Set(signalIds), allIds),
    });
  }
  return hotspots.sort(
    (a, b) =>
      b.recentCount - a.recentCount ||
      (b.previousCount ?? 0) - (a.previousCount ?? 0) ||
      compareId(a.id, b.id),
  );
}
