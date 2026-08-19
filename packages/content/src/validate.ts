import { readdir, readFile } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';
import matter from 'gray-matter';
import { validateFrontMatter } from './schema.js';

async function walk(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const nested = await Promise.all(entries.map((entry) => entry.isDirectory() ? walk(join(dir, entry.name)) : Promise.resolve([join(dir, entry.name)])));
  return nested.flat();
}

const root = resolve(process.cwd(), '../../content');
const files = (await walk(root)).filter((file) => ['.md', '.mdx'].includes(extname(file)));
let failures = 0;
for (const file of files) {
  try {
    const parsed = matter(await readFile(file, 'utf8'));
    validateFrontMatter(parsed.data);
  } catch (error) {
    failures += 1;
    console.error(`Invalid front matter: ${file}`);
    console.error(error);
  }
}
if (failures > 0) process.exit(1);
console.log(`Validated ${files.length} content files.`);
