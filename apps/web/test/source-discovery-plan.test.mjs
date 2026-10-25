import test from 'node:test';
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { URL } from 'node:url';
import {
  createDiscoverySearchPlan,
  publicDiscoveryExclusions,
} from '../lib/source-discovery-plan.ts';

const topics = [
  { id: 'ai', name: '人工智能' },
  { id: 'chips', name: '半导体' },
  { id: 'energy', name: '能源' },
  { id: 'bio', name: '生物技术' },
  { id: 'space', name: '航空航天' },
  { id: 'materials', name: '先进材料' },
  { id: 'robotics', name: '机器人' },
  { id: 'quantum', name: '量子技术' },
  { id: 'network', name: '通信网络' },
  { id: 'security', name: '安全技术' },
];
const coveredIds = (plan) => plan.flatMap((group) => group.topics.map((topic) => topic.id));

test('each search plan covers all requested topics once within the three-search budget', () => {
  for (const selected of [topics.slice(0, 1), topics.slice(0, 2), topics.slice(0, 3), topics]) {
    const original = selected.map((topic) => ({ ...topic }));
    const plan = createDiscoverySearchPlan(selected, '2026-10-25T00:00:00Z', 'test/model');
    assert.ok(plan.length >= 1 && plan.length <= 3);
    assert.ok(plan.every((group) => group.topics.length > 0));
    const sizes = plan.map((group) => group.topics.length);
    assert.ok(Math.max(...sizes) - Math.min(...sizes) <= 1);
    assert.deepEqual(coveredIds(plan).sort(), selected.map((topic) => topic.id).sort());
    assert.deepEqual(
      plan.flatMap((group) => group.topics).sort((a, b) => a.id.localeCompare(b.id)),
      [...selected].sort((a, b) => a.id.localeCompare(b.id)),
    );
    assert.deepEqual(selected, original, 'building a plan must not reorder the taxonomy input');
  }
});

test('daily search priority is deterministic across invocations and rotates across days and models', () => {
  const start = createDiscoverySearchPlan(topics, '2026-10-25T00:01:00Z', 'test/model');
  assert.deepEqual(
    createDiscoverySearchPlan(topics, new Date('2026-10-25T23:59:59Z'), 'test/model'),
    start,
    'reruns on the same UTC day retain the same coverage plan',
  );
  const dailyPriorities = new Set();
  for (let day = 0; day < 7; day++) {
    const now = new Date(Date.UTC(2026, 9, 25 + day));
    const plan = createDiscoverySearchPlan(topics, now, 'test/model');
    assert.deepEqual(coveredIds(plan).sort(), topics.map((topic) => topic.id).sort());
    dailyPriorities.add(JSON.stringify(plan[0]));
  }
  assert.ok(dailyPriorities.size > 1, 'a fixed catalog prefix must not receive every first search');
  const modelPriorities = new Set(
    ['test/model-a', 'test/model-b', 'test/model-c', 'test/model-d'].map((model) =>
      JSON.stringify(createDiscoverySearchPlan(topics, '2026-10-25T12:00:00Z', model)[0]),
    ),
  );
  assert.ok(
    modelPriorities.size > 1,
    'different models must not always search the same first group',
  );
});

test('public exclusions reject unsafe URLs and omit queries and fragments instead of laundering them', () => {
  const safe = 'https://example.com/news/public-release';
  const rejected = [
    '',
    'not a URL',
    'http://example.com/news',
    'file:///private/document',
    'https://user:secret@example.com/news',
    'https://example.com/news?utm_source=private',
    'https://example.com/news?token=private',
    'https://example.com/news#private',
    'https://localhost/news',
    'https://intranet/news',
    'https://internal.example.local/news',
    'https://127.0.0.1/news',
    'https://10.0.0.1/news',
    'https://169.254.169.254/latest/meta-data',
    'https://[::1]/news',
    'https://[fc00::1]/news',
    'https://example.com:8443/news',
  ];
  assert.deepEqual(publicDiscoveryExclusions([...rejected, safe]), [safe]);
});

test('canonical URL duplicates do not consume the public exclusion count budget', () => {
  const safe = 'https://example.com/news/public-release';
  const more = Array.from({ length: 50 }, (_, index) => `https://example.com/news/${index}`);
  const result = publicDiscoveryExclusions([
    ...Array(50).fill(safe),
    'https://EXAMPLE.com:443/news/public-release',
    ...more,
  ]);
  assert.equal(result.length, 40);
  assert.equal(new Set(result).size, 40);
  assert.equal(result.filter((url) => url === safe).length, 1);
  assert.ok(result.every((url) => url === safe || more.includes(url)));
});

test('public exclusion URLs stay within their 4096-byte budget even below the count limit', () => {
  const urls = Array.from(
    { length: 20 },
    (_, index) => `https://example.com/news/${index}/${'新技术'.repeat(40)}`,
  );
  const result = publicDiscoveryExclusions(urls);
  assert.ok(result.length > 0);
  assert.ok(result.length < urls.length, 'long URLs must be bounded before forty entries');
  assert.ok(Buffer.byteLength(JSON.stringify(result), 'utf8') <= 4096);
  const canonical = new Set(urls.map((url) => new URL(url).href));
  assert.ok(
    result.every((url) => canonical.has(url)),
    'the byte bound must not truncate URLs',
  );
});
