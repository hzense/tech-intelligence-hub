import type { SeedCatalog } from '@hzense/content';
import type { SignalEntry } from './public-signal-reader-core.ts';

/** Resolve historical references once, without upgrading Seed acceptance to publication. */
export function projectLegacySignalEntries(catalog: SeedCatalog): SignalEntry[] {
  const entities = new Map(catalog.entities.map((entity) => [entity.id, entity]));
  const sources = new Map(catalog.sources.map((source) => [source.id, source]));
  const topics = new Map(catalog.topics.map((topic) => [topic.id, topic]));

  return catalog.signals
    .filter((signal) => signal.status === 'accepted' || signal.status === 'reviewed')
    .filter((signal) => !signal.id.startsWith('editorial-'))
    .map((signal) => {
      const linked = signal.entities.map((id) => {
        const entity = entities.get(id);
        if (!entity) throw new Error(`Unknown historical Signal entity ${id} in ${signal.id}`);
        return entity;
      });
      const source = sources.get(signal.source_id);
      if (!source) throw new Error(`Unknown historical Signal source in ${signal.id}`);
      return {
        ...signal,
        public_people: linked
          .filter((entity) => entity.type === 'person')
          .map((entity) => ({
            id: entity.id,
            name: entity.name,
            event_role: signal.entity_roles?.[entity.id] ?? '',
          })),
        public_organizations: linked
          .filter((entity) => entity.type === 'company' || entity.type === 'institution')
          .map((entity) => ({
            id: entity.id,
            name: entity.name,
            event_role: signal.entity_roles?.[entity.id] ?? '',
          })),
        legacy_related_entities: linked
          .filter((entity) => !['person', 'company', 'institution'].includes(entity.type))
          .map((entity) => ({ id: entity.id, name: entity.name, type: entity.type })),
        public_topics: signal.topics.map((id) => {
          const topic = topics.get(id);
          if (!topic) throw new Error(`Unknown historical Signal topic ${id} in ${signal.id}`);
          return { id, title: topic.title };
        }),
        public_sources: [{ id: source.id, name: source.name, url: signal.source_url }],
      };
    })
    .sort(
      (left, right) =>
        right.occurred_at.localeCompare(left.occurred_at) ||
        right.importance - left.importance ||
        left.title.localeCompare(right.title),
    );
}
