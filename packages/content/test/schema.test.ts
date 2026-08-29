import { describe, expect, it } from 'vitest';
import { validateFrontMatter } from '../src/schema.js';

describe('front matter schemas', () => {
  it('accepts a minimal daily', () => {
    expect(
      validateFrontMatter({
        id: 'daily-2024-06-20',
        title: 'HZense Daily',
        type: 'daily',
        status: 'published',
        edition: 'historical_example',
        date: '2024-06-20',
        language: 'en',
        summary: 'Summary',
        signal_count: 1,
        major_developments: 1,
        rising_topics: ['topic-ai'],
        signal_refs: ['signal-example'],
      }).type,
    ).toBe('daily');
  });
  it('normalizes YAML date objects', () => {
    expect(
      validateFrontMatter({
        id: 'daily-2024-06-20',
        title: 'HZense Daily',
        type: 'daily',
        status: 'published',
        edition: 'historical_example',
        date: new Date('2024-06-20T00:00:00.000Z'),
        language: 'en',
        summary: 'Summary',
        signal_count: 1,
        major_developments: 1,
        rising_topics: ['topic-ai'],
        signal_refs: ['signal-example'],
      }),
    ).toMatchObject({ date: '2024-06-20' });
  });
  it('rejects impossible historical calendar dates', () => {
    expect(() =>
      validateFrontMatter({
        id: 'daily-2026-02-30',
        title: 'HZense Daily',
        type: 'daily',
        status: 'published',
        edition: 'historical_example',
        date: '2026-02-30',
        language: 'en',
        summary: 'Summary',
        signal_count: 1,
        major_developments: 1,
        rising_topics: ['topic-ai'],
        signal_refs: ['signal-example'],
      }),
    ).toThrow();
  });
  it('rejects unstable IDs', () => {
    expect(() =>
      validateFrontMatter({ id: 'Bad ID', title: 'x', type: 'topic', status: 'active' }),
    ).toThrow();
  });
});
