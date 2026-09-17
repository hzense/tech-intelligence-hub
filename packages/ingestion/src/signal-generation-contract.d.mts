export const GENERATION_LIMITS: Readonly<{
  sourceBytes: 48000;
  outputBytes: 96000;
  candidates: 5;
  references: 8;
  quoteCharacters: 500;
}>;
export const generationCandidateJsonSchema: Readonly<Record<string, unknown>>;
export class SignalGenerationError extends Error {
  code: string;
  constructor(code: string);
}
export interface GenerationSource {
  classification: 'private';
  fragments: { id: string; text: string; locator: Record<string, string | number> }[];
}
export interface GenerationReference {
  fragment_id: string;
  quote: string;
}
export interface GeneratedCandidateInput {
  title: string;
  summary: string;
  event_date: string | null;
  event_date_evidence: GenerationReference[];
  persons: {
    name: string;
    role: string;
    organization: string | null;
    evidence: GenerationReference[];
  }[];
  organizations: string[];
  claims: { text: string; evidence: GenerationReference[] }[];
}
export type GenerationIssue =
  'needs_public_evidence' | 'needs_person_evidence' | 'needs_event_time';
export interface GeneratedCandidate extends GeneratedCandidateInput {
  index: number;
  classification: 'private';
  status: 'needs_review';
  issues: GenerationIssue[];
}
export interface GeneratedCandidates {
  classification: 'private';
  candidates: GeneratedCandidate[];
  reason: string;
}
export function buildGenerationSource(importOutput: unknown): GenerationSource;
export function validateGenerationSource(source: unknown): GenerationSource;
export function normalizeGeneratedCandidates(
  value: unknown,
  source: GenerationSource,
): GeneratedCandidates;
