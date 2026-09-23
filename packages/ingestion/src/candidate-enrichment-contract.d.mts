import type { GeneratedCandidate } from './signal-generation-contract.mjs';

export const candidateEnrichmentJsonSchema: Readonly<Record<string, unknown>>;
export class CandidateEnrichmentError extends Error {
  readonly code: string;
}
export function assessCandidateEnrichment(
  value: unknown,
  candidate: Record<string, unknown>,
  source: unknown,
): {
  classification: 'private';
  validation_version: 1;
  candidate: GeneratedCandidate;
};
