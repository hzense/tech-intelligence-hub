import { readdir, readFile } from 'node:fs/promises';
import { extname, join, relative, sep } from 'node:path';
import matter from 'gray-matter';
import { findReferenceIssues, type ContentDocument, type ReferenceCatalogs } from './references.js';
import { validateDailyIntegrity } from './daily.js';
import { validateFrontMatter, type FrontMatter } from './schema.js';
import { loadSeedCatalog } from './seed.js';

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
    entries.map((entry) =>
      entry.isDirectory()
        ? walk(join(directory, entry.name))
        : Promise.resolve([join(directory, entry.name)]),
    ),
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

export async function loadContent({
  contentRoot,
  seedRoot,
}: LoadContentOptions): Promise<ContentEntry[]> {
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
    throw new Error(
      `Content front matter validation failed:\n${parseFailures.map((failure) => `- ${failure}`).join('\n')}`,
    );
  }

  const seedCatalog = await loadSeedCatalog(seedRoot);
  const catalogs: ReferenceCatalogs = {
    topicIds: new Set(seedCatalog.topics.map((topic) => topic.id)),
    entityIds: new Set(seedCatalog.entities.map((entity) => entity.id)),
    signalIds: new Set(seedCatalog.signals.map((signal) => signal.id)),
  };
  const documents: ContentDocument[] = entries.map((entry) => ({
    file: entry.relativePath,
    frontMatter: entry.frontMatter,
  }));
  const referenceIssues = findReferenceIssues(documents, catalogs);
  if (referenceIssues.length > 0) {
    const details = referenceIssues.map((issue) =>
      issue.reason === 'cycle'
        ? `- ${issue.file}: ${issue.field} cycle ${issue.kind} "${issue.cycle.join(' -> ')}"`
        : `- ${issue.file}: ${issue.field} ${issue.reason} ${issue.kind} "${issue.target}"`,
    );
    throw new Error(`Content reference validation failed:\n${details.join('\n')}`);
  }

  validateDailyIntegrity(entries, seedCatalog);

  return entries.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
}
