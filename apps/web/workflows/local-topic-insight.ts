import {
  isLocalAutomationSchedulerEnabled,
  isLocalRealAutomationEnabled,
} from '../lib/local-development';
import { automationPool } from '../lib/server/automation-store-access';
import { executeTopicInsight } from '../lib/server/topic-insight-executor';
import { assertTrackedInsightTopics } from '../lib/server/insight-topics';
import { TopicInsightProviderError } from '../lib/topic-insight-provider';
import * as store from '../../../packages/database/src/automation-store.mjs';

const preflightFailures = new Set([
  'not_configured',
  'ai_not_configured',
  'not_found',
  'revision_conflict',
  'profile_not_ready',
  'insight_insufficient_evidence',
  'insight_topic_not_leaf',
  'insight_topic_not_tracked',
  'insight_input_too_large',
  'budget_exceeded',
  'connection_unavailable',
  'invalid_insight_configuration',
  'invalid_configuration',
]);

/** Workflow persists identifiers only; report and accounting stay in PostgreSQL. */
export async function runLocalTopicInsightStep(owner: string, id: string, token: string) {
  'use step';
  if (!isLocalRealAutomationEnabled()) throw new Error('execution_disabled');
  const run = await store.readAutomationRun({ pool: automationPool, owner, id });
  if (
    run.id !== id ||
    run.owner_id !== owner ||
    run.snapshot.kind !== 'topic_insight' ||
    run.status !== 'running' ||
    run.lease_token !== token ||
    !token
  )
    throw new Error('stale_attempt');
  if (
    run.trigger !== 'manual' &&
    !(run.trigger === 'scheduled' && isLocalAutomationSchedulerEnabled())
  )
    throw new Error('execution_disabled');

  // Only one invocation can cross this fence. A replay after a lost step
  // acknowledgement never calls AI or overwrites another worker's outcome.
  await store.beginTopicInsightExecution({ pool: automationPool, owner, id, token });
  let completion: Awaited<ReturnType<typeof executeTopicInsight>> | undefined;
  try {
    await assertTrackedInsightTopics(run.snapshot.topicIds);
    completion = await executeTopicInsight(owner, run);
    await store.updateAutomationRun({
      pool: automationPool,
      owner,
      id,
      token,
      phase: 'ready_for_review',
      result: { ...completion.result },
      status: 'completed',
      costMicrousd: completion.costMicrousd,
      costSource: completion.costSource,
    });
    return 'completed';
  } catch (error) {
    // A completion commit can succeed even if its acknowledgement is lost.
    // Reconcile once, preserving the successful response and any known charge.
    const latest = await store.readAutomationRun({ pool: automationPool, owner, id });
    if (latest.status !== 'running' || latest.lease_token !== token) return latest.status;
    const provider = error instanceof TopicInsightProviderError ? error : null;
    const knownPreflight =
      !completion && error instanceof Error && preflightFailures.has(error.message);
    const costMicrousd =
      completion?.costMicrousd ??
      provider?.providerCostMicrousd ??
      (knownPreflight || provider?.requestSent === false ? 0 : undefined);
    const costSource =
      completion?.costSource ??
      (provider?.providerCostMicrousd !== null && provider?.providerCostMicrousd !== undefined
        ? 'provider'
        : costMicrousd === 0
          ? 'estimate'
          : 'reserve');
    const status = completion || costMicrousd === undefined ? 'unknown' : 'failed';
    await store.updateAutomationRun({
      pool: automationPool,
      owner,
      id,
      token,
      phase: status === 'unknown' ? 'outcome_unknown' : 'failed',
      result: completion
        ? { ...completion.result }
        : {
            ...latest.result,
            ...(provider ? { providerDiagnostic: provider.diagnostic } : {}),
            ...(provider?.providerCostMicrousd !== null &&
            provider?.providerCostMicrousd !== undefined
              ? { providerCostMicrousd: provider.providerCostMicrousd }
              : {}),
          },
      status,
      errorCode: knownPreflight
        ? (error as Error).message
        : provider && status === 'failed'
          ? provider.diagnostic.code
          : 'outcome_unknown',
      ...(costMicrousd !== undefined ? { costMicrousd } : {}),
      costSource,
    });
    return status;
  }
}
// A provider request may already have been charged when acknowledgement is lost.
runLocalTopicInsightStep.maxRetries = 0;
