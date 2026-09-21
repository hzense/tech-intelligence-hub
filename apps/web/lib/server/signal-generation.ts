import 'server-only';
import pg from 'pg';
import * as store from '../../../../packages/database/src/signal-generation-store.mjs';
import {
  assertGenerationRole,
  assertGenerationHistoryRole,
} from '../../../../packages/database/src/signal-generation-role.mjs';
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
  generationDto,
  GenerationError,
} from '../signal-generation-core';
import {
  readGenerationConfiguration,
  readGenerationDatabaseConfiguration,
} from '../signal-generation-config';
import { invokeSignalGeneration } from '../signal-generation-provider';
import { createGenerationSourceInspector } from '../signal-generation-source-inspection';
import { buildCandidateReview } from '../candidate-review';

let pool: pg.Pool | undefined;
let poolUrl: string | undefined;
function makeGenerationPool(history = false) {
  return {
    async connect() {
      // A database connection authorizes neither task mutation nor provider spending.
      const config = readGenerationDatabaseConfiguration(process.env);
      if (poolUrl && poolUrl !== config.connectionString)
        throw new GenerationError('not_configured');
      if (!pool) {
        poolUrl = config.connectionString;
        pool = new pg.Pool({
          connectionString: poolUrl,
          max: 1,
          idleTimeoutMillis: 10000,
          connectionTimeoutMillis: 3500,
          query_timeout: 15000,
          allowExitOnIdle: true,
          enableChannelBinding: true,
          application_name: 'hzense-private-generation',
        });
        pool.on('error', () => console.error('generation_pool_unavailable'));
      }
      const client = await pool.connect();
      try {
        await (history ? assertGenerationHistoryRole : assertGenerationRole)(client);
        return client;
      } catch (error) {
        client.release(true);
        throw error;
      }
    },
  };
}
const generationPool = makeGenerationPool();
const generationHistoryPool = makeGenerationPool(true);
const historyOptions = () => ({
  pool: generationHistoryPool,
  readOnly: true,
  legacyReadOnly: process.env.HZENSE_GENERATION_WORKFLOW_ENABLED !== '1',
});
export function generationConfigured() {
  try {
    if (process.env.HZENSE_GENERATION_WORKFLOW_ENABLED !== '1') return false;
    readGenerationConfiguration(process.env);
    readAiBackendConfiguration(process.env);
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
async function historyDtos(owner: string, runs: store.SignalGenerationRun[]) {
  const itemIds = [...new Set(runs.map((run) => run.item_id).filter(Boolean))];
  const labels =
    importsConfigured() && itemIds.length
      ? await getImportItemLabels({ pool: importPool, owner, itemIds }).catch(() => [])
      : [];
  const names = new Map(labels.map((item) => [item.id, item.name ?? item.url ?? '未命名资料']));
  return runs.map((run) => ({
    ...generationDto(run),
    // Compatibility mode is deliberately read-only until 0019/ACL enablement.
    ...(process.env.HZENSE_GENERATION_WORKFLOW_ENABLED !== '1' ? { can_delete: false } : {}),
    ...(names.has(run.item_id) ? { source_name: names.get(run.item_id) } : {}),
  }));
}
export async function generationDashboard(owner: string) {
  if (!generationHistoryConfigured()) throw new GenerationError('not_configured');
  // Keep history available if accounting cannot be read; never substitute zero.
  const dailyUsage = await store
    .getSignalGenerationDailyUsage({ pool: generationHistoryPool, owner })
    .catch(() => null);
  // History does not depend on import, AI credentials, budgets or the spend switch.
  if (!generationConfigured()) {
    const runs = await store.listSignalGenerations({ ...historyOptions(), owner });
    return { runs: await historyDtos(owner, runs), profiles: [], batches: [], dailyUsage };
  }
  const [runs, ai, batches] = await Promise.all([
    store.listSignalGenerations({ ...historyOptions(), owner }),
    // Selection data is optional: an ancillary outage must not hide saved runs.
    getAiDashboard().catch(() => null),
    listImportBatches({ pool: importPool, owner, view: 'sources' }).catch(() => []),
  ]);
  return {
    runs: await historyDtos(owner, runs),
    dailyUsage,
    profiles: (ai?.profiles ?? []).map(({ id, revision, name, readiness, stages }) => {
      const connection = ai?.connections.find((item) => item.id === stages.extract.connection_id);
      return {
        id,
        revision,
        name,
        readiness,
        provider_host: connection ? new URL(connection.base_url).hostname : '',
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
    await historyDtos(owner, [await store.getSignalGeneration({ ...historyOptions(), owner, id })])
  )[0];
}
export async function candidateReviewDetail(owner: string, id: string, index: number) {
  if (!generationHistoryConfigured()) throw new GenerationError('not_configured');
  const run = await store.getSignalGeneration({ ...historyOptions(), owner, id });
  return buildCandidateReview(run, index);
}
export async function executeGeneration(owner: string, body: unknown) {
  if (!generationConfigured()) throw new GenerationError('not_configured');
  const config = readGenerationConfiguration(process.env);
  const ai = readAiBackendConfiguration(process.env);
  const execute = createGenerationExecutor({
    source,
    access: generationAiAccess,
    invoke: invokeSignalGeneration,
    allowedHosts: ai.allowedHosts,
    report: (event) => console.info(JSON.stringify(event)),
    progress: (owner, id, token, phase) =>
      store.updateSignalGenerationProgress({ pool: generationPool, owner, id, token, phase }),
    create: (owner, args) =>
      store.createSignalGeneration({
        pool: generationPool,
        owner,
        request: args.request,
        snapshot: args.snapshot,
        ...(args.retryOf ? { retryOf: args.retryOf } : {}),
        configuration: {
          version: 'private-candidate-v1',
          batchLimitMicrousd: config.batch,
          dailyLimitMicrousd: config.daily,
          reserveMicrousd: args.reserveMicrousd,
        },
      }),
    get: (owner, id) => store.getSignalGeneration({ pool: generationPool, owner, id }),
    claim: (owner, id) =>
      store.claimSignalGeneration({
        pool: generationPool,
        owner,
        id,
        currentLimits: { batchLimitMicrousd: config.batch, dailyLimitMicrousd: config.daily },
      }),
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
  return generationDto(await store.queueSignalGeneration({ pool: generationPool, owner, id }));
}

export async function failQueuedGeneration(owner: string, id: string) {
  await store.failQueuedSignalGeneration({ pool: generationPool, owner, id });
}
