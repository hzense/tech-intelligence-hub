import 'server-only';
import * as store from '../../../../packages/database/src/automation-store.mjs';
import {
  normalizeAutomationConfig,
  type AutomationConfig,
} from '../../../../packages/database/src/automation-contract.mjs';
import {
  automationDatabaseConfiguration,
  automationStorageConfiguration,
  automationConfigPool,
  automationPool,
} from './automation-store-access';
import { aiStageAccess, generationAiAccess } from './admin-ai';
import { importsConfigured } from './import-service';
import { generationConfigured, generationSummaries } from './signal-generation';
import { currentInsight } from '../topic-insight-core';
import { readTaskPublicSignals } from './task-public-signals';
import { getTopicEntries } from '../content-runtime';
import { assertDiscoveryConnection } from '../source-discovery-provider';
import {
  automationGenerationIds,
  summarizeAutomationGenerations,
} from '../automation-generation-status';
export type {
  AutomationRun,
  SaveAutomationRequest,
  TriggerAutomationRequest,
  DeleteAutomationRequest,
} from '../../../../packages/database/src/automation-store.mjs';
export { freezeAutomationInputs } from './automation-store-access';
export function automationConfigured() {
  try {
    automationDatabaseConfiguration();
    return true;
  } catch {
    return false;
  }
}
export function automationStorageConfigured() {
  try {
    automationStorageConfiguration();
    return true;
  } catch {
    return false;
  }
}
export function automationExecutionConfigured(kind: AutomationConfig['kind']) {
  return automationExecutionReadiness(kind).ready;
}
export function automationExecutionReadiness(kind: AutomationConfig['kind']) {
  // Pure configuration checks only. Never expose values, connect to a database,
  // resolve an AI profile or invoke a paid service while rendering diagnostics.
  const check = (key: string, inspect: () => unknown) => {
    try {
      return { key, ready: inspect() !== false };
    } catch {
      return { key, ready: false };
    }
  };
  const checks = [
    check('storage', automationStorageConfigured),
    check('execution', automationConfigured),
    check('budget', automationLimits),
    ...(kind === 'source_collection'
      ? [check('import', importsConfigured), check('generation', generationConfigured)]
      : []),
  ];
  return { ready: checks.every(({ ready }) => ready), checks };
}
function assertExecutionConfiguration(kind: AutomationConfig['kind']) {
  const readiness = automationExecutionReadiness(kind);
  if (!readiness.checks.find(({ key }) => key === 'execution')?.ready)
    throw new store.AutomationError('execution_disabled');
  if (!readiness.ready) throw new store.AutomationError('not_configured');
}
export function automationLimits() {
  const limits = {
    batch: Number(process.env.HZENSE_AUTOMATION_BATCH_LIMIT_MICROUSD),
    daily: Number(process.env.HZENSE_AUTOMATION_DAILY_LIMIT_MICROUSD),
    reserve: Number(process.env.HZENSE_AUTOMATION_RESERVE_MICROUSD),
  };
  if (
    Object.values(limits).some(
      (value) => !Number.isSafeInteger(value) || value < 1 || value > 50000000,
    ) ||
    limits.batch > limits.daily ||
    limits.reserve > limits.batch
  )
    throw new store.AutomationError('not_configured');
  return limits;
}
export async function automationDashboard(owner: string) {
  const state = await store.readAutomationDashboard({ pool: automationConfigPool, owner });
  const generationIds = [
    ...new Set(
      state.runs.flatMap((run) =>
        run.snapshot.kind === 'source_collection' ? automationGenerationIds(run.result) : [],
      ),
    ),
  ];
  // Preserve task/accounting reads even if ancillary generation history is down.
  // Null is unavailable evidence; it must not become an empty success result.
  const summaries = generationIds.length
    ? await generationSummaries(owner, generationIds).catch(() => null)
    : [];
  return {
    configDeletionAvailable: state.configDeletionAvailable,
    configs: state.configs.map(
      ({ id, revision, config, enabled, next_run_at, created_at, updated_at }) => ({
        id,
        revision,
        config,
        enabled,
        next_run_at,
        created_at,
        updated_at,
      }),
    ),
    runs: state.runs.map(
      ({
        id,
        snapshot,
        status,
        phase,
        result,
        error_code,
        created_at,
        finished_at,
        charged_microusd,
        cost_source,
        publication_status,
      }) => ({
        id,
        snapshot,
        status,
        phase,
        result,
        error_code,
        created_at,
        finished_at,
        charged_microusd,
        cost_source,
        publication_status,
        ...(snapshot.kind === 'source_collection'
          ? { generationProgress: summarizeAutomationGenerations(result, summaries) }
          : {}),
      }),
    ),
  };
}
export async function saveAutomation(owner: string, request: store.SaveAutomationRequest) {
  const config = normalizeAutomationConfig(request.config);
  // Saving an inactive configuration neither enables execution nor needs its
  // budgets/import/generation services. Enabling a schedule remains protected.
  if (config.enabled) assertExecutionConfiguration(config.kind);
  await validateAutomationProfile(config);
  return store.saveAutomationConfig({
    pool: automationConfigPool,
    owner,
    request: { ...request, config },
  });
}
export async function deleteAutomation(owner: string, request: store.DeleteAutomationRequest) {
  // Removing a schedule must not depend on paid execution or a ready AI profile.
  return store.deleteAutomationConfig({ pool: automationConfigPool, owner, request });
}
async function validateAutomationProfile(config: AutomationConfig) {
  if (config.kind === 'source_collection') {
    await generationAiAccess(config.profileId!, config.profileRevision!, false);
    if (config.discovery) {
      const access = await aiStageAccess(
        config.profileId!,
        config.profileRevision!,
        'analyze',
        false,
      );
      try {
        assertDiscoveryConnection(access);
      } catch {
        throw new store.AutomationError('discovery_connection_unsupported');
      }
      const topics = new Set((await getTopicEntries()).map((entry) => entry.frontMatter.id));
      if (config.topicIds.some((id) => !topics.has(id)))
        throw new store.AutomationError('discovery_topic_invalid');
    }
  } else await aiStageAccess(config.profileId!, config.profileRevision!, 'analyze', false);
}
async function dispatch(owner: string, id: string) {
  try {
    const run = await store.readAutomationRun({ pool: automationPool, owner, id });
    assertExecutionConfiguration(run.snapshot.kind);
    await validateAutomationProfile(run.snapshot);
    const [{ start }, { automationWorkflow }] = await Promise.all([
      import('workflow/api'),
      import('../../workflows/automation'),
    ]);
    await start(automationWorkflow, [owner, id]);
  } catch {
    await store.failAutomationDispatch({ pool: automationPool, owner, id }).catch(() => undefined);
    throw new store.AutomationError('dispatch_unknown');
  }
}
export async function triggerAutomation(owner: string, request: store.TriggerAutomationRequest) {
  if (!automationConfigured()) throw new store.AutomationError('execution_disabled');
  automationLimits();
  const result = await store.enqueueAutomation({
    pool: automationPool,
    owner,
    request,
    beforeEnqueue: async (config) => {
      assertExecutionConfiguration(config.kind);
      try {
        await validateAutomationProfile(config);
      } catch (error) {
        // Preserve only fixed public admission codes across the store's
        // transaction boundary. Never reflect provider/DB exception messages.
        const code = error && typeof error === 'object' && 'code' in error ? error.code : undefined;
        const profileUnavailable = ['capability_failed', 'connection_unavailable', 'invalid_model'];
        const publicCodes = [
          'profile_not_ready',
          'not_configured',
          'revision_conflict',
          'not_found',
          'database_unavailable',
          'discovery_connection_unsupported',
          'discovery_topic_invalid',
        ];
        throw new store.AutomationError(
          typeof code === 'string' && publicCodes.includes(code)
            ? code
            : typeof code === 'string' && profileUnavailable.includes(code)
              ? 'profile_not_ready'
              : 'database_unavailable',
        );
      }
    },
  });
  if (result.created) await dispatch(owner, result.run.id);
  return result;
}
export async function dispatchDueAutomations() {
  const kinds = (['source_collection', 'topic_insight'] as const).filter(
    automationExecutionConfigured,
  );
  if (!kinds.length) return { dispatched: 0, failed: 0 };
  const tasks = await store.enqueueDueAutomations({ pool: automationPool, kinds });
  let dispatched = 0,
    failed = 0;
  for (const task of tasks)
    if (task.created) {
      try {
        await dispatch(task.run.owner_id, task.run.id);
        dispatched++;
      } catch {
        failed++;
      }
    }
  return { dispatched, failed };
}
export async function publishAutomationInsight(owner: string, id: string, confirm: boolean) {
  if (confirm) {
    const run = await store.readAutomationRun({ pool: automationPool, owner, id });
    if (!currentInsight(run.result, await readTaskPublicSignals()))
      throw new store.AutomationError('insight_stale');
  }
  return store.publishAutomationInsight({ pool: automationPool, owner, id, confirm });
}
