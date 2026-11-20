/** Whitelisted provider hour buckets, shared once per history instead of per sample. */
export type NeonUsageHour = {
  from: string;
  through: string;
  periodStart: string;
  sampledAt: string;
  bytes: number;
};

const hour = 3_600_000;
export const neonUsageHourLimit = 1500;

export function parseNeonUsageHours(value: unknown): NeonUsageHour[] {
  if (!Array.isArray(value) || value.length > neonUsageHourLimit)
    throw new Error('invalid_metrics');
  const seen = new Set<string>();
  return value
    .map((item) => {
      if (!item || typeof item !== 'object' || Array.isArray(item))
        throw new Error('invalid_metrics');
      const dates = ['from', 'through', 'periodStart', 'sampledAt'] as const;
      for (const key of dates) {
        if (
          typeof item[key] !== 'string' ||
          item[key].length > 40 ||
          !/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(item[key]) ||
          !Number.isFinite(Date.parse(item[key]))
        )
          throw new Error('invalid_metrics');
      }
      const from = Date.parse(item.from),
        through = Date.parse(item.through);
      const periodStart = Date.parse(item.periodStart),
        sampledAt = Date.parse(item.sampledAt);
      const key = `${periodStart}:${from}`;
      if (
        !Number.isSafeInteger(item.bytes) ||
        item.bytes < 0 ||
        through <= from ||
        through - from > hour ||
        through % hour !== 0 ||
        (from % hour !== 0 && from !== periodStart) ||
        from < periodStart ||
        through > sampledAt ||
        seen.has(key)
      )
        throw new Error('invalid_metrics');
      seen.add(key);
      return {
        from: new Date(from).toISOString(),
        through: new Date(through).toISOString(),
        periodStart: new Date(periodStart).toISOString(),
        sampledAt: new Date(sampledAt).toISOString(),
        bytes: item.bytes,
      };
    })
    .sort((a, b) => Date.parse(a.from) - Date.parse(b.from));
}

export function mergeNeonUsageHours(
  previous: NeonUsageHour[],
  incoming: NeonUsageHour[],
  now: Date,
): NeonUsageHour[] {
  const cutoff = now.getTime() - 60 * 24 * hour;
  const merged = new Map<string, NeonUsageHour>();
  for (const item of [...previous, ...incoming]) {
    if (Date.parse(item.through) < cutoff) continue;
    const key = `${item.periodStart}:${item.from}`;
    const existing = merged.get(key);
    if (!existing || Date.parse(item.sampledAt) > Date.parse(existing.sampledAt))
      merged.set(key, item);
  }
  return [...merged.values()]
    .sort((a, b) => Date.parse(a.from) - Date.parse(b.from))
    .slice(-neonUsageHourLimit);
}
