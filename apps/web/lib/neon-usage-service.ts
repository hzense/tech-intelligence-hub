import {
  NeonUsageError,
  appendNeonUsageSample,
  parseNeonUsageSample,
  neonUsageSampleInterval,
  neonUsageProjectId,
  type NeonUsageHistory,
} from './neon-usage-core.ts';
import { readImportBytes } from './import-io.ts';
import { fetchNeonUsageCosts } from './neon-usage-costs.ts';

export interface NeonUsageStore {
  read(): Promise<{ history: NeonUsageHistory; version: string } | null>;
  compareAndSwap(history: NeonUsageHistory, version: string | null): Promise<boolean>;
}

/** Fixed origin/path, no redirects, bounded body; the API key never reaches the browser or Blob. */
export async function fetchNeonUsage(
  projectId: string,
  apiKey: string,
  now: Date,
  fetcher = fetch,
) {
  if (
    !neonUsageProjectId(projectId) ||
    !apiKey ||
    apiKey.length > 512 ||
    /[^\x21-\x7e]/.test(apiKey)
  )
    throw new NeonUsageError('not_configured');
  let response: Response;
  try {
    response = await fetcher(
      `https://console.neon.tech/api/v2/projects/${encodeURIComponent(projectId)}`,
      {
        headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
        redirect: 'error',
        cache: 'no-store',
        signal: AbortSignal.timeout(10_000),
      },
    );
  } catch {
    throw new NeonUsageError('provider_unavailable');
  }
  if (!response.ok) {
    void response.body?.cancel().catch(() => {});
    if (response.status === 401 || response.status === 403)
      throw new NeonUsageError('provider_unauthorized');
    if (response.status === 404) throw new NeonUsageError('project_not_found');
    if (response.status === 429) throw new NeonUsageError('provider_rate_limited');
    throw new NeonUsageError('provider_unavailable');
  }
  try {
    const value = JSON.parse(
      (await readImportBytes(response.body, 262_144, 10_000)).toString('utf8'),
    );
    const sample = parseNeonUsageSample(value, projectId, now);
    // Cost collection is optional and independent from the traffic counter.
    // Older project responses without an organization remain readable.
    if (typeof value.project.org_id === 'string') {
      sample.costs = await fetchNeonUsageCosts({
        projectId,
        orgId: value.project.org_id,
        periodStart: sample.periodStart,
        periodEnd: sample.periodEnd,
        now,
        apiKey,
        fetcher,
      }).catch(() => ({
        status: 'unavailable' as const,
        plan: null,
        from: null,
        through: null,
        totalMicrousd: null,
        items: [],
        reason: 'provider_unavailable' as const,
        pricingVersion: '2026-11-02' as const,
      }));
    }
    return sample;
  } catch {
    throw new NeonUsageError('invalid_metrics');
  }
}

export async function sampleNeonUsage(options: {
  projectId: string;
  apiKey: string;
  store: NeonUsageStore;
  now?: () => Date;
  fetcher?: typeof fetch;
}): Promise<'sampled' | 'recent'> {
  const now = (options.now ?? (() => new Date()))();
  let saved = await options.store.read();
  const recent = (history: NeonUsageHistory | undefined) => {
    const latest = history?.samples.at(-1);
    return (
      latest &&
      Date.parse(latest.periodEnd) > now.getTime() &&
      Date.parse(latest.sampledAt) <= now.getTime() &&
      now.getTime() - Date.parse(latest.sampledAt) < neonUsageSampleInterval
    );
  };
  if (recent(saved?.history)) return 'recent';
  const sample = await fetchNeonUsage(options.projectId, options.apiKey, now, options.fetcher);
  const bucket = Math.floor(Date.parse(sample.sampledAt) / neonUsageSampleInterval);
  // A later-starting request may finish first. Its timestamp is ahead of this
  // request's clock, but an occupied identical slot still means first-write wins.
  const alreadySampled = (history: NeonUsageHistory | undefined) =>
    recent(history) ||
    history?.samples.some(
      (savedSample) =>
        Math.floor(Date.parse(savedSample.sampledAt) / neonUsageSampleInterval) === bucket,
    );
  if (alreadySampled(saved?.history)) return 'recent';
  for (let attempt = 0; attempt < 3; attempt++) {
    const history = appendNeonUsageSample(
      saved?.history ?? {
        version: 1,
        projectId: options.projectId,
        samples: [],
      },
      sample,
    );
    if (await options.store.compareAndSwap(history, saved?.version ?? null)) return 'sampled';
    saved = await options.store.read();
    if (alreadySampled(saved?.history)) return 'recent';
  }
  throw new NeonUsageError('storage_conflict');
}
