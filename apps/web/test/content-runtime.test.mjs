import assert from 'node:assert/strict';
import test from 'node:test';

import {
  getDailyEntriesForTopic,
  getInsightEntries,
  getInsightEntryById,
  getInsightsForTopic,
  getTopicEntries,
  getTopicEntryById,
} from '../lib/content-runtime.ts';

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

test('only exposes active Topics in attention order', async () => {
  const topics = await getTopicEntries();

  assert.ok(topics.length > 0);
  assert.ok(topics.every((entry) => entry.frontMatter.status !== 'archived'));
  assert.deepEqual(
    topics.map((entry) => entry.frontMatter.attention ?? 0),
    [...topics]
      .map((entry) => entry.frontMatter.attention ?? 0)
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

  const dailyEntries = await getDailyEntriesForTopic(firstTopic.frontMatter.id);
  assert.ok(
    dailyEntries.every((entry) =>
      entry.frontMatter.rising_topics.includes(firstTopic.frontMatter.id),
    ),
  );
});
