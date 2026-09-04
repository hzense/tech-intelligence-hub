import { createHash } from 'node:crypto';

import type { DatabaseSearchDocument } from './database.js';
import { normalizeSearchText } from './ranking.js';
import type { SearchDocument, SearchType } from './ranking.js';

export const SEARCH_DOCUMENT_PROJECTION_VERSION = 'search-document-v1' as const;

export type ContentPublicationStatus = 'draft' | 'review' | 'published' | 'archived';
export type TopicPublicationStatus = 'watching' | 'active' | 'strategic' | 'archived';
export type SignalPublicationStatus = 'inbox' | 'reviewed' | 'accepted' | 'rejected' | 'archived';

const publishedTopicStatuses: ReadonlySet<TopicPublicationStatus> = new Set([
  'watching',
  'active',
  'strategic',
]);

interface SearchProjectionFields {
  sourceId: string;
  title: string;
  summary: string;
  href: string;
  keywords: string;
  body: string;
  importance: number;
  documentDate: string | null;
  topics: readonly string[];
  entities: readonly string[];
}

export type SearchProjectionCandidate = SearchProjectionFields &
  (
    | {
        sourceType: 'daily' | 'weekly' | 'insight';
        publication: { kind: 'content'; status: ContentPublicationStatus };
      }
    | {
        sourceType: 'topic';
        publication: { kind: 'topic'; status: TopicPublicationStatus };
      }
    | {
        sourceType: 'signal';
        publication: { kind: 'signal'; status: SignalPublicationStatus };
      }
    | {
        sourceType: 'resource';
        publication: { kind: 'resource'; status: string };
      }
  );

export type PublishedSearchProjectionInput = SearchProjectionFields &
  (
    | {
        sourceType: 'daily' | 'weekly' | 'insight';
        publication: { kind: 'content'; status: 'published' };
      }
    | {
        sourceType: 'topic';
        publication: { kind: 'topic'; status: 'watching' | 'active' | 'strategic' };
      }
    | {
        sourceType: 'signal';
        publication: { kind: 'signal'; status: 'reviewed' | 'accepted' };
      }
    | {
        sourceType: 'resource';
        publication: { kind: 'resource'; status: 'active' };
      }
  );

export interface CanonicalSearchDocument {
  id: string;
  sourceId: string;
  sourceType: SearchType;
  title: string;
  summary: string;
  href: string;
  keywords: string;
  body: string;
  importance: number;
  documentDate: string | null;
  topics: readonly string[];
  entities: readonly string[];
}

function compareOrdinal(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function canonicalText(value: string, field: string, allowEmpty = false): string {
  const canonical = value.replace(/\r\n?/g, '\n').trim();
  if (!allowEmpty && canonical.length === 0) {
    throw new Error(`Search projection ${field} must not be empty`);
  }
  return canonical;
}

function canonicalKeywords(value: string): string {
  return canonicalText(value, 'keywords', true).replace(/\s+/g, ' ');
}

function canonicalIds(values: readonly string[], field: string): readonly string[] {
  const ids = values.map((value) => canonicalText(value, field));
  return [...new Set(ids)].sort(compareOrdinal);
}

function assertDocumentDate(value: string | null): void {
  if (value === null) return;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error('Search projection documentDate must be a date-only value or null');
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new Error('Search projection documentDate must be a valid date-only value or null');
  }
}

function assertImportance(value: number): void {
  if (!Number.isInteger(value) || value < 1 || value > 5) {
    throw new Error('Search projection importance must be an integer from 1 to 5');
  }
}

export function isPublishedSearchProjectionInput(
  candidate: SearchProjectionCandidate,
): candidate is PublishedSearchProjectionInput {
  switch (candidate.publication.kind) {
    case 'content':
      return (
        (candidate.sourceType === 'daily' ||
          candidate.sourceType === 'weekly' ||
          candidate.sourceType === 'insight') &&
        candidate.publication.status === 'published'
      );
    case 'topic':
      return (
        candidate.sourceType === 'topic' && publishedTopicStatuses.has(candidate.publication.status)
      );
    case 'signal':
      return (
        candidate.sourceType === 'signal' &&
        (candidate.publication.status === 'reviewed' || candidate.publication.status === 'accepted')
      );
    case 'resource':
      return candidate.sourceType === 'resource' && candidate.publication.status === 'active';
  }
}

function buildCanonicalSearchDocument(
  input: PublishedSearchProjectionInput,
): CanonicalSearchDocument {
  assertImportance(input.importance);
  assertDocumentDate(input.documentDate);

  const sourceId = canonicalText(input.sourceId, 'sourceId');
  const sourceType = input.sourceType;

  return {
    id: `searchdoc-${sourceType}-${sourceId}`,
    sourceId,
    sourceType,
    title: canonicalText(input.title, 'title'),
    summary: canonicalText(input.summary, 'summary'),
    href: canonicalText(input.href, 'href'),
    keywords: canonicalKeywords(input.keywords),
    body: canonicalText(input.body, 'body', true),
    importance: input.importance,
    documentDate: input.documentDate,
    topics: canonicalIds(input.topics, 'topics'),
    entities: canonicalIds(input.entities, 'entities'),
  };
}

export function projectPublishedSearchDocument(
  candidate: SearchProjectionCandidate,
): CanonicalSearchDocument | null {
  return isPublishedSearchProjectionInput(candidate)
    ? buildCanonicalSearchDocument(candidate)
    : null;
}

export function projectPublishedSearchDocuments(
  candidates: readonly SearchProjectionCandidate[],
): CanonicalSearchDocument[] {
  return candidates.flatMap((candidate) => {
    const document = projectPublishedSearchDocument(candidate);
    return document ? [document] : [];
  });
}

export function toSearchDocument(projection: CanonicalSearchDocument): SearchDocument {
  return {
    id: projection.sourceId,
    type: projection.sourceType,
    title: projection.title,
    summary: projection.summary,
    href: projection.href,
    ...(projection.documentDate ? { date: projection.documentDate } : {}),
    keywords: projection.keywords,
    body: projection.body,
  };
}

export function serializeCanonicalSearchDocuments(
  documents: readonly CanonicalSearchDocument[],
): string {
  const sortedDocuments = [...documents].sort((left, right) => compareOrdinal(left.id, right.id));
  const ids = new Set<string>();

  for (const document of sortedDocuments) {
    if (ids.has(document.id)) {
      throw new Error(`Duplicate canonical Search Document id: ${document.id}`);
    }
    ids.add(document.id);
  }

  return JSON.stringify({
    version: SEARCH_DOCUMENT_PROJECTION_VERSION,
    documents: sortedDocuments.map((document) => ({
      id: document.id,
      sourceId: document.sourceId,
      sourceType: document.sourceType,
      title: document.title,
      summary: document.summary,
      href: document.href,
      keywords: document.keywords,
      body: document.body,
      importance: document.importance,
      documentDate: document.documentDate,
      topics: [...document.topics],
      entities: [...document.entities],
    })),
  });
}

export function fingerprintCanonicalSearchDocuments(
  documents: readonly CanonicalSearchDocument[],
): string {
  return `sha256:${createHash('sha256')
    .update(serializeCanonicalSearchDocuments(documents), 'utf8')
    .digest('hex')}`;
}

export function toDatabaseSearchDocument(
  document: CanonicalSearchDocument,
): DatabaseSearchDocument {
  return {
    ...document,
    normalizedTitle: normalizeSearchText(document.title),
    normalizedSummary: normalizeSearchText(document.summary),
    normalizedKeywords: normalizeSearchText(document.keywords),
    normalizedBody: normalizeSearchText(document.body),
  };
}

export function toDatabaseSearchDocuments(
  documents: readonly CanonicalSearchDocument[],
): DatabaseSearchDocument[] {
  return documents.map(toDatabaseSearchDocument);
}
