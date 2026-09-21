export class CandidatePublicationError extends Error {
  readonly code: string;
}
export interface ReviewedIdentity {
  runId: string;
  candidateIndex: number;
  expectedReviewRevision: number;
  materialHash: string;
}
export interface ConversionReceipt {
  request_key: string;
  review_id: string;
  signal_id: string;
  source_version: number;
}
interface Base<R = ReviewedIdentity> {
  pool: ImportPool;
  owner: string;
  request: R;
}
export function prepareReviewedSignalCandidate(
  input: Base<ReviewedIdentity & { requestKey: string }>,
): Promise<ConversionReceipt & { outcome: 'prepared' | 'replay' }>;
export function inspectReviewedCandidate(
  input: Base & { verificationPool?: ImportPool; publisherPool?: ImportPool },
): Promise<{
  reviewId: string;
  reviewRevision: number;
  conversion: ConversionReceipt | null;
  verification: {
    verification_id: string;
    decision: string;
    expires_at: Date;
    current: boolean;
  } | null;
  assembly: { verification_id: string; target_version: number } | null;
  publication: {
    publication_revision: number;
    content_version: number;
    status: string;
    current_public: boolean;
  } | null;
  readiness: string;
}>;
export function readReviewedPublicationMaterial(
  input: Base & { verificationPool: ImportPool },
): Promise<{
  scope: string;
  bundle_fingerprint: string;
  bundle: { snapshot: { content_hash: string; [key: string]: unknown }; [key: string]: unknown };
  [key: string]: unknown;
}>;
export function recordReviewedVerification(
  input: Base<
    ReviewedIdentity & {
      report: Record<string, unknown>;
      attestation: { keyId: string; payload: string; signature: string };
    }
  > & { verificationPool: ImportPool },
): Promise<{ scope: string; outcome: string; record: Record<string, unknown> }>;
export function assembleReviewedVerifiedCandidate(
  input: Base<ReviewedIdentity & { verificationId: string; requestKey: string }> & {
    verificationPool: ImportPool;
  },
): Promise<{ scope: string; outcome: string; receipt: Record<string, unknown> }>;
export function publishReviewedSignal(
  input: Base<
    ReviewedIdentity & {
      requestKey: string;
      expectedPublicationRevision: number;
      reasonCode: string;
    }
  > & {
    publisherPool: ImportPool;
    controlPool: ImportPool;
    trustedControl: { taskId: string; principalId: string };
  },
): Promise<PublicPublicationReceipt & { control_cleanup_pending?: boolean }>;
export function withdrawReviewedSignal(
  input: Base<
    ReviewedIdentity & {
      requestKey: string;
      expectedPublicationRevision: number;
      reasonCode: string;
    }
  > & { publisherPool: ImportPool },
): Promise<PublicPublicationReceipt>;
import type { ImportPool } from './import-store.mjs';
import type { PublicPublicationReceipt } from './signal-publication-service-store.mjs';
