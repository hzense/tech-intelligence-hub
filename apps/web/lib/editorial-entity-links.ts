import { isExcludedPublicPerson } from '@hzense/ingestion/person-resource-policy';
import type { PublicSignalPerson, SignalEntry } from './public-signal-reader-core.ts';

export type EditorialEntityCatalogEntry = {
  id: string;
  name: string;
  type: string;
  status: string;
  aliases?: readonly string[] | null;
};

const normalized = (name: string) => name.normalize('NFKC').trim().toLocaleLowerCase('en-US');
type EntityKind = 'person' | 'organization';

/** Link existing identities only. Publication of a name does not create an entity. */
export function projectEditorialEntityLinks(
  signals: readonly SignalEntry[],
  catalog: readonly EditorialEntityCatalogEntry[],
): SignalEntry[] {
  const index = new Map<string, Set<string>>();
  const add = (kind: EntityKind, id: string, names: readonly string[]) => {
    for (const name of names) {
      const key = `${kind}:${normalized(name)}`;
      if (key === `${kind}:`) continue;
      const ids = index.get(key) ?? new Set<string>();
      ids.add(id);
      index.set(key, ids);
    }
  };
  const excludedIds = new Set<string>();
  for (const entity of catalog) {
    if (entity.type === 'person' && isExcludedPublicPerson(entity)) excludedIds.add(entity.id);
  }
  for (const signal of signals) {
    for (const person of signal.public_people ?? []) {
      if (isExcludedPublicPerson(person)) excludedIds.add(person.id);
    }
  }
  for (const entity of catalog) {
    if (entity.status !== 'active' || excludedIds.has(entity.id)) continue;
    const kind =
      entity.type === 'person'
        ? 'person'
        : ['company', 'institution'].includes(entity.type)
          ? 'organization'
          : null;
    if (kind) add(kind, entity.id, [entity.name, ...(entity.aliases ?? [])]);
  }
  // Current, source-evidence publications already carry canonical identities.
  // Never promote another name-only editorial row, even if it has an old marker.
  for (const signal of signals) {
    // These identities were atomically committed with a reviewed publication.
    // They can resolve older name-only Signals without publishing private drafts.
    for (const resource of signal.public_resources ?? []) {
      if (!excludedIds.has(resource.id))
        add(resource.type === 'person' ? 'person' : 'organization', resource.id, [resource.name]);
    }
    if (signal.publication_basis === 'manual_confirmation' || signal.public_version === undefined)
      continue;
    for (const person of signal.public_people ?? []) {
      if (!excludedIds.has(person.id)) add('person', person.id, [person.name]);
    }
    for (const organization of signal.public_organizations ?? []) {
      add('organization', organization.id, [organization.name]);
    }
  }
  return signals.map((signal) => {
    if (signal.publication_basis !== 'manual_confirmation') return signal;
    // Explicit reviewed identity choices must survive an ambiguous name catalog.
    // Only the public reader can attach public_resources; name-only rows still
    // take the unique-match path below and cannot smuggle a canonical marker.
    if (signal.public_resources !== undefined) return signal;
    const resolve = (rows: readonly PublicSignalPerson[], kind: EntityKind): PublicSignalPerson[] =>
      rows.map((row) => {
        // Re-evaluate each read; catalog changes must not retain a stale match.
        const { canonical_entity_id: previous, ...unlinked } = row;
        void previous;
        if (kind === 'person' && isExcludedPublicPerson(row)) return unlinked;
        const ids = index.get(`${kind}:${normalized(row.name)}`);
        if (ids?.size !== 1) return unlinked;
        const id = [...ids][0]!;
        return { ...unlinked, id, canonical_entity_id: id };
      });
    const people = resolve(signal.public_people ?? [], 'person');
    const organizations = resolve(signal.public_organizations ?? [], 'organization');
    return {
      ...signal,
      entities: [
        ...new Set(
          [...people, ...organizations].flatMap((row) =>
            row.canonical_entity_id ? [row.canonical_entity_id] : [],
          ),
        ),
      ],
      public_people: people,
      public_organizations: organizations,
    };
  });
}
