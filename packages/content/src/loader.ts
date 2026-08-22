import { readdir, readFile } from 'node:fs/promises';
import { extname, join, relative, sep } from 'node:path';
import matter from 'gray-matter';
import { parse } from 'yaml';
import { findReferenceIssues, type ContentDocument, type ReferenceCatalogs } from './references.js';
import { validateFrontMatter, type FrontMatter } from './schema.js';

export interface MarkdownSection {
  heading: string;
  level: 2 | 3;
  paragraphs: string[];
}

export interface ContentEntry<TFrontMatter extends FrontMatter = FrontMatter> {
  filePath: string;
  relativePath: string;
  slug: string;
  frontMatter: TFrontMatter;
  body: string;
  summary: string;
  sections: MarkdownSection[];
}

export interface LoadContentOptions {
  contentRoot: string;
  seedRoot: string;
}

async function walk(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries.map((entry) => entry.isDirectory()
      ? walk(join(directory, entry.name))
      : Promise.resolve([join(directory, entry.name)])),
  );
  return files.flat().sort();
}

function normalizePath(filePath: string): string {
  return filePath.split(sep).join('/');
}

function stripInlineMarkdown(value: string): string {
  return value
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[`*_~]/g, '')
    .trim();
}

function paragraphsFromLines(lines: string[]): string[] {
  const paragraphs: string[] = [];
  let current: string[] = [];
  const flush = () => {
    if (current.length > 0) {
      paragraphs.push(stripInlineMarkdown(current.join(' ')));
      current = [];
    }
  };

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      flush();
      continue;
    }
    if (/^#{1,6}\s+/.test(trimmed) || /^```/.test(trimmed)) {
      flush();
      continue;
    }
    current.push(trimmed);
  }
  flush();
  return paragraphs.filter(Boolean);
}

function parseSections(body: string): MarkdownSection[] {
  const sections: MarkdownSection[] = [];
  let current: MarkdownSection | undefined;
  let paragraphLines: string[] = [];
  const flushParagraphs = () => {
    if (current) current.paragraphs.push(...paragraphsFromLines(paragraphLines));
    paragraphLines = [];
  };

  for (const line of body.split(/\r?\n/)) {
    const heading = /^(#{2,3})\s+(.+?)\s*$/.exec(line);
    if (heading) {
      flushParagraphs();
      const marker = heading[1];
      const text = heading[2];
      if (!marker || !text) continue;
      current = {
        heading: stripInlineMarkdown(text),
        level: marker.length as 2 | 3,
        paragraphs: [],
      };
      sections.push(current);
      continue;
    }
    if (current) paragraphLines.push(line);
  }
  flushParagraphs();
  return sections;
}

function firstParagraph(body: string): string {
  return paragraphsFromLines(body.split(/\r?\n/))[0] ?? '';
}

async function loadSeedIds(seedRoot: string, name: string): Promise<Set<string>> {
  const filePath = join(seedRoot, name);
  const records: unknown = parse(await readFile(filePath, 'utf8'));
  if (!Array.isArray(records)) throw new Error(`Expected an array in ${filePath}`);

  const ids = new Set<string>();
  for (const record of records) {
    if (typeof record !== 'object' || record === null || !('id' in record) || typeof record.id !== 'string') {
      throw new Error(`Expected every record in ${filePath} to have a string id`);
    }
    ids.add(record.id);
  }
  return ids;
}

async function loadCatalogs(seedRoot: string): Promise<ReferenceCatalogs> {
  const [topicIds, entityIds, signalIds] = await Promise.all([
    loadSeedIds(seedRoot, 'topics.yaml'),
    loadSeedIds(seedRoot, 'entities.yaml'),
    loadSeedIds(seedRoot, 'signals.yaml'),
  ]);
  return { topicIds, entityIds, signalIds };
}

export async function loadContent({ contentRoot, seedRoot }: LoadContentOptions): Promise<ContentEntry[]> {
  const files = (await walk(contentRoot)).filter((file) => ['.md', '.mdx'].includes(extname(file)));
  const entries: ContentEntry[] = [];
  const parseFailures: string[] = [];

  for (const filePath of files) {
    try {
      const parsed = matter(await readFile(filePath, 'utf8'));
      const frontMatter = validateFrontMatter(parsed.data);
      const relativePath = normalizePath(relative(contentRoot, filePath));
      entries.push({
        filePath,
        relativePath,
        slug: relativePath.replace(/\.mdx?$/, ''),
        frontMatter,
        body: parsed.content.trim(),
        summary: frontMatter.summary?.trim() || firstParagraph(parsed.content),
        sections: parseSections(parsed.content),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      parseFailures.push(`${normalizePath(relative(contentRoot, filePath))}: ${message}`);
    }
  }

  if (parseFailures.length > 0) {
    throw new Error(`Content front matter validation failed:\n${parseFailures.map((failure) => `- ${failure}`).join('\n')}`);
  }

  const catalogs = await loadCatalogs(seedRoot);
  const documents: ContentDocument[] = entries.map((entry) => ({
    file: entry.relativePath,
    frontMatter: entry.frontMatter,
  }));
  const referenceIssues = findReferenceIssues(documents, catalogs);
  if (referenceIssues.length > 0) {
    const details = referenceIssues.map((issue) =>
      `- ${issue.file}: ${issue.field} ${issue.reason} ${issue.kind} "${issue.target}"`,
    );
    throw new Error(`Content reference validation failed:\n${details.join('\n')}`);
  }

  return entries.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
}
