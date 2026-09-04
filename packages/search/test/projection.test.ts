import { describe, expect, it } from 'vitest';

import {
  fingerprintCanonicalSearchDocuments,
  projectPublishedSearchDocument,
  projectPublishedSearchDocuments,
  SEARCH_DOCUMENT_PROJECTION_VERSION,
  serializeCanonicalSearchDocuments,
  toDatabaseSearchDocument,
  toSearchDocument,
  type SearchProjectionCandidate,
} from '../src/projection.js';

const common = {
  title: '  Canonical 标题  ',
  summary: '  中文与 English summary  ',
  href: '/search/example',
  keywords: 'AI   模型\nplatform',
  body: '第一行\r\n\r\nSecond line',
  importance: 4,
  topics: ['topic-z', 'topic-a', 'topic-z'],
  entities: ['entity-b', 'entity-a'],
} as const;

const publishedCandidates: SearchProjectionCandidate[] = [
  {
    ...common,
    sourceId: 'daily-example',
    sourceType: 'daily',
    publication: { kind: 'content', status: 'published' },
    documentDate: '2026-09-01',
  },
  {
    ...common,
    sourceId: 'weekly-example',
    sourceType: 'weekly',
    publication: { kind: 'content', status: 'published' },
    documentDate: '2026-09-02',
  },
  {
    ...common,
    sourceId: 'insight-example',
    sourceType: 'insight',
    publication: { kind: 'content', status: 'published' },
    documentDate: '2026-09-03',
  },
  {
    ...common,
    sourceId: 'topic-example',
    sourceType: 'topic',
    publication: { kind: 'topic', status: 'strategic' },
    documentDate: null,
  },
  {
    ...common,
    sourceId: 'signal-example',
    sourceType: 'signal',
    publication: { kind: 'signal', status: 'reviewed' },
    documentDate: '2026-09-04',
  },
  {
    ...common,
    sourceId: 'resource-example',
    sourceType: 'resource',
    publication: { kind: 'resource', status: 'active' },
    documentDate: null,
  },
];

describe('canonical Search Document projection', () => {
  it('projects all six public source types with nullable dates and UI fields', () => {
    const documents = projectPublishedSearchDocuments(publishedCandidates);

    expect(documents.map((document) => document.sourceType)).toEqual([
      'daily',
      'weekly',
      'insight',
      'topic',
      'signal',
      'resource',
    ]);
    expect(documents[0]).toMatchObject({
      id: 'searchdoc-daily-daily-example',
      sourceId: 'daily-example',
      title: 'Canonical 标题',
      summary: '中文与 English summary',
      href: '/search/example',
      keywords: 'AI 模型 platform',
      body: '第一行\n\nSecond line',
      importance: 4,
      documentDate: '2026-09-01',
      topics: ['topic-a', 'topic-z'],
      entities: ['entity-a', 'entity-b'],
    });
    expect(documents[3]?.documentDate).toBeNull();
    expect(documents[5]?.documentDate).toBeNull();
  });

  it('excludes non-public states at the projection boundary', () => {
    const excluded: SearchProjectionCandidate[] = [
      {
        ...common,
        sourceId: 'draft-daily',
        sourceType: 'daily',
        publication: { kind: 'content', status: 'draft' },
        documentDate: '2026-09-01',
      },
      {
        ...common,
        sourceId: 'archived-topic',
        sourceType: 'topic',
        publication: { kind: 'topic', status: 'archived' },
        documentDate: null,
      },
      {
        ...common,
        sourceId: 'archived-signal',
        sourceType: 'signal',
        publication: { kind: 'signal', status: 'archived' },
        documentDate: '2026-09-04',
      },
      {
        ...common,
        sourceId: 'inactive-resource',
        sourceType: 'resource',
        publication: { kind: 'resource', status: 'inactive' },
        documentDate: null,
      },
    ];

    expect(projectPublishedSearchDocuments(excluded)).toEqual([]);
    expect(projectPublishedSearchDocument(excluded[0]!)).toBeNull();

    const mismatchedKind = {
      ...publishedCandidates[0]!,
      sourceType: 'topic',
    } as unknown as SearchProjectionCandidate;
    expect(projectPublishedSearchDocument(mismatchedKind)).toBeNull();
  });

  it.each(['watching', 'active', 'strategic'] as const)(
    'accepts the explicit %s Topic publication status',
    (status) => {
      const publishedTopic = {
        ...publishedCandidates[3]!,
        sourceType: 'topic',
        publication: { kind: 'topic', status },
      } satisfies SearchProjectionCandidate;

      expect(projectPublishedSearchDocument(publishedTopic)).not.toBeNull();
    },
  );

  it.each([
    { label: 'empty', status: '' },
    { label: 'unknown', status: 'unknown' },
    { label: 'future', status: 'scheduled' },
  ])('fails closed for a $label Topic publication status', ({ status }) => {
    const invalidTopic = {
      ...publishedCandidates[3]!,
      publication: { kind: 'topic', status },
    } as unknown as SearchProjectionCandidate;

    expect(projectPublishedSearchDocument(invalidTopic)).toBeNull();
  });

  it('maps the canonical projection back to the unchanged Web ranking shape', () => {
    const dated = projectPublishedSearchDocument(publishedCandidates[0]!);
    const undated = projectPublishedSearchDocument(publishedCandidates[3]!);
    expect(dated).not.toBeNull();
    expect(undated).not.toBeNull();

    expect(toSearchDocument(dated!)).toEqual({
      id: 'daily-example',
      type: 'daily',
      title: 'Canonical 标题',
      summary: '中文与 English summary',
      href: '/search/example',
      date: '2026-09-01',
      keywords: 'AI 模型 platform',
      body: '第一行\n\nSecond line',
    });
    expect(toSearchDocument(undated!)).not.toHaveProperty('date');
  });

  it('creates the database projection with the same NFKC normalization contract', () => {
    const projected = projectPublishedSearchDocument({
      ...publishedCandidates[0]!,
      title: 'ＡＩ  安全',
      keywords: 'Ｆｏｕｎｄａｔｉｏｎ  模型',
    });
    expect(projected).not.toBeNull();
    expect(toDatabaseSearchDocument(projected!)).toMatchObject({
      normalizedTitle: 'ai 安全',
      normalizedKeywords: 'foundation 模型',
      normalizedSummary: '中文与 english summary',
    });
  });

  it('has an order-independent versioned canonical serialization and fingerprint', () => {
    const documents = projectPublishedSearchDocuments(publishedCandidates);
    const serialized = serializeCanonicalSearchDocuments(documents);

    expect(JSON.parse(serialized)).toMatchObject({
      version: SEARCH_DOCUMENT_PROJECTION_VERSION,
      documents: expect.any(Array),
    });
    expect(serializeCanonicalSearchDocuments([...documents].reverse())).toBe(serialized);
    const equivalentCandidates = publishedCandidates.map((candidate) => ({
      ...candidate,
      body: candidate.body.replace(/\r\n/g, '\n'),
      topics: [...candidate.topics].reverse(),
      entities: [...candidate.entities].reverse(),
    }));
    expect(
      fingerprintCanonicalSearchDocuments(projectPublishedSearchDocuments(equivalentCandidates)),
    ).toBe(fingerprintCanonicalSearchDocuments(documents));
    expect(fingerprintCanonicalSearchDocuments(documents)).toBe(
      'sha256:699a2e299642822679077f2c4bf0dae7d5de563009f798264c140363f5dc93c2',
    );
  });

  it('rejects invalid canonical dates, importance and duplicate ids', () => {
    expect(() =>
      projectPublishedSearchDocument({
        ...publishedCandidates[0]!,
        documentDate: '2026-02-30',
      }),
    ).toThrow('valid date-only');
    expect(() =>
      projectPublishedSearchDocument({ ...publishedCandidates[0]!, importance: 0 }),
    ).toThrow('integer from 1 to 5');

    const duplicate = projectPublishedSearchDocument(publishedCandidates[0]!);
    expect(duplicate).not.toBeNull();
    expect(() => serializeCanonicalSearchDocuments([duplicate!, duplicate!])).toThrow(
      'Duplicate canonical Search Document id',
    );
  });
});
