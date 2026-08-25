import assert from 'node:assert/strict';
import test from 'node:test';

import { getInsightEntries, getInsightEntryById } from '../lib/content-runtime.ts';

test('only exposes published Insights to public pages', async () => {
  const insights = await getInsightEntries();

  assert.ok(insights.length > 0);
  assert.ok(insights.every((entry) => entry.frontMatter.status === 'published'));
});

test('finds a published Insight by its stable content id', async () => {
  const insights = await getInsightEntries();
  const firstInsight = insights[0];
  assert.ok(firstInsight);

  const resolved = await getInsightEntryById(firstInsight.frontMatter.id);
  assert.equal(resolved?.frontMatter.id, firstInsight.frontMatter.id);
});
