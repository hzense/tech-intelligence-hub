/** Read-only accounting summary. This never reconciles tasks or invokes a provider. */
export type AiUsageCostKind = 'generation' | 'enrichment' | 'collection' | 'insight' | 'probe';
export interface AiUsageAmounts {
  /** Settled ledger amounts, including estimates; not a supplier invoice. */
  chargedMicrousd: number;
  /** Unsettled exposure, kept separate even when a legacy row copied it into charged. */
  unsettledMicrousd: number;
}
export interface AiUsageCostItem {
  kind: AiUsageCostKind;
  scope: 'owner' | 'site';
  status: 'available' | 'unavailable';
  today: AiUsageAmounts | null;
  monthToDate: AiUsageAmounts | null;
}
export interface AiUsageCosts {
  sampledAt: string;
  day: string;
  month: string;
  status: 'available' | 'partial' | 'unavailable';
  items: AiUsageCostItem[];
  today: AiUsageAmounts | null;
  monthToDate: AiUsageAmounts | null;
}
export interface AiUsagePool {
  connect(): Promise<{
    query(text: string, values?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
    release(destroy?: boolean): void;
  }>;
}
export interface AiUsagePools {
  generation?: AiUsagePool;
  enrichment?: AiUsagePool;
  automation?: AiUsagePool;
  probe?: AiUsagePool;
}

// Generation/enrichment did not persist provider-vs-estimate provenance. Their
// completed/failed ledger amount is therefore only labelled "booked, incl.
// estimates". Unknown/cancelled calls may still have charged=full reservation.
const generationSettled = "status IN ('completed','failed')";
// Probe INSERT already copies reserved into charged before any external call.
// A stale result is settled only if the finishing path persisted accounting.
const probeSettled = `(status IN ('succeeded','failed') OR (status='stale' AND
  result->'accounting' IN ('{"version":1,"source":"provider"}'::jsonb,
    '{"version":1,"source":"estimate"}'::jsonb,
    '{"version":1,"source":"request_rejected"}'::jsonb)))`;
// Match the existing source-discovery budget exception exactly: the downstream
// task may be unknown although its one discovery call has a settled receipt.
const automationSettled = `((status IN ('completed','failed') AND cost_source IN ('provider','estimate')) OR (
  status='unknown' AND phase='source_failed'
  AND snapshot->>'kind'='source_collection'
  AND jsonb_typeof(snapshot->'discovery')='object'
  AND lease_token IS NULL AND lease_until IS NULL AND finished_at IS NOT NULL
  AND cost_source='provider' AND result->>'discoveryCostSource'='provider'
  AND jsonb_typeof(result->'discoveryCostMicrousd')='number'
  AND charged_microusd>=0
  AND result->'discoveryCostMicrousd'=to_jsonb(charged_microusd)))`;

function accountingQuery(kind: AiUsageCostKind): string {
  const probe = kind === 'probe';
  const automation = kind === 'collection' || kind === 'insight';
  // All SQL identifiers and kind literals come from this closed internal map.
  const table = probe
    ? 'ai_probe_runs'
    : automation
      ? 'automation_runs'
      : kind === 'generation'
        ? 'signal_generation_runs'
        : 'candidate_enrichment_runs';
  const settled = probe ? probeSettled : automation ? automationSettled : generationSettled;
  const day = probe ? "(created_at AT TIME ZONE 'UTC')::date" : 'budget_day';
  const where = probe
    ? "created_at >= ($2::date::timestamp AT TIME ZONE 'UTC') AND created_at <= $3::timestamptz"
    : `owner_id=$4 AND budget_day >= $2::date AND budget_day <= ($3::timestamptz AT TIME ZONE 'UTC')::date${
        kind === 'generation'
          ? " AND generation_version !~ '^local-simulation-v1(/retry/[0-9a-f-]{36})?$'"
          : automation
            ? ` AND snapshot->>'kind'='${kind === 'collection' ? 'source_collection' : 'topic_insight'}'`
            : ''
      }`;
  return `/* ai-usage:${kind} */ WITH ledger AS (
    SELECT ${day} AS day,
      CASE WHEN ${settled} THEN charged_microusd ELSE 0 END AS charged,
      CASE WHEN ${settled} THEN 0 ELSE GREATEST(reserved_microusd,charged_microusd) END AS unsettled
    FROM public.${table} WHERE ${where}
  ) SELECT
    COALESCE(sum(charged) FILTER (WHERE day=$1::date),0)::text AS today_charged,
    COALESCE(sum(unsettled) FILTER (WHERE day=$1::date),0)::text AS today_unsettled,
    COALESCE(sum(charged),0)::text AS month_charged,
    COALESCE(sum(unsettled),0)::text AS month_unsettled
  FROM ledger`;
}

function microusd(value: unknown): number {
  // PostgreSQL SUM(bigint) is numeric/text. Never silently round a large total.
  if (typeof value !== 'string' || !/^(0|[1-9]\d{0,15})$/.test(value)) throw Error();
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) throw Error();
  return number;
}
function amounts(row: Record<string, unknown>, prefix: 'today' | 'month'): AiUsageAmounts {
  return {
    chargedMicrousd: microusd(row[`${prefix}_charged`]),
    unsettledMicrousd: microusd(row[`${prefix}_unsettled`]),
  };
}
function sum(items: AiUsageCostItem[], field: 'today' | 'monthToDate'): AiUsageAmounts | null {
  const values = items.flatMap((item) => (item[field] ? [item[field]!] : []));
  if (!values.length) return null;
  const result = values.reduce(
    (total, value) => ({
      chargedMicrousd: total.chargedMicrousd + value.chargedMicrousd,
      unsettledMicrousd: total.unsettledMicrousd + value.unsettledMicrousd,
    }),
    { chargedMicrousd: 0, unsettledMicrousd: 0 },
  );
  return Object.values(result).every(Number.isSafeInteger) ? result : null;
}

export async function readAiUsageCosts(options: {
  owner: string;
  now?: Date;
  pools: AiUsagePools;
}): Promise<AiUsageCosts> {
  const now = options.now ?? new Date();
  const sampledAt = now.toISOString();
  const day = sampledAt.slice(0, 10);
  const month = day.slice(0, 7);
  const validOwner =
    typeof options.owner === 'string' &&
    options.owner.length > 0 &&
    options.owner.length <= 320 &&
    options.owner === options.owner.trim();
  const items: AiUsageCostItem[] = [];
  const kinds: AiUsageCostKind[] = ['generation', 'enrichment', 'collection', 'insight', 'probe'];
  const groups = new Map<AiUsagePool, AiUsageCostItem[]>();
  for (const kind of kinds) {
    const item: AiUsageCostItem = {
      kind,
      scope: kind === 'probe' ? 'site' : 'owner',
      status: 'unavailable',
      today: null,
      monthToDate: null,
    };
    items.push(item);
    const pool =
      kind === 'collection' || kind === 'insight' ? options.pools.automation : options.pools[kind];
    if (!pool || !validOwner) continue;
    const group = groups.get(pool) ?? [];
    group.push(item);
    groups.set(pool, group);
  }
  // Same-pool categories are sequential (max:1); independent guarded connections
  // run concurrently so one unavailable service cannot stall every ledger.
  // Only aggregates cross the DB boundary: no snapshots, credentials or raw errors.
  async function readItem(pool: AiUsagePool, item: AiUsageCostItem) {
    const { kind } = item;
    let client: Awaited<ReturnType<AiUsagePool['connect']>> | undefined;
    let destroy = false;
    try {
      client = await pool.connect();
      await client.query('BEGIN TRANSACTION READ ONLY');
      await client.query("SET LOCAL statement_timeout = '5000ms'");
      const values = [day, `${month}-01`, sampledAt, ...(kind === 'probe' ? [] : [options.owner])];
      const { rows } = await client.query(accountingQuery(kind), values);
      if (rows.length !== 1) throw Error();
      const today = amounts(rows[0]!, 'today');
      const monthToDate = amounts(rows[0]!, 'month');
      if (
        today.chargedMicrousd > monthToDate.chargedMicrousd ||
        today.unsettledMicrousd > monthToDate.unsettledMicrousd
      )
        throw Error();
      await client.query('COMMIT');
      Object.assign(item, { status: 'available', today, monthToDate });
    } catch {
      if (client)
        await client.query('ROLLBACK').catch(() => {
          destroy = true;
        });
    } finally {
      client?.release(destroy);
    }
  }
  await Promise.allSettled(
    [...groups].map(async ([pool, group]) => {
      for (const item of group) await readItem(pool, item);
    }),
  );
  const today = sum(items, 'today');
  const monthToDate = sum(items, 'monthToDate');
  const available = items.filter((item) => item.status === 'available').length;
  return {
    sampledAt,
    day,
    month,
    status:
      available === 0
        ? 'unavailable'
        : available === kinds.length && today !== null && monthToDate !== null
          ? 'available'
          : 'partial',
    items,
    today,
    monthToDate,
  };
}
