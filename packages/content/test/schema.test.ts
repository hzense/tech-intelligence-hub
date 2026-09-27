import { describe, expect, it } from 'vitest';
import { validateFrontMatter } from '../src/schema.js';

describe('front matter schemas', () => {
  it('accepts Topic editorial metadata without duplicated Radar metrics', () => {
    expect(
      validateFrontMatter({
        id: 'topic-ai-security',
        title: 'AI 安全',
        type: 'topic',
        status: 'active',
      }),
    ).toMatchObject({ id: 'topic-ai-security', type: 'topic' });
  });
  it.each([
    ['attention', 85],
    ['trend', 'rapid_growth'],
    ['maturity', 'emerging'],
    ['strategic_value', 'high'],
  ])('rejects a duplicated Topic metric: %s', (field, value) => {
    expect(() =>
      validateFrontMatter({
        id: 'topic-ai-security',
        title: 'AI 安全',
        type: 'topic',
        status: 'active',
        [field]: value,
      }),
    ).toThrow();
  });
  it.each(['daily', 'weekly'])('rejects retired %s content', (type) => {
    expect(() =>
      validateFrontMatter({ id: 'retired-content', title: 'Retired', type, status: 'published' }),
    ).toThrow();
  });
  it('normalizes YAML date objects', () => {
    expect(
      validateFrontMatter({
        id: 'insight-2024-06-20',
        title: 'HZense Insight',
        type: 'insight',
        status: 'published',
        date: new Date('2024-06-20T00:00:00.000Z'),
        importance: 3,
        topics: ['topic-ai'],
      }),
    ).toMatchObject({ date: '2024-06-20' });
  });
  it('rejects impossible historical calendar dates', () => {
    expect(() =>
      validateFrontMatter({
        id: 'insight-2026-02-30',
        title: 'HZense Insight',
        type: 'insight',
        status: 'published',
        date: '2026-02-30',
        importance: 3,
        topics: ['topic-ai'],
      }),
    ).toThrow();
  });
  it('rejects unstable IDs', () => {
    expect(() =>
      validateFrontMatter({ id: 'Bad ID', title: 'x', type: 'topic', status: 'active' }),
    ).toThrow();
  });
});
