import { describe, expect, it } from 'vitest';
import { findReferenceIssues, type ContentDocument } from '../src/references.js';
import { validateFrontMatter } from '../src/schema.js';

const catalogs = {
  topicIds: new Set(['topic-foundation-models']),
  entityIds: new Set(['company-openai']),
  signalIds: new Set(['signal-gpt4o']),
};

function document(file: string, input: unknown): ContentDocument {
  return { file, frontMatter: validateFrontMatter(input) };
}

describe('content cross-reference validation', () => {
  it('accepts references that resolve to seed and content records', () => {
    const documents = [
      document('daily.md', {
        id: 'daily-2024-06-20',
        title: 'Daily',
        type: 'daily',
        status: 'published',
        date: '2024-06-20',
        language: 'en',
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
        expect.objectContaining({ field: 'id', reason: 'duplicate', target: 'insight-platform-shift' }),
        expect.objectContaining({ field: 'topics', reason: 'missing', target: 'topic-missing' }),
        expect.objectContaining({ field: 'companies', reason: 'missing', target: 'company-missing' }),
        expect.objectContaining({ field: 'evidence_signals', reason: 'missing', target: 'signal-missing' }),
        expect.objectContaining({ field: 'daily_refs', kind: 'daily', reason: 'missing', target: 'daily-missing' }),
      ]),
    );
  });
});
