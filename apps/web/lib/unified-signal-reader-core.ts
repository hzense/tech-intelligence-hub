import { assertUnifiedSignalContent } from '../../../packages/database/src/unified-signal-contract.mjs';
import {
  PublicSignalReaderError,
  publicSignalMaximumEntries,
  type SignalEntry,
  type PublicSignalQueryClient,
} from './public-signal-reader-core.ts';

export const unifiedPublicListQuery = `SELECT signal_id,version,origin,publication_basis,content,recorded_at
FROM public.unified_public_signals ORDER BY signal_id COLLATE "C" LIMIT $1`;
export const unifiedPublicStatusQuery = 'SELECT ready FROM public.unified_public_status';

export function mapUnifiedSignalRows(rows: unknown[]): SignalEntry[] {
  if (!Array.isArray(rows) || rows.length > publicSignalMaximumEntries)
    throw new PublicSignalReaderError();
  const seen = new Set<string>();
  return rows
    .map((value) => {
      const row = value as Record<string, unknown>;
      if (
        !row ||
        typeof row.signal_id !== 'string' ||
        !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(row.signal_id) ||
        seen.has(row.signal_id) ||
        !Number.isSafeInteger(row.version) ||
        Number(row.version) < 1
      )
        throw new PublicSignalReaderError();
      seen.add(row.signal_id);
      const manual =
        row.origin === 'ai_generation' && row.publication_basis === 'manual_confirmation';
      if (!manual && !(row.origin === 'legacy_seed' && row.publication_basis === 'legacy_import'))
        throw new PublicSignalReaderError();
      const c = assertUnifiedSignalContent(row.content, { historical: true });
      const participants = (items: typeof c.people, kind: string) =>
        items.map((p: (typeof c.people)[number], i: number) => ({
          id: p.id ?? `${kind}-${i}`,
          name: p.name,
          event_role: p.event_role ?? '',
          ...(p.id ? { canonical_entity_id: p.id } : {}),
        }));
      const people = participants(c.people, 'person');
      const organizations = participants(c.organizations, 'organization');
      const sources = c.sources.map((s: (typeof c.sources)[number], i: number) => ({
        id: s.id ?? `source-${i}`,
        name: s.name ?? new URL(s.url).hostname,
        url: s.url,
      }));
      const resources = [...c.people, ...c.organizations]
        .filter(
          (p: (typeof c.people)[number]) =>
            p.id && ['person', 'company', 'institution'].includes(p.kind ?? ''),
        )
        .map((p: (typeof c.people)[number]) => ({
          id: p.id!,
          name: p.name,
          type: p.kind as 'person' | 'company' | 'institution',
          introduction: p.introduction,
          source_urls: p.source_urls,
        }));
      const date = (value: unknown, preserve = false) => {
        if (!(value instanceof Date) && typeof value !== 'string')
          throw new PublicSignalReaderError();
        const parsed = new Date(value);
        if (!Number.isFinite(parsed.getTime())) throw new PublicSignalReaderError();
        return preserve && typeof value === 'string' ? value : parsed.toISOString();
      };
      const common = {
        id: row.signal_id,
        title: c.title,
        summary: c.summary,
        status: 'accepted' as const,
        occurred_at: date(c.occurred_at, !manual),
        // Compatibility DTO: manual records previously exposed publication time here.
        // The stored unified captured_at remains null, never changed by this reader.
        captured_at: manual ? date(row.recorded_at) : date(c.captured_at, true),
        source_id: sources[0]?.id ?? '',
        source_url: sources[0]?.url ?? '',
        topics: c.topics.map((t: (typeof c.topics)[number]) => t.id),
        entities: [...c.people, ...c.organizations, ...c.related_entities].flatMap(
          (p: { id: string | null }) => (p.id ? [p.id] : []),
        ),
        public_people: people,
        public_organizations: organizations,
        public_sources: sources,
        public_topics: c.topics,
        ...(manual
          ? { publication_revision: Number(row.version) }
          : { legacy_related_entities: c.related_entities }),
        // Presence means reviewed identities to the entity-link projector. Older
        // name-only editorial revisions must still resolve unique catalog names;
        // an empty array would incorrectly bypass that read-only projection.
        ...(!manual || resources.length ? { public_resources: resources } : {}),
      };
      if (manual)
        return {
          ...common,
          publication_basis: 'manual_confirmation',
          type: c.type ?? 'editorial',
        } as SignalEntry;
      if (c.type === null || c.importance === null || c.confidence === null || c.novelty === null)
        throw new PublicSignalReaderError();
      return {
        ...common,
        type: c.type,
        importance: c.importance,
        confidence: c.confidence,
        novelty: c.novelty,
      } as SignalEntry;
    })
    .sort((a, b) => b.occurred_at.localeCompare(a.occurred_at) || a.id.localeCompare(b.id));
}
export function createUnifiedSignalReader(client: PublicSignalQueryClient) {
  return {
    async list() {
      try {
        const status = (await client.query(unifiedPublicStatusQuery, [])).rows;
        if (status.length !== 1 || (status[0] as { ready?: unknown })?.ready !== true)
          throw new PublicSignalReaderError();
        return mapUnifiedSignalRows(
          (await client.query(unifiedPublicListQuery, [publicSignalMaximumEntries + 1])).rows,
        );
      } catch {
        throw new PublicSignalReaderError();
      }
    },
  };
}
