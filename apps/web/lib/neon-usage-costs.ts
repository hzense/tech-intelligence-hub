import { readImportBytes } from './import-io.ts';

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
  pricingVersion: '2026-11-02';
};

const day = 86_400_000;
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
    from % day !== 0 ||
    through % day !== 0 ||
    through <= from ||
    through - from > 35 * day ||
    items.length !== kinds.length ||
    !amount(value.totalMicrousd) ||
    !amount(total) ||
    total !== value.totalMicrousd
  )
    return invalid();
  return {
    status: 'estimated',
    plan,
    from: new Date(from).toISOString(),
    through: new Date(through).toISOString(),
    totalMicrousd: total,
    items,
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

function calculate(
  value: unknown,
  projectId: string,
  plan: 'launch' | 'scale',
  from: number,
  through: number,
): NeonUsageCosts {
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
  const frames = new Map<number, Record<Metric, number>>();
  for (const period of project.periods) {
    if (!record(period)) throw new CostError('invalid_metrics');
    const periodStart = timestamp(period.period_start);
    if (period.period_plan !== plan || !Number.isFinite(periodStart) || periodStart > from)
      throw new CostError('unsupported_plan');
    if (!Array.isArray(period.consumption) || period.consumption.length > 35)
      throw new CostError('invalid_metrics');
    for (const frame of period.consumption) {
      if (!record(frame)) throw new CostError('invalid_metrics');
      const start = timestamp(frame.timeframe_start),
        end = timestamp(frame.timeframe_end);
      if (
        !Number.isFinite(start) ||
        start % day !== 0 ||
        end - start !== day ||
        start < from ||
        end > through ||
        frames.has(start) ||
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
      frames.set(start, values);
    }
  }
  if (frames.size !== (through - from) / day) throw new CostError('incomplete_period');
  const sum = (metric: Metric) => {
    const total = [...frames.values()].reduce((value, frame) => value + frame[metric], 0);
    if (!Number.isFinite(total) || total > Number.MAX_SAFE_INTEGER)
      throw new CostError('invalid_metrics');
    return total;
  };
  const dollars: Record<NeonUsageCostKind, number> = {
    compute: (sum('compute_unit_seconds') / 3600) * (plan === 'launch' ? 0.106 : 0.222),
    storage: ((sum('root_branch_bytes_month') + sum('child_branch_bytes_month')) / 1e9) * 0.35,
    history: (sum('instant_restore_bytes_month') / 1e9) * 0.2,
    snapshots: (sum('snapshot_storage_bytes_month') / 1e9) * 0.09,
    publicTransfer: Math.max(0, sum('public_network_transfer_bytes') / 1e9 - 500) * 0.1,
    privateTransfer: (sum('private_network_transfer_bytes') / 1e9) * 0.01,
    branches:
      ([...frames.values()].reduce(
        (total, frame) =>
          total + Math.max(0, frame.extra_branches_month - (plan === 'launch' ? 9 : 24) * 24),
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
    reason: null,
    pricingVersion,
  });
}

/**
 * Published database rates, not an invoice. Excludes Functions, Auth, discounts,
 * taxes and organization-level minimums; daily branch allowances may understate
 * hourly billing. Requires a UTC-midnight period start; the current UTC day is excluded.
 * Free describes the current plan, not historical paid charges.
 * Sources: neon.com/docs/introduction/usage-calculations and
 * neon.com/docs/guides/consumption-metrics (2026-11-02).
 */
export async function fetchNeonUsageCosts(options: {
  projectId: string;
  orgId: unknown;
  periodStart: string;
  periodEnd: string;
  now: Date;
  apiKey: string;
  fetcher?: typeof fetch;
}): Promise<NeonUsageCosts> {
  if (typeof options.orgId !== 'string' || !/^[a-z0-9-]{1,60}$/.test(options.orgId))
    return unavailable('missing_org');
  if (
    !/^[a-z0-9][a-z0-9-]{2,99}$/.test(options.projectId) ||
    !options.apiKey ||
    options.apiKey.length > 512 ||
    /[^\x21-\x7e]/.test(options.apiKey)
  )
    return unavailable('provider_unavailable');
  let plan: NeonUsageCosts['plan'] = null;
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
      return parseNeonUsageCosts({
        ...unavailable('missing_org', plan),
        status: 'free',
        totalMicrousd: 0,
        reason: null,
      });
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
    // Omitting an initial partial day would incorrectly restart the 500 GB allowance.
    if (start % day !== 0) throw new CostError('incomplete_period');
    const from = Math.ceil(start / day) * day,
      through = Math.floor(now / day) * day;
    if (through <= from) throw new CostError('waiting_data');
    const query = new URLSearchParams({
      org_id: options.orgId,
      project_ids: options.projectId,
      limit: '1',
      from: new Date(from).toISOString(),
      to: new Date(through).toISOString(),
      granularity: 'daily',
      metrics: metrics.join(','),
    });
    const data = await providerJSON(
      `https://console.neon.tech/api/v2/consumption_history/v2/projects?${query}`,
      options.apiKey,
      fetcher,
    );
    return calculate(data, options.projectId, plan, from, through);
  } catch (error) {
    return unavailable(error instanceof CostError ? error.reason : 'provider_unavailable', plan);
  }
}
