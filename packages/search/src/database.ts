import {
  compareSearchResults,
  isSearchType,
  normalizeSearchText,
  tokenizeSearchQuery,
  type SearchResult,
  type SearchType,
} from './ranking.js';

export const SEARCH_DATABASE_PROJECTION_VERSION = 'search-database-v1' as const;
export const searchQueryMaximumLength = 120;
export const searchQueryMaximumTerms = 24;

export interface DatabaseSearchDocument {
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
  normalizedTitle: string;
  normalizedSummary: string;
  normalizedKeywords: string;
  normalizedBody: string;
}

export interface DatabaseSearchInput {
  normalizedQuery: string;
  terms: readonly string[];
  type: SearchType | null;
}

export const databaseSearchQuery = `WITH query_input AS (
  SELECT $1::text AS normalized_query,
         $2::text[] AS terms,
         $3::text AS source_type
), matching AS (
  SELECT document.source_id AS id,
         document.source_type AS type,
         document.title,
         document.summary,
         document.href,
         document.document_date::text AS date,
         document.keywords,
         document.body,
         (
           SELECT COALESCE(sum(
             ((length(document.normalized_title) - length(replace(document.normalized_title, term, ''))) / length(term)) * 8 +
             ((length(document.normalized_summary) - length(replace(document.normalized_summary, term, ''))) / length(term)) * 4 +
             ((length(document.normalized_keywords) - length(replace(document.normalized_keywords, term, ''))) / length(term)) * 3 +
             least((length(document.normalized_body) - length(replace(document.normalized_body, term, ''))) / length(term), 4)
           ), 0)::integer
           FROM unnest(query_input.terms) AS term
         ) +
         CASE WHEN strpos(document.normalized_title, query_input.normalized_query) > 0 THEN 12 ELSE 0 END +
         CASE WHEN strpos(document.normalized_summary, query_input.normalized_query) > 0 THEN 6 ELSE 0 END +
         CASE WHEN strpos(document.normalized_keywords, query_input.normalized_query) > 0 THEN 3 ELSE 0 END AS score
  FROM ONLY public.search_documents AS document
  CROSS JOIN query_input
  WHERE (query_input.source_type IS NULL OR document.source_type = query_input.source_type)
    AND NOT EXISTS (
      SELECT 1
      FROM unnest(query_input.terms) AS term
      WHERE strpos(
        concat_ws(
          ' ',
          document.normalized_title,
          document.normalized_summary,
          document.normalized_keywords,
          document.normalized_body
        ),
        term
      ) = 0
    )
)
SELECT id, type, title, summary, href, date, keywords, body, score
FROM matching`;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireString(value: unknown, field: string, allowEmpty = false): string {
  if (typeof value !== 'string' || (!allowEmpty && value.length === 0)) {
    throw new Error(`Database search row has invalid ${field}`);
  }
  return value;
}

export function prepareDatabaseSearchInput(query: string, type?: SearchType): DatabaseSearchInput {
  if (typeof query !== 'string' || query.length > searchQueryMaximumLength) {
    throw new Error(`Search query must contain at most ${searchQueryMaximumLength} characters`);
  }
  const normalizedQuery = normalizeSearchText(query);
  const terms = tokenizeSearchQuery(query);
  if (terms.length === 0) throw new Error('Search query must not be empty');
  if (terms.length > searchQueryMaximumTerms) {
    throw new Error(`Search query must contain at most ${searchQueryMaximumTerms} terms`);
  }
  if (type !== undefined && !isSearchType(type)) throw new Error('Search type is invalid');
  return { normalizedQuery, terms, type: type ?? null };
}

export function databaseSearchValues(input: DatabaseSearchInput): readonly unknown[] {
  return [input.normalizedQuery, [...input.terms], input.type];
}

export function mapDatabaseSearchRows(rows: readonly unknown[]): SearchResult[] {
  return rows
    .map((row) => {
      if (!isRecord(row)) throw new Error('Database search row must be an object');
      const type = requireString(row.type, 'type');
      if (!isSearchType(type)) throw new Error('Database search row has invalid type');
      if (!Number.isSafeInteger(row.score) || (row.score as number) < 0) {
        throw new Error('Database search row has invalid score');
      }
      const date = row.date;
      if (date !== null && (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date))) {
        throw new Error('Database search row has invalid date');
      }
      return {
        id: requireString(row.id, 'id'),
        type,
        title: requireString(row.title, 'title'),
        summary: requireString(row.summary, 'summary'),
        href: requireString(row.href, 'href'),
        ...(date ? { date } : {}),
        keywords: requireString(row.keywords, 'keywords', true),
        body: requireString(row.body, 'body', true),
        score: row.score as number,
      };
    })
    .sort(compareSearchResults);
}
