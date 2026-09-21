import type { CandidateReviewRequest } from './candidate-review-store.mjs';
import type { SignalGenerationRun } from './signal-generation-store.mjs';
export class CandidateReviewError extends Error {
  code: string;
  constructor(code?: string);
}
export function normalizeCandidateReviewRequest(value: unknown): CandidateReviewRequest;
export function candidateReviewMaterialHash(run: SignalGenerationRun, index: number): string;
export function reviewUuid(value: unknown): string;
export function reviewOwner(value: unknown): string;
