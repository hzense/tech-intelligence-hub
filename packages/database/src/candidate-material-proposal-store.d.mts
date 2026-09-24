import type { ImportPool } from './import-store.mjs';
import type { MaterialPlan } from './material-registration-contract.mjs';
interface Owned {
  pool: ImportPool;
  owner: string;
  requestId: string;
}
export interface MaterialProposalPayload {
  plan: MaterialPlan;
  dossier: Record<string, unknown>;
}
export interface MaterialProposalRecord {
  id: string;
  request_id: string;
  owner_id: string;
  plan_hash: string;
  proposal_hash: string;
  payload: MaterialProposalPayload;
  created_at: Date | string;
}
export interface MaterialApprovalRecord {
  id: string;
  proposal_id: string;
  request_id: string;
  owner_id: string;
  proposal_hash: string;
  approved_by: string;
  created_at: Date | string;
}
export function materialProposalHash(args: {
  owner: string;
  requestId: string;
  payload: unknown;
}): string;
export function createMaterialProposal(
  args: Owned & { id?: string; payload: unknown },
): Promise<MaterialProposalRecord>;
export function getMaterialProposal(
  args: Owned & { proposalId: string },
): Promise<MaterialProposalRecord>;
export function readMaterialProposals(args: Owned): Promise<MaterialProposalRecord[]>;
export function approveMaterialProposal(
  args: Owned & { proposalId: string; proposalHash: string; approvedBy: string },
): Promise<MaterialApprovalRecord>;
export function latestApprovedMaterialProposal(
  args: Owned,
): Promise<{ proposal: MaterialProposalRecord; approval: MaterialApprovalRecord } | null>;
