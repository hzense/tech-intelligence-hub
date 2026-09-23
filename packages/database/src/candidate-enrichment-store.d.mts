import type { ImportPool } from './import-store.mjs';

export type CandidateEnrichmentRun = {
  id: string;
  owner_id: string;
  run_id: string;
  candidate_index: number;
  material_hash: string;
  profile_id: string;
  profile_revision: number;
  fingerprint: string;
  snapshot: Record<string, unknown>;
  configuration: Record<string, unknown>;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'unknown';
  lease_token: string | null;
  lease_until: string | null;
  budget_day: string | null;
  reserved_microusd: string;
  charged_microusd: string;
  result: Record<string, unknown> | null;
  error_code: string | null;
  progress_phase: string | null;
  progress_at: string | null;
  started_at: string | null;
  created_at: string;
  finished_at: string | null;
};
export class CandidateEnrichmentStoreError extends Error {
  readonly code: string;
}
type Owned = { pool: ImportPool; owner: string };
type Task = Owned & { id: string };
export function createCandidateEnrichment(
  input: Owned & Record<string, unknown>,
): Promise<CandidateEnrichmentRun>;
export function getCandidateEnrichment(input: Task): Promise<CandidateEnrichmentRun>;
export function listCandidateEnrichments(
  input: Owned & { runId: string; candidateIndex: number },
): Promise<CandidateEnrichmentRun[]>;
export function queueCandidateEnrichment(input: Task): Promise<CandidateEnrichmentRun>;
export function claimCandidateEnrichment(
  input: Task & { currentLimits: { batchLimitMicrousd: number; dailyLimitMicrousd: number } },
): Promise<{ claimed: boolean; run: CandidateEnrichmentRun }>;
export function updateCandidateEnrichmentProgress(
  input: Task & { token: string; phase: string },
): Promise<CandidateEnrichmentRun>;
export function finishCandidateEnrichment(
  input: Task & Record<string, unknown>,
): Promise<CandidateEnrichmentRun>;
export function failQueuedCandidateEnrichment(input: Task): Promise<CandidateEnrichmentRun>;
