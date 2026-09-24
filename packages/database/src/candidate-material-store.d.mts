import type { ImportPool } from './import-store.mjs';
import type { CandidateSourceBundle } from '../../ingestion/src/candidate-source-bundle.mjs';
import type { MaterialPlan } from './material-registration-contract.mjs';

export class CandidateMaterialStoreError extends Error {
  code: string;
  constructor(code?: string);
}
export const materialHistoryLimits: Readonly<{ requests: 10; reports: 3 }>;
interface Owned {
  pool: ImportPool;
  owner: string;
}
export interface MaterialReceiptRecord {
  id: string;
  request_id: string;
  report_id: string;
  owner_id: string;
  plan_hash: string;
  stage: 'registered' | 'verified';
  created_at: Date | string;
}
export interface MaterialReportRecord {
  id: string;
  request_id: string;
  owner_id: string;
  plan_hash: string;
  plan: MaterialPlan;
  attestation: Record<string, unknown>;
  received_at: Date | string;
  receipts?: MaterialReceiptRecord[];
}
export interface MaterialRequestRecord {
  id: string;
  owner_id: string;
  run_id: string;
  candidate_index: number;
  base_material_hash: string;
  bundle_hash: string;
  fingerprint: string;
  bundle: CandidateSourceBundle;
  created_at: Date | string;
  reports: MaterialReportRecord[];
}
export function createMaterialRequest(
  args: Owned & {
    request: {
      id: string;
      runId: string;
      candidateIndex: number;
      baseMaterialHash: string;
      bundleHash: string;
    };
    bundle: unknown;
  },
): Promise<MaterialRequestRecord>;
/** Newest ten requests, each with newest three reports and their stage receipts. */
export function readMaterialRequests(
  args: Owned & { runId: string; candidateIndex: number },
): Promise<MaterialRequestRecord[]>;
export function getMaterialRequest(args: Owned & { id: string }): Promise<MaterialRequestRecord>;
/** Mandatory synchronous signature check at the exact database admission time; no external I/O. */
export function saveMaterialReport(
  args: Owned & {
    requestId: string;
    planHash: string;
    plan: unknown;
    attestation: unknown;
    /** Require a current owner confirmation, checked under the run lock before new admission. */
    requireHumanApproval?: boolean;
    assertAttestationAt: (
      plan: MaterialPlan,
      attestation: Record<string, unknown>,
      receivedAt: Date | string,
    ) => void;
  },
): Promise<MaterialReportRecord>;
/** Newest three reports and their stage receipts. */
export function readMaterialReports(
  args: Owned & { requestId: string },
): Promise<MaterialReportRecord[]>;
/** Exact lookup; throws not_found if the report or its live owner-scoped request is absent. */
export function getMaterialReport(
  args: Owned & { requestId: string } & (
      { reportId: string; planHash?: never } | { planHash: string; reportId?: never }
    ),
): Promise<MaterialReportRecord & { receipts: MaterialReceiptRecord[] }>;
/** Newest verification receipt across all matching requests and reports. */
export function latestVerifiedMaterialReport(
  args: Owned & { runId: string; candidateIndex: number; baseMaterialHash: string },
): Promise<{
  request: MaterialRequestRecord;
  report: MaterialReportRecord & { receipts: MaterialReceiptRecord[] };
} | null>;
/** Trusted server service only: records a completed stage, does not perform it. */
export function saveMaterialReceipt(
  args: Owned & {
    requestId: string;
    reportId: string;
    planHash: string;
    stage: 'registered' | 'verified';
  },
): Promise<MaterialReceiptRecord>;
