import type { ImportPool } from './import-store.mjs';
export class SignalGenerationError extends Error {
  code: string;
  previousId?: string;
  constructor(code: string);
}
export interface SignalGenerationConfiguration {
  version: string;
  batchLimitMicrousd: number;
  dailyLimitMicrousd: number;
  reserveMicrousd: number;
}
export interface SignalGenerationRequest {
  id: string;
  batchId: string;
  itemId: string;
  sourceFence: number;
  sourceHash: string;
  profileId: string;
  profileRevision: number;
}
export interface SignalGenerationSnapshot {
  source: unknown;
  profile: unknown;
  connection: unknown;
}
export interface SignalGenerationRun {
  id: string;
  owner_id: string;
  batch_id: string;
  item_id: string;
  source_fence: number;
  source_hash: string;
  profile_id: string;
  profile_revision: number;
  generation_version: string;
  fingerprint: string;
  snapshot: SignalGenerationSnapshot;
  configuration: SignalGenerationConfiguration;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'unknown' | 'cancelled';
  lease_token: string | null;
  lease_until: Date | string | null;
  budget_day: Date | string | null;
  reserved_microusd: string;
  charged_microusd: string;
  result: unknown | null;
  error_code: string | null;
  created_at: Date | string;
  finished_at: Date | string | null;
  deleted_at?: Date | string | null;
  progress_phase?: 'queued' | 'preparing' | 'generating' | 'validating' | 'saving' | null;
  progress_at?: Date | string | null;
  started_at?: Date | string | null;
}
interface Owned {
  pool: ImportPool;
  owner: string;
}
interface RunArgs extends Owned {
  id: string;
}
export function signalGenerationSourceHash(source: unknown): string;
export function createSignalGeneration(
  args: Owned & {
    request: SignalGenerationRequest;
    snapshot: SignalGenerationSnapshot;
    configuration: SignalGenerationConfiguration;
    retryOf?: string;
  },
): Promise<SignalGenerationRun>;
export function getSignalGeneration(
  args: RunArgs & { readOnly?: boolean; legacyReadOnly?: boolean },
): Promise<SignalGenerationRun>;
export function listSignalGenerations(
  args: Owned & { batchId?: string; itemId?: string; readOnly?: boolean; legacyReadOnly?: boolean },
): Promise<SignalGenerationRun[]>;
export function claimSignalGeneration(
  args: RunArgs & { currentLimits: { batchLimitMicrousd: number; dailyLimitMicrousd: number } },
): Promise<{ claimed: boolean; run: SignalGenerationRun }>;
export function finishSignalGeneration(
  args: RunArgs & {
    token: string;
    outcome: 'completed' | 'failed' | 'unknown';
    result?: unknown;
    chargedMicrousd?: number;
    errorCode?: string | null;
  },
): Promise<SignalGenerationRun>;
export function cancelSignalGeneration(args: RunArgs): Promise<SignalGenerationRun>;

export function deleteSignalGeneration(args: RunArgs): Promise<{ id: string; deleted: boolean }>;
export function queueSignalGeneration(args: RunArgs): Promise<SignalGenerationRun>;
export function updateSignalGenerationProgress(
  args: RunArgs & {
    token: string;
    phase: 'generating' | 'validating' | 'saving';
  },
): Promise<void>;
export function failQueuedSignalGeneration(args: RunArgs): Promise<void>;
