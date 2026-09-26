import 'server-only';
import { aiStageAccess } from './admin-ai';
import { readAiBackendConfiguration } from '../admin-ai-core';
import { readTaskPublicSignals } from './task-public-signals';
import { insightInput, selectInsightSignals, type TopicInsightResult } from '../topic-insight-core';
import { insightRules, invokeTopicInsight } from '../topic-insight-provider';
import { estimateGenerationTokens } from '../../../../packages/ingestion/src/signal-generation-contract.mjs';
import { generationCost } from '../signal-generation-core';
import { freezeAutomationInputs } from './automation-store-access';

interface InsightRun {
  id: string;
  owner_id: string;
  created_at: string | Date;
  lease_token: string | null;
  reserved_microusd: number;
  config_snapshot: { topicIds: string[]; profileId: string | null; profileRevision: number | null };
}
/** Invoked only by the claimed automation worker; no HTTP or page may invoke AI directly. */
export async function executeTopicInsight(owner: string, run: InsightRun) {
  if (owner !== run.owner_id || process.env.HZENSE_AUTOMATION_ENABLED !== '1')
    throw new Error('not_configured');
  const config = run.config_snapshot;
  if (!config.profileId || !config.profileRevision) throw new Error('profile_not_ready');
  const input = selectInsightSignals(
    await readTaskPublicSignals(),
    config.topicIds,
    new Date(run.created_at),
  );
  if (input.signals.length < 2) throw new Error('insight_insufficient_evidence');
  const access = await aiStageAccess(config.profileId, config.profileRevision, 'analyze', true);
  const stage = access.profile.stages.analyze;
  const prompt = JSON.stringify({
    windowStart: input.windowStart,
    windowEnd: input.windowEnd,
    topicIds: config.topicIds,
    untrusted_signals: input.signals.map((s) => ({
      id: s.id,
      title: s.title,
      summary: s.summary,
      analysis: s.analysis ?? '',
      occurred_at: s.occurred_at,
      topics: s.topics,
      people: s.public_people ?? [],
      organizations: s.public_organizations ?? [],
      sources: s.public_sources ?? [],
    })),
  });
  const inputTokens =
    estimateGenerationTokens(prompt) + estimateGenerationTokens(insightRules + stage.prompt) + 2048;
  if (inputTokens > 100000) throw new Error('insight_input_too_large');
  const estimate = generationCost(
    inputTokens,
    Math.min(stage.max_output_tokens, 8192),
    access.connection.settings,
  );
  if (!Number.isSafeInteger(run.reserved_microusd) || estimate > run.reserved_microusd)
    throw new Error('budget_exceeded');
  if (!access.apiKey) throw new Error('connection_unavailable');
  if (!run.lease_token) throw new Error('stale_attempt');
  const frozenInputs = input.signals.map(insightInput);
  await freezeAutomationInputs(owner, run.id, run.lease_token, {
    inputs: frozenInputs,
    windowStart: input.windowStart,
    windowEnd: input.windowEnd,
    topicIds: config.topicIds,
  });
  const generated = await invokeTopicInsight({
    connection: access.connection,
    stage,
    apiKey: access.apiKey,
    allowedHosts: readAiBackendConfiguration(process.env).allowedHosts,
    prompt,
    inputTokens,
    inputIds: input.signals.map((s) => s.id),
  });
  const result: TopicInsightResult = {
    kind: 'topic_insight',
    topicIds: config.topicIds,
    windowStart: input.windowStart,
    windowEnd: input.windowEnd,
    generatedAt: new Date().toISOString(),
    inputs: frozenInputs,
    report: generated.report,
  };
  const measured =
    Number.isSafeInteger(generated.inputTokens) && Number.isSafeInteger(generated.outputTokens)
      ? generationCost(generated.inputTokens!, generated.outputTokens!, access.connection.settings)
      : estimate;
  return {
    result,
    costMicrousd: generated.providerCostMicrousd ?? measured,
    costSource:
      generated.providerCostMicrousd !== null ? ('provider' as const) : ('estimate' as const),
  };
}
