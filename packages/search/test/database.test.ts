import { describe, expect, it } from 'vitest';

import {
  databaseSearchQuery,
  databaseSearchValues,
  mapDatabaseSearchRows,
  prepareDatabaseSearchInput,
} from '../src/database.js';
import { rankSearchDocuments, type SearchDocument } from '../src/ranking.js';

const documents: SearchDocument[] = [
  {
    id: 'body-match',
    type: 'daily',
    title: '每日简报',
    summary: '技术变化',
    href: '/daily/2026-09-04',
    date: '2026-09-04',
    keywords: '',
    body: 'AI 安全边界正在扩大',
  },
  {
    id: 'title-match',
    type: 'insight',
    title: 'AI 安全边界',
    summary: '智能体权限控制',
    href: '/insights/title-match',
    keywords: '安全',
    body: '',
  },
];

describe('PostgreSQL search contract', () => {
  it('prepares only bounded normalized parameters', () => {
    const input = prepareDatabaseSearchInput('  ＡＩ   安全  ', 'daily');
    expect(input).toEqual({ normalizedQuery: 'ai 安全', terms: ['ai', '安全'], type: 'daily' });
    expect(databaseSearchValues(input)).toEqual(['ai 安全', ['ai', '安全'], 'daily']);
    expect(() => prepareDatabaseSearchInput('')).toThrow('must not be empty');
    expect(() => prepareDatabaseSearchInput('x'.repeat(121))).toThrow('at most 120');
  });

  it('keeps all user values out of the fixed SQL text and preserves exact scoring math', () => {
    expect(databaseSearchQuery).toContain('$1::text');
    expect(databaseSearchQuery).toContain('$2::text[]');
    expect(databaseSearchQuery).toContain('$3::text');
    expect(databaseSearchQuery).toContain('FROM ONLY public.search_documents');
    expect(databaseSearchQuery).toContain('replace(document.normalized_title, term');
    expect(databaseSearchQuery).not.toContain('ＡＩ');
  });

  it('maps validated rows and applies the shared deterministic total order', () => {
    const expected = rankSearchDocuments(documents, 'AI 安全');
    const rows = [...expected].reverse().map((result) => ({
      id: result.id,
      type: result.type,
      title: result.title,
      summary: result.summary,
      href: result.href,
      date: result.date ?? null,
      keywords: result.keywords,
      body: result.body,
      score: result.score,
    }));
    expect(mapDatabaseSearchRows(rows)).toEqual(expected);
    expect(() => mapDatabaseSearchRows([{ ...rows[0], score: '10' }])).toThrow('invalid score');
  });
});
