import 'server-only';
import { aiStageAccess } from './admin-ai';
import { getSignalEntries } from '../seed-runtime';
import { getTopicEntries } from '../content-runtime';
import { readAiBackendConfiguration } from '../admin-ai-core';
import { automationPool } from './automation-store-access';
import * as store from '../../../../packages/database/src/automation-store.mjs';
import { normalizeAutomationConfig } from '../../../../packages/database/src/automation-contract.mjs';
import {
  DiscoveryFailure,
  discoveryEstimate,
  invokeSourceDiscovery,
} from '../source-discovery-provider';

/** No URL is accepted from model memory. The paid call has an atomic one-way phase fence. */
export async function discoverSources(owner: string, id: string): Promise<string[]> {
  const run = await store.readAutomationRun({ pool: automationPool, owner, id });
  if (run.status !== 'running' || !run.lease_token) throw new Error('stale_attempt');
  const config = normalizeAutomationConfig(run.snapshot);
  if (!config.discovery) return config.sourceUrls;
  if (run.phase !== 'preparing') throw new Error('stale_attempt');
  let admitted = false;
  let receipt: Awaited<ReturnType<typeof invokeSourceDiscovery>> | undefined;
  try {
    const [access, topics, signals, previousUrls] = await Promise.all([
      aiStageAccess(config.profileId!, config.profileRevision!, 'analyze', true),
      getTopicEntries(),
      getSignalEntries(),
      store.readCollectedSourceUrls({ pool: automationPool, owner }),
    ]);
    const selected = config.topicIds.map((id) => {
      const topic = topics.find((entry) => entry.frontMatter.id === id);
      if (!topic) throw new Error('discovery_topic_invalid');
      return { id, name: topic.frontMatter.title };
    });
    if (discoveryEstimate(access) > run.reserved_microusd) throw new Error('budget_exceeded');
    const completion = await invokeSourceDiscovery({
      access,
      config,
      now: run.created_at,
      topics: selected,
      knownUrls: [
        ...previousUrls,
        ...signals.flatMap((s) => (s.public_sources ?? []).map((source) => source.url)),
      ],
      allowedHosts: readAiBackendConfiguration(process.env).allowedHosts,
      beforeCall: async () => {
        await store.beginSourceDiscovery({
          pool: automationPool,
          owner,
          id,
          token: run.lease_token!,
        });
        admitted = true;
      },
    });
    receipt = completion;
    await store.updateAutomationRun({
      pool: automationPool,
      owner,
      id,
      token: run.lease_token,
      phase: 'sources_discovered',
      result: {
        discovery: completion.result,
        discoveryCostMicrousd: completion.costMicrousd,
        discoveryCostSource: completion.costSource,
      },
    });
    return completion.result.articles.map((article) => article.url);
  } catch (error) {
    // Do not overwrite another execution's receipt when a duplicate fails its fence.
    if (error instanceof Error && error.message === 'stale_attempt') throw error;
    const called = admitted || (error instanceof DiscoveryFailure && error.called);
    const cost =
      receipt?.costMicrousd ?? (error instanceof DiscoveryFailure ? error.costMicrousd : null);
    const code =
      error instanceof Error &&
      [
        'discovery_search_unconfirmed',
        'discovery_invalid_output',
        'discovery_connection_unsupported',
        'capability_failed',
        'invalid_model',
        'provider_rejected',
        'timeout',
        'budget_exceeded',
        'discovery_topic_invalid',
        'profile_not_ready',
        'revision_conflict',
      ].includes(error.message)
        ? error.message
        : 'discovery_unavailable';
    await store.updateAutomationRun({
      pool: automationPool,
      owner,
      id,
      token: run.lease_token,
      phase: 'discovery_failed',
      result: receipt
        ? {
            discovery: receipt.result,
            discoveryCostMicrousd: receipt.costMicrousd,
            discoveryCostSource: receipt.costSource,
          }
        : {},
      status: called && cost === null ? 'unknown' : 'failed',
      errorCode: code,
      ...(cost !== null
        ? { costMicrousd: cost, costSource: receipt?.costSource ?? ('provider' as const) }
        : !called
          ? { costMicrousd: 0, costSource: 'estimate' as const }
          : {}),
    });
    throw new Error(code);
  }
}
