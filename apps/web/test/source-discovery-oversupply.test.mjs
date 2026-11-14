import assert from 'node:assert/strict';
import test from 'node:test';
import { parseDiscoveryResponse } from '../lib/source-discovery-core.ts';
import {
  discoveryDiagnosticItems,
  discoveryValidationItems,
} from '../lib/source-discovery-diagnostics.ts';

const config = { discovery: { maxSources: 3 } };
const window = { windowStart: '2026-11-11T01:00:00Z', windowEnd: '2026-11-13T01:00:00Z' };
const article = (index, publishedAt = '2026-11-12') => ({
  url: `https://example.com/news-${index}`,
  title: `Article ${index}`,
  publishedAt,
});
const envelope = (articles, cited = articles) => ({
  choices: [
    {
      finish_reason: 'stop',
      message: {
        content: JSON.stringify({ articles }),
        annotations: cited.map(({ url }) => ({ type: 'url_citation', url_citation: { url } })),
      },
    },
  ],
});

test('oversupply validates every candidate before selection and never fills from rejected sources', () => {
  const rows = [
    article(0, '2026-11-01'),
    article(1),
    article(1),
    article(2),
    { ...article(3), url: 'http://127.0.0.1/private' },
    ...Array.from({ length: 8 }, (_, index) => article(index + 4)),
  ];
  const result = parseDiscoveryResponse(
    envelope(
      rows,
      rows.filter((row) => row.url !== article(2).url),
    ),
    config,
    window,
    [article(4).url],
  );
  assert.deepEqual(result.articles, [article(1), article(5), article(6)]);
  assert.equal(result.rejected, 3);
  assert.equal(result.duplicates, 2);
  assert.equal(result.validation.selectedCount, 3);
  assert.equal(result.validation.deferredCount, 5);
  assert.equal(result.validation.returnedCount, 13);
  assert.ok(
    discoveryValidationItems(result.validation).summary.some((line) =>
      line.includes('选入 3 条，另 5 条未选入'),
    ),
  );
});

test('oversupply still requires trustworthy provider search evidence', () => {
  const body = envelope(
    Array.from({ length: 24 }, (_, i) => article(i)),
    [],
  );
  assert.throws(
    () => parseDiscoveryResponse(body, config, window, []),
    /discovery_search_unconfirmed/,
  );
});

test('selection caps at eight even if an unvalidated caller supplies a larger configured count', () => {
  const rows = Array.from({ length: 24 }, (_, i) => article(i));
  const result = parseDiscoveryResponse(
    envelope(rows),
    { discovery: { maxSources: 24 } },
    window,
    [],
  );
  assert.equal(result.articles.length, 8);
  assert.equal(result.validation.deferredCount, 16);
  for (const maxSources of [-1, 0, NaN, undefined, 1.5]) {
    assert.throws(
      () => parseDiscoveryResponse(envelope(rows), { discovery: { maxSources } }, window, []),
      /invalid_discovery_configuration/,
    );
  }
});

test('bounded receipt preserves all rejection indices and historical limit meanings', () => {
  const rows = Array.from({ length: 24 }, (_, i) => article(i, '2026-11-01'));
  const result = parseDiscoveryResponse(envelope(rows), config, window, []);
  const presentation = discoveryValidationItems(result.validation);
  assert.equal(result.articles.length, 0);
  assert.equal(presentation.rejections.length, 24);
  assert.match(presentation.rejections[23], /^第 24 条/);
  assert.ok(
    discoveryDiagnosticItems({ version: 1, outputIssue: 'too_many_articles' }).some((line) =>
      line.includes('8 条上限'),
    ),
  );
  assert.ok(
    discoveryDiagnosticItems({ version: 1, outputIssue: 'too_many_candidates' }).some((line) =>
      line.includes('24 条处理上限'),
    ),
  );
});
