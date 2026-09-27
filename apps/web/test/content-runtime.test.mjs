import assert from 'node:assert/strict';
import test from 'node:test';

import {
  getInsightEntries,
  getInsightEntryById,
  getInsightsForTopic,
  getTopicEntries,
  getTopicEntryById,
} from '../lib/content-runtime.ts';

test('does not expose retired Insights that rely on removed Signals', async () => {
  const insights = await getInsightEntries();

  assert.deepEqual(insights, []);
});

test('does not resolve a retired Insight by its former content id', async () => {
  assert.equal(await getInsightEntryById('insight-foundation-model-platform-shift'), undefined);
});

test('only exposes active Topics in attention order', async () => {
  const topics = await getTopicEntries();

  assert.ok(topics.length > 0);
  assert.ok(topics.every((entry) => entry.frontMatter.status !== 'archived'));
  assert.deepEqual(
    topics.map((entry) => entry.assessment?.attention ?? -1),
    [...topics]
      .map((entry) => entry.assessment?.attention ?? -1)
      .sort((left, right) => right - left),
  );
});

test('resolves Topic detail and its published intelligence relationships', async () => {
  const topics = await getTopicEntries();
  const firstTopic = topics[0];
  assert.ok(firstTopic);

  const resolved = await getTopicEntryById(firstTopic.frontMatter.id);
  assert.equal(resolved?.frontMatter.id, firstTopic.frontMatter.id);

  const insights = await getInsightsForTopic(firstTopic.frontMatter.id);
  assert.ok(
    insights.every((entry) => entry.frontMatter.topics.includes(firstTopic.frontMatter.id)),
  );
});
