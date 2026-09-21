import type { ImportPool } from './import-store.mjs';
export type CandidatePipelineRole =
  | 'hzense_candidate_assembler'
  | 'hzense_candidate_verifier'
  | 'hzense_publication_controller'
  | 'hzense_publisher';
export const candidatePipelineRoles: Record<
  CandidatePipelineRole,
  {
    select: string[];
    readColumns: Record<string, string[]>;
    insert: Record<string, string[]>;
    update: Record<string, string[]>;
    functions: string[];
  }
>;
export function candidatePipelineAuditSQL(role: CandidatePipelineRole, runtime?: boolean): string;
export function candidatePipelineProvisionSQL(): string;
export function assertCandidatePipelineRole(
  client: Pick<Awaited<ReturnType<ImportPool['connect']>>, 'query'>,
  role: CandidatePipelineRole,
): Promise<void>;
