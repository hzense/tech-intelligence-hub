import 'server-only';
import * as store from '../../../../packages/database/src/signal-generation-store.mjs';
import { generationPool, generationHistoryPool } from './generation-database';
import {
  getImportBatch,
  getImportItemLabels,
  getImportOutput,
  listImportBatches,
} from '../../../../packages/database/src/import-store.mjs';
import { importPool, importsConfigured } from './generation-import-reader';
import { generationAiAccess, getAiDashboard } from './admin-ai';
import { readAiBackendConfiguration } from '../admin-ai-core';
import {
  createGenerationExecutor,
  generationAiMode,
  generationDto,
  generationProgressDto,
  GenerationError,
} from '../signal-generation-core';
import {
  readGenerationConfiguration,
  readGenerationDatabaseConfiguration,
} from '../signal-generation-config';
import { invokeSignalGeneration } from '../signal-generation-provider';
import { createGenerationSourceInspector } from '../signal-generation-source-inspection';
import { buildCandidateReview } from '../candidate-review';
import { editorialTopicOptions } from './editorial-topics';
import { readEditorialSignalStatuses } from '../../../../packages/database/src/editorial-signal-store.mjs';
import { editorialPool } from './editorial-database';
import { withGenerationPublications } from '../generation-publication';
import { isLocalDevelopment, isLocalMockAi, isLocalRealAi } from '../local-development';
import {
  automaticPublicationAvailable,
  automaticPublicationEnabled,
} from '../automatic-publication';
import { readEditorialSourceOptions } from '../editorial-source-options';
import { readMaterialSupplement } from '../material-source-reader';
import {
  invokeLocalGeneration,
  localGenerationAccess,
  LOCAL_GENERATION_PROFILE_ID,
} from '../local-generation';

const historyOptions = () => ({
  pool: generationHistoryPool,
  readOnly: true,
  legacyReadOnly: process.env.HZENSE_GENERATION_WORKFLOW_ENABLED !== '1',
});
export function generationConfigured() {
  try {
    if (process.env.HZENSE_GENERATION_WORKFLOW_ENABLED !== '1') return false;
    readGenerationConfiguration(process.env);
    if (!isLocalMockAi()) readAiBackendConfiguration(process.env);
    return importsConfigured();
  } catch {
    return false;
  }
}
export function generationHistoryConfigured() {
  try {
    readGenerationDatabaseConfiguration(process.env);
    return true;
  } catch {
    return false;
  }
}
async function source(
  owner: string,
  batchId: string,
  itemId: string,
  options?: { requireCanonical?: boolean },
) {
  const batch = await getImportBatch({ pool: importPool, owner, id: batchId });
  const item = batch.items.find((row) => row.id === itemId);
  if (batch.cancelled || batch.deleted_at) throw new GenerationError('cancelled');
  // Duplicate ranking can change while a billable call is in flight. It only
  // controls admission; existing tasks retain their pinned evidence checks.
  if (options?.requireCanonical && item?.duplicate_of)
    throw new GenerationError('duplicate_source');
  if (!item || item.status !== 'completed') throw new GenerationError('source_unavailable');
  return {
    fence: item.fence,
    output: await getImportOutput({ pool: importPool, owner, batchId, itemId }),
  };
}
async function historyDtos(owner: string, runs: store.SignalGenerationDisplay[]) {
  const itemIds = [...new Set(runs.map((run) => run.item_id).filter(Boolean))];
  const [labels, receipts] = await Promise.all([
    importsConfigured() && itemIds.length
      ? getImportItemLabels({ pool: importPool, owner, itemIds }).catch(() => [])
      : [],
    // Publication history must remain visible when generation spending or
    // editorial writes are disabled. Reuse the existing owner-scoped reader;
    // do not expand the generation role's access or rewrite its immutable result.
    withGenerationPublications(runs.map(generationDto), (runIds) =>
      readEditorialSignalStatuses({ pool: editorialPool, owner, runIds }),
    ),
  ]);
  const names = new Map(labels.map((item) => [item.id, item.name ?? item.url ?? '未命名资料']));
  const matchingModes = new Map(runs.map((run) => [run.id, localGenerationModeMatches(run)]));
  return receipts.map((run) => ({
    ...run,
    // Compatibility mode is deliberately read-only until 0019/ACL enablement.
    ...(process.env.HZENSE_GENERATION_WORKFLOW_ENABLED !== '1' ? { can_delete: false } : {}),
    ...(isLocalDevelopment() && !matchingModes.get(run.id) ? { can_retry: false } : {}),
    ...(names.has(run.item_id) ? { source_name: names.get(run.item_id) } : {}),
  }));
}
export async function generationDashboard(owner: string) {
  if (!generationHistoryConfigured()) throw new GenerationError('not_configured');
  // Keep history available if accounting cannot be read; never substitute zero.
  const dailyUsage = await store
    .getSignalGenerationDailyUsage({
      pool: generationHistoryPool,
      owner,
      ...localGenerationBudgetOptions(),
    })
    .catch(() => null);
  // History does not depend on import, AI credentials, budgets or the spend switch.
  if (!generationConfigured()) {
    const runs = await store.listSignalGenerationDisplays({ ...historyOptions(), owner });
    return {
      runs: await historyDtos(owner, runs),
      profiles: [],
      batches: [],
      dailyUsage,
      automaticPublicationEnabled: false,
    };
  }
  const [runs, ai, batches] = await Promise.all([
    store.listSignalGenerationDisplays({ ...historyOptions(), owner }),
    // Selection data is optional: an ancillary outage must not hide saved runs.
    isLocalMockAi()
      ? Promise.resolve({ profiles: [localGenerationAccess().profile], connections: [] })
      : getAiDashboard().catch(() => null),
    listImportBatches({ pool: importPool, owner, view: 'sources' }).catch(() => []),
  ]);
  return {
    runs: await historyDtos(owner, runs),
    automaticPublicationEnabled: automaticPublicationEnabled(process.env),
    dailyUsage,
    profiles: (ai?.profiles ?? []).map(({ id, revision, name, readiness, stages }) => {
      const connection = ai?.connections.find((item) => item.id === stages.extract.connection_id);
      return {
        id,
        revision,
        name,
        readiness,
        provider_host: isLocalMockAi()
          ? '本地模拟（不联网）'
          : connection
            ? new URL(connection.base_url).hostname
            : '',
      };
    }),
    batches,
  };
}
export async function inspectGenerationInput(owner: string, body: unknown) {
  if (!generationConfigured()) throw new GenerationError('not_configured');
  return createGenerationSourceInspector(source)(owner, body);
}
export async function generationDetail(owner: string, id: string) {
  if (!generationHistoryConfigured()) throw new GenerationError('not_configured');
  return (
    await historyDtos(owner, [
      await store.getSignalGenerationDisplay({ ...historyOptions(), owner, id }),
    ])
  )[0];
}
export async function generationProgress(owner: string, ids: string[]) {
  if (!generationHistoryConfigured()) throw new GenerationError('not_configured');
  return (await store.readSignalGenerationProgress({ ...historyOptions(), owner, ids })).map(
    generationProgressDto,
  );
}
export async function generationRecord(owner: string, id: string) {
  if (!generationHistoryConfigured()) throw new GenerationError('not_configured');
  return store.getSignalGeneration({ ...historyOptions(), owner, id });
}
export async function generationSummaries(owner: string, ids: string[]) {
  if (!generationHistoryConfigured()) throw new GenerationError('not_configured');
  return store.readSignalGenerationSummaries({ ...historyOptions(), owner, ids });
}
export async function candidateReviewDetail(owner: string, id: string, index: number) {
  const run = await generationRecord(owner, id);
  const aiMode = generationAiMode(run);
  return { ...buildCandidateReview(run, index), ...(aiMode ? { ai_mode: aiMode } : {}) };
}

function localGenerationBudgetOptions(): { budgetMode?: store.LocalGenerationBudgetMode } {
  return isLocalMockAi()
    ? { budgetMode: 'local-mock' }
    : isLocalRealAi()
      ? { budgetMode: 'local-real' }
      : {};
}

/** A saved task keeps its execution mode across restarts and mode switches. */
function localGenerationModeMatches(
  run: Pick<store.SignalGenerationRun, 'generation_version' | 'profile_id' | 'profile_revision'>,
) {
  const mock = isLocalMockAi();
  const version = mock ? 'local-simulation-v1' : 'local-real-ai-v1';
  const validVersion = new RegExp(
    `^${version}(?:/retry/[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})?$`,
  );
  return (
    validVersion.test(run.generation_version) &&
    run.generation_version === run.generation_version.trim() &&
    (mock
      ? run.profile_id === LOCAL_GENERATION_PROFILE_ID && run.profile_revision === 1
      : isLocalRealAi() && run.profile_id !== LOCAL_GENERATION_PROFILE_ID)
  );
}

function assertLocalGenerationMode(run: store.SignalGenerationRun) {
  if (!isLocalDevelopment()) return;
  const profile = run.snapshot.profile as { id?: unknown; revision?: unknown } | null;
  if (
    !localGenerationModeMatches(run) ||
    run.configuration.version !== run.generation_version ||
    profile?.id !== run.profile_id ||
    profile?.revision !== run.profile_revision
  )
    throw new GenerationError('configuration_changed');
}

export async function executeGeneration(owner: string, body: unknown, queuedAt?: string) {
  if (!generationConfigured()) throw new GenerationError('not_configured');
  const config = readGenerationConfiguration(process.env);
  const mock = isLocalMockAi();
  const allowedHosts = mock ? [] : readAiBackendConfiguration(process.env).allowedHosts;
  const execute = createGenerationExecutor({
    topics: editorialTopicOptions,
    source,
    access: mock
      ? async (id, revision, credentials) => localGenerationAccess(id, revision, credentials)
      : generationAiAccess,
    invoke: mock ? invokeLocalGeneration : invokeSignalGeneration,
    allowedHosts,
    report: (event) => console.info(JSON.stringify(event)),
    progress: (owner, id, token, phase) =>
      store.updateSignalGenerationProgress({ pool: generationPool, owner, id, token, phase }),
    create: async (owner, args) => {
      if (args.automaticPublicationConsent && !automaticPublicationAvailable(process.env))
        throw new GenerationError('publication_policy_changed');
      if (isLocalDevelopment() && args.retryOf)
        assertLocalGenerationMode(
          await store.getSignalGeneration({ pool: generationPool, owner, id: args.retryOf }),
        );
      return store.createSignalGeneration({
        pool: generationPool,
        owner,
        request: args.request,
        snapshot: {
          ...args.snapshot,
          ...(args.automaticPublicationConsent && automaticPublicationAvailable(process.env)
            ? {
                publication: {
                  mode: 'automatic' as const,
                  policy: 'auto-publication-v1' as const,
                  sourceUrls: await readEditorialSourceOptions(
                    owner,
                    {
                      owner_id: owner,
                      batch_id: args.request.batchId,
                      item_id: args.request.itemId,
                      source_fence: args.request.sourceFence,
                      source_hash: args.request.sourceHash,
                    },
                    (o, b, i) => readMaterialSupplement(importPool, o, b, i),
                  ),
                },
              }
            : {}),
        },
        ...(args.retryOf ? { retryOf: args.retryOf } : {}),
        configuration: {
          version: mock
            ? 'local-simulation-v1'
            : isLocalRealAi()
              ? 'local-real-ai-v1'
              : 'private-candidate-v1',
          batchLimitMicrousd: config.batch,
          dailyLimitMicrousd: config.daily,
          reserveMicrousd: args.reserveMicrousd,
        },
      });
    },
    get: (owner, id) => store.getSignalGeneration({ pool: generationPool, owner, id }),
    claim: async (owner, id) => {
      // Validate the immutable task before reserving budget or claiming its lease.
      if (isLocalDevelopment())
        assertLocalGenerationMode(
          await store.getSignalGeneration({ pool: generationPool, owner, id }),
        );
      const admission = await store.claimSignalGeneration({
        pool: generationPool,
        owner,
        id,
        currentLimits: { batchLimitMicrousd: config.batch, dailyLimitMicrousd: config.daily },
        ...localGenerationBudgetOptions(),
        ...(queuedAt === undefined ? {} : { queuedAt }),
      });
      assertLocalGenerationMode(admission.run);
      return admission;
    },
    finish: (owner, args) => store.finishSignalGeneration({ pool: generationPool, owner, ...args }),
    cancel: (owner, id) => store.cancelSignalGeneration({ pool: generationPool, owner, id }),
  });
  return execute(owner, body);
}

export async function deleteGeneration(owner: string, id: string) {
  if (!generationHistoryConfigured() || process.env.HZENSE_GENERATION_WORKFLOW_ENABLED !== '1')
    throw new GenerationError('not_configured');
  return store.deleteSignalGeneration({ pool: generationPool, owner, id });
}

export async function queueGeneration(owner: string, id: string) {
  if (!generationConfigured() || process.env.HZENSE_GENERATION_WORKFLOW_ENABLED !== '1')
    throw new GenerationError('not_configured');
  if (isLocalDevelopment())
    assertLocalGenerationMode(await store.getSignalGeneration({ pool: generationPool, owner, id }));
  return generationDto(await store.queueSignalGeneration({ pool: generationPool, owner, id }));
}

export async function failQueuedGeneration(owner: string, id: string, queuedAt?: string) {
  await store.failQueuedSignalGeneration({
    pool: generationPool,
    owner,
    id,
    ...(queuedAt === undefined ? {} : { queuedAt }),
  });
}

export async function resolveQueuedGeneration(owner: string, id: string, queuedAt: string) {
  // Administrative queue closure never loads AI credentials, reserves budget,
  // starts a Workflow or retries a model call. The store atomically excludes a
  // worker that has already claimed the task or a newer dispatch.
  if (!generationHistoryConfigured() || process.env.HZENSE_GENERATION_WORKFLOW_ENABLED !== '1')
    throw new GenerationError('not_configured');
  return generationDto(
    await store.resolveQueuedSignalGeneration({ pool: generationPool, owner, id, queuedAt }),
  );
}
