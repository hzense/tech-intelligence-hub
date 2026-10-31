import { sleep } from 'workflow';
import { automationLimits } from '../lib/server/automation';
import { automationPool } from '../lib/server/automation-store-access';
import { assertTrackedInsightTopics } from '../lib/server/insight-topics';
import * as store from '../../../packages/database/src/automation-store.mjs';
import { automationStableId } from '../../../packages/database/src/automation-contract.mjs';
import { executeImportAdmin, runImportItem } from '../lib/server/import-service';
import {
  executeGeneration,
  failQueuedGeneration,
  queueGeneration,
} from '../lib/server/signal-generation';
import { start } from 'workflow/api';
import { signalGenerationWorkflow } from './signal-generation';
import { localSignalGenerationWorkflow } from './local-signal-generation';
import { runLocalTopicInsightStep } from './local-topic-insight';
import {
  isLocalAutomationSchedulerEnabled,
  isLocalRealAutomationEnabled,
} from '../lib/local-development';
import { automaticPublicationAvailable } from '../lib/automatic-publication';
import { discoverSources } from '../lib/server/source-discovery';
import {
  appendAutomationSourceFailure,
  appendAutomationImportFailure,
  automationSourceFailureCode,
  readAutomationSourceFailures,
  type AutomationSourceFailureCode,
} from '../lib/automation-source-failures';
import {
  canTrySourceFallback,
  readAutomationSourceFallbacks,
  sourceFallbackLimit,
  sourceFallbackUrls,
  type AutomationSourceFallback,
} from '../lib/automation-source-fallbacks';
import {
  startTopicInsightSandbox,
  pollTopicInsightSandbox,
  stopTopicInsightSandbox,
  type TopicInsightSandboxHandle,
} from '../lib/server/topic-insight-sandbox';

type SourceItem = {
  id: string;
  status: string;
  kind: string;
  url: string;
  error_code?: string | null;
  fetch_diagnostic?: unknown;
};
type SourceBatch = { id: string; items: SourceItem[] };
type GenerationDispatch = { id: string; queuedAt: string };
type QueuedSource = { url: string; originalUrl?: string; generationId: string; queuedAt: string };

/** Called only from steps: a local marker must never fall back to cloud execution. */
function assertLocalAutomationExecution(kind?: 'source_collection' | 'topic_insight') {
  if (process.env.HZENSE_LOCAL_DEVELOPMENT !== '1') return false;
  if (
    !isLocalRealAutomationEnabled() ||
    (kind !== undefined && !['source_collection', 'topic_insight'].includes(kind))
  )
    throw new Error('execution_disabled');
  return true;
}

function assertLocalAutomationRun(
  run: Pick<store.AutomationRun, 'snapshot' | 'trigger'>,
  expectedKind?: 'source_collection' | 'topic_insight',
) {
  if (expectedKind && run.snapshot.kind !== expectedKind) throw new Error('execution_disabled');
  if (
    assertLocalAutomationExecution(run.snapshot.kind) &&
    run.trigger !== 'manual' &&
    !(run.trigger === 'scheduled' && isLocalAutomationSchedulerEnabled())
  )
    throw new Error('execution_disabled');
  // The saved run snapshot is the only consent source, including workflow
  // resumption. Changing a configuration or global flag cannot upgrade it.
  if (
    run.snapshot.kind === 'source_collection' &&
    run.snapshot.publicationMode === 'automatic' &&
    !automaticPublicationAvailable(process.env)
  )
    throw new store.AutomationError('automatic_publication_unavailable');
}

export async function automationWorkflow(owner: string, id: string) {
  'use workflow';
  const run = await claim(owner, id);
  if (!run) return 'already_started_or_finished';
  if (run.kind === 'topic_insight') {
    if (run.local) return runLocalTopicInsightStep(owner, id, run.lease_token!);
    let handle: TopicInsightSandboxHandle | null = null;
    try {
      handle = await startTopicWorker(owner, id);
      if (!handle) return 'already_started_or_finished';
      for (let poll = 0; poll < 60; poll++) {
        await sleep('30s');
        const state = await pollTopicWorker(handle);
        if (state !== 'running') return await reconcileTopic(owner, id);
      }
      await markTopicUnknown(owner, id);
      return 'outcome_unknown';
    } catch {
      await markTopicUnknown(owner, id);
      return 'outcome_unknown';
    } finally {
      if (handle) await stopTopicWorker(handle);
    }
  }
  try {
    const urls = await findSources(owner, run.id);
    if (!urls.length) {
      await finishSourceRun(owner, run.id, run.lease_token!, {
        generationIds: [],
        queuedSources: [],
        failed: 0,
      });
      return 'no_new_sources';
    }
    const batch = await createSourceBatch(owner, run.id, urls);
    const generationIds: string[] = [];
    const generationDispatches: GenerationDispatch[] = [];
    const queuedSources: QueuedSource[] = [];
    let failed = 0;
    let dispatchUnconfirmed = false;
    let dispatchError: unknown;
    try {
      for (const item of batch.items) {
        if (item.kind !== 'url') continue;
        let selectedItem = item;
        let selectedBatchId = batch.id;
        let status =
          item.status === 'completed'
            ? 'completed'
            : await importSourceItem(owner, batch.id, item.id, run.id);
        for (let attempt = 0; status === 'failed' && attempt < sourceFallbackLimit; attempt++) {
          const fallback = await createFallbackSourceBatch(
            owner,
            run.id,
            batch.id,
            item.id,
            item.url,
            attempt,
          );
          if (!fallback) break;
          selectedBatchId = fallback.id;
          selectedItem = fallback.items[0]!;
          status =
            selectedItem.status === 'completed'
              ? 'completed'
              : await importSourceItem(owner, selectedBatchId, selectedItem.id, run.id);
        }
        if (status !== 'completed') {
          failed++;
          continue;
        }
        const generation = await createPrivateGeneration(
          owner,
          run.id,
          selectedBatchId,
          selectedItem.id,
        );
        if (generation) {
          generationIds.push(generation.id);
          generationDispatches.push(generation);
          queuedSources.push({
            url: selectedItem.url,
            ...(selectedItem.id !== item.id ? { originalUrl: item.url } : {}),
            generationId: generation.id,
            queuedAt: generation.queuedAt,
          });
          await markSourceDispatch(owner, run.id, run.lease_token!, {
            batchId: batch.id,
            generationIds,
            queuedSources,
            failed,
          });
        } else failed++;
      }
      await markSourceDispatch(owner, run.id, run.lease_token!, {
        batchId: batch.id,
        generationIds,
        queuedSources,
        failed,
      });
    } finally {
      // A later source or receipt write can fail after earlier tasks were queued.
      // Dispatch each confirmed queue receipt exactly once before leaving this run;
      // never retry the uncertain source or erase its pinned request ID.
      for (const generation of generationDispatches) {
        try {
          if (!(await dispatchGeneration(owner, run.id, generation))) failed++;
        } catch (error) {
          // A failed cleanup must remain visible, but it must not strand the
          // other queue receipts that this run has already persisted.
          failed++;
          if (!dispatchUnconfirmed) dispatchError = error;
          dispatchUnconfirmed = true;
        }
      }
    }
    await markSourceDispatch(owner, run.id, run.lease_token!, {
      batchId: batch.id,
      generationIds,
      queuedSources,
      failed,
    });
    if (dispatchUnconfirmed) throw dispatchError;
    await finishSourceRun(owner, run.id, run.lease_token!, {
      batchId: batch.id,
      generationIds,
      queuedSources,
      failed,
    });
    return 'completed';
  } catch {
    await failSourceRun(owner, run.id, run.lease_token!);
    return 'failed';
  }
}

async function claim(owner: string, id: string) {
  'use step';
  const local = assertLocalAutomationExecution();
  // Reject unavailable automatic publication or unsupported local tasks before
  // reserving money. This reads the immutable run, not its current configuration.
  const pending = await store.readAutomationRun({ pool: automationPool, owner, id });
  if (['completed', 'failed', 'unknown', 'cancelled'].includes(pending.status)) return null;
  try {
    assertLocalAutomationRun(pending);
    if (pending.snapshot.kind === 'topic_insight')
      await assertTrackedInsightTopics(pending.snapshot.topicIds);
  } catch (error) {
    if (
      error instanceof store.AutomationError &&
      (error.code === 'insight_topic_not_leaf' || error.code === 'insight_topic_not_tracked')
    )
      await store.rejectInsightTopicsBeforeClaim({
        pool: automationPool,
        owner,
        id,
        errorCode: error.code,
      });
    if (
      error instanceof store.AutomationError &&
      error.code === 'automatic_publication_unavailable'
    )
      await store.rejectAutomaticPublicationBeforeClaim({ pool: automationPool, owner, id });
    throw error;
  }
  const run = await store.claimAutomationRun({
    pool: automationPool,
    owner,
    id,
    limits: automationLimits(),
  });
  return run ? { id: run.id, kind: run.snapshot.kind, lease_token: run.lease_token, local } : null;
}
claim.maxRetries = 0;
async function findSources(owner: string, id: string) {
  'use step';
  assertLocalAutomationExecution('source_collection');
  // A resumed workflow may reuse its completed claim step. Recheck the saved
  // policy and execution capability before crossing the paid discovery fence.
  const run = await store.readAutomationRun({ pool: automationPool, owner, id });
  assertLocalAutomationRun(run, 'source_collection');
  return discoverSources(owner, id);
}
findSources.maxRetries = 0;
async function createSourceBatch(
  owner: string,
  runId: string,
  urls: string[],
): Promise<SourceBatch> {
  'use step';
  assertLocalAutomationExecution('source_collection');
  const run = await store.readAutomationRun({ pool: automationPool, owner, id: runId });
  assertLocalAutomationRun(run, 'source_collection');
  if (run.status !== 'running' || run.snapshot.kind !== 'source_collection')
    throw new Error('stale_attempt');
  const batch = (await executeImportAdmin(owner, 'POST', {
    action: 'create',
    request: {
      id: automationStableId({ runId, kind: 'import' }),
      intent: 'preview',
      manifest: { files: [], urlLines: urls.join('\n') },
    },
  })) as SourceBatch;
  await store.updateAutomationRun({
    pool: automationPool,
    owner,
    id: runId,
    token: run.lease_token!,
    phase: 'importing_sources',
    result: { ...run.result, batchId: batch.id },
  });
  return {
    id: batch.id,
    items: batch.items.map((item: { id: string; status: string; kind: string }, index) => ({
      id: item.id,
      status: item.status,
      kind: item.kind,
      url: urls[index]!,
    })),
  };
}
createSourceBatch.maxRetries = 0;
async function createFallbackSourceBatch(
  owner: string,
  runId: string,
  primaryBatchId: string,
  primaryItemId: string,
  primaryUrl: string,
  attempt: number,
): Promise<SourceBatch | null> {
  'use step';
  assertLocalAutomationExecution('source_collection');
  const run = await store.readAutomationRun({ pool: automationPool, owner, id: runId });
  assertLocalAutomationRun(run, 'source_collection');
  if (
    run.status !== 'running' ||
    run.result?.batchId !== primaryBatchId ||
    !Number.isInteger(attempt) ||
    attempt < 0 ||
    attempt >= sourceFallbackLimit
  )
    throw new Error('stale_attempt');
  const receipts = readAutomationSourceFallbacks(run.result?.sourceFallbacks);
  const prior = receipts.filter((entry) => entry.primaryItemId === primaryItemId);
  // A previous unacknowledged create is not an invitation to try another URL.
  if (prior.length !== attempt) throw new Error('source_outcome_unknown');
  const failedItemId = attempt === 0 ? primaryItemId : prior[attempt - 1]?.itemId;
  if (!failedItemId) throw new Error('source_outcome_unknown');
  const failure = readAutomationSourceFailures(run.result?.sourceFailures).find(
    (entry) => entry.itemId === failedItemId,
  );
  if (!canTrySourceFallback(failure)) return null;
  const url = sourceFallbackUrls(run.result?.discovery, primaryUrl)[attempt];
  if (!url || receipts.some((entry) => entry.url === url)) return null;
  const batchId = automationStableId({
    runId,
    itemId: primaryItemId,
    kind: 'import_fallback',
    attempt,
  });
  const receipt = { primaryItemId, originalUrl: primaryUrl, batchId, url };
  // Pin provenance and deterministic identity BEFORE the import commit boundary.
  // A lost acknowledgement leaves a read-only reconciliation trail, never a new search.
  const sourceFallbacks: AutomationSourceFallback[] = [...receipts, receipt];
  await store.updateAutomationRun({
    pool: automationPool,
    owner,
    id: runId,
    token: run.lease_token!,
    phase: 'importing_sources',
    result: { ...run.result, sourceFallbacks },
  });
  const batch = (await executeImportAdmin(owner, 'POST', {
    action: 'create',
    request: { id: batchId, intent: 'preview', manifest: { files: [], urlLines: url } },
  })) as SourceBatch;
  if (batch.id !== batchId || batch.items.length !== 1 || batch.items[0]?.kind !== 'url')
    throw new Error('source_outcome_unknown');
  const item = batch.items[0]!;
  sourceFallbacks[sourceFallbacks.length - 1] = { ...receipt, itemId: item.id };
  await store.updateAutomationRun({
    pool: automationPool,
    owner,
    id: runId,
    token: run.lease_token!,
    phase: 'importing_sources',
    result: { ...run.result, sourceFallbacks },
  });
  console.info('automation_source_fallback', {
    runId,
    primaryItemId,
    batchId,
    itemId: item.id,
    attempt,
  });
  return { id: batchId, items: [{ id: item.id, status: item.status, kind: item.kind, url }] };
}
createFallbackSourceBatch.maxRetries = 0;
async function importSourceItem(owner: string, batchId: string, itemId: string, runId?: string) {
  'use step';
  assertLocalAutomationExecution('source_collection');
  let outcome: Pick<SourceItem, 'status' | 'error_code' | 'fetch_diagnostic'> | undefined;
  try {
    const result = (await runImportItem(owner, batchId, itemId)) as unknown as NonNullable<
      typeof outcome
    >;
    if (['completed', 'failed', 'cancelled'].includes(result.status)) outcome = result;
  } catch {
    // A thrown transport/commit error is not proof that the item failed. Read
    // back its durable result once; do not retry a fetch, parser or AI call.
    const batch = (await executeImportAdmin(owner, 'POST', {
      action: 'detail',
      batchId,
    })) as SourceBatch;
    const item = batch.items.find((row) => row.id === itemId);
    if (item && ['completed', 'failed', 'cancelled'].includes(item.status)) outcome = item;
  }
  if (!outcome) throw new Error('source_outcome_unknown');
  if (runId && outcome.status !== 'completed') {
    // Persist only a confirmed, sanitized failure. A lost receipt write stops
    // reconciliation; it must never trigger another fetch or paid search.
    const run = await store.readAutomationRun({ pool: automationPool, owner, id: runId });
    assertLocalAutomationRun(run, 'source_collection');
    const fallbackBatch = readAutomationSourceFallbacks(run.result?.sourceFallbacks).some(
      (entry) => entry.batchId === batchId && entry.itemId === itemId,
    );
    if (run.status !== 'running' || (run.result?.batchId !== batchId && !fallbackBatch))
      throw new Error('stale_attempt');
    await store.updateAutomationRun({
      pool: automationPool,
      owner,
      id: runId,
      token: run.lease_token!,
      phase: 'importing_sources',
      result: {
        ...run.result,
        sourceFailures: appendAutomationImportFailure(run.result?.sourceFailures, itemId, outcome),
      },
    });
  }
  return outcome.status;
}
importSourceItem.maxRetries = 0;
async function createPrivateGeneration(
  owner: string,
  runId: string,
  batchId: string,
  itemId: string,
): Promise<GenerationDispatch | null> {
  'use step';
  assertLocalAutomationExecution('source_collection');
  const run = await store.readAutomationRun({ pool: automationPool, owner, id: runId });
  assertLocalAutomationRun(run, 'source_collection');
  if (
    run.status !== 'running' ||
    run.snapshot.kind !== 'source_collection' ||
    !run.snapshot.profileId ||
    !run.snapshot.profileRevision
  )
    throw new Error('stale_attempt');
  const id = automationStableId({ runId, itemId, kind: 'generation' });
  const generationIds = Array.isArray(run.result?.generationIds)
    ? run.result.generationIds.filter((value): value is string => typeof value === 'string')
    : [];
  // Pin the stable request ID before crossing either database commit boundary.
  // A lost create/queue acknowledgement must remain reconcilable; it must not
  // disappear into the ordinary per-source failed count or cause a fresh task.
  await store.updateAutomationRun({
    pool: automationPool,
    owner,
    id: runId,
    token: run.lease_token!,
    phase: 'creating_candidates',
    result: {
      ...run.result,
      generationIds: [...new Set([...generationIds, id])],
    },
  });
  let created;
  let refusalCode: AutomationSourceFailureCode | null = null;
  try {
    created = await executeGeneration(
      owner,
      {
        action: 'create',
        id,
        batchId,
        itemId,
        profileId: run.snapshot.profileId,
        profileRevision: run.snapshot.profileRevision,
        consent: true,
        // Only the immutable collection snapshot authorizes publication; absent
        // (historical) and manual modes stay private even if the global flag is on.
        automaticPublicationConsent: run.snapshot.publicationMode === 'automatic',
      },
      undefined,
      // This argument is internal workflow context, not part of the browser body.
      // Keep the original snapshot and selected discovery receipts across delays.
      run.snapshot.publicationMode === 'automatic' && run.snapshot.discovery ? run : undefined,
    );
  } catch (error) {
    // Only explicit, pre-commit refusals can be counted as a failed source.
    // Unrecognized failures (including commit_unknown) retain the request ID
    // and stop the run for read-only reconciliation, without retrying creation.
    refusalCode = automationSourceFailureCode(
      error && typeof error === 'object' && 'code' in error ? error.code : null,
    );
    if (!refusalCode) throw new Error('generation_creation_unconfirmed');
  }
  if (!created || created.id !== id) {
    // Semantic deduplication may return a separately created task. Do not
    // commandeer/requeue that task or claim that our stable ID was persisted.
    await store.updateAutomationRun({
      pool: automationPool,
      owner,
      id: runId,
      token: run.lease_token!,
      phase: 'creating_candidates',
      result: {
        ...run.result,
        ...(refusalCode || created
          ? {
              sourceFailures: appendAutomationSourceFailure(
                run.result?.sourceFailures,
                itemId,
                refusalCode ?? 'duplicate_source',
              ),
            }
          : {}),
      },
    });
    return null;
  }
  const queued = await queueGeneration(owner, id);
  const progressAt = queued.progress_at;
  // The millisecond-precision queue receipt is the worker admission fence.
  // Never synthesize it or requeue just because dispatch was not acknowledged.
  if (
    queued.status !== 'pending' ||
    queued.progress_phase !== 'queued' ||
    !(typeof progressAt === 'string' || progressAt instanceof Date) ||
    !Number.isFinite(new Date(progressAt).getTime())
  )
    throw new Error('generation_queue_unconfirmed');
  return { id, queuedAt: new Date(progressAt).toISOString() };
}
createPrivateGeneration.maxRetries = 0;
async function finishSourceRun(
  owner: string,
  id: string,
  token: string,
  result: {
    batchId?: string;
    generationIds: string[];
    queuedSources: QueuedSource[];
    failed: number;
  },
) {
  'use step';
  const run = await store.readAutomationRun({ pool: automationPool, owner, id });
  await store.updateAutomationRun({
    pool: automationPool,
    owner,
    id,
    token,
    phase: result.generationIds.length
      ? 'candidate_tasks_queued'
      : result.failed
        ? 'source_failed'
        : 'no_new_sources',
    result: { ...run.result, ...result },
    status: result.failed && !result.generationIds.length ? 'failed' : 'completed',
    costMicrousd: Number(run.result?.discoveryCostMicrousd ?? 0),
    costSource: run.result?.discoveryCostSource === 'provider' ? 'provider' : 'estimate',
  });
}
finishSourceRun.maxRetries = 0;
async function markSourceDispatch(
  owner: string,
  id: string,
  token: string,
  result: {
    batchId: string;
    generationIds: string[];
    queuedSources: QueuedSource[];
    failed: number;
  },
) {
  'use step';
  const run = await store.readAutomationRun({ pool: automationPool, owner, id });
  await store.updateAutomationRun({
    pool: automationPool,
    owner,
    id,
    token,
    phase: 'dispatching_candidates',
    result: { ...run.result, ...result },
  });
}
markSourceDispatch.maxRetries = 0;
async function failSourceRun(owner: string, id: string, token: string) {
  'use step';
  // A dispatch can have succeeded even when its acknowledgement was lost. Keep
  // the saved batch and generation IDs for reconciliation; never create a new
  // batch merely because the workflow outcome is unknown.
  const run = await store.readAutomationRun({ pool: automationPool, owner, id });
  if (run.status !== 'running' || run.lease_token !== token) return;
  await store
    .updateAutomationRun({
      pool: automationPool,
      owner,
      id,
      token,
      phase: 'source_failed',
      result:
        run.result && typeof run.result === 'object' && !Array.isArray(run.result)
          ? run.result
          : {},
      status: 'unknown',
      errorCode: 'outcome_unknown',
      ...(typeof run.result?.discoveryCostMicrousd === 'number'
        ? {
            costMicrousd: run.result.discoveryCostMicrousd,
            costSource:
              run.result.discoveryCostSource === 'provider'
                ? ('provider' as const)
                : ('estimate' as const),
          }
        : {}),
    })
    .catch(() => undefined);
}
failSourceRun.maxRetries = 0;
async function dispatchGeneration(owner: string, runId: string, generation: GenerationDispatch) {
  'use step';
  try {
    assertLocalAutomationExecution('source_collection');
    const run = await store.readAutomationRun({ pool: automationPool, owner, id: runId });
    assertLocalAutomationRun(run, 'source_collection');
    if (assertLocalAutomationExecution('source_collection'))
      await start(localSignalGenerationWorkflow, [owner, generation.id, generation.queuedAt]);
    else await start(signalGenerationWorkflow, [owner, generation.id, generation.queuedAt]);
    return true;
  } catch (error) {
    // A lost acknowledgement may hide an accepted workflow. Only fail this
    // exact pending queue receipt; a claimed worker or newer queue is untouched.
    // Never retry start(), including when the fenced cleanup itself fails.
    await failQueuedGeneration(owner, generation.id, generation.queuedAt).catch(() => {
      throw error;
    });
    return false;
  }
}
dispatchGeneration.maxRetries = 0;
async function startTopicWorker(owner: string, id: string) {
  'use step';
  if (assertLocalAutomationExecution('topic_insight')) throw new Error('execution_disabled');
  return startTopicInsightSandbox(owner, id);
}
startTopicWorker.maxRetries = 0;
async function pollTopicWorker(handle: TopicInsightSandboxHandle) {
  'use step';
  if (assertLocalAutomationExecution('topic_insight')) throw new Error('execution_disabled');
  return pollTopicInsightSandbox(handle);
}
pollTopicWorker.maxRetries = 3;
async function stopTopicWorker(handle: TopicInsightSandboxHandle) {
  'use step';
  if (assertLocalAutomationExecution('topic_insight')) throw new Error('execution_disabled');
  await stopTopicInsightSandbox(handle).catch(() => undefined);
}
stopTopicWorker.maxRetries = 0;
async function reconcileTopic(owner: string, id: string) {
  'use step';
  const run = await store.readAutomationRun({ pool: automationPool, owner, id });
  if (run.status === 'running' && run.lease_token) {
    await store.updateAutomationRun({
      pool: automationPool,
      owner,
      id,
      token: run.lease_token,
      phase: 'outcome_unknown',
      result: {},
      status: 'unknown',
      errorCode: 'outcome_unknown',
    });
    return 'outcome_unknown';
  }
  return run.status;
}
reconcileTopic.maxRetries = 0;
async function markTopicUnknown(owner: string, id: string) {
  'use step';
  const run = await store.readAutomationRun({ pool: automationPool, owner, id });
  if (run.status === 'running' && run.lease_token)
    await store
      .updateAutomationRun({
        pool: automationPool,
        owner,
        id,
        token: run.lease_token,
        phase: 'outcome_unknown',
        result: {},
        status: 'unknown',
        errorCode: 'outcome_unknown',
      })
      .catch(() => undefined);
}
markTopicUnknown.maxRetries = 0;
