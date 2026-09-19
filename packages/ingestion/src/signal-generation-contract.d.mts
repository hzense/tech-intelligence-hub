export const GENERATION_LIMITS: Readonly<{
  sourceBytes: 48000;
  outputBytes: 96000;
  candidates: 5;
  titleCharacters: 80;
  summaryCharacters: 500;
  references: 8;
  quoteCharacters: 500;
}>;
export const generationCandidateJsonSchema: Readonly<Record<string, unknown>>;
export const REJECTED_CANDIDATES_REASON: string;
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
  validation_version?: 1;
  rejected?: {
    index: number;
    classification: 'private';
    status: 'rejected';
    errors: { field: string; code: string }[];
  }[];
}
export function assessGeneratedCandidates(
  value: unknown,
  source: GenerationSource,
): GeneratedCandidates;
export function validateGenerationEnvelope(value: unknown): unknown;
export function buildGenerationSource(importOutput: unknown): GenerationSource;
export interface GenerationSourceInspection {
  ready: boolean;
  sourceBytes: number;
  limitBytes: number;
  fragmentCount: number;
  locators: { id: string; locator: Record<string, string | number> }[];
}
export function inspectGenerationSource(importOutput: unknown): GenerationSourceInspection;
export function validateGenerationSource(source: unknown): GenerationSource;
export function normalizeGeneratedCandidates(
  value: unknown,
  source: GenerationSource,
): GeneratedCandidates;
