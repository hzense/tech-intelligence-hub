import 'server-only';
import { resolve } from 'node:path';
import process from 'node:process';
import { cache } from 'react';
import { loadTaxonomy } from '@hzense/content';
import type { SignalEntry } from './public-signal-reader-core';
import { getResourceEntries, getSignalEntries } from './seed-runtime';
import { buildPublicEntityDirectory } from './public-exploration-core';

// This facade preserves the configured public authority, including editorial
// publication and withdrawal checks. It never reads private candidate tables.
export const getPublicExploration = cache(async function getPublicExploration(
  currentSignals?: SignalEntry[],
) {
  const [signals, seedEntities, taxonomy] = await Promise.all([
    currentSignals ?? getSignalEntries(),
    getResourceEntries(),
    loadTaxonomy(resolve(process.cwd(), '../../data/taxonomy/taxonomy.yaml')),
  ]);
  return {
    signals,
    seedEntities,
    taxonomy,
    entities: buildPublicEntityDirectory(signals, seedEntities),
  };
});
