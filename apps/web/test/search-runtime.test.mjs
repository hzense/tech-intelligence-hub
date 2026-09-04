import assert from 'node:assert/strict';
import test from 'node:test';

import { rankSearchDocuments } from '@hzense/search/ranking';
import {
  getDailyEntries,
  getInsightEntries,
  getTopicEntries,
  getTopicTitleMap,
  getWeeklyEntries,
} from '../lib/content-runtime.ts';
import { formatEntityType } from '../lib/resource-presentation.ts';
import { getSearchDocumentProjections } from '../lib/search-runtime.ts';
import {
  getResourceEntries,
  getSeedEntityMap,
  getSeedSourceMap,
  getSignalEntries,
} from '../lib/seed-runtime.ts';
import { formatSignalType } from '../lib/signal-presentation.ts';

const documents = [
  {
    id: 'title-match',
    type: 'insight',
    title: 'AI 安全边界',
    summary: '智能体权限控制',
    href: '/insights/title-match',
    keywords: '安全',
    body: '',
  },
  {
    id: 'body-match',
    type: 'daily',
    title: '每日简报',
    summary: '技术变化',
    href: '/daily/2024-01-01',
    keywords: '',
    body: 'AI 安全边界正在扩大',
  },
];

function canonicalText(value) {
  return value.replace(/\r\n?/g, '\n').trim();
}

function canonicalKeywords(parts) {
  return canonicalText(parts.join(' ')).replace(/\s+/g, ' ');
}

function canonicalIds(values) {
  return [...new Set(values.map(canonicalText))].sort();
}

function expectedTopicKeywords(ids, topicTitleMap) {
  return ids.map((id) => `${id} ${topicTitleMap.get(id) ?? ''}`).join(' ');
}

test('ranks title matches above body-only matches', () => {
  const results = rankSearchDocuments(documents, 'AI 安全');

  assert.deepEqual(
    results.map((result) => result.id),
    ['title-match', 'body-match'],
  );
  assert.ok(results[0].score > results[1].score);
});

test('requires every normalized query term and respects type filters', () => {
  assert.equal(rankSearchDocuments(documents, 'AI 不存在').length, 0);
  assert.deepEqual(
    rankSearchDocuments(documents, 'ＡＩ 安全', 'daily').map((result) => result.id),
    ['body-match'],
  );
});

test('assembles all six public projection types from the real content and seed catalogs', async () => {
  const [
    projections,
    dailyEntries,
    weeklyEntries,
    insightEntries,
    topicEntries,
    signalEntries,
    resourceEntries,
    topicTitleMap,
    entityMap,
    sourceMap,
  ] = await Promise.all([
    getSearchDocumentProjections(),
    getDailyEntries(),
    getWeeklyEntries(),
    getInsightEntries(),
    getTopicEntries(),
    getSignalEntries(),
    getResourceEntries(),
    getTopicTitleMap(),
    getSeedEntityMap(),
    getSeedSourceMap(),
  ]);
  const projectionsByType = new Map();

  for (const projection of projections) {
    const existing = projectionsByType.get(projection.sourceType) ?? [];
    existing.push(projection);
    projectionsByType.set(projection.sourceType, existing);
  }

  const expectedSourceIdsByType = new Map([
    ['daily', dailyEntries.map((entry) => entry.frontMatter.id)],
    ['weekly', weeklyEntries.map((entry) => entry.frontMatter.id)],
    ['insight', insightEntries.map((entry) => entry.frontMatter.id)],
    ['topic', topicEntries.map((entry) => entry.frontMatter.id)],
    ['signal', signalEntries.map((signal) => signal.id)],
    ['resource', resourceEntries.map((resource) => resource.id)],
  ]);

  assert.deepEqual([...projectionsByType.keys()].sort(), [
    'daily',
    'insight',
    'resource',
    'signal',
    'topic',
    'weekly',
  ]);

  const expectedHrefPrefix = {
    daily: '/daily/',
    weekly: '/weekly/',
    insight: '/insights/',
    topic: '/topics/',
    signal: '/signals/',
    resource: '/resources/',
  };

  for (const [sourceType, prefix] of Object.entries(expectedHrefPrefix)) {
    const typedProjections = projectionsByType.get(sourceType);
    assert.ok(typedProjections?.length > 0, `expected a real ${sourceType} projection`);
    assert.deepEqual(
      typedProjections.map((projection) => projection.sourceId).sort(),
      expectedSourceIdsByType.get(sourceType).sort(),
    );
    assert.ok(typedProjections.every((projection) => projection.href.startsWith(prefix)));
    assert.ok(
      typedProjections.every(
        (projection) => projection.id === `searchdoc-${sourceType}-${projection.sourceId}`,
      ),
    );
  }

  assert.ok(dailyEntries.every((entry) => entry.frontMatter.status === 'published'));
  assert.ok(weeklyEntries.every((entry) => entry.frontMatter.status === 'published'));
  assert.ok(insightEntries.every((entry) => entry.frontMatter.status === 'published'));
  assert.ok(
    topicEntries.every((entry) =>
      ['watching', 'active', 'strategic'].includes(entry.frontMatter.status),
    ),
  );
  assert.ok(
    signalEntries.every((signal) => signal.status === 'reviewed' || signal.status === 'accepted'),
  );
  assert.ok(resourceEntries.every((resource) => resource.status === 'active'));

  function projectionFor(sourceType, sourceId) {
    const projection = projectionsByType
      .get(sourceType)
      .find((candidate) => candidate.sourceId === sourceId);
    assert.ok(projection, `expected ${sourceType} projection for ${sourceId}`);
    return projection;
  }

  function assertProjectionFields(projection, expected) {
    assert.deepEqual(
      {
        title: projection.title,
        summary: projection.summary,
        keywords: projection.keywords,
        body: projection.body,
        importance: projection.importance,
        topics: projection.topics,
        entities: projection.entities,
      },
      expected,
    );
  }

  for (const entry of dailyEntries) {
    const { frontMatter } = entry;
    assertProjectionFields(projectionFor('daily', frontMatter.id), {
      title: canonicalText(frontMatter.title),
      summary: canonicalText(entry.summary),
      keywords: canonicalKeywords([
        ...(frontMatter.tags ?? []),
        expectedTopicKeywords(frontMatter.rising_topics, topicTitleMap),
        entry.sections.map((section) => section.heading).join(' '),
      ]),
      body: canonicalText(entry.body),
      importance: frontMatter.importance ?? 1,
      topics: canonicalIds(frontMatter.rising_topics),
      entities: [],
    });
  }

  for (const entry of weeklyEntries) {
    const { frontMatter } = entry;
    assertProjectionFields(projectionFor('weekly', frontMatter.id), {
      title: canonicalText(frontMatter.title),
      summary: canonicalText(entry.summary),
      keywords: canonicalKeywords([
        ...(frontMatter.tags ?? []),
        expectedTopicKeywords(frontMatter.featured_topics, topicTitleMap),
        entry.sections.map((section) => section.heading).join(' '),
      ]),
      body: canonicalText(entry.body),
      importance: frontMatter.importance ?? 1,
      topics: canonicalIds(frontMatter.featured_topics),
      entities: [],
    });
  }

  for (const entry of insightEntries) {
    const { frontMatter } = entry;
    const entities = [...(frontMatter.companies ?? []), ...(frontMatter.technologies ?? [])];
    assertProjectionFields(projectionFor('insight', frontMatter.id), {
      title: canonicalText(frontMatter.title),
      summary: canonicalText(entry.summary),
      keywords: canonicalKeywords([
        ...(frontMatter.tags ?? []),
        expectedTopicKeywords(frontMatter.topics, topicTitleMap),
        entry.sections.map((section) => section.heading).join(' '),
      ]),
      body: canonicalText(entry.body),
      importance: frontMatter.importance,
      topics: canonicalIds(frontMatter.topics),
      entities: canonicalIds(entities),
    });
  }

  for (const entry of topicEntries) {
    const { frontMatter } = entry;
    assertProjectionFields(projectionFor('topic', frontMatter.id), {
      title: canonicalText(frontMatter.title),
      summary: canonicalText(entry.summary),
      keywords: canonicalKeywords([
        ...(frontMatter.tags ?? []),
        expectedTopicKeywords([frontMatter.id], topicTitleMap),
        entry.sections.map((section) => section.heading).join(' '),
      ]),
      body: canonicalText(entry.body),
      importance: 1,
      topics: [frontMatter.id],
      entities: [],
    });
  }

  for (const signal of signalEntries) {
    assertProjectionFields(projectionFor('signal', signal.id), {
      title: canonicalText(signal.title),
      summary: canonicalText(signal.summary),
      keywords: canonicalKeywords([
        formatSignalType(signal.type),
        sourceMap.get(signal.source_id)?.name ?? signal.source_id,
        expectedTopicKeywords(signal.topics, topicTitleMap),
        signal.entities.map((id) => `${id} ${entityMap.get(id)?.name ?? ''}`).join(' '),
      ]),
      body: '',
      importance: signal.importance,
      topics: canonicalIds(signal.topics),
      entities: canonicalIds(signal.entities),
    });
  }

  for (const resource of resourceEntries) {
    const typeLabel = formatEntityType(resource.type);
    assertProjectionFields(projectionFor('resource', resource.id), {
      title: canonicalText(resource.name),
      summary: `${typeLabel} · HZense 活跃资源`,
      keywords: `${resource.id} ${resource.type} ${typeLabel}`,
      body: '',
      importance: 1,
      topics: [],
      entities: [resource.id],
    });
  }

  for (const sourceType of ['daily', 'weekly', 'insight', 'signal']) {
    assert.ok(
      projectionsByType
        .get(sourceType)
        .every((projection) => /^\d{4}-\d{2}-\d{2}$/.test(projection.documentDate)),
    );
  }
  assert.ok(projectionsByType.get('topic').every((projection) => projection.documentDate === null));
  assert.ok(
    projectionsByType.get('resource').every((projection) => projection.documentDate === null),
  );
});
