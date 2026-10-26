import { describe, expect, it } from 'vitest';
import {
  collectionPublicationDateIssue,
  parseCollectionPublicationWindow,
} from '../src/collection-publication-window.mjs';

const sourceUrl = 'https://example.com/article';
const window = {
  runId: 'e5d586c2-d573-cc8c-0913-db0e7869fab1',
  windowStart: '2026-10-24T00:00:37.200Z',
  windowEnd: '2026-10-26T00:00:37.200Z',
  sourceUrl,
  discoveredPublishedAt: '2026-10-24',
};

describe('collection publication window', () => {
  it('accepts the stable automation ID and returns a detached exact contract', () => {
    const parsed = parseCollectionPublicationWindow(window);
    expect(parsed).toEqual(window);
    expect(parsed).not.toBe(window);
  });
  it.each([
    null,
    [],
    { ...window, extra: true },
    { ...window, runId: 'bad-id' },
    { ...window, windowStart: '2026-10-24' },
    { ...window, windowStart: '2026-02-30T00:00:37.200Z' },
    { ...window, windowStart: '2026-10-24T00:00:37.200+00:00' },
    { ...window, windowStart: window.windowEnd },
    { ...window, windowStart: '2026-10-27T00:00:37.200Z' },
    { ...window, windowStart: '2026-09-25T00:00:37.200Z' },
    { ...window, windowStart: '2026-10-24T00:00:38.200Z' },
    { ...window, windowEnd: '0000-10-26T00:00:37.200Z' },
    { ...window, sourceUrl: 'http://example.com/article' },
    { ...window, sourceUrl: 'https://private@example.com/article' },
    { ...window, sourceUrl: `${sourceUrl}#section` },
    { ...window, sourceUrl: `${sourceUrl}#` },
    { ...window, sourceUrl: ` ${sourceUrl}` },
    { ...window, discoveredPublishedAt: '2026-10-23' },
    { ...window, discoveredPublishedAt: '2026-10-27' },
    { ...window, discoveredPublishedAt: '2026-02-30' },
    { ...window, discoveredPublishedAt: '2026-10-24T00:00:00.000Z' },
    { ...window, discoveredPublishedAt: null },
  ])('rejects malformed or untrusted collection metadata %#', (value) => {
    expect(parseCollectionPublicationWindow(value)).toBeNull();
    expect(collectionPublicationDateIssue(value, '2026-10-24', [sourceUrl])).toBe(
      'invalid_collection_window',
    );
  });
  it.each([
    '2025-10-20',
    '2026-10-16',
    '2026-10-22',
    '2026-10-23',
    '2026-10-27',
    null,
    '',
    '2026-02-30',
  ])('blocks original date %s even when discovery claimed a recent publication', (date) => {
    expect(collectionPublicationDateIssue(window, date, [sourceUrl])).toBe(
      'source_date_out_of_window',
    );
  });
  it.each(['2026-10-24', '2026-10-25', '2026-10-26'])(
    'accepts the inclusive UTC calendar date %s without requiring AI date agreement',
    (date) => {
      expect(collectionPublicationDateIssue(window, date, [sourceUrl])).toBeNull();
    },
  );
  it('requires the selected original to be in publication sources', () => {
    for (const urls of [[], null, [sourceUrl.replace('article', 'other')]])
      expect(collectionPublicationDateIssue(window, '2026-10-24', urls)).toBe(
        'collection_source_mismatch',
      );
  });
});
