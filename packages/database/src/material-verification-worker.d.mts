import type { MaterialPlan, MaterialVerificationCheck } from './material-registration-contract.mjs';
import type { CandidateSourceBundle } from '../../ingestion/src/candidate-source-bundle.mjs';

export class MaterialWorkerError extends Error {
  code: string;
  constructor(code?: string);
}
export type MaterialWorkerRequest = {
  requestId: string;
  owner: string;
  runId: string;
  candidateIndex: number;
  baseMaterialHash: string;
  bundle: CandidateSourceBundle;
  originalSourceUrl: string | null;
  candidate: {
    title: string;
    summary: string;
    event_date: string | null;
    persons: Array<{ name: string; role: string; organization: string | null }>;
    organizations: string[];
    claims: Array<{ text: string }>;
  };
  catalog: {
    topics: Array<{ id: string; title: string; runtime_enabled?: boolean; status?: string }>;
    entities: Array<{
      id: string;
      type: string;
      name: string;
      aliases: string[] | null;
      status: string;
    }>;
    sources: Array<{
      id: string;
      name: string;
      url: string;
      allowed_hosts: string[];
      active: boolean;
    }>;
  };
};
export type MaterialReviewDecision = { approved: true; rationale: string };
export type MaterialReviewDossier = {
  version: 'reviewed-material-dossier-v1';
  requestId: string;
  planHash: string;
  sourceBundleHash: string;
  approvedBy: string;
  approvedAt: string;
  expiresAt: string;
  checks: Record<MaterialVerificationCheck, MaterialReviewDecision>;
  sources: Array<{
    sourceUrl: string;
    excerptHashes: string[];
    authenticity: MaterialReviewDecision;
    usageRights: MaterialReviewDecision & { basis: string };
  }>;
  eventDate: { value: string; evidenceId: string; quote: string; rationale: string };
};
export type MaterialVerificationAssessment = Readonly<{
  requestId: string;
  planHash: string;
  dossierHash: string;
  approvedBy: string;
  expiresAt: string;
  evidence: ReadonlyArray<
    Readonly<{ id: string; contentHash: string; liveTextHash: string; fetchedAt: string }>
  >;
}>;
export function materialReviewDossierHash(dossier: unknown): string;
export function assessMaterialVerification(input: {
  request: MaterialWorkerRequest;
  plan: MaterialPlan;
  dossier: MaterialReviewDossier;
  fetchSource(url: string): Promise<{ sourceUrl: string; text: string; fetchedAt: string }>;
  clock?: () => Date;
}): Promise<MaterialVerificationAssessment>;
export function signMaterialVerification(input: {
  assessment: MaterialVerificationAssessment;
  approvedDossierHash: string;
  keyId: string;
  verifierId: string;
  privateKey: string;
  now?: Date;
  ttlMs?: number;
}): { keyId: string; payload: string; signature: string };
