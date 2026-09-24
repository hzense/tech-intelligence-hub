import 'server-only';
import { Buffer } from 'node:buffer';
import { isDeepStrictEqual } from 'node:util';
import pg from 'pg';
import type { GenerationSource } from '../../../../packages/ingestion/src/signal-generation-contract.mjs';
import * as store from '../../../../packages/database/src/candidate-enrichment-store.mjs';
import { assertCandidateEnrichmentRole } from '../../../../packages/database/src/signal-generation-role.mjs';
import { signalGenerationProfileIdentity } from '../../../../packages/database/src/signal-generation-store.mjs';
import { aiUuid } from '../../../../packages/database/src/ai-config-contract.mjs';
import { buildCandidateReview } from '../candidate-review';
import { enrichmentRules, invokeCandidateEnrichment } from '../candidate-enrichment-provider';
import { generationCost, GenerationError } from '../signal-generation-core';
import {
  readGenerationConfiguration,
  readGenerationDatabaseConfiguration,
} from '../signal-generation-config';
import { readAiBackendConfiguration } from '../admin-ai-core';
import { aiStageAccess } from './admin-ai';
import { generationRecord } from './signal-generation';
import {
  materialEnrichmentInput,
  materialEnrichmentRules,
  type MaterialEnrichmentContext,
} from '../material-enrichment';
import type { CandidateSourceBundle } from '../../../../packages/ingestion/src/candidate-source-bundle.mjs';

let pool: pg.Pool | undefined;
let poolUrl: string | undefined;
export const candidateEnrichmentPool = {
  async connect() {
    const config = readGenerationDatabaseConfiguration(process.env);
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
        application_name: 'hzense-candidate-enrichment',
      });
      pool.on('error', () => console.error('candidate_enrichment_pool_unavailable'));
    }
    const client = await pool.connect();
    try {
      await assertCandidateEnrichmentRole(client);
      return client;
    } catch (error) {
      client.release(true);
      throw error;
    }
  },
};

export function candidateEnrichmentConfigured() {
  try {
    if (process.env.HZENSE_GENERATION_WORKFLOW_ENABLED !== '1') return false;
    readGenerationConfiguration(process.env);
    readAiBackendConfiguration(process.env);
    return true;
  } catch {
    return false;
  }
}

export function candidateEnrichmentDto(run: store.CandidateEnrichmentRun) {
  const expired =
    run.status === 'running' &&
    (run.lease_until === null || new Date(run.lease_until).getTime() <= Date.now());
  return {
    id: run.id,
    run_id: run.run_id,
    candidate_index: run.candidate_index,
    material_hash: run.material_hash,
    material_request_id: run.snapshot.materialRequestId ?? null,
    profile_id: run.profile_id,
    profile_revision: run.profile_revision,
    status: expired || run.status === 'unknown' ? 'failed' : run.status,
    result: run.result,
    error_code: expired ? 'outcome_unknown' : run.error_code,
    progress_phase: run.progress_phase,
    progress_at: run.progress_at,
    started_at: run.started_at,
    created_at: run.created_at,
    finished_at: run.finished_at,
    reserved_microusd: run.reserved_microusd,
    charged_microusd: run.charged_microusd,
  };
}

function request(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new GenerationError('invalid_request');
  const body = value as Record<string, unknown>;
  if (
    Object.keys(body).sort().join(',') !== 'candidateIndex,consent,id,materialHash,runId' ||
    body.consent !== true ||
    !Number.isInteger(body.candidateIndex) ||
    Number(body.candidateIndex) < 0 ||
    Number(body.candidateIndex) > 4 ||
    typeof body.materialHash !== 'string' ||
    !/^[a-f0-9]{64}$/.test(body.materialHash)
  )
    throw new GenerationError('invalid_request');
  return {
    id: aiUuid(body.id),
    runId: aiUuid(body.runId),
    candidateIndex: Number(body.candidateIndex),
    materialHash: body.materialHash,
  };
}

export async function createCandidateEnrichment(
  owner: string,
  input: unknown,
  material?: {
    requestId: string;
    bundle: CandidateSourceBundle;
    context: MaterialEnrichmentContext;
  },
) {
  if (!candidateEnrichmentConfigured()) throw new GenerationError('not_configured');
  const value = request(input);
  const generation = await generationRecord(owner, value.runId);
  const packet = buildCandidateReview(generation, value.candidateIndex);
  if (packet.materialHash !== value.materialHash) throw new GenerationError('material_changed');
  if (material && material.bundle.baseMaterialHash !== packet.materialHash)
    throw new GenerationError('material_changed');
  const selected = material
    ? materialEnrichmentInput(material.bundle, packet.candidate)
    : { source: generation.snapshot.source, candidate: packet.candidate };
  const identityHash = material?.bundle.sourceBundleHash ?? value.materialHash;
  // A replay of a saved bundle must not change its catalog/model snapshot.
  if (material) {
    const existing = (
      await store.listCandidateEnrichments({
        pool: candidateEnrichmentPool,
        owner,
        runId: value.runId,
        candidateIndex: value.candidateIndex,
        materialHash: identityHash,
      })
    ).find((row) => row.material_hash === identityHash && row.status !== 'failed');
    if (existing) return candidateEnrichmentDto(existing);
  }
  const access = await aiStageAccess(generation.profile_id, generation.profile_revision, 'verify');
  const stage = access.profile.stages.verify;
  const config = readGenerationConfiguration(process.env);
  const inputBound =
    Buffer.byteLength(
      JSON.stringify({
        source: selected.source,
        candidate: selected.candidate,
        ...(material ? { context: material.context } : {}),
      }),
    ) +
    Buffer.byteLength(stage.prompt) +
    Buffer.byteLength(enrichmentRules) +
    (material ? Buffer.byteLength(materialEnrichmentRules) : 0) +
    12000;
  const reserveMicrousd = Math.max(
    1,
    generationCost(inputBound, stage.max_output_tokens, access.connection.settings),
  );
  return candidateEnrichmentDto(
    await store.createCandidateEnrichment({
      pool: candidateEnrichmentPool,
      owner,
      request: {
        id: value.id,
        runId: value.runId,
        candidateIndex: value.candidateIndex,
        materialHash: identityHash,
        profileId: generation.profile_id,
        profileRevision: generation.profile_revision,
      },
      snapshot: {
        materialHash: identityHash,
        source: selected.source,
        candidate: selected.candidate,
        ...(material
          ? {
              baseMaterialHash: value.materialHash,
              materialRequestId: material.requestId,
              materialContext: material.context,
            }
          : {}),
        profile: access.profile,
        connection: access.connection,
      },
      configuration: {
        version: 'candidate-enrichment-v1',
        batchLimitMicrousd: config.batch,
        dailyLimitMicrousd: config.daily,
        reserveMicrousd,
      },
    }),
  );
}

export async function listCandidateEnrichmentDtos(
  owner: string,
  runId: string,
  candidateIndex: number,
  materialHash?: string,
) {
  // History and already completed proposals remain readable with AI disabled.
  readGenerationDatabaseConfiguration(process.env);
  return (
    await store.listCandidateEnrichments({
      pool: candidateEnrichmentPool,
      owner,
      runId,
      candidateIndex,
      ...(materialHash === undefined ? {} : { materialHash }),
    })
  ).map(candidateEnrichmentDto);
}

export async function candidateEnrichmentDetail(owner: string, id: string) {
  readGenerationDatabaseConfiguration(process.env);
  return candidateEnrichmentDto(
    await store.getCandidateEnrichment({ pool: candidateEnrichmentPool, owner, id }),
  );
}

export async function queueCandidateEnrichment(owner: string, id: string) {
  return candidateEnrichmentDto(
    await store.queueCandidateEnrichment({ pool: candidateEnrichmentPool, owner, id }),
  );
}

export async function failQueuedCandidateEnrichment(owner: string, id: string) {
  await store.failQueuedCandidateEnrichment({ pool: candidateEnrichmentPool, owner, id });
}

export async function executeCandidateEnrichment(owner: string, id: string) {
  const config = readGenerationConfiguration(process.env);
  const ai = readAiBackendConfiguration(process.env);
  const admission = await store.claimCandidateEnrichment({
    pool: candidateEnrichmentPool,
    owner,
    id,
    currentLimits: { batchLimitMicrousd: config.batch, dailyLimitMicrousd: config.daily },
  });
  const run = admission.run;
  if (!admission.claimed) return candidateEnrichmentDto(run);
  let sent = false;
  let chargedMicrousd = 0;
  let providerCostMicrousd: number | undefined;
  let finishing = false;
  try {
    const beforeCall = buildCandidateReview(
      await generationRecord(owner, run.run_id),
      run.candidate_index,
    );
    if (beforeCall.materialHash !== (run.snapshot.baseMaterialHash ?? run.material_hash))
      throw new GenerationError('material_changed');
    const access = await aiStageAccess(run.profile_id, run.profile_revision, 'verify', true);
    if (
      !isDeepStrictEqual(
        signalGenerationProfileIdentity(access.profile),
        signalGenerationProfileIdentity(run.snapshot.profile),
      ) ||
      !isDeepStrictEqual(access.connection, run.snapshot.connection) ||
      !access.apiKey
    )
      throw new GenerationError('configuration_changed');
    await store.updateCandidateEnrichmentProgress({
      pool: candidateEnrichmentPool,
      owner,
      id,
      token: run.lease_token!,
      phase: 'generating',
    });
    sent = true;
    const result = await invokeCandidateEnrichment({
      source: run.snapshot.source as GenerationSource,
      candidate: run.snapshot.candidate as Record<string, unknown>,
      stage: access.profile.stages.verify,
      connection: access.connection,
      apiKey: access.apiKey,
      allowedHosts: ai.allowedHosts,
      ...(run.snapshot.materialContext
        ? { materialContext: run.snapshot.materialContext as MaterialEnrichmentContext }
        : {}),
    });
    providerCostMicrousd =
      typeof result.provider_cost_microusd === 'number' &&
      Number.isSafeInteger(result.provider_cost_microusd) &&
      result.provider_cost_microusd >= 0
        ? result.provider_cost_microusd
        : undefined;
    chargedMicrousd =
      result.input_tokens !== null && result.output_tokens !== null
        ? generationCost(result.input_tokens, result.output_tokens, access.connection.settings)
        : 0;
    await store
      .updateCandidateEnrichmentProgress({
        pool: candidateEnrichmentPool,
        owner,
        id,
        token: run.lease_token!,
        phase: 'validating',
      })
      .catch(() => undefined); // Advisory progress must not discard an already paid result.
    const current = buildCandidateReview(
      await generationRecord(owner, run.run_id),
      run.candidate_index,
    );
    if (current.materialHash !== (run.snapshot.baseMaterialHash ?? run.material_hash))
      throw new GenerationError('material_changed');
    finishing = true;
    return candidateEnrichmentDto(
      await store.finishCandidateEnrichment({
        pool: candidateEnrichmentPool,
        owner,
        id,
        token: run.lease_token!,
        outcome: result.success
          ? 'completed'
          : result.error_code === 'enrichment_unknown'
            ? 'unknown'
            : 'failed',
        ...(result.output ? { result: result.output } : {}),
        chargedMicrousd,
        ...(providerCostMicrousd !== undefined ? { providerCostMicrousd } : {}),
        errorCode: result.success ? null : result.error_code,
      }),
    );
  } catch (error) {
    // A lost COMMIT reply must not submit a contradictory completion.
    if (finishing) throw error;
    return candidateEnrichmentDto(
      await store.finishCandidateEnrichment({
        pool: candidateEnrichmentPool,
        owner,
        id,
        token: run.lease_token!,
        outcome: sent ? 'unknown' : 'failed',
        chargedMicrousd,
        ...(!sent
          ? { providerCostMicrousd: 0 }
          : providerCostMicrousd !== undefined
            ? { providerCostMicrousd }
            : {}),
        errorCode: sent ? 'enrichment_unknown' : 'enrichment_failed',
      }),
    );
  }
}
