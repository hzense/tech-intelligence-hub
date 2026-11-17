import assert from 'node:assert/strict';
import test from 'node:test';
import { filterPublicPageview, isPublicAnalyticsPath } from '../lib/public-web-analytics.ts';

test('tracks public pages including client-side detail and edition navigation', () => {
  for (const path of [
    '/',
    '/radar',
    '/signals',
    '/signals/example',
    '/insights/report',
    '/resources/company',
    '/persons/person',
    '/topics/ai/editions/2026-11',
    '/search/',
  ]) {
    const event = { type: 'pageview', url: `https://hzense.com${path}` };
    assert.equal(isPublicAnalyticsPath(path), true);
    assert.deepEqual(filterPublicPageview(event), event);
  }
});

test('removes search terms, query parameters and fragments without changing the input event', () => {
  const event = {
    type: 'pageview',
    url: 'https://hzense.com/search?q=private&utm_source=test#details',
  };
  assert.deepEqual(filterPublicPageview(event), {
    type: 'pageview',
    url: 'https://hzense.com/search',
  });
  assert.equal(event.url, 'https://hzense.com/search?q=private&utm_source=test#details');
});

test('rejects admin, authentication, API and unknown pages even after visiting a public page', () => {
  assert.ok(filterPublicPageview({ type: 'pageview', url: 'https://hzense.com/' }));
  for (const path of [
    '/admin',
    '/admin/login',
    '/admin/signal-generation/private-id',
    '/api/auth/callback/google',
    '/api/signals',
    '/unknown',
    '/signals/a/private',
  ]) {
    assert.equal(isPublicAnalyticsPath(path), false);
    assert.equal(
      filterPublicPageview({ type: 'pageview', url: `https://hzense.com${path}` }),
      null,
    );
  }
  assert.equal(isPublicAnalyticsPath(null), false);
});

test('rejects local, preview and foreign origins, malformed URLs and custom events', () => {
  for (const url of [
    'http://localhost:3000/',
    'http://127.0.0.1:3000/',
    'https://example.vercel.app/',
    'https://example.com/',
    'http://hzense.com/',
    'https://hzense.com:8443/',
    '/signals',
    'invalid',
  ]) {
    assert.equal(filterPublicPageview({ type: 'pageview', url }), null);
  }
  assert.deepEqual(
    filterPublicPageview({ type: 'pageview', url: 'https://www.hzense.com/signals?x=1' }),
    { type: 'pageview', url: 'https://www.hzense.com/signals' },
  );
  assert.equal(filterPublicPageview({ type: 'event', url: 'https://hzense.com/' }), null);
});
