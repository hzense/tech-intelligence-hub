import { resolve } from 'node:path';
import { assertDailyPublicationReady } from './daily.js';
import { loadContent } from './loader.js';

const contentRoot = resolve(process.cwd(), '../../content');
const seedRoot = resolve(process.cwd(), '../../data/seed');

try {
  const entries = await loadContent({ contentRoot, seedRoot });
  assertDailyPublicationReady(entries);
  console.log('All Daily content is published or intentionally archived.');
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
