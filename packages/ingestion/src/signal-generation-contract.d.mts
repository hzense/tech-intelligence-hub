import type { GenerationValidationDetail } from './signal-generation-validation-diagnostics.mjs';
import type { GenerationSignalType } from './signal-types.mjs';
export { SIGNAL_TYPES, type GenerationSignalType } from './signal-types.mjs';

export const GENERATION_LIMITS: Readonly<{
  inputTokens: 100000;
  sourceBytes: 1000000;
  outputBytes: 400000;
  candidates: 5;
  titleCharacters: 80;
  summaryCharacters: 500;
  references: 8;
  quoteCharacters: 500;
}>;
export const generationCandidateJsonSchema: Readonly<Record<string, unknown>>;
export const generationCandidateWithTopicsJsonSchema: Readonly<Record<string, unknown>>;
export const generationCandidateWithMetadataJsonSchema: Readonly<Record<string, unknown>>;
export const GENERATION_METADATA_CONTRACT: 'signal-metadata-v1';
export const GENERATION_RESOURCES_CONTRACT: 'signal-resources-v1';
export type GenerationOutputContract =
  typeof GENERATION_METADATA_CONTRACT | typeof GENERATION_RESOURCES_CONTRACT;
export const generatedResourceJsonSchema: Readonly<Record<string, unknown>>;
export const generationCandidateWithResourcesJsonSchema: Readonly<Record<string, unknown>>;
export const REJECTED_CANDIDATES_REASON: string;
export function estimateGenerationTokens(text: string): number;
export class SignalGenerationError extends Error {
  code: string;
  diagnostic?: GenerationValidationDetail;
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
export interface GenerationTopic {
  id: string;
  title: string;
}
export function normalizeGenerationTopics(value: unknown): GenerationTopic[];
export interface GeneratedResourceDraft {
  type: 'person' | 'company' | 'institution';
  name: string;
  introduction: string | null;
  event_role: string | null;
  evidence: GenerationReference[];
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
  topic_ids?: string[];
  signal_type?: GenerationSignalType;
  resources?: GeneratedResourceDraft[];
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
    errors: ({ field: string; code: string } & (
      GenerationValidationDetail | { path?: never; reason?: never }
    ))[];
  }[];
}
export function assessGeneratedCandidates(
  value: unknown,
  source: GenerationSource,
  topics?: GenerationTopic[],
  outputContract?: GenerationOutputContract,
): GeneratedCandidates;
export function validateGenerationEnvelope(value: unknown): unknown;
export function buildGenerationSource(importOutput: unknown): GenerationSource;
export interface GenerationSourceInspection {
  ready: boolean;
  sourceBytes: number;
  limitBytes: number;
  sourceTokens: number;
  limitTokens: number;
  tokenEncoding: string;
  fragmentCount: number;
  locators: { id: string; locator: Record<string, string | number> }[];
}
export function inspectGenerationSource(importOutput: unknown): GenerationSourceInspection;
export function validateGenerationSource(source: unknown): GenerationSource;
/** Structural validation only; callers must enforce their own byte budget. */
export function normalizePrivateSource(source: unknown): GenerationSource;
export function normalizeGeneratedCandidates(
  value: unknown,
  source: GenerationSource,
  topics?: GenerationTopic[],
  outputContract?: GenerationOutputContract,
): GeneratedCandidates;
