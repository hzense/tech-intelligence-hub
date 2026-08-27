import assert from 'node:assert/strict';
import test from 'node:test';

import { rankSearchDocuments } from '../lib/search-ranking.ts';

const documents = [
  {
    id: 'title-match',
    type: 'insight',
    title: 'AI 安全边界',
    summary: '智能体权限控制',
    href: '/insights/title-match',
    keywords: '安全',
    body: '',
  },
  {
    id: 'body-match',
    type: 'daily',
    title: '每日简报',
    summary: '技术变化',
    href: '/daily/2024-01-01',
    keywords: '',
    body: 'AI 安全边界正在扩大',
  },
];

test('ranks title matches above body-only matches', () => {
  const results = rankSearchDocuments(documents, 'AI 安全');

  assert.deepEqual(
    results.map((result) => result.id),
    ['title-match', 'body-match'],
  );
  assert.ok(results[0].score > results[1].score);
});

test('requires every normalized query term and respects type filters', () => {
  assert.equal(rankSearchDocuments(documents, 'AI 不存在').length, 0);
  assert.deepEqual(
    rankSearchDocuments(documents, 'ＡＩ 安全', 'daily').map((result) => result.id),
    ['body-match'],
  );
});
