import { resolve } from 'node:path';
import process from 'node:process';
import { isExcludedPublicPerson } from '@hzense/ingestion/person-resource-policy';
import { readSignalReadMode, type SignalEntry } from './public-signal-reader-core.ts';
import { projectLegacySignalEntries } from './legacy-signal-projection.ts';
import { projectEditorialEntityLinks } from './editorial-entity-links.ts';
import {
  loadSeedCatalog,
  type SeedEntity,
  type SeedRadarSnapshot,
  type SeedRelation,
  type SeedSource,
} from '@hzense/content';

let seedPromise: ReturnType<typeof loadSeedCatalog> | undefined;

function getSeedCatalog() {
  seedPromise ??= loadSeedCatalog(
    resolve(process.cwd(), '../../data/seed'),
    resolve(process.cwd(), '../../data/taxonomy/taxonomy.yaml'),
  );
  return seedPromise;
}

export async function getSignalEntries(): Promise<SignalEntry[]> {
  if (readSignalReadMode(process.env) === 'database') {
    const signals = await (await import('./server/public-signals.ts')).getPublicSignals();
    return projectEditorialEntityLinks(signals, await getResourceEntries());
  }
  const editorial =
    process.env.HZENSE_EDITORIAL_PUBLICATION_ENABLED === '1'
      ? await (await import('./server/editorial-signals.ts')).getEditorialSignals()
      : [];
  const normalizedLegacy = projectLegacySignalEntries(await getSeedCatalog());
  return projectEditorialEntityLinks(
    [...normalizedLegacy, ...editorial].sort((left, right) =>
      right.occurred_at.localeCompare(left.occurred_at),
    ),
    await getResourceEntries(),
  );
}

export async function getSignalEntryById(id: string): Promise<SignalEntry | undefined> {
  if (id.startsWith('editorial-')) {
    if (process.env.HZENSE_EDITORIAL_PUBLICATION_ENABLED !== '1') return undefined;
    // Use the same current catalog as lists, filters and resource reverse links.
    return (await getSignalEntries()).find((signal) => signal.id === id);
  }
  if (readSignalReadMode(process.env) === 'database') {
    return (await import('./server/public-signals.ts')).getPublicSignalById(id);
  }
  return (await getSignalEntries()).find((signal) => signal.id === id);
}

export async function getSeedEntityMap(): Promise<Map<string, SeedEntity>> {
  return new Map(
    (await getSeedCatalog()).entities
      .filter((entity) => entity.type !== 'person' || !isExcludedPublicPerson(entity))
      .map((entity) => [entity.id, entity]),
  );
}

export async function getSeedSourceMap(): Promise<Map<string, SeedSource>> {
  return new Map((await getSeedCatalog()).sources.map((source) => [source.id, source]));
}

export async function getSeedRelations(): Promise<SeedRelation[]> {
  return (await getSeedCatalog()).relations;
}

export async function getRadarSnapshots(): Promise<SeedRadarSnapshot[]> {
  if (readSignalReadMode(process.env) === 'database') {
    await (await import('./server/public-signals.ts')).waitForPublicSignalRequest();
    // Legacy scores lack immutable content-version/publication-revision bindings.
    // Do not attach them to a new version of the same Signal or resurrect Seed.
    return [];
  }
  return [...(await getSeedCatalog()).radar].sort(
    (left, right) =>
      right.date.localeCompare(left.date) ||
      right.attention - left.attention ||
      left.topic.localeCompare(right.topic),
  );
}

export async function getResourceEntries(): Promise<SeedEntity[]> {
  return (await getSeedCatalog()).entities
    .filter(
      (entity) =>
        entity.status === 'active' && (entity.type !== 'person' || !isExcludedPublicPerson(entity)),
    )
    .sort(
      (left, right) => left.type.localeCompare(right.type) || left.name.localeCompare(right.name),
    );
}

export async function getResourceEntryById(id: string): Promise<SeedEntity | undefined> {
  return (await getResourceEntries()).find((entity) => entity.id === id);
}

export async function getSignalsForEntity(entityId: string): Promise<SignalEntry[]> {
  return (await getSignalEntries()).filter((signal) => signal.entities.includes(entityId));
}

export async function getRelationsForEntity(entityId: string): Promise<SeedRelation[]> {
  return (await getSeedRelations()).filter(
    (relation) => relation.source === entityId || relation.target === entityId,
  );
}
