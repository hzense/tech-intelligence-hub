import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import test from 'node:test';

import nextConfig from '../next.config.ts';

test('traces repository content required by deployed routes', () => {
  assert.equal(nextConfig.outputFileTracingRoot, resolve(import.meta.dirname, '../../..'));

  const includes = nextConfig.outputFileTracingIncludes;
  assert.ok(includes);
  for (const route of [
    '/',
    '/daily',
    '/daily/[date]',
    '/insights',
    '/insights/[id]',
    '/topics',
    '/topics/[id]',
    '/sitemap.xml',
  ]) {
    assert.deepEqual(includes[route], ['../../content/**/*', '../../data/seed/*.yaml']);
  }
});
