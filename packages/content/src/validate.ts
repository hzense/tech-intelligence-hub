import { resolve } from 'node:path';
import { loadContent } from './loader.js';

const contentRoot = resolve(process.cwd(), '../../content');
const seedRoot = resolve(process.cwd(), '../../data/seed');
const taxonomyFile = resolve(process.cwd(), '../../data/taxonomy/taxonomy.yaml');

try {
  const entries = await loadContent({ contentRoot, seedRoot, taxonomyFile });
  console.log(
    `Validated Topic authority, ${entries.length} content files and their cross-references.`,
  );
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
