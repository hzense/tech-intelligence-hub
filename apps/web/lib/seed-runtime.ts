import { resolve } from 'node:path';
import {
  loadSeedCatalog,
  type SeedEntity,
  type SeedRelation,
  type SeedSignal,
  type SeedSource,
} from '@hzense/content';

let seedPromise: ReturnType<typeof loadSeedCatalog> | undefined;

function getSeedCatalog() {
  seedPromise ??= loadSeedCatalog(resolve(process.cwd(), '../../data/seed'));
  return seedPromise;
}

export async function getSignalEntries(): Promise<SeedSignal[]> {
  return (await getSeedCatalog()).signals
    .filter((signal) => signal.status === 'accepted' || signal.status === 'reviewed')
    .sort(
      (left, right) =>
        right.occurred_at.localeCompare(left.occurred_at) ||
        right.importance - left.importance ||
        left.title.localeCompare(right.title),
    );
}

export async function getSignalEntryById(id: string): Promise<SeedSignal | undefined> {
  return (await getSignalEntries()).find((signal) => signal.id === id);
}

export async function getSeedEntityMap(): Promise<Map<string, SeedEntity>> {
  return new Map((await getSeedCatalog()).entities.map((entity) => [entity.id, entity]));
}

export async function getSeedSourceMap(): Promise<Map<string, SeedSource>> {
  return new Map((await getSeedCatalog()).sources.map((source) => [source.id, source]));
}

export async function getSeedRelations(): Promise<SeedRelation[]> {
  return (await getSeedCatalog()).relations;
}


export async function getResourceEntries(): Promise<SeedEntity[]> {
  return (await getSeedCatalog()).entities
    .filter((entity) => entity.status === 'active')
    .sort(
      (left, right) =>
        left.type.localeCompare(right.type) || left.name.localeCompare(right.name),
    );
}

export async function getResourceEntryById(id: string): Promise<SeedEntity | undefined> {
  return (await getResourceEntries()).find((entity) => entity.id === id);
}

export async function getSignalsForEntity(entityId: string): Promise<SeedSignal[]> {
  return (await getSignalEntries()).filter((signal) => signal.entities.includes(entityId));
}

export async function getRelationsForEntity(entityId: string): Promise<SeedRelation[]> {
  return (await getSeedRelations()).filter(
    (relation) => relation.source === entityId || relation.target === entityId,
  );
}
