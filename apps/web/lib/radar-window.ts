import type {
  RadarCategoryObservation,
  RadarDomainObservation,
  RadarResourceObservation,
  RadarSignalIndexEntry,
} from './signal-radar-model.ts';

type DomainNode = Pick<
  RadarDomainObservation,
  'id' | 'name' | 'totalCount' | 'recentCount' | 'previousCount' | 'signalIds'
>;

/** Only public display fields and identity links cross the server boundary. */
export interface RadarExplorerData {
  asOf: string;
  recentStart: string;
  totalCount: number;
  recentCount: number;
  previousCount: number;
  domains: readonly DomainNode[];
  categories: readonly RadarCategoryObservation[];
  resources: readonly RadarResourceObservation[];
  signalIndex: readonly RadarSignalIndexEntry[];
}

export type RadarTimeRange =
  | { kind: 'days'; days: number }
  | { kind: 'all' }
  | { kind: 'custom'; startDate: string; endDate: string };

const day = 86_400_000;

function utcDay(value: string) {
  const timestamp = Date.parse(`${value}T00:00:00.000Z`);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    !Number.isFinite(timestamp) ||
    new Date(timestamp).toISOString().slice(0, 10) !== value
  )
    throw new Error('请选择有效的开始和结束日期。');
  return timestamp;
}

/** Reuse the server's deduplicated snapshot; switching ranges needs no database read. */
export function filterRadarWindow(data: RadarExplorerData, range: RadarTimeRange) {
  const asOf = Date.parse(data.asOf);
  if (!Number.isFinite(asOf)) throw new Error('Invalid radar cutoff');
  let end = asOf;
  let start: number;
  let rangeLabel: string;
  let previousLabel: string | null;
  if (range.kind === 'days') {
    if (!Number.isInteger(range.days) || range.days < 1 || range.days > 3650)
      throw new Error('请选择 1 至 3650 天的时间范围。');
    start = end - range.days * day;
    rangeLabel = `近 ${range.days} 日`;
    previousLabel = `前 ${range.days} 日`;
  } else if (range.kind === 'custom') {
    start = utcDay(range.startDate);
    const lastDay = utcDay(range.endDate);
    if (start > lastDay) throw new Error('开始日期不能晚于结束日期。');
    if (lastDay > utcDay(data.asOf.slice(0, 10))) throw new Error('结束日期不能晚于当前数据日期。');
    end = Math.min(lastDay + day, asOf);
    rangeLabel = '自定义时段';
    previousLabel = '上一等长时段';
  } else {
    start = data.signalIndex.reduce((earliest, signal) => {
      const at = Date.parse(signal.occurredAt);
      return Number.isFinite(at) ? Math.min(earliest, at) : earliest;
    }, asOf);
    rangeLabel = '全部时间';
    previousLabel = null;
  }
  const previousStart = start - (end - start);
  const current = new Set<string>();
  const previous = new Set<string>();
  const signalIndex = data.signalIndex.filter((signal) => {
    const at = Date.parse(signal.occurredAt);
    if (at >= start && at < end) {
      current.add(signal.id);
      return true;
    }
    if (previousLabel !== null && at >= previousStart && at < start) previous.add(signal.id);
    return false;
  });
  const project = <T extends { signalIds: string[]; recentCount: number }>(node: T) => {
    const signalIds = node.signalIds.filter((id) => current.has(id));
    return { ...node, signalIds, recentCount: signalIds.length };
  };
  const domains = data.domains
    .map((domain) => ({
      ...project(domain),
      previousCount: domain.signalIds.filter((id) => previous.has(id)).length,
    }))
    .filter((domain) => domain.recentCount > 0);
  const categories = data.categories.map(project).filter((category) => category.recentCount > 0);
  const topResources = data.resources
    .map(project)
    .filter((resource) => resource.recentCount > 0)
    .sort(
      (left, right) =>
        right.recentCount - left.recentCount ||
        right.totalCount - left.totalCount ||
        (left.id < right.id ? -1 : left.id > right.id ? 1 : 0),
    )
    .slice(0, 5);
  return {
    asOf: data.asOf,
    totalCount: data.totalCount,
    recentCount: current.size,
    previousCount: previous.size,
    rangeStart: new Date(start).toISOString(),
    rangeEnd: new Date(end).toISOString(),
    rangeLabel,
    previousLabel,
    domains,
    categories,
    topResources,
    signalIndex,
  };
}
