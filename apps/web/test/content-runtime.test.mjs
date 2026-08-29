import assert from 'node:assert/strict';
import test from 'node:test';

import {
  formatDailyEdition,
  getDailyEntries,
  getDailyEntriesForTopic,
  getInsightEntries,
  getInsightEntryById,
  getInsightsForTopic,
  getTopicEntries,
  getTopicEntryById,
  getWeeklyEntries,
  getWeeklyEntryByWeek,
} from '../lib/content-runtime.ts';

test('only exposes published Daily entries and labels their edition explicitly', async () => {
  const entries = await getDailyEntries();

  assert.ok(entries.length > 0);
  assert.ok(entries.every((entry) => entry.frontMatter.status === 'published'));
  assert.equal(formatDailyEdition('historical_example'), '历史回顾样例');
  assert.equal(formatDailyEdition('live'), '正式简报');
});

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

test('only exposes published Weekly entries and resolves their stable week route', async () => {
  const entries = await getWeeklyEntries();
  const firstEntry = entries[0];

  assert.ok(firstEntry);
  assert.ok(entries.every((entry) => entry.frontMatter.status === 'published'));
  assert.equal(
    (await getWeeklyEntryByWeek(firstEntry.frontMatter.week))?.frontMatter.id,
    firstEntry.frontMatter.id,
  );
});
