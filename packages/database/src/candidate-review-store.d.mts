import type { ImportPool } from './import-store.mjs';
export { CandidateReviewError } from './candidate-review-contract.mjs';
export interface CandidateReviewDraft {
  title: string;
  summary: string;
  eventDate: string | null;
  sourceUrls: string[];
  personIds: string[];
  organizationIds: string[];
  topicIds: string[];
  eventKey: string;
  publicEvidenceIds: string[];
  claims: { text: string; evidenceId: string }[];
}
export interface CandidateReviewRequest {
  requestId: string;
  runId: string;
  candidateIndex: number;
  materialHash: string;
  expectedRevision: number;
  decision: 'draft' | 'needs_evidence' | 'rejected' | 'submit_verification';
  note: string;
  draft: CandidateReviewDraft;
}
export interface CandidateReviewRecord {
  id: string;
  run_id: string;
  candidate_index: number;
  revision: number;
  decision: CandidateReviewRequest['decision'];
  note: string;
  draft: CandidateReviewDraft;
  material_hash: string;
  created_at: Date | string;
}
export function saveCandidateReview(args: {
  pool: ImportPool;
  owner: string;
  request: CandidateReviewRequest;
  materialHash: string;
}): Promise<CandidateReviewRecord>;
export function readCandidateReviews(args: {
  pool: ImportPool;
  owner: string;
  runId: string;
  candidateIndex: number;
}): Promise<CandidateReviewRecord[]>;
