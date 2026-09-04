export const searchTypes = ['daily', 'weekly', 'insight', 'topic', 'signal', 'resource'] as const;

export type SearchType = (typeof searchTypes)[number];

export const searchTypeLabels: Record<SearchType, string> = {
  daily: '每日简报',
  weekly: '周报',
  insight: '洞察',
  topic: '专题',
  signal: '信号',
  resource: '资源',
};

export const SEARCH_RANKING_CONTRACT = {
  version: 'nfkc-whitespace-substring-v1',
  normalization: 'NFKC, zh-CN locale lowercase, collapsed Unicode whitespace',
  queryTermBoundary: 'Unicode whitespace only; no Chinese word segmentation',
  matching: 'all normalized terms must occur as literal substrings',
  ordering:
    'score descending, date descending, zh-CN title ascending, type ordinal ascending, id ordinal ascending',
} as const;

export interface SearchDocument {
  id: string;
  type: SearchType;
  title: string;
  summary: string;
  href: string;
  date?: string;
  keywords: string;
  body: string;
}

export interface SearchResult extends SearchDocument {
  score: number;
}

export function normalizeSearchText(value: string): string {
  return value.normalize('NFKC').toLocaleLowerCase('zh-CN').replace(/\s+/g, ' ').trim();
}

export function tokenizeSearchQuery(query: string): string[] {
  return [...new Set(normalizeSearchText(query).split(' ').filter(Boolean))];
}

function countMatches(value: string, term: string): number {
  if (!term) return 0;
  let count = 0;
  let start = 0;
  while ((start = value.indexOf(term, start)) !== -1) {
    count += 1;
    start += term.length;
  }
  return count;
}

function compareOrdinal(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function isSearchType(value: string): value is SearchType {
  return searchTypes.includes(value as SearchType);
}

export function rankSearchDocuments(
  documents: readonly SearchDocument[],
  query: string,
  type?: SearchType,
): SearchResult[] {
  const normalizedQuery = normalizeSearchText(query);
  const terms = tokenizeSearchQuery(query);
  if (terms.length === 0) return [];

  return documents
    .filter((document) => !type || document.type === type)
    .flatMap((document) => {
      const title = normalizeSearchText(document.title);
      const summary = normalizeSearchText(document.summary);
      const keywords = normalizeSearchText(document.keywords);
      const body = normalizeSearchText(document.body);
      const searchable = `${title} ${summary} ${keywords} ${body}`;
      if (!terms.every((term) => searchable.includes(term))) return [];

      const termScore = terms.reduce(
        (score, term) =>
          score +
          countMatches(title, term) * 8 +
          countMatches(summary, term) * 4 +
          countMatches(keywords, term) * 3 +
          Math.min(countMatches(body, term), 4),
        0,
      );
      const phraseScore =
        (title.includes(normalizedQuery) ? 12 : 0) +
        (summary.includes(normalizedQuery) ? 6 : 0) +
        (keywords.includes(normalizedQuery) ? 3 : 0);

      return [{ ...document, score: termScore + phraseScore }];
    })
    .sort(
      (left, right) =>
        right.score - left.score ||
        (right.date ?? '').localeCompare(left.date ?? '') ||
        left.title.localeCompare(right.title, 'zh-CN') ||
        compareOrdinal(left.type, right.type) ||
        compareOrdinal(left.id, right.id),
    );
}
