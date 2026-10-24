import type {
  GeneratedCandidates,
  GenerationReference,
  GenerationSource,
} from './signal-generation-contract.mjs';

export interface SourcePublicationDateHint {
  date: string;
  evidence: GenerationReference;
  kind: 'label' | 'news_card';
}

/** Hints are derived from pinned text, never from discovery metadata or the clock. */
export function collectSourcePublicationDates(
  source: GenerationSource,
): SourcePublicationDateHint[];
/** Complete only new, validated source-publication candidates with matching claim evidence. */
export function completeSourcePublicationDates(
  result: GeneratedCandidates,
  source: GenerationSource,
): GeneratedCandidates;
