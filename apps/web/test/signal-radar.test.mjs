import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath, URL } from 'node:url';
import { build } from 'esbuild';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { buildSignalRadar, radarRankingVersion } from '../lib/signal-radar-model.ts';
import { primaryNavigation } from '../lib/site-navigation.ts';

const now = new Date('2026-09-26T12:00:00.000Z');
const topics = [
  { id: 'topic-ai', name: '人工智能', parentId: null },
  { id: 'topic-models', name: '模型', parentId: 'topic-ai' },
  { id: 'topic-agents', name: '智能体', parentId: 'topic-ai' },
  { id: 'topic-tool-use', name: '工具使用', parentId: 'topic-agents' },
  { id: 'topic-agent-memory', name: '智能体记忆', parentId: 'topic-agents' },
  { id: 'topic-security', name: '安全', parentId: null },
];
const signal = (id, occurred_at = '2026-09-25T12:00:00.000Z', overrides = {}) => ({
  id,
  title: `Signal ${id}`,
  summary: `Summary ${id}`,
  occurred_at,
  captured_at: now.toISOString(),
  publication_basis: 'manual_confirmation',
  type: 'editorial',
  status: 'accepted',
  topics: ['topic-models'],
  entities: [],
  source_id: '',
  source_url: '',
  publication_revision: 1,
  public_people: [{ id: 'person-0', name: 'Ada', event_role: '' }],
  public_organizations: [{ id: 'organization-0', name: 'Lab', event_role: '' }],
  public_sources: [],
  ...overrides,
});
const legacy = (id, occurred_at = '2026-03-03T00:00:00.000Z', overrides = {}) => {
  const entry = signal(id, occurred_at, {
    type: 'product',
    importance: 4,
    confidence: 0.8,
    novelty: 0.6,
    ...overrides,
  });
  delete entry.publication_basis;
  delete entry.publication_revision;
  return entry;
};
const compute = (entries, options = {}) => buildSignalRadar(entries, topics, { now, ...options });

test('one radar includes Seed and published entries without promoting Seed review status', () => {
  const sourced = signal('sourced', '2026-08-01T00:00:00.000Z', {
    publication_basis: undefined,
    public_version: 1,
    type: 'product',
    importance: 5,
    confidence: 0.9,
    novelty: 0.7,
  });
  const result = compute([legacy('seed'), sourced, signal('manual')]);
  assert.equal(result.totalCount, 3);
  assert.equal(result.recentCount, 1);
  assert.deepEqual(
    result.latestSignals.map((item) => item.signal.id),
    ['manual', 'sourced', 'seed'],
  );
  assert.equal(result.latestSignals[0].importance, null);
  assert.equal(result.latestSignals[1].importance, 5);
  assert.equal(result.latestSignals[2].importance, 4);
  assert.equal(result.domains[0].totalCount, 3);
  assert.equal('legacy' in result.exclusions, false);
});

test('event dates define recent and prior windows while older events remain in the radar', () => {
  const result = compute([
    legacy('old', '2026-01-01T00:00:00.000Z'),
    signal('start', '2026-08-27T12:00:00.000Z'),
    signal('before', '2026-08-27T11:59:59.999Z'),
    signal('end', now.toISOString()),
    signal('future', '2026-10-01T00:00:00.000Z'),
    signal('invalid', 'not-a-date'),
  ]);
  assert.equal(result.totalCount, 3);
  assert.equal(result.recentCount, 1);
  assert.equal(result.previousCount, 1);
  assert.deepEqual(
    result.latestSignals.map((item) => item.signal.id),
    ['start', 'before', 'old'],
  );
  assert.equal(result.earliestAt, '2026-01-01T00:00:00.000Z');
  assert.equal(result.latestAt, '2026-08-27T12:00:00.000Z');
  assert.deepEqual(result.exclusions, {
    invalidDates: 1,
    futureDates: 2,
    duplicateCount: 0,
  });
});

test('revisions and exact content are deduplicated, preferring public publication over archive', () => {
  const original = signal('a');
  const updated = signal('a', undefined, { publication_revision: 2, summary: 'Updated fact' });
  const duplicate = { ...updated, id: 'b' };
  const distinct = signal('c', undefined, { title: updated.title, summary: 'Different fact' });
  const result = compute([original, updated, duplicate, distinct]);
  assert.equal(result.totalCount, 2);
  assert.equal(result.exclusions.duplicateCount, 2);
  assert.equal(result.latestSignals[0].signal.summary, 'Updated fact');

  const archived = legacy('archive', '2026-09-25T12:00:00.000Z', {
    title: 'Same event',
    summary: 'Same text',
  });
  const published = signal('published', '2026-09-25T12:00:00.000Z', {
    title: 'Same event',
    summary: 'Same text',
  });
  assert.equal(compute([archived, published]).latestSignals[0].signal.id, 'published');
});

test('all-domain counts and six-month matrix include older events, without counting sibling topics twice', () => {
  const result = compute([
    legacy('april', '2026-04-01T00:00:00.000Z'),
    legacy('august', '2026-08-01T00:00:00.000Z'),
    signal('september', '2026-09-01T00:00:00.000Z', {
      topics: ['topic-models', 'topic-agents', 'topic-security'],
    }),
    signal('latest', '2026-09-26T00:00:00.000Z'),
  ]);
  const ai = result.domains.find((domain) => domain.id === 'topic-ai');
  const security = result.domains.find((domain) => domain.id === 'topic-security');
  assert.deepEqual(
    result.months.map((month) => month.key),
    ['2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09'],
  );
  assert.equal(ai.totalCount, 4);
  assert.equal(ai.recentCount, 2);
  assert.deepEqual(ai.monthlyCounts, [1, 0, 0, 0, 1, 2]);
  assert.equal(security.totalCount, 1);
  assert.equal(security.recentCount, 1);
  assert.equal(result.observedDomainCount, 2);
  assert.equal(result.focusDomains[0].id, 'topic-ai');
  assert.equal(result.rankingVersion, radarRankingVersion);
});

test('second-level bars resolve deeper topics and count each signal once per subtopic', () => {
  const result = compute([
    legacy('old-agents', '2026-04-01T00:00:00.000Z', {
      topics: ['topic-tool-use', 'topic-agent-memory'],
    }),
    signal('recent-agents', '2026-09-20T00:00:00.000Z', {
      topics: ['topic-tool-use', 'topic-agent-memory', 'topic-models'],
    }),
    legacy('root-only', '2026-06-01T00:00:00.000Z', { topics: ['topic-ai'] }),
  ]);
  const agents = result.subtopics.find((topic) => topic.id === 'topic-agents');
  const models = result.subtopics.find((topic) => topic.id === 'topic-models');
  assert.equal(result.domains.find((domain) => domain.id === 'topic-ai').totalCount, 3);
  assert.deepEqual([agents.domainName, agents.totalCount, agents.recentCount], ['人工智能', 2, 1]);
  assert.deepEqual([models.totalCount, models.recentCount], [1, 1]);
  assert.equal(result.subtopics[0].id, 'topic-agents');
});

test('a removed public entry disappears, small samples stay numeric, invalid cutoffs fail', () => {
  assert.equal(compute([signal('one')]).totalCount, 1);
  const cleared = compute([]);
  assert.equal(cleared.totalCount, 0);
  assert.deepEqual(cleared.latestSignals, []);
  assert.ok(cleared.domains.every((domain) => domain.totalCount === 0));
  assert.equal('growthRate' in compute([signal('one')]).domains[0], false);
  assert.throws(() => compute([], { now: new Date('invalid') }));
});

const compiled = await build({
  entryPoints: [fileURLToPath(new URL('../components/signal-radar.tsx', import.meta.url))],
  bundle: true,
  jsx: 'automatic',
  write: false,
  platform: 'node',
  format: 'cjs',
  packages: 'external',
  loader: { '.module.css': 'empty' },
});
const loaded = { exports: {} };
new Function('require', 'module', 'exports', compiled.outputFiles[0].text)(
  createRequire(import.meta.url),
  loaded,
  loaded.exports,
);
const render = (model) =>
  renderToStaticMarkup(createElement(loaded.exports.SignalRadar, { model }));

test('radar renders a unified accessible visualization and links to both signal kinds', () => {
  const html = render(
    compute([
      legacy('archive'),
      signal('current', undefined, { title: '<script>not markup</script>' }),
    ]),
  );
  assert.match(html, /技术演进雷达/);
  assert.match(html, /领域雷达/);
  assert.match(html, /领域内部的关注落点/);
  assert.match(html, /不能跨两行比较长度/);
  assert.match(html, /aria-label="领域雷达/);
  assert.match(html, /href="\/signals\/archive"/);
  assert.match(html, /href="\/signals\/current"/);
  assert.match(html, /&lt;script&gt;/);
  assert.doesNotMatch(html, /<script>not markup/);
  assert.match(html, /每格为当月事件数/);
  assert.match(html, /不声称它们是综合热度榜/);
  assert.doesNotMatch(html, /排除历史档案|仅使用当前公开集合|实时热度/);
  assert.match(render(compute([])), /暂无可展示的信号/);
});

test('homepage authority, redirect and navigation exclude retired report routes', async () => {
  assert.deepEqual(
    primaryNavigation.map((item) => item.href),
    ['/', '/signals', '/topics', '/resources'],
  );
  assert.deepEqual(
    primaryNavigation.map((item) => item.label),
    ['雷达', '信号', '洞察', '资源'],
  );
  const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');
  const home = await read('../app/page.tsx');
  assert.match(home, /getPublicExploration/);
  assert.match(home, /force-dynamic/);
  assert.doesNotMatch(home, /getRadarEntries|getDailyEntries|catch\s*\(/);
  assert.match(await read('../app/radar/page.tsx'), /permanentRedirect\('\/'\)/);
  assert.doesNotMatch(await read('../components/site-shell.tsx'), /\/daily|\/weekly/);
  assert.match(await read('../components/mobile-navigation.tsx'), /primaryNavigation\.map/);
});
