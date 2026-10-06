import type { GenerationSignalType } from '../../ingestion/src/signal-types.mjs';
export interface UnifiedParticipant {
  id: string | null;
  name: string;
  event_role: string | null;
  kind: 'person' | 'company' | 'institution' | null;
  introduction: string | null;
  source_urls: string[];
}
export interface UnifiedSignalContent {
  title: string;
  summary: string;
  type: GenerationSignalType | null;
  occurred_at: string | null;
  captured_at: string | null;
  importance: number | null;
  confidence: number | null;
  novelty: number | null;
  people: UnifiedParticipant[];
  organizations: UnifiedParticipant[];
  topics: { id: string; title: string }[];
  sources: { id: string | null; name: string | null; url: string }[];
  related_entities: { id: string; name: string; type: string }[];
}
export const UNIFIED_SIGNAL_SCHEMA: '4.0.0';
export class UnifiedSignalError extends Error {
  code: string;
}
export function assertUnifiedSignalContent(
  value: unknown,
  options?: { historical?: boolean },
): UnifiedSignalContent;
export function unifiedSignalId(value: unknown): string;
export function unifiedSignalReadiness(value: unknown): { ready: boolean; missing: string[] };
