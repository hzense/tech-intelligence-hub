import { Buffer } from 'node:buffer';
import { isDeepStrictEqual } from 'node:util';
import { aiUuid } from '../../../packages/database/src/ai-config-contract.mjs';
import {
  signalGenerationSourceHash,
  type SignalGenerationRun,
  type SignalGenerationSnapshot,
} from '../../../packages/database/src/signal-generation-store.mjs';
import type { AiProfile, AiConnection } from '../../../packages/database/src/ai-config-store.mjs';
import { buildGenerationSource } from '../../../packages/ingestion/src/signal-generation-contract.mjs';
import {
  generationRules,
  type GenerationProviderInput,
  type GenerationProviderResult,
} from './signal-generation-provider.ts';
import {
  generationElapsedMs,
  generationTimeoutMs,
  safeGenerationDiagnosticCode,
} from './signal-generation-diagnostics.ts';

export class GenerationError extends Error {
  readonly code: string;
  constructor(code: string) {
    super(code);
    this.code = code;
  }
}
const fail = (code = 'invalid_request'): never => {
  throw new GenerationError(code);
};
export type GenerationAccess = {
  profile: AiProfile;
  connection: Pick<AiConnection, 'id' | 'revision' | 'protocol' | 'base_url' | 'settings'>;
  apiKey?: string;
};
export interface GenerationDependencies {
  source(
    owner: string,
    batchId: string,
    itemId: string,
    options?: { requireCanonical?: boolean },
  ): Promise<{ fence: number; output: unknown }>;
  access(profileId: string, revision: number, credentials?: boolean): Promise<GenerationAccess>;
  create(
    owner: string,
    args: {
      request: {
        id: string;
        batchId: string;
        itemId: string;
        sourceFence: number;
        sourceHash: string;
        profileId: string;
        profileRevision: number;
      };
      snapshot: SignalGenerationSnapshot;
      reserveMicrousd: number;
      retryOf?: string;
    },
  ): Promise<SignalGenerationRun>;
  get(owner: string, id: string): Promise<SignalGenerationRun>;
  claim(owner: string, id: string): Promise<{ claimed: boolean; run: SignalGenerationRun }>;
  finish(
    owner: string,
    args: {
      id: string;
      token: string;
      outcome: 'completed' | 'failed' | 'unknown';
      result?: Record<string, unknown>;
      chargedMicrousd?: number;
      errorCode?: string;
    },
  ): Promise<SignalGenerationRun>;
  cancel(owner: string, id: string): Promise<SignalGenerationRun>;
  invoke(input: GenerationProviderInput): Promise<GenerationProviderResult>;
  allowedHosts: readonly string[];
  report?(event: {
    event: 'signal_generation';
    run_id: string;
    phase: 'provider' | 'preflight' | 'postflight' | 'completion';
    outcome: 'completed' | 'failed' | 'unknown' | 'cancelled';
    code: string | null;
    elapsed_ms: number;
    timeout_ms: number;
  }): void;
  progress?(
    owner: string,
    id: string,
    token: string,
    phase: 'generating' | 'validating' | 'saving',
  ): Promise<void>;
}
export function generationCost(input: number, output: number, settings: AiConnection['settings']) {
  if (
    ![
      input,
      output,
      settings.input_price_microusd_per_million,
      settings.output_price_microusd_per_million,
    ].every((x) => Number.isSafeInteger(x) && x >= 0)
  )
    return fail('invalid_configuration');
  const value =
    (BigInt(input) * BigInt(settings.input_price_microusd_per_million) +
      BigInt(output) * BigInt(settings.output_price_microusd_per_million) +
      999999n) /
    1000000n;
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) return fail('budget_exceeded');
  return Number(value);
}
/** Excludes source text, credentials, lease tokens, owner and internal configuration. */
export function generationDto(run: SignalGenerationRun) {
  // Unknown provider outcomes are failed tasks for users. Keep the stored
  // diagnostic and accounting state intact. Retries need a separate explicit request.
  const leaseReleased =
    run.lease_until === null || new Date(run.lease_until).getTime() <= Date.now();
  const expired = run.status === 'running' && leaseReleased;
  return {
    id: run.id,
    retry_of: run.generation_version?.split('/retry/')[1] ?? null,
    batch_id: run.batch_id,
    item_id: run.item_id,
    profile_id: run.profile_id,
    profile_revision: run.profile_revision,
    status: expired || run.status === 'unknown' ? 'failed' : run.status,
    can_delete:
      (run.status !== 'running' || expired) &&
      (!['unknown', 'cancelled'].includes(run.status) || leaseReleased),
    result: run.result,
    error_code: expired ? 'outcome_unknown' : run.error_code,
    progress_phase: run.progress_phase ?? null,
    progress_at: run.progress_at ?? null,
    started_at: run.started_at ?? null,
    finished_at: run.finished_at,
    created_at: run.created_at,
    reserved_microusd: run.reserved_microusd,
    charged_microusd: run.charged_microusd,
  };
}

/** Inputs from the browser identify records only; all source/configuration data comes from stores. */
export function createGenerationExecutor(deps: GenerationDependencies) {
  return async (owner: string, input: unknown): Promise<ReturnType<typeof generationDto>> => {
    if (!input || typeof input !== 'object' || Array.isArray(input)) return fail();
    const body = input as Record<string, unknown>;
    const fields =
      body.action === 'create'
        ? [
            'action',
            'id',
            'batchId',
            'itemId',
            'profileId',
            'profileRevision',
            'consent',
            ...(Object.hasOwn(body, 'retryOf') ? ['retryOf'] : []),
          ]
        : ['action', 'id'];
    if (
      Object.keys(body).some((key) => !fields.includes(key)) ||
      fields.some((key) => !(key in body))
    )
      return fail();
    const id = aiUuid(body.id);
    if (body.action === 'create') {
      if (
        body.consent !== true ||
        !Number.isSafeInteger(body.profileRevision) ||
        Number(body.profileRevision) < 1
      )
        return fail();
      const batchId = aiUuid(body.batchId),
        itemId = aiUuid(body.itemId),
        profileId = aiUuid(body.profileId);
      const retryOf = Object.hasOwn(body, 'retryOf') ? aiUuid(body.retryOf) : undefined;
      const { fence, output } = await deps.source(owner, batchId, itemId, {
        requireCanonical: true,
      });
      const source = buildGenerationSource(output);
      const access = await deps.access(profileId, Number(body.profileRevision));
      const stage = access.profile.stages.extract;
      // One UTF-8 byte per input token plus framing/schema allowance: conservative, not a provider bill.
      const inputBound =
        Buffer.byteLength(JSON.stringify(source)) +
        Buffer.byteLength(stage.prompt) +
        Buffer.byteLength(generationRules) +
        16000;
      const reserveMicrousd = Math.max(
        1,
        generationCost(inputBound, stage.max_output_tokens, access.connection.settings),
      );
      return generationDto(
        await deps.create(owner, {
          request: {
            id,
            batchId,
            itemId,
            sourceFence: fence,
            sourceHash: signalGenerationSourceHash(source),
            profileId,
            profileRevision: access.profile.revision,
          },
          snapshot: { source, profile: access.profile, connection: access.connection },
          reserveMicrousd,
          ...(retryOf ? { retryOf } : {}),
        }),
      );
    }
    if (body.action === 'detail') return generationDto(await deps.get(owner, id));
    if (body.action === 'cancel') return generationDto(await deps.cancel(owner, id));
    if (body.action !== 'run') return fail();
    // A committed lease/admission is mandatory. Uncertain COMMIT never reaches the model.
    const admission = await deps.claim(owner, id);
    const run = admission.run;
    if (!admission.claimed) return generationDto(run);
    let access: GenerationAccess | undefined;
    let sent = false;
    let charged: number | undefined;
    let phase: 'preflight' | 'provider' | 'postflight' = 'preflight';
    let phaseStarted = performance.now();
    const report = (
      at: 'provider' | 'preflight' | 'postflight' | 'completion',
      outcome: 'completed' | 'failed' | 'unknown' | 'cancelled',
      code: string | null,
    ) => {
      try {
        deps.report?.({
          event: 'signal_generation',
          run_id: id,
          phase: at,
          outcome,
          code,
          elapsed_ms: generationElapsedMs(phaseStarted),
          timeout_ms: generationTimeoutMs,
        });
      } catch {
        /* Logging cannot change accounting, trigger retries or discard completion. */
      }
    };
    let completion: Parameters<GenerationDependencies['finish']>[1];
    try {
      const currentSource = await deps.source(owner, run.batch_id, run.item_id);
      const source = buildGenerationSource(currentSource.output);
      if (
        currentSource.fence !== run.source_fence ||
        signalGenerationSourceHash(source) !== run.source_hash
      )
        return fail('source_changed');
      access = await deps.access(run.profile_id, run.profile_revision, true);
      if (
        !access.apiKey ||
        !isDeepStrictEqual(access.profile, run.snapshot.profile) ||
        !isDeepStrictEqual(access.connection, run.snapshot.connection)
      )
        return fail('configuration_changed');
      const latest = await deps.get(owner, id);
      if (latest.status !== 'running' || latest.lease_token !== run.lease_token)
        return generationDto(latest);
      await deps.progress?.(owner, id, run.lease_token!, 'generating');
      sent = true;
      phase = 'provider';
      phaseStarted = performance.now();
      const result = await deps.invoke({
        source,
        stage: access.profile.stages.extract,
        connection: access.connection,
        apiKey: access.apiKey,
        allowedHosts: deps.allowedHosts,
      });
      delete access.apiKey;
      const outcome =
        result.success && result.output
          ? 'completed'
          : result.error_code === 'generation_unknown'
            ? 'unknown'
            : 'failed';
      const code =
        outcome === 'completed'
          ? null
          : (safeGenerationDiagnosticCode(result.diagnostic?.code) ??
            (outcome === 'unknown' ? 'generation_unknown' : 'generation_failed'));
      report('provider', outcome, code);
      charged =
        result.input_tokens !== null && result.output_tokens !== null
          ? generationCost(result.input_tokens, result.output_tokens, access.connection.settings)
          : undefined;
      // Re-check evidence ownership/cancellation and capability state after the external call.
      phase = 'postflight';
      phaseStarted = performance.now();
      await deps.progress?.(owner, id, run.lease_token!, 'validating').catch(() => {});
      await deps.source(owner, run.batch_id, run.item_id);
      const after = await deps.access(run.profile_id, run.profile_revision);
      if (
        !isDeepStrictEqual(after.profile, run.snapshot.profile) ||
        !isDeepStrictEqual(after.connection, run.snapshot.connection)
      )
        return fail('configuration_changed');
      completion = {
        id,
        token: run.lease_token!,
        outcome,
        ...(result.success && result.output
          ? {
              result: {
                ...result.output,
                usage: {
                  input_tokens: result.input_tokens,
                  output_tokens: result.output_tokens,
                },
              },
            }
          : {}),
        ...(charged === undefined ? {} : { chargedMicrousd: charged }),
        ...(code ? { errorCode: code } : {}),
      };
    } catch {
      const code = !sent
        ? 'preflight_failed'
        : phase === 'postflight'
          ? 'generation_postflight_failed'
          : 'generation_unknown';
      report(phase, sent ? 'unknown' : 'failed', code);
      completion = {
        id,
        token: run.lease_token!,
        outcome: sent ? 'unknown' : 'failed',
        ...(charged === undefined ? {} : { chargedMicrousd: charged }),
        errorCode: code,
      };
    } finally {
      if (access) delete access.apiKey;
    }
    // Exactly one completion attempt. An uncertain acknowledgement must be recovered by GET,
    // not by a second, contradictory finish or a second provider invocation.
    phaseStarted = performance.now();
    try {
      // Progress is advisory here: failure to record it must not discard a paid result.
      await deps.progress?.(owner, id, run.lease_token!, 'saving').catch(() => {});
      const finished = await deps.finish(owner, completion);
      const persisted =
        finished.status === 'completed' ||
        finished.status === 'failed' ||
        finished.status === 'cancelled'
          ? finished.status
          : 'unknown';
      report(
        'completion',
        persisted,
        persisted === 'cancelled' ? 'cancelled' : (completion.errorCode ?? null),
      );
      return generationDto(finished);
    } catch (error) {
      report('completion', 'unknown', 'completion_unconfirmed');
      // The response and persisted task are uncertain; never attempt a second completion/call.
      throw error;
    }
  };
}
