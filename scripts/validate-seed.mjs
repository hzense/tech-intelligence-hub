import { resolve } from 'node:path';
import { loadSeedCatalog } from '../packages/content/dist/src/index.js';

const catalog = await loadSeedCatalog(resolve('data/seed'), resolve('data/taxonomy/taxonomy.yaml'));

console.log(
  `Taxonomy and Seed validation OK: ${catalog.taxonomy.topics.length} Taxonomy topics, ${catalog.topics.length} Seed topics, ${catalog.entities.length} entities, ${catalog.relations.length} relations, ${catalog.signals.length} signals, ${catalog.radar.length} Radar snapshots.`,
);
