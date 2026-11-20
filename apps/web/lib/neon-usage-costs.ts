import { neonComputeRate, neonTransferAllowance } from './neon-usage-pricing.ts';
import { readImportBytes } from './import-io.ts';
import { parseNeonUsageHours, type NeonUsageHour } from './neon-usage-hours.ts';

export type NeonUsageCostKind =
  | 'compute'
  | 'storage'
  | 'history'
  | 'snapshots'
  | 'publicTransfer'
  | 'privateTransfer'
  | 'branches';
export type NeonUsageCosts = {
  status: 'estimated' | 'free' | 'unavailable';
  plan: 'free' | 'launch' | 'scale' | null;
  from: string | null;
  through: string | null;
  totalMicrousd: number | null;
  items: { kind: NeonUsageCostKind; microusd: number }[];
  reason:
    | 'missing_org'
    | 'provider_unavailable'
    | 'unsupported_plan'
    | 'invalid_metrics'
    | 'incomplete_period'
    | 'waiting_data'
    | null;
  /** Absent in older persisted estimates. CU-seconds, not elapsed wall time. */
  computeUnitSeconds?: number;
  pricingVersion: '2026-11-02';
};

const hour = 3_600_000;
const day = 24 * hour;
const pricingVersion = '2026-11-02' as const;
const kinds: NeonUsageCostKind[] = [
  'compute',
  'storage',
  'history',
  'snapshots',
  'publicTransfer',
  'privateTransfer',
  'branches',
];
const metrics = [
  'compute_unit_seconds',
  'root_branch_bytes_month',
  'child_branch_bytes_month',
  'instant_restore_bytes_month',
  'snapshot_storage_bytes_month',
  'public_network_transfer_bytes',
  'private_network_transfer_bytes',
  'extra_branches_month',
] as const;
type Metric = (typeof metrics)[number];
type Reason = NonNullable<NeonUsageCosts['reason']>;
const reasons: Reason[] = [
  'missing_org',
  'provider_unavailable',
  'unsupported_plan',
  'invalid_metrics',
  'incomplete_period',
  'waiting_data',
];
const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const amount = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
function timestamp(value: unknown): number {
  if (
    typeof value !== 'string' ||
    value.length > 40 ||
    !/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value)
  )
    return NaN;
  return Date.parse(value);
}
class CostError extends Error {
  readonly reason: Reason;
  constructor(reason: Reason) {
    super(reason);
    this.reason = reason;
  }
}
function unavailable(reason: Reason, plan: NeonUsageCosts['plan'] = null): NeonUsageCosts {
  return {
    status: 'unavailable',
    plan,
    from: null,
    through: null,
    totalMicrousd: null,
    items: [],
    reason,
    pricingVersion,
  };
}

/** Strict persisted contract; no organization metadata, provider errors, or credentials survive. */
export function parseNeonUsageCosts(value: unknown): NeonUsageCosts {
  const invalid = () => {
    throw new CostError('invalid_metrics');
  };
  if (!record(value) || value.pricingVersion !== pricingVersion) return invalid();
  if (!['free', 'launch', 'scale', null].includes(value.plan as string | null)) return invalid();
  if (!Array.isArray(value.items) || value.items.length > kinds.length) return invalid();
  const items: NeonUsageCosts['items'] = [];
  for (const item of value.items) {
    if (
      !record(item) ||
      !kinds.includes(item.kind as NeonUsageCostKind) ||
      !amount(item.microusd) ||
      items.some((existing) => existing.kind === item.kind)
    )
      return invalid();
    items.push({ kind: item.kind as NeonUsageCostKind, microusd: item.microusd });
  }
  const plan = value.plan as NeonUsageCosts['plan'];
  if (value.status === 'unavailable') {
    if (
      !reasons.includes(value.reason as Reason) ||
      value.totalMicrousd !== null ||
      value.from !== null ||
      value.through !== null ||
      items.length
    )
      return invalid();
    return unavailable(value.reason as Reason, plan);
  }
  if (value.reason !== null) return invalid();
  if (value.status === 'free') {
    if (
      plan !== 'free' ||
      value.from !== null ||
      value.through !== null ||
      value.totalMicrousd !== 0 ||
      items.length
    )
      return invalid();
    return {
      ...unavailable('missing_org', plan),
      status: 'free',
      totalMicrousd: 0,
      reason: null,
    };
  }
  const from = timestamp(value.from),
    through = timestamp(value.through);
  const total = items.reduce((sum, item) => sum + item.microusd, 0);
  if (
    value.status !== 'estimated' ||
    (plan !== 'launch' && plan !== 'scale') ||
    !Number.isFinite(from) ||
    !Number.isFinite(through) ||
    through % hour !== 0 ||
    through <= from ||
    through - from > 35 * day ||
    items.length !== kinds.length ||
    !amount(value.totalMicrousd) ||
    !amount(total) ||
    total !== value.totalMicrousd ||
    (value.computeUnitSeconds !== undefined &&
      (typeof value.computeUnitSeconds !== 'number' ||
        !Number.isFinite(value.computeUnitSeconds) ||
        value.computeUnitSeconds < 0 ||
        value.computeUnitSeconds > Number.MAX_SAFE_INTEGER))
  )
    return invalid();
  return {
    status: 'estimated',
    plan,
    from: new Date(from).toISOString(),
    through: new Date(through).toISOString(),
    totalMicrousd: total,
    items,
    ...(value.computeUnitSeconds === undefined
      ? {}
      : { computeUnitSeconds: value.computeUnitSeconds as number }),
    reason: null,
    pricingVersion,
  };
}

async function providerJSON(url: string, apiKey: string, fetcher: typeof fetch): Promise<unknown> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new CostError('provider_unavailable'));
    }, 6000);
  });
  try {
    return await Promise.race([
      deadline,
      (async () => {
        let response: Response;
        try {
          response = await fetcher(url, {
            method: 'GET',
            headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
            redirect: 'error',
            cache: 'no-store',
            signal: controller.signal,
          });
        } catch {
          throw new CostError('provider_unavailable');
        }
        if (!response.ok || response.redirected) {
          void response.body?.cancel().catch(() => {});
          throw new CostError('provider_unavailable');
        }
        try {
          return JSON.parse((await readImportBytes(response.body, 524_288, 6000)).toString('utf8'));
        } catch {
          throw new CostError(
            controller.signal.aborted ? 'provider_unavailable' : 'invalid_metrics',
          );
        }
      })(),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

type Frame = { from: number; through: number; values: Record<Metric, number> };

/** Query bounds select the billing window; Neon plan periods can predate a monthly reset. */
function consumptionFrames(
  value: unknown,
  projectId: string,
  plan: 'launch' | 'scale',
  periodStart: number,
  from: number,
  through: number,
  step: number,
): Frame[] {
  if (!record(value) || !Array.isArray(value.projects) || value.projects.length !== 1)
    throw new CostError('invalid_metrics');
  const project = value.projects[0];
  if (
    !record(project) ||
    project.project_id !== projectId ||
    !Array.isArray(project.periods) ||
    project.periods.length > 35
  )
    throw new CostError('invalid_metrics');
  const frames = new Map<number, Frame>();
  for (const period of project.periods) {
    if (!record(period) || !Number.isFinite(timestamp(period.period_start)))
      throw new CostError('invalid_metrics');
    // The plan's start is not necessarily the current monthly billing boundary.
    // A newer plan segment needs separate pricing and must not silently reset allowances.
    if (timestamp(period.period_start) > periodStart) throw new CostError('unsupported_plan');
    if (period.period_plan !== plan) throw new CostError('unsupported_plan');
    if (!Array.isArray(period.consumption) || period.consumption.length > 168)
      throw new CostError('invalid_metrics');
    for (const frame of period.consumption) {
      if (!record(frame)) throw new CostError('invalid_metrics');
      const start = timestamp(frame.timeframe_start),
        end = timestamp(frame.timeframe_end);
      // Neon rounds API boundaries; period-scoped metrics in the first bucket
      // already exclude pre-upgrade usage. Never prorate or discard those metrics.
      const bucketStart = Math.floor(start / step) * step;
      if (
        !Number.isFinite(start) ||
        !Number.isFinite(end) ||
        (start !== bucketStart && start !== periodStart) ||
        end !== bucketStart + step ||
        bucketStart < from ||
        end > through ||
        end <= periodStart ||
        frames.has(bucketStart) ||
        !Array.isArray(frame.metrics) ||
        frame.metrics.length > metrics.length
      )
        throw new CostError('invalid_metrics');
      const values = Object.fromEntries(metrics.map((metric) => [metric, 0])) as Record<
        Metric,
        number
      >;
      const seen = new Set<string>();
      for (const metric of frame.metrics) {
        if (
          !record(metric) ||
          !metrics.includes(metric.metric_name as Metric) ||
          seen.has(metric.metric_name as string) ||
          typeof metric.value !== 'number' ||
          !Number.isFinite(metric.value) ||
          metric.value < 0 ||
          metric.value > Number.MAX_SAFE_INTEGER
        )
          throw new CostError('invalid_metrics');
        seen.add(metric.metric_name as string);
        values[metric.metric_name as Metric] = metric.value;
      }
      if (plan === 'launch' && values.private_network_transfer_bytes !== 0)
        throw new CostError('invalid_metrics');
      frames.set(bucketStart, { from: Math.max(start, periodStart), through: end, values });
    }
  }
  return [...frames.values()].sort((a, b) => a.from - b.from);
}

function calculate(frames: Frame[], plan: 'launch' | 'scale', from: number): NeonUsageCosts {
  if (!frames.length) throw new CostError('waiting_data');
  let through = from;
  for (const frame of frames) {
    if (frame.from !== through) throw new CostError('incomplete_period');
    through = frame.through;
  }
  const sum = (metric: Metric) => {
    const total = frames.reduce((value, frame) => value + frame.values[metric], 0);
    if (!Number.isFinite(total) || total > Number.MAX_SAFE_INTEGER)
      throw new CostError('invalid_metrics');
    return total;
  };
  const dollars: Record<NeonUsageCostKind, number> = {
    compute: (sum('compute_unit_seconds') / 3600) * neonComputeRate(plan)!,
    storage: ((sum('root_branch_bytes_month') + sum('child_branch_bytes_month')) / 1e9) * 0.35,
    history: (sum('instant_restore_bytes_month') / 1e9) * 0.2,
    snapshots: (sum('snapshot_storage_bytes_month') / 1e9) * 0.09,
    publicTransfer:
      (Math.max(0, sum('public_network_transfer_bytes') - neonTransferAllowance(plan)!) / 1e9) *
      0.1,
    privateTransfer: (sum('private_network_transfer_bytes') / 1e9) * 0.01,
    branches:
      (frames.reduce(
        (total, frame) =>
          total +
          Math.max(
            0,
            frame.values.extra_branches_month -
              ((plan === 'launch' ? 9 : 24) * (frame.through - frame.from)) / hour,
          ),
        0,
      ) /
        744) *
      1.5,
  };
  const items = kinds.map((kind) => ({ kind, microusd: Math.round(dollars[kind] * 1e6) }));
  return parseNeonUsageCosts({
    status: 'estimated',
    plan,
    from: new Date(from).toISOString(),
    through: new Date(through).toISOString(),
    totalMicrousd: items.reduce((total, item) => total + item.microusd, 0),
    items,
    computeUnitSeconds: sum('compute_unit_seconds'),
    reason: null,
    pricingVersion,
  });
}

type Options = {
  projectId: string;
  orgId: unknown;
  periodStart: string;
  periodEnd: string;
  now: Date;
  apiKey: string;
  fetcher?: typeof fetch;
};

/** Bounded control-plane reads only. Hour buckets backfill delayed cron runs (Neon retains 168 hours).
 * Completed UTC days cover the older part of the bill; today's completed hours extend it without overlap.
 * Rates: neon.com/docs/introduction/usage-calculations. This is never an invoice.
 */
export async function fetchNeonUsageAccounting(options: Options): Promise<{
  costs: NeonUsageCosts;
  trafficHours?: NeonUsageHour[];
}> {
  if (typeof options.orgId !== 'string' || !/^[a-z0-9-]{1,60}$/.test(options.orgId))
    return { costs: unavailable('missing_org') };
  if (
    !/^[a-z0-9][a-z0-9-]{2,99}$/.test(options.projectId) ||
    !options.apiKey ||
    options.apiKey.length > 512 ||
    /[^\x21-\x7e]/.test(options.apiKey)
  )
    return { costs: unavailable('provider_unavailable') };
  let plan: NeonUsageCosts['plan'] = null;
  let trafficHours: NeonUsageHour[] | undefined;
  try {
    const fetcher = options.fetcher ?? fetch;
    const org = await providerJSON(
      `https://console.neon.tech/api/v2/organizations/${encodeURIComponent(options.orgId)}`,
      options.apiKey,
      fetcher,
    );
    if (!record(org) || org.id !== options.orgId) throw new CostError('invalid_metrics');
    if (org.plan !== 'free' && org.plan !== 'launch' && org.plan !== 'scale')
      throw new CostError('unsupported_plan');
    plan = org.plan;
    if (plan === 'free')
      return {
        costs: parseNeonUsageCosts({
          ...unavailable('missing_org', plan),
          status: 'free',
          totalMicrousd: 0,
          reason: null,
        }),
      };
    const start = timestamp(options.periodStart),
      end = timestamp(options.periodEnd),
      now = options.now.getTime();
    if (
      !Number.isFinite(now) ||
      !Number.isFinite(start) ||
      !Number.isFinite(end) ||
      start > now ||
      end <= now ||
      end - start > 35 * day ||
      start < Date.parse('2024-03-01T00:00:00Z')
    )
      throw new CostError('invalid_metrics');
    const today = Math.floor(now / day) * day;
    const hourlyEnd = Math.floor(now / hour) * hour;
    const hourlyStart = Math.max(
      Math.floor(start / hour) * hour,
      Math.ceil((now - 168 * hour) / hour) * hour,
    );
    const dailyStart = Math.floor(start / day) * day;
    const load = async (from: number, through: number, granularity: 'daily' | 'hourly') => {
      if (through <= from) return [];
      const query = new URLSearchParams({
        org_id: options.orgId as string,
        project_ids: options.projectId,
        limit: '1',
        from: new Date(from).toISOString(),
        to: new Date(through).toISOString(),
        granularity,
        metrics: metrics.join(','),
      });
      const data = await providerJSON(
        `https://console.neon.tech/api/v2/consumption_history/v2/projects?${query}`,
        options.apiKey,
        fetcher,
      );
      return consumptionFrames(
        data,
        options.projectId,
        plan as 'launch' | 'scale',
        start,
        from,
        through,
        granularity === 'daily' ? day : hour,
      );
    };
    const [daily, hourly] = await Promise.allSettled([
      load(dailyStart, today, 'daily'),
      load(hourlyStart, hourlyEnd, 'hourly'),
    ]);
    if (hourly.status === 'fulfilled') {
      trafficHours = parseNeonUsageHours(
        hourly.value.map((frame) => ({
          from: new Date(frame.from).toISOString(),
          through: new Date(frame.through).toISOString(),
          periodStart: options.periodStart,
          sampledAt: options.now.toISOString(),
          bytes: frame.values.public_network_transfer_bytes,
        })),
      );
    }
    // A failed historical query cannot erase valid hourly traffic. Conversely,
    // failed hourly collection still permits a complete previous-day cost estimate.
    if (daily.status === 'rejected') throw daily.reason;
    const dailyFrames = daily.value;
    if (today > start && (dailyFrames[0]?.from !== start || dailyFrames.at(-1)?.through !== today))
      throw new CostError('incomplete_period');
    const currentHours =
      hourly.status === 'fulfilled' ? hourly.value.filter((frame) => frame.from >= today) : [];
    if (!dailyFrames.length && !currentHours.length && hourly.status === 'rejected')
      throw hourly.reason;
    return {
      costs: calculate([...dailyFrames, ...currentHours], plan, start),
      ...(trafficHours === undefined ? {} : { trafficHours }),
    };
  } catch (error) {
    return {
      costs: unavailable(error instanceof CostError ? error.reason : 'provider_unavailable', plan),
      ...(trafficHours === undefined ? {} : { trafficHours }),
    };
  }
}

export async function fetchNeonUsageCosts(options: Options): Promise<NeonUsageCosts> {
  return (await fetchNeonUsageAccounting(options)).costs;
}
