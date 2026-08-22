import { readdir, readFile } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';
import matter from 'gray-matter';
import { parse } from 'yaml';
import { findReferenceIssues, type ContentDocument } from './references.js';
import { validateFrontMatter } from './schema.js';

async function walk(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const nested = await Promise.all(entries.map((entry) => entry.isDirectory() ? walk(join(dir, entry.name)) : Promise.resolve([join(dir, entry.name)])));
  return nested.flat();
}

const root = resolve(process.cwd(), '../../content');
const files = (await walk(root)).filter((file) => ['.md', '.mdx'].includes(extname(file)));
const documents: ContentDocument[] = [];
let failures = 0;
for (const file of files) {
  try {
    const parsed = matter(await readFile(file, 'utf8'));
    documents.push({ file, frontMatter: validateFrontMatter(parsed.data) });
  } catch (error) {
    failures += 1;
    console.error(`Invalid front matter: ${file}`);
    console.error(error);
  }
}

async function loadSeedIds(name: string): Promise<Set<string>> {
  const file = resolve(process.cwd(), '../../data/seed', name);
  const records: unknown = parse(await readFile(file, 'utf8'));
  if (!Array.isArray(records)) throw new Error(`Expected an array in ${file}`);

  const ids = new Set<string>();
  for (const record of records) {
    if (typeof record !== 'object' || record === null || !('id' in record) || typeof record.id !== 'string') {
      throw new Error(`Expected every record in ${file} to have a string id`);
    }
    ids.add(record.id);
  }
  return ids;
}

try {
  const [topicIds, entityIds, signalIds] = await Promise.all([
    loadSeedIds('topics.yaml'),
    loadSeedIds('entities.yaml'),
    loadSeedIds('signals.yaml'),
  ]);
  const referenceIssues = findReferenceIssues(documents, { topicIds, entityIds, signalIds });
  for (const issue of referenceIssues) {
    failures += 1;
    console.error(
      `${issue.reason === 'duplicate' ? 'Duplicate' : 'Broken'} ${issue.kind} reference: ${issue.file} ${issue.field} -> ${issue.target}`,
    );
  }
} catch (error) {
  failures += 1;
  console.error('Unable to validate content references.');
  console.error(error);
}

if (failures > 0) process.exit(1);
console.log(`Validated ${files.length} content files and their cross-references.`);
