import { resolve } from 'node:path';
import { loadSeedCatalog } from '../packages/content/dist/src/index.js';

const catalog = await loadSeedCatalog(resolve('data/seed'));

console.log(
  `Seed validation OK: ${catalog.topics.length} topics, ${catalog.entities.length} entities, ${catalog.relations.length} relations, ${catalog.signals.length} signals.`,
);
