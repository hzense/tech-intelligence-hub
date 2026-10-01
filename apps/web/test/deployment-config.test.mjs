import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import test from 'node:test';

import { nextConfig } from '../next.config.ts';

test('traces repository content required by deployed routes', () => {
  assert.equal(nextConfig.outputFileTracingRoot, resolve(import.meta.dirname, '../../..'));

  const includes = nextConfig.outputFileTracingIncludes;
  assert.ok(includes);
  for (const route of [
    '/',
    '/insights',
    '/insights/[id]',
    '/radar',
    '/resources',
    '/resources/[id]',
    '/search',
    '/signals',
    '/signals/[id]',
    '/topics',
    '/topics/[id]',
    '/sitemap.xml',
    '/admin/sources',
  ]) {
    assert.deepEqual(includes[route], [
      '../../content/**/*',
      '../../data/seed/*.yaml',
      '../../data/taxonomy/taxonomy.yaml',
    ]);
  }
  for (const route of ['/.well-known/workflow/v1/step', '/api/admin/automation']) {
    assert.ok(includes[route].includes('../../data/seed/*.yaml'));
    assert.ok(includes[route].includes('../../data/taxonomy/taxonomy.yaml'));
    assert.ok(includes[route].includes('../../content/**/*'));
  }
});
