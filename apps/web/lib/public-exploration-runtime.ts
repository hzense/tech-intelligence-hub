import 'server-only';
import { resolve } from 'node:path';
import process from 'node:process';
import { loadTaxonomy } from '@hzense/content';
import { getResourceEntries, getSignalEntries } from './seed-runtime';
import { buildPublicEntityDirectory } from './public-exploration-core';

// This facade preserves the configured public authority, including editorial
// publication and withdrawal checks. It never reads private candidate tables.
export async function getPublicExploration() {
  const [signals, seedEntities, taxonomy] = await Promise.all([
    getSignalEntries(),
    getResourceEntries(),
    loadTaxonomy(resolve(process.cwd(), '../../data/taxonomy/taxonomy.yaml')),
  ]);
  return {
    signals,
    seedEntities,
    taxonomy,
    entities: buildPublicEntityDirectory(signals, seedEntities),
  };
}
