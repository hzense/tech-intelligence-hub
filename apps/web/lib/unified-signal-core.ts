import type { SignalEntry } from './public-signal-reader-core.ts';

/** The public contract is independent of the historical storage path. */
export interface UnifiedSignal {
  id: string;
  title: string;
  summary: string;
  /** Event category; absent when the publication path did not classify it. */
  type: Exclude<SignalEntry['type'], 'editorial'> | null;
  occurredAt: string;
  capturedAt: string;
  publication: {
    basis: 'legacy_seed' | 'source_evidence' | 'manual_confirmation';
    state: 'archive' | 'published';
    version: number | null;
    revision: number | null;
  };
  assessment: {
    importance: number;
    /** Credibility of the reported news; not a forecast probability. */
    confidence: number;
    novelty: number;
  } | null;
  people: { id: string | null; name: string; eventRole: string }[];
  organizations: { id: string | null; name: string; eventRole: string }[];
  /** Preserve historical non-participant entity references; never recast them as people. */
  relatedEntities: { id: string; name: string; type: string }[];
  topics: { id: string; title: string }[];
  sources: { id: string; name: string; url: string }[];
}

export function signalPublication(entry: SignalEntry): UnifiedSignal['publication'] {
  const manual = entry.publication_basis === 'manual_confirmation';
  const current = manual || entry.public_version !== undefined;
  return {
    basis: manual ? 'manual_confirmation' : current ? 'source_evidence' : 'legacy_seed',
    state: current ? 'published' : 'archive',
    version: entry.public_version ?? null,
    revision: entry.publication_revision ?? null,
  };
}

export function toUnifiedSignal(entry: SignalEntry): UnifiedSignal {
  const publication = signalPublication(entry);
  const manual = publication.basis === 'manual_confirmation';
  const assessment =
    entry.publication_basis === 'manual_confirmation'
      ? null
      : {
          importance: entry.importance,
          confidence: entry.confidence,
          novelty: entry.novelty,
        };
  const participants = (rows: NonNullable<SignalEntry['public_people']>) =>
    rows.map((row) => ({
      // Editorial names are not verified entity identities. Never turn their
      // display-only positional IDs into links to person/resource pages.
      id: manual ? null : row.id,
      name: row.name,
      eventRole: row.event_role,
    }));
  return {
    id: entry.id,
    title: entry.title,
    summary: entry.summary,
    type: entry.type === 'editorial' ? null : entry.type,
    occurredAt: entry.occurred_at,
    capturedAt: entry.captured_at,
    publication,
    assessment,
    people: participants(entry.public_people ?? []),
    organizations: participants(entry.public_organizations ?? []),
    relatedEntities:
      publication.basis === 'legacy_seed' ? (entry.legacy_related_entities ?? []) : [],
    topics: entry.public_topics ?? entry.topics.map((id) => ({ id, title: id })),
    sources:
      entry.public_sources ??
      (entry.source_url
        ? [{ id: entry.source_id, name: entry.source_id, url: entry.source_url }]
        : []),
  };
}
