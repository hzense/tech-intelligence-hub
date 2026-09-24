export class MaterialRegistrationError extends Error {
  code: string;
  constructor(code?: string);
}
export type MaterialEntity = {
  id: string;
  type: 'person' | 'company' | 'institution';
  name: string;
  aliases: string[];
  evidenceIds: string[];
};
export type MaterialPlan = {
  version: 'material-registration-v1';
  owner: string;
  runId: string;
  candidateIndex: number;
  baseMaterialHash: string;
  sourceBundleHash: string;
  entities: MaterialEntity[];
  sources: Array<{ id: string; name: string; url: string; allowedHosts: string[] }>;
  evidence: Array<{
    id: string;
    sourceId: string;
    sourceUrl: string;
    locator: string;
    excerpt: string;
    contentHash: string;
    capturedAt: string;
    sourcePublishedAt: string | null;
  }>;
  topicIds: string[];
  candidate: {
    title: string;
    summary: string;
    eventDate: string;
    persons: Array<{
      entityId: string;
      role: string;
      organizationId: string | null;
      evidenceIds: string[];
    }>;
    organizationIds: string[];
    claims: Array<{ text: string; evidenceId: string }>;
  };
};
export type MaterialVerificationCheck =
  | 'sourceAuthenticity'
  | 'usageRights'
  | 'entityIdentity'
  | 'eventRelevance'
  | 'claimSupport'
  | 'taxonomy';
export type MaterialAttestation = {
  version: 'signed-material-verification-v1';
  planHash: string;
  owner: string;
  runId: string;
  candidateIndex: number;
  baseMaterialHash: string;
  sourceBundleHash: string;
  verifierId: string;
  issuedAt: string;
  ingestBefore: string;
  checks: Record<MaterialVerificationCheck, true>;
  rationale: Record<MaterialVerificationCheck, string>;
};
export function normalizeMaterialPlan(value: unknown): MaterialPlan;
export function materialPlanHash(plan: unknown): string;
export function verifyMaterialAttestation(input: {
  envelope: unknown;
  plan: unknown;
  trustedVerifiers: Record<string, { publicKey: string; verifierId: string }>;
  now?: Date;
}): MaterialAttestation;
