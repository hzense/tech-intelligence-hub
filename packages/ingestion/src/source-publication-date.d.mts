import type {
  GeneratedCandidates,
  GenerationReference,
  GenerationSource,
} from './signal-generation-contract.mjs';

export interface SourcePublicationDateHint {
  date: string;
  evidence: GenerationReference;
  kind: 'label' | 'news_card' | 'article_metadata';
  /** Only these semantic article body fragments may use an article metadata date. */
  fragment_ids?: string[];
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
