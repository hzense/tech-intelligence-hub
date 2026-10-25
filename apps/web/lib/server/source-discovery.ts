import 'server-only';
import { resolve } from 'node:path';
import { loadTaxonomy } from '@hzense/content';
import { aiStageAccess } from './admin-ai';
import { getSignalEntries } from '../seed-runtime';
import { discoveryTopics } from '../source-discovery-core';
import { unavailableDiscoveryTopics } from '../source-discovery-topics';
import { editorialTopicOptions } from './editorial-topics';
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
  let missingTopics: Array<{ id: string; name: string }> = [];
  let receipt: Awaited<ReturnType<typeof invokeSourceDiscovery>> | undefined;
  try {
    const [access, taxonomy, signals, previousUrls, publishableTopics] = await Promise.all([
      aiStageAccess(config.profileId!, config.profileRevision!, 'analyze', true),
      loadTaxonomy(resolve(process.cwd(), '../../data/taxonomy/taxonomy.yaml')),
      getSignalEntries(),
      store.readCollectedSourceUrls({ pool: automationPool, owner }),
      editorialTopicOptions(),
    ]);
    const selected = discoveryTopics(config.topicIds, taxonomy.topics);
    // Do not pay to discover a domain that generation/publication cannot classify.
    // Keep the complete requested scope; a stale database projection must be synced,
    // not silently replaced by the narrower enabled catalog.
    missingTopics = unavailableDiscoveryTopics(selected, publishableTopics);
    if (missingTopics.length) throw new Error('discovery_topics_not_ready');
    if (discoveryEstimate(access) > run.reserved_microusd) throw new Error('budget_exceeded');
    const completion = await invokeSourceDiscovery({
      access,
      config,
      now: run.created_at,
      topics: selected,
      publicKnownUrls: signals.flatMap((s) => (s.public_sources ?? []).map((source) => source.url)),
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
    // A nonempty response with no valid articles is a validation failure, not
    // an empty search. Valid but already-collected sources remain a normal
    // no-new-sources outcome. Keep the paid receipt before throwing so the
    // failure path persists item diagnostics and settles the original charge.
    if (
      completion.result.articles.length === 0 &&
      completion.result.rejected > 0 &&
      completion.result.duplicates === 0
    )
      throw new Error('discovery_all_sources_rejected');
    await store.updateAutomationRun({
      pool: automationPool,
      owner,
      id,
      token: run.lease_token,
      phase: 'sources_discovered',
      result: {
        discovery: completion.result,
        discoveryDiagnostics: completion.diagnostics,
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
    // Only a typed HTTP refusal is known not to have been admitted. A generic
    // provider_rejected string also covered 5xx historically and is not proof.
    // Keep any actual provider charge; policy-zero is not a provider receipt.
    const rejectedHttpStatus =
      cost === null && error instanceof DiscoveryFailure ? error.rejectedHttpStatus : undefined;
    const rejectedWithoutCharge = rejectedHttpStatus !== undefined;
    const code =
      error instanceof Error &&
      [
        'discovery_search_unconfirmed',
        'discovery_invalid_output',
        'discovery_provider_error',
        'discovery_output_truncated',
        'discovery_input_too_large',
        'discovery_all_sources_rejected',
        'discovery_connection_unsupported',
        'capability_failed',
        'invalid_model',
        'provider_rejected',
        'timeout',
        'budget_exceeded',
        'discovery_topic_invalid',
        'discovery_topics_not_ready',
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
      phase: rejectedWithoutCharge ? 'discovery_rejected' : 'discovery_failed',
      result: {
        ...(missingTopics.length ? { discoveryMissingTopics: missingTopics } : {}),
        ...(receipt
          ? {
              discovery: receipt.result,
              discoveryDiagnostics: receipt.diagnostics,
              discoveryCostMicrousd: receipt.costMicrousd,
              discoveryCostSource: receipt.costSource,
            }
          : error instanceof DiscoveryFailure && error.diagnostics
            ? { discoveryDiagnostics: error.diagnostics }
            : {}),
        ...(rejectedWithoutCharge
          ? {
              discoveryRejection: {
                version: 1,
                httpStatus: rejectedHttpStatus,
                accounting: 'request_rejected',
              },
            }
          : {}),
      },
      status: called && cost === null && !rejectedWithoutCharge ? 'unknown' : 'failed',
      errorCode: code,
      ...(cost !== null
        ? { costMicrousd: cost, costSource: receipt?.costSource ?? ('provider' as const) }
        : !called || rejectedWithoutCharge
          ? { costMicrousd: 0, costSource: 'estimate' as const }
          : {}),
    });
    throw new Error(code);
  }
}
