import { describe, expect, it } from 'vitest';

import golden from './fixtures/search-ranking-golden.json';
import {
  isSearchType,
  rankSearchDocuments,
  SEARCH_RANKING_CONTRACT,
  searchTypes,
  tokenizeSearchQuery,
  type SearchDocument,
  type SearchType,
} from '../src/ranking.js';

function goldenDocuments(): SearchDocument[] {
  return golden.documents.map((document) => {
    if (!isSearchType(document.type)) throw new Error(`Unknown golden type: ${document.type}`);
    return { ...document, type: document.type };
  });
}

describe('in-process ranking parity corpus', () => {
  it('pins the tokenizer boundary that PostgreSQL FTS must preserve at cutover', () => {
    expect(golden.contract).toEqual(SEARCH_RANKING_CONTRACT);
    expect(new Set(goldenDocuments().map((document) => document.type))).toEqual(
      new Set(searchTypes),
    );
    expect(tokenizeSearchQuery('  ＡＩ   安全  ')).toEqual(['ai', '安全']);
    expect(tokenizeSearchQuery('模型平台')).toEqual(['模型平台']);
    expect(tokenizeSearchQuery('foundation-model')).toEqual(['foundation-model']);
  });

  for (const goldenCase of golden.cases) {
    it(goldenCase.name, () => {
      const type = goldenCase.type;
      if (type !== undefined && !isSearchType(type)) {
        throw new Error(`Unknown golden filter type: ${type}`);
      }

      expect(
        rankSearchDocuments(
          goldenDocuments(),
          goldenCase.query,
          type as SearchType | undefined,
        ).map((result) => result.id),
      ).toEqual(goldenCase.expectedIds);
    });
  }

  it('keeps empty queries and missing all-term matches empty', () => {
    expect(rankSearchDocuments(goldenDocuments(), '   ')).toEqual([]);
    expect(rankSearchDocuments(goldenDocuments(), 'AI 不存在')).toEqual([]);
  });
});
