/** Private, administrator-only read DTOs. Not a publication or verification API. */
export type WorkbenchVerificationStatus = 'pending' | 'verified' | 'rejected';
export interface SignalWorkbenchListRequest {
  q?: string;
  after?: string;
  limit?: number;
}
export interface SignalWorkbenchDetailRequest {
  signal_id: string;
  version?: number;
}
export interface SignalWorkbenchHead {
  content_version: number;
  publication_revision: number;
  status: 'published' | 'withdrawn';
  occurred_at: string;
}
export interface SignalWorkbenchListItem {
  signal_id: string;
  title: string;
  type: string;
  occurred_at: string;
  latest_snapshot_version: number;
  recorded_head: SignalWorkbenchHead | null;
  current_public_version: number | null;
}
export interface SignalWorkbenchList {
  items: SignalWorkbenchListItem[];
  next_after: string | null;
  observed_at: string;
}
export interface SignalWorkbenchVersion {
  version: number;
  title: string;
  created_at: string;
  revision_reason: string;
  origin: 'legacy_seed' | 'pipeline' | 'manual';
  assembled_candidate: boolean;
  publication_snapshot: boolean;
}
export interface SignalWorkbenchSnapshot {
  version: number;
  title: string;
  type: string;
  occurred_at: string;
  date_precision: 'day' | 'instant';
  date_basis: string;
  captured_at: string;
  summary: string;
  analysis: string | null;
  importance: number;
  strength: number;
  confidence: number;
  novelty: number;
  revision_reason: string;
  origin: 'legacy_seed' | 'pipeline' | 'manual';
  created_at: string;
}
/** Assertion/source/status summary only; never raw excerpt, locator or metadata. */
export interface SignalWorkbenchEvidence {
  evidence_id: string;
  claim: string;
  relation: 'supports' | 'contradicts' | 'context';
  verification_status: WorkbenchVerificationStatus;
  source_id: string;
  source_name: string;
  source_active: boolean;
  source_url: string | null;
  captured_at: string;
  source_published_at: string | null;
}
/** Event participation edges, not employment/affiliation history or public permission. */
export interface SignalWorkbenchParticipant {
  entity_id: string;
  name: string;
  entity_type: string;
  entity_status: string;
  event_role: string;
  evidence_id: string;
  verification_status: WorkbenchVerificationStatus;
}
export interface SignalWorkbenchVerification {
  verification_id: string;
  source_version: number;
  decision: 'approved' | 'rejected';
  verified_at: string;
  expires_at: string;
  expired: boolean;
  dependency_invalidated: boolean | null;
  checks: {
    claims_supported: boolean | null;
    people_disambiguated: boolean | null;
    people_are_participants: boolean | null;
    organizations_supported: boolean | null;
    public_sources_cleared: boolean | null;
    contradictions_resolved: boolean | null;
  };
}
export interface SignalWorkbenchDetail {
  signal_id: string;
  latest_snapshot_version: number;
  selected_version: number;
  snapshot: SignalWorkbenchSnapshot;
  recorded_head: SignalWorkbenchHead | null;
  current_public_version: number | null;
  versions: SignalWorkbenchVersion[];
  evidence: SignalWorkbenchEvidence[];
  people: SignalWorkbenchParticipant[];
  organizations: SignalWorkbenchParticipant[];
  topics: { id: string; title: string }[];
  verifications: SignalWorkbenchVerification[];
  truncated: {
    versions: boolean;
    evidence: boolean;
    people: boolean;
    organizations: boolean;
    topics: boolean;
    verifications: boolean;
    text: boolean;
  };
  observed_at: string;
}
export function listSignalWorkbench(input: {
  pool: unknown;
  request?: SignalWorkbenchListRequest;
}): Promise<SignalWorkbenchList>;
export function getSignalWorkbenchDetail(input: {
  pool: unknown;
  request: SignalWorkbenchDetailRequest;
}): Promise<SignalWorkbenchDetail>;
