/** Approximate control-plane counters; never database traffic or invoice metering. */
import { parseNeonUsageCosts, type NeonUsageCosts } from './neon-usage-costs.ts';
import type { AiUsageCosts } from './ai-usage-costs';

export const neonUsageTimezone = 'Europe/Berlin' as const;
export const neonUsageRetentionDays = 60;
export const neonUsageSampleInterval = 15 * 60_000;
export const neonUsageHistoryLimit = 6000;
export const neonUsageByteLimit = 8_000_000;
const hour = 3_600_000;
const day = 24 * hour;

export type NeonUsageSample = {
  sampledAt: string;
  periodStart: string;
  periodEnd: string;
  bytes: number;
  costs?: NeonUsageCosts;
};
export type NeonUsageHistory = { version: 1; projectId: string; samples: NeonUsageSample[] };
export type NeonUsageDay = {
  date: string;
  bytes: number | null;
  status: 'estimated' | 'partial' | 'missing';
  samples: number;
};
export type NeonUsageDashboard = {
  configured: boolean;
  missing: string[];
  available: boolean;
  error: string | null;
  sampledAt: string | null;
  stale: boolean;
  projectId: string | null;
  timezone: typeof neonUsageTimezone;
  totalBytes: number | null;
  quotaBytes: number | null;
  quotaPercent: number | null;
  alert: 'none' | 'warning' | 'critical';
  periodStart: string | null;
  periodEnd: string | null;
  days: NeonUsageDay[];
  historyDays: number;
  costs: NeonUsageCosts | null;
  costSampledAt: string | null;
  /** Per-admin live ledger summary; never persisted with shared Neon samples. */
  aiCosts?: AiUsageCosts;
};
export class NeonUsageError extends Error {
  readonly code:
    | 'not_configured'
    | 'provider_unauthorized'
    | 'project_not_found'
    | 'provider_rate_limited'
    | 'provider_unavailable'
    | 'invalid_metrics'
    | 'storage_unavailable'
    | 'storage_conflict';
  constructor(code: NeonUsageError['code']) {
    super(code);
    this.code = code;
  }
}
export function neonUsageProjectId(value: unknown): value is string {
  return typeof value === 'string' && /^[a-z0-9][a-z0-9-]{2,99}$/.test(value);
}
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function timestamp(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length <= 40 &&
    /^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value) &&
    Number.isFinite(Date.parse(value))
  );
}
function validSample(value: unknown): value is NeonUsageSample {
  if (
    !record(value) ||
    !timestamp(value.sampledAt) ||
    !timestamp(value.periodStart) ||
    !timestamp(value.periodEnd) ||
    !Number.isSafeInteger(value.bytes) ||
    Number(value.bytes) < 0
  )
    return false;
  const start = Date.parse(value.periodStart),
    end = Date.parse(value.periodEnd);
  const observed = Date.parse(value.sampledAt);
  return start < end && end - start <= 35 * day && observed >= start && observed < end;
}
export function parseNeonUsageSample(
  value: unknown,
  projectId: string,
  now: Date,
): NeonUsageSample {
  if (!record(value) || !record(value.project) || value.project.id !== projectId)
    throw new NeonUsageError('invalid_metrics');
  const project = value.project;
  const sample = {
    sampledAt: now.toISOString(),
    periodStart: project.consumption_period_start,
    periodEnd: project.consumption_period_end,
    bytes: project.data_transfer_bytes,
  };
  if (!validSample(sample)) throw new NeonUsageError('invalid_metrics');
  // Whitelist fields: never persist the rest of a project response (roles/settings/owner).
  return {
    sampledAt: sample.sampledAt,
    periodStart: new Date(sample.periodStart).toISOString(),
    periodEnd: new Date(sample.periodEnd).toISOString(),
    bytes: sample.bytes,
  };
}
export function parseNeonUsageHistory(value: unknown, projectId: string): NeonUsageHistory {
  if (
    !record(value) ||
    value.version !== 1 ||
    value.projectId !== projectId ||
    !Array.isArray(value.samples) ||
    value.samples.length > neonUsageHistoryLimit ||
    !value.samples.every(validSample)
  )
    throw new NeonUsageError('storage_unavailable');
  return {
    version: 1,
    projectId,
    samples: value.samples
      .map((s) => ({
        sampledAt: s.sampledAt,
        periodStart: s.periodStart,
        periodEnd: s.periodEnd,
        bytes: s.bytes,
        ...(s.costs === undefined ? {} : { costs: storedCosts(s.costs) }),
      }))
      .sort((a, b) => Date.parse(a.sampledAt) - Date.parse(b.sampledAt)),
  };
}
function storedCosts(value: unknown): NeonUsageCosts {
  try {
    return parseNeonUsageCosts(value);
  } catch {
    throw new NeonUsageError('storage_unavailable');
  }
}
export function appendNeonUsageSample(
  history: NeonUsageHistory,
  sample: NeonUsageSample,
): NeonUsageHistory {
  const cutoff = Date.parse(sample.sampledAt) - neonUsageRetentionDays * day;
  const samples = history.samples.filter((s) => Date.parse(s.sampledAt) >= cutoff);
  // A stable 15-minute bucket bounds storage even under concurrent manual/cron requests.
  const bucket = Math.floor(Date.parse(sample.sampledAt) / neonUsageSampleInterval);
  if (
    !samples.some((s) => Math.floor(Date.parse(s.sampledAt) / neonUsageSampleInterval) === bucket)
  )
    samples.push(sample);
  samples.sort((a, b) => Date.parse(a.sampledAt) - Date.parse(b.sampledAt));
  return {
    version: 1,
    projectId: history.projectId,
    samples: samples.slice(-neonUsageHistoryLimit),
  };
}
const formatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: neonUsageTimezone,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});
export function berlinUsageDate(now: Date): string {
  const parts = formatter.formatToParts(now);
  return ['year', 'month', 'day']
    .map((type) => parts.find((p) => p.type === type)!.value)
    .join('-');
}
/** Calendar midnight, including Berlin's 23/25-hour DST days. */
export function berlinUsageMidnight(date: string): number {
  const utc = Date.parse(`${date}T00:00:00Z`);
  for (const offset of [1, 2]) {
    const candidate = utc - offset * hour;
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: neonUsageTimezone,
      hour: '2-digit',
      hourCycle: 'h23',
    }).format(new Date(candidate));
    if (parts === '00' && berlinUsageDate(new Date(candidate)) === date) return candidate;
  }
  throw new NeonUsageError('invalid_metrics');
}
function shiftDate(date: string, offset: number) {
  return new Date(Date.parse(`${date}T12:00:00Z`) + offset * day).toISOString().slice(0, 10);
}
function samePeriod(a: NeonUsageSample, b: NeonUsageSample) {
  return a.periodStart === b.periodStart && a.periodEnd === b.periodEnd;
}
export function neonUsageDays(history: NeonUsageHistory | null, now: Date): NeonUsageDay[] {
  const today = berlinUsageDate(now);
  const samples = (history?.samples ?? []).filter((s) => Date.parse(s.sampledAt) <= now.getTime());
  const nearest = (target: number) =>
    samples.reduce<NeonUsageSample | undefined>((best, s) => {
      const distance = Math.abs(Date.parse(s.sampledAt) - target);
      return distance <= 1.5 * hour &&
        (!best || distance < Math.abs(Date.parse(best.sampledAt) - target))
        ? s
        : best;
    }, undefined);
  return Array.from({ length: 30 }, (_, index) => {
    const date = shiftDate(today, index - 29);
    const start = berlinUsageMidnight(date);
    const end = Math.min(berlinUsageMidnight(shiftDate(date, 1)), now.getTime());
    const inside = samples.filter(
      (s) => Date.parse(s.sampledAt) >= start && Date.parse(s.sampledAt) <= end,
    );
    const first = nearest(start) ?? inside[0];
    const last = nearest(end) ?? inside.at(-1);
    if (!first || !last || Date.parse(last.sampledAt) <= Date.parse(first.sampledAt))
      return {
        date,
        bytes: null,
        status: inside.length ? 'partial' : 'missing',
        samples: inside.length,
      };
    const range = samples.filter(
      (s) =>
        Date.parse(s.sampledAt) >= Date.parse(first.sampledAt) &&
        Date.parse(s.sampledAt) <= Date.parse(last.sampledAt),
    );
    let bytes = 0,
      valid = 0;
    let corrected = false;
    let complete = Boolean(nearest(start) && nearest(end));
    for (let i = 1; i < range.length; i++) {
      const previous = range[i - 1]!,
        current = range[i]!;
      const gap = Date.parse(current.sampledAt) - Date.parse(previous.sampledAt);
      if (samePeriod(previous, current) && current.bytes < previous.bytes) corrected = true;
      if (!samePeriod(previous, current) || current.bytes < previous.bytes || gap > 3 * hour) {
        complete = false;
        continue; // Never assign a multi-day gap or a counter reset to one day's traffic.
      }
      bytes += current.bytes - previous.bytes;
      valid++;
    }
    return {
      date,
      bytes: valid && !corrected ? bytes : null,
      status: complete && valid && !corrected ? 'estimated' : 'partial',
      samples: inside.length,
    };
  });
}
export function makeNeonUsageDashboard(options: {
  history: NeonUsageHistory | null;
  now: Date;
  missing?: string[];
  error?: string | null;
  projectId: string | null;
  quotaBytes?: number | null;
}): NeonUsageDashboard {
  const samples = (options.history?.samples ?? []).filter(
    (s) => Date.parse(s.sampledAt) <= options.now.getTime(),
  );
  const latest = samples.at(-1);
  const currentPeriod = latest && Date.parse(latest.periodEnd) > options.now.getTime();
  const totalBytes = currentPeriod ? latest.bytes : null;
  const quotaBytes = options.quotaBytes ?? null;
  const quotaPercent = quotaBytes && totalBytes !== null ? (totalBytes / quotaBytes) * 100 : null;
  return {
    configured: !options.missing?.length,
    missing: options.missing ?? [],
    available: !options.error,
    error: options.error ?? null,
    projectId: options.projectId,
    sampledAt: latest?.sampledAt ?? null,
    stale:
      !latest || !currentPeriod || options.now.getTime() - Date.parse(latest.sampledAt) > 3 * hour,
    totalBytes,
    quotaBytes,
    quotaPercent,
    alert:
      quotaPercent !== null && quotaPercent >= 90
        ? 'critical'
        : quotaPercent !== null && quotaPercent >= 80
          ? 'warning'
          : 'none',
    periodStart: latest?.periodStart ?? null,
    periodEnd: latest?.periodEnd ?? null,
    timezone: neonUsageTimezone,
    days: neonUsageDays(options.history, options.now),
    historyDays: neonUsageRetentionDays,
    costs: currentPeriod ? (latest.costs ?? null) : null,
    costSampledAt: currentPeriod && latest.costs ? latest.sampledAt : null,
  };
}
