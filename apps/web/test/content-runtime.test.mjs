import assert from 'node:assert/strict';
import test from 'node:test';

import { getInsightEntries } from '../lib/content-runtime.ts';

test('only exposes published Insights to public pages', async () => {
  const insights = await getInsightEntries();

  assert.ok(insights.length > 0);
  assert.ok(insights.every((entry) => entry.frontMatter.status === 'published'));
});
