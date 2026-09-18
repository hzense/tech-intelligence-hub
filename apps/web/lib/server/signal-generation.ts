import 'server-only';
import pg from 'pg';
import * as store from '../../../../packages/database/src/signal-generation-store.mjs';
import { assertGenerationRole } from '../../../../packages/database/src/signal-generation-role.mjs';
import {
  getImportBatch,
  getImportOutput,
  listImportBatches,
} from '../../../../packages/database/src/import-store.mjs';
import { importPool, importsConfigured } from './import-service';
import { generationAiAccess, getAiDashboard } from './admin-ai';
import { readAiBackendConfiguration } from '../admin-ai-core';
import {
  createGenerationExecutor,
  generationDto,
  GenerationError,
} from '../signal-generation-core';
import { readGenerationConfiguration } from '../signal-generation-config';
import { invokeSignalGeneration } from '../signal-generation-provider';
import { createGenerationSourceInspector } from '../signal-generation-source-inspection';

let pool: pg.Pool | undefined;
let poolUrl: string | undefined;
const generationPool = {
  async connect() {
    const config = readGenerationConfiguration(process.env);
    if (poolUrl && poolUrl !== config.connectionString) throw new GenerationError('not_configured');
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
      await assertGenerationRole(client);
      return client;
    } catch (error) {
      client.release(true);
      throw error;
    }
  },
};
export function generationConfigured() {
  try {
    readGenerationConfiguration(process.env);
    readAiBackendConfiguration(process.env);
    return importsConfigured();
  } catch {
    return false;
  }
}
async function source(owner: string, batchId: string, itemId: string) {
  const batch = await getImportBatch({ pool: importPool, owner, id: batchId });
  const item = batch.items.find((row) => row.id === itemId);
  if (batch.cancelled) throw new GenerationError('cancelled');
  if (!item || item.status !== 'completed') throw new GenerationError('source_unavailable');
  return {
    fence: item.fence,
    output: await getImportOutput({ pool: importPool, owner, batchId, itemId }),
  };
}
export async function generationDashboard(owner: string) {
  if (!generationConfigured()) throw new GenerationError('not_configured');
  const [runs, ai, batches] = await Promise.all([
    store.listSignalGenerations({ pool: generationPool, owner }),
    getAiDashboard(),
    listImportBatches({ pool: importPool, owner }),
  ]);
  return {
    runs: runs.map(generationDto),
    profiles: ai.profiles.map(({ id, revision, name, readiness, stages }) => {
      const connection = ai.connections.find((item) => item.id === stages.extract.connection_id);
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
  if (!generationConfigured()) throw new GenerationError('not_configured');
  return generationDto(await store.getSignalGeneration({ pool: generationPool, owner, id }));
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
    create: (owner, args) =>
      store.createSignalGeneration({
        pool: generationPool,
        owner,
        request: args.request,
        snapshot: args.snapshot,
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
