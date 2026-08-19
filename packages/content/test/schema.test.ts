import { describe, expect, it } from 'vitest';
import { validateFrontMatter } from '../src/schema.js';

describe('front matter schemas', () => {
  it('accepts a minimal daily', () => {
    expect(validateFrontMatter({ id: 'daily-2024-06-20', title: 'HZense Daily', type: 'daily', status: 'published', date: '2024-06-20', language: 'en', signal_count: 1, major_developments: 1, rising_topics: [], signal_refs: [] }).type).toBe('daily');
  });
  it('rejects unstable IDs', () => {
    expect(() => validateFrontMatter({ id: 'Bad ID', title: 'x', type: 'topic', status: 'active' })).toThrow();
  });
});
