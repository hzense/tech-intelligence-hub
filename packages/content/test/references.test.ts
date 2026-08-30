import { describe, expect, it } from 'vitest';
import { findReferenceIssues, type ContentDocument } from '../src/references.js';
import { validateFrontMatter } from '../src/schema.js';

const catalogs = {
  archivedTopicIds: new Set<string>(),
  topicIds: new Set(['topic-foundation-models']),
  entityIds: new Set(['company-openai']),
  signalIds: new Set(['signal-gpt4o']),
};

function catalogsWithTopics(topicIds: readonly string[], archivedTopicIds: readonly string[] = []) {
  return {
    ...catalogs,
    archivedTopicIds: new Set(archivedTopicIds),
    topicIds: new Set([...catalogs.topicIds, ...topicIds]),
  };
}

function document(file: string, input: unknown): ContentDocument {
  return { file, frontMatter: validateFrontMatter(input) };
}

function topicDocument(file: string, id: string, parent?: string): ContentDocument {
  return document(file, {
    id,
    title: id,
    type: 'topic',
    status: 'active',
    ...(parent ? { parent } : {}),
  });
}

describe('content cross-reference validation', () => {
  it('accepts references that resolve to seed and content records', () => {
    const documents = [
      document('daily.md', {
        id: 'daily-2024-06-20',
        title: 'Daily',
        type: 'daily',
        status: 'published',
        edition: 'historical_example',
        date: '2024-06-20',
        language: 'en',
        summary: 'Summary',
        signal_count: 1,
        major_developments: 1,
        rising_topics: ['topic-foundation-models'],
        signal_refs: ['signal-gpt4o'],
      }),
      document('weekly.md', {
        id: 'weekly-2024-w25',
        title: 'Weekly',
        type: 'weekly',
        status: 'published',
        week: '2024-W25',
        start_date: '2024-06-17',
        end_date: '2024-06-23',
        signal_count: 1,
        daily_refs: ['daily-2024-06-20'],
        featured_topics: ['topic-foundation-models'],
      }),
    ];

    expect(findReferenceIssues(documents, catalogs)).toEqual([]);
  });

  it('reports missing and duplicate references with their source fields', () => {
    const documents = [
      document('first.md', {
        id: 'insight-platform-shift',
        title: 'Platform shift',
        type: 'insight',
        status: 'draft',
        date: '2024-06-21',
        importance: 4,
        topics: ['topic-missing'],
        companies: ['company-missing'],
        evidence_signals: ['signal-missing'],
      }),
      document('duplicate.md', {
        id: 'insight-platform-shift',
        title: 'Duplicate',
        type: 'insight',
        status: 'draft',
        date: '2024-06-22',
        importance: 3,
        topics: [],
        evidence_signals: [],
      }),
      document('weekly.md', {
        id: 'weekly-2024-w25',
        title: 'Weekly',
        type: 'weekly',
        status: 'published',
        week: '2024-W25',
        start_date: '2024-06-17',
        end_date: '2024-06-23',
        signal_count: 1,
        daily_refs: ['daily-missing'],
        featured_topics: [],
      }),
    ];

    expect(findReferenceIssues(documents, catalogs)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          field: 'id',
          reason: 'duplicate',
          target: 'insight-platform-shift',
        }),
        expect.objectContaining({ field: 'topics', reason: 'missing', target: 'topic-missing' }),
        expect.objectContaining({
          field: 'companies',
          reason: 'missing',
          target: 'company-missing',
        }),
        expect.objectContaining({
          field: 'evidence_signals',
          reason: 'missing',
          target: 'signal-missing',
        }),
        expect.objectContaining({
          field: 'daily_refs',
          kind: 'daily',
          reason: 'missing',
          target: 'daily-missing',
        }),
      ]),
    );
  });

  it('rejects archived Topic references from published content while allowing drafts', () => {
    const documents = [
      document('archived-topic.md', {
        id: 'topic-legacy',
        title: 'Legacy topic',
        type: 'topic',
        status: 'archived',
      }),
      document('published-insight.md', {
        id: 'insight-published',
        title: 'Published insight',
        type: 'insight',
        status: 'published',
        date: '2024-06-23',
        importance: 4,
        topics: ['topic-legacy'],
        evidence_signals: [],
      }),
      document('draft-insight.md', {
        id: 'insight-draft',
        title: 'Draft insight',
        type: 'insight',
        status: 'draft',
        date: '2024-06-24',
        importance: 3,
        topics: ['topic-legacy'],
        evidence_signals: [],
      }),
    ];

    expect(
      findReferenceIssues(documents, catalogsWithTopics(['topic-legacy'], ['topic-legacy'])),
    ).toEqual([
      {
        file: 'published-insight.md',
        field: 'topics',
        kind: 'topic',
        reason: 'archived',
        target: 'topic-legacy',
      },
    ]);
  });

  it('rejects a Topic that names itself as its parent', () => {
    const overlappingCatalogs = catalogsWithTopics(['topic-self']);

    expect(
      findReferenceIssues(
        [topicDocument('topics/self.md', 'topic-self', 'topic-self')],
        overlappingCatalogs,
      ),
    ).toEqual([
      {
        file: 'topics/self.md',
        field: 'parent',
        kind: 'topic',
        reason: 'cycle',
        cycle: ['topic-self', 'topic-self'],
      },
    ]);
  });

  it('reports every Topic ID in a multi-node parent cycle exactly once', () => {
    const documents = [
      topicDocument('topics/tail.md', 'topic-0-tail', 'topic-a'),
      topicDocument('topics/a.md', 'topic-a', 'topic-b'),
      topicDocument('topics/b.md', 'topic-b', 'topic-a'),
    ];

    expect(
      findReferenceIssues(documents, catalogsWithTopics(['topic-0-tail', 'topic-a', 'topic-b'])),
    ).toEqual([
      {
        file: 'topics/a.md',
        field: 'parent',
        kind: 'topic',
        reason: 'cycle',
        cycle: ['topic-a', 'topic-b', 'topic-a'],
      },
    ]);
  });

  it('allows an acyclic parent chain that terminates at a seed-only Topic', () => {
    const documents = [
      topicDocument('topics/root.md', 'topic-root'),
      topicDocument('topics/child.md', 'topic-child', 'topic-root'),
      topicDocument('topics/grandchild.md', 'topic-grandchild', 'topic-child'),
      topicDocument('topics/model-serving.md', 'topic-model-serving', 'topic-foundation-models'),
    ];

    expect(
      findReferenceIssues(
        documents,
        catalogsWithTopics([
          'topic-root',
          'topic-child',
          'topic-grandchild',
          'topic-model-serving',
        ]),
      ),
    ).toEqual([]);
  });

  it('does not let a Topic content document authorize its own ID', () => {
    const documents = [
      topicDocument('topics/rogue.md', 'topic-rogue'),
      document('insight.md', {
        id: 'insight-rogue-topic',
        title: 'Rogue topic reference',
        type: 'insight',
        status: 'draft',
        date: '2026-08-30',
        importance: 3,
        topics: ['topic-rogue'],
        evidence_signals: [],
      }),
    ];

    expect(findReferenceIssues(documents, catalogs)).toEqual([
      {
        file: 'topics/rogue.md',
        field: 'id',
        kind: 'topic',
        reason: 'missing',
        target: 'topic-rogue',
      },
      {
        file: 'insight.md',
        field: 'topics',
        kind: 'topic',
        reason: 'missing',
        target: 'topic-rogue',
      },
    ]);
  });
});
