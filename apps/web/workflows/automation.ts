import { sleep } from 'workflow';
import { automationLimits } from '../lib/server/automation';
import { automationPool } from '../lib/server/automation-store-access';
import * as store from '../../../packages/database/src/automation-store.mjs';
import { automationStableId } from '../../../packages/database/src/automation-contract.mjs';
import { executeImportAdmin, runImportItem } from '../lib/server/import-service';
import { executeGeneration, queueGeneration } from '../lib/server/signal-generation';
import { start } from 'workflow/api';
import { signalGenerationWorkflow } from './signal-generation';
import { discoverSources } from '../lib/server/source-discovery';
import {
  startTopicInsightSandbox,
  pollTopicInsightSandbox,
  stopTopicInsightSandbox,
  type TopicInsightSandboxHandle,
} from '../lib/server/topic-insight-sandbox';

type SourceItem = { id: string; status: string; kind: string; url: string };
type SourceBatch = { id: string; items: SourceItem[] };

export async function automationWorkflow(owner: string, id: string) {
  'use workflow';
  const run = await claim(owner, id);
  if (!run) return 'already_started_or_finished';
  if (run.kind === 'topic_insight') {
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
    const queuedSources: { url: string; generationId: string }[] = [];
    let failed = 0;
    for (const item of batch.items) {
      if (item.kind !== 'url') continue;
      const status =
        item.status === 'completed'
          ? 'completed'
          : await importSourceItem(owner, batch.id, item.id);
      if (status !== 'completed') {
        failed++;
        continue;
      }
      const generationId = await createPrivateGeneration(owner, run.id, batch.id, item.id);
      if (generationId) {
        generationIds.push(generationId);
        queuedSources.push({ url: item.url, generationId });
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
    for (const generationId of generationIds) await dispatchGeneration(owner, generationId);
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
  const run = await store.claimAutomationRun({
    pool: automationPool,
    owner,
    id,
    limits: automationLimits(),
  });
  return run ? { id: run.id, kind: run.snapshot.kind, lease_token: run.lease_token } : null;
}
claim.maxRetries = 0;
async function findSources(owner: string, id: string) {
  'use step';
  return discoverSources(owner, id);
}
findSources.maxRetries = 0;
async function createSourceBatch(
  owner: string,
  runId: string,
  urls: string[],
): Promise<SourceBatch> {
  'use step';
  const run = await store.readAutomationRun({ pool: automationPool, owner, id: runId });
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
async function importSourceItem(owner: string, batchId: string, itemId: string) {
  'use step';
  const result = (await runImportItem(owner, batchId, itemId)) as unknown as { status: string };
  return result.status;
}
importSourceItem.maxRetries = 0;
async function createPrivateGeneration(
  owner: string,
  runId: string,
  batchId: string,
  itemId: string,
) {
  'use step';
  try {
    const run = await store.readAutomationRun({ pool: automationPool, owner, id: runId });
    if (
      run.status !== 'running' ||
      run.snapshot.kind !== 'source_collection' ||
      !run.snapshot.profileId ||
      !run.snapshot.profileRevision
    )
      throw new Error('stale_attempt');
    const id = automationStableId({ runId, itemId, kind: 'generation' });
    await executeGeneration(owner, {
      action: 'create',
      id,
      batchId,
      itemId,
      profileId: run.snapshot.profileId,
      profileRevision: run.snapshot.profileRevision,
      consent: true,
    });
    const queued = await queueGeneration(owner, id);
    return queued.status === 'pending' ? id : null;
  } catch {
    return null;
  }
}
createPrivateGeneration.maxRetries = 0;
async function finishSourceRun(
  owner: string,
  id: string,
  token: string,
  result: {
    batchId?: string;
    generationIds: string[];
    queuedSources: { url: string; generationId: string }[];
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
    queuedSources: { url: string; generationId: string }[];
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
async function dispatchGeneration(owner: string, id: string) {
  'use step';
  await start(signalGenerationWorkflow, [owner, id]);
}
dispatchGeneration.maxRetries = 0;
async function startTopicWorker(owner: string, id: string) {
  'use step';
  return startTopicInsightSandbox(owner, id);
}
startTopicWorker.maxRetries = 0;
async function pollTopicWorker(handle: TopicInsightSandboxHandle) {
  'use step';
  return pollTopicInsightSandbox(handle);
}
pollTopicWorker.maxRetries = 3;
async function stopTopicWorker(handle: TopicInsightSandboxHandle) {
  'use step';
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
