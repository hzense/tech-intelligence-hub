import test from 'node:test';
import assert from 'node:assert/strict';
import {
  canTrySourceFallback,
  readAutomationSourceFallbacks,
  sourceFallbackUrls,
} from '../lib/automation-source-fallbacks.ts';

const id = (n) => `11111111-1111-4111-8111-${String(n).padStart(12, '0')}`;
const primaryUrl = 'https://example.com/original';
const alternative = (url = 'https://partner.example/news') => ({
  url,
  title: '同一事件的合作方公告',
  publishedAt: '2026-10-23',
});
const discovery = (alternatives) => ({
  windowStart: '2026-10-21T00:00:00Z',
  windowEnd: '2026-10-23T12:00:00Z',
  articles: [{ url: primaryUrl, alternatives }],
});

test('fallback reads only bounded safe alternatives from the saved discovery event', () => {
  assert.deepEqual(sourceFallbackUrls(discovery([alternative()]), primaryUrl), [alternative().url]);
  assert.deepEqual(sourceFallbackUrls({ articles: [] }, primaryUrl), []);
  assert.deepEqual(sourceFallbackUrls(discovery([alternative()]), 'https://other.example/'), []);
  assert.deepEqual(sourceFallbackUrls(discovery([alternative(), alternative()]), primaryUrl), [
    alternative().url,
  ]);
  assert.deepEqual(
    sourceFallbackUrls(
      discovery([
        alternative('https://a.example/'),
        alternative('https://b.example/'),
        alternative('https://c.example/'),
      ]),
      primaryUrl,
    ),
    ['https://a.example/', 'https://b.example/'],
  );
  for (const row of [
    alternative(primaryUrl),
    alternative('http://example.com/'),
    alternative('https://127.0.0.1/private'),
    alternative('https://user:secret@example.com/'),
    { ...alternative(), publishedAt: '2026-10-24' },
    { ...alternative(), publishedAt: '2026-10-01' },
    { ...alternative(), publishedAt: '2026-02-30' },
    { ...alternative(), title: '' },
    { ...alternative(), title: '\u0000secret' },
  ])
    assert.deepEqual(sourceFallbackUrls(discovery([row]), primaryUrl), []);
  const crossed = discovery([alternative()]);
  crossed.articles.push({ url: alternative().url });
  assert.deepEqual(sourceFallbackUrls(crossed, primaryUrl), []);
});

test('only confirmed access failures admit a different source, not parser, policy or cancellation errors', () => {
  const receipt = { phase: 'import_source', code: 'fetch_failed' };
  for (const status of [401, 403, 404, 410, 429, 500, 502, 503, 504]) {
    assert.equal(
      canTrySourceFallback({ ...receipt, fetchDiagnostic: { reason: 'http_status', status } }),
      true,
    );
  }
  for (const reason of ['network', 'timeout']) {
    assert.equal(canTrySourceFallback({ ...receipt, fetchDiagnostic: { reason } }), true);
  }
  for (const row of [
    null,
    {},
    receipt,
    { ...receipt, fetchDiagnostic: { reason: 'dns' } },
    { ...receipt, fetchDiagnostic: { reason: 'http_status', status: 200 } },
    { ...receipt, fetchDiagnostic: { reason: 'http_status', status: '403' } },
    ...['parse_failed', 'cancelled', 'source_unavailable', 'import_failed'].map((code) => ({
      ...receipt,
      code,
    })),
    { ...receipt, phase: 'create_candidate' },
  ])
    assert.equal(canTrySourceFallback(row), false);
});

test('attempt receipts whitelist provenance and never treat a batch as successful', () => {
  const row = {
    primaryItemId: id(1),
    batchId: id(2),
    originalUrl: primaryUrl,
    url: alternative().url,
  };
  assert.deepEqual(readAutomationSourceFallbacks([{ ...row, secret: 'private', success: true }]), [
    row,
  ]);
  assert.deepEqual(readAutomationSourceFallbacks([{ ...row, itemId: id(3) }]), [
    { ...row, itemId: id(3) },
  ]);
  assert.deepEqual(readAutomationSourceFallbacks([row, row]), [row]);
  for (const bad of [
    { ...row, primaryItemId: 'not-uuid' },
    { ...row, batchId: 'not-uuid' },
    { ...row, itemId: 'not-uuid' },
    { ...row, url: primaryUrl },
    { ...row, url: 'javascript:alert(1)' },
    { ...row, originalUrl: 'https://127.0.0.1/' },
  ])
    assert.deepEqual(readAutomationSourceFallbacks([bad]), []);
  assert.equal(
    readAutomationSourceFallbacks([row, { ...row, batchId: id(4) }, { ...row, batchId: id(5) }])
      .length,
    2,
  );
});
