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

  it('keeps fully tied results independent of source iteration order', () => {
    const expected = ['exact-tie-a', 'exact-tie-b'];
    expect(
      rankSearchDocuments(goldenDocuments(), 'equal-order-probe').map((result) => result.id),
    ).toEqual(expected);
    expect(
      rankSearchDocuments(goldenDocuments().reverse(), 'equal-order-probe').map(
        (result) => result.id,
      ),
    ).toEqual(expected);
  });

  it('uses type before ID to total-order canonical identities', () => {
    const shared = {
      id: 'shared-id',
      title: 'Exact Cross-Type Tie',
      summary: '',
      href: '/shared',
      date: '2024-12-04',
      keywords: '',
      body: 'cross-type-tie-token',
    };
    const documents: SearchDocument[] = [
      { ...shared, type: 'topic' },
      { ...shared, type: 'signal' },
    ];
    const identities = (source: readonly SearchDocument[]) =>
      rankSearchDocuments(source, 'cross-type-tie-token').map(
        (result) => `${result.type}:${result.id}`,
      );

    expect(identities(documents)).toEqual(['signal:shared-id', 'topic:shared-id']);
    expect(identities([...documents].reverse())).toEqual(['signal:shared-id', 'topic:shared-id']);
  });
});
