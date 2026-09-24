import type { GenerationSource } from './signal-generation-contract.mjs';

export interface CandidateSourceSupplement {
  batchId: string;
  itemId: string;
  fence: number;
  contentHash: string;
  /**
   * Declared URL only, never a public verification or usage permission.
   * Required when supplement text repeats the original source; only one such
   * attribution is accepted because supplemental content hashes remain unique.
   */
  sourceUrl: string | null;
  source: GenerationSource;
}
export interface CandidateSourceProvenance {
  fragmentId: string;
  kind: 'original' | 'supplement';
  originalFragmentId: string;
  batchId: string | null;
  itemId: string | null;
  fence: number | null;
  contentHash: string | null;
  sourceUrl: string | null;
}
export interface CandidateSourceBundle {
  version: 'candidate-source-bundle-v1';
  baseMaterialHash: string;
  sourceBundleHash: string;
  source: GenerationSource;
  provenance: CandidateSourceProvenance[];
}
export class CandidateSourceBundleError extends Error {
  readonly code: 'invalid_candidate_source_bundle';
}
export function buildCandidateSourceBundle(input: {
  baseMaterialHash: string;
  source: GenerationSource;
  supplements: CandidateSourceSupplement[];
}): CandidateSourceBundle;
export function validateCandidateSourceBundle(bundle: unknown): CandidateSourceBundle;
