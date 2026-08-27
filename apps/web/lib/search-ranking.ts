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

function normalize(value: string): string {
  return value.normalize('NFKC').toLocaleLowerCase('zh-CN').replace(/\s+/g, ' ').trim();
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

export function isSearchType(value: string): value is SearchType {
  return searchTypes.includes(value as SearchType);
}

export function rankSearchDocuments(
  documents: SearchDocument[],
  query: string,
  type?: SearchType,
): SearchResult[] {
  const normalizedQuery = normalize(query);
  const terms = [...new Set(normalizedQuery.split(' ').filter(Boolean))];
  if (terms.length === 0) return [];

  return documents
    .filter((document) => !type || document.type === type)
    .flatMap((document) => {
      const title = normalize(document.title);
      const summary = normalize(document.summary);
      const keywords = normalize(document.keywords);
      const body = normalize(document.body);
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
        left.title.localeCompare(right.title, 'zh-CN'),
    );
}
