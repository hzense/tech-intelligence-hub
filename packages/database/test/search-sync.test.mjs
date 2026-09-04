import { describe, expect, it } from 'vitest';
import {
  normalizeSearchDocuments,
  planSearchDocumentSync,
  searchDocumentsFingerprint,
} from '../src/search-sync.mjs';

function document(overrides = {}) {
  return {
    id: 'searchdoc-insight-example',
    sourceId: 'example',
    sourceType: 'insight',
    title: 'AI 安全',
    summary: '摘要',
    href: '/insights/example',
    keywords: 'ai 安全',
    body: '正文',
    importance: 4,
    documentDate: '2026-09-04',
    topics: ['topic-ai'],
    entities: ['entity-openai'],
    normalizedTitle: 'ai 安全',
    normalizedSummary: '摘要',
    normalizedKeywords: 'ai 安全',
    normalizedBody: '正文',
    ...overrides,
  };
}

describe('Search Document projection sync', () => {
  it('plans inserts, updates, stale-row deletion and a deterministic fingerprint', () => {
    const desired = [
      document(),
      document({
        id: 'searchdoc-topic-topic-ai',
        sourceId: 'topic-ai',
        sourceType: 'topic',
        href: '/topics/topic-ai',
        documentDate: null,
        entities: [],
      }),
    ];
    const existing = [
      document({ summary: '旧摘要', normalizedSummary: '旧摘要' }),
      document({
        id: 'searchdoc-resource-stale',
        sourceId: 'stale',
        sourceType: 'resource',
        href: '/resources/stale',
        documentDate: null,
      }),
    ];
    const plan = planSearchDocumentSync(desired, existing);
    expect(plan.inserts.map((row) => row.id)).toEqual(['searchdoc-topic-topic-ai']);
    expect(plan.updates.map((row) => row.id)).toEqual(['searchdoc-insight-example']);
    expect(plan.deletes.map((row) => row.id)).toEqual(['searchdoc-resource-stale']);
    expect(plan.planFingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(searchDocumentsFingerprint([...desired].reverse())).toBe(
      searchDocumentsFingerprint(desired),
    );
  });

  it('fails closed for empty, duplicate or non-canonical projections', () => {
    expect(() => normalizeSearchDocuments([])).toThrow('non-empty array');
    expect(() => normalizeSearchDocuments([document(), document()])).toThrow('duplicate id');
    expect(() => normalizeSearchDocuments([document({ id: 'wrong' })])).toThrow(
      'canonical source identity',
    );
    expect(() => normalizeSearchDocuments([document({ href: 'https://example.com' })])).toThrow(
      'root-relative',
    );
  });
});
