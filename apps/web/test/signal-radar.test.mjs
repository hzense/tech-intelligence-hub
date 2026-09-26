import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath, URL } from 'node:url';
import { build } from 'esbuild';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  buildSignalRadar,
  parseRadarRange,
  radarRankingVersion,
} from '../lib/signal-radar-model.ts';
import { primaryNavigation, historicalNavigation } from '../lib/site-navigation.ts';

const now = new Date('2026-09-26T12:00:00.000Z');
const topics = [
  { id: 'topic-ai', name: '人工智能', parentId: null },
  { id: 'topic-models', name: '模型', parentId: 'topic-ai' },
  { id: 'topic-agents', name: '智能体', parentId: 'topic-ai' },
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
const compute = (entries, options = {}) => buildSignalRadar(entries, topics, { now, ...options });

test('radar honors manual confirmation but excludes legacy and never manufactures metrics', () => {
  const legacy = signal('legacy');
  delete legacy.publication_basis;
  const sourced = signal('public', undefined, {
    publication_basis: undefined,
    public_version: 1,
    importance: 4,
  });
  const result = compute([legacy, sourced, signal('manual')]);
  assert.equal(result.recentCount, 2);
  assert.equal(result.exclusions.legacy, 1);
  const manual = result.rankings.find((item) => item.signal.id === 'manual');
  assert.equal(manual.importance, null);
  assert.equal(manual.hotnessScore, null);
  assert.equal(manual.independentSourceCount, null);
  assert.equal(result.rankings.find((item) => item.signal.id === 'public').importance, 4);
});

test('recent ranking uses event time, half-open boundaries and not ingestion or publication time', () => {
  const result = compute([
    signal('old', '2020-01-01T00:00:00.000Z'),
    signal('start', '2026-09-19T12:00:00.000Z'),
    signal('before', '2026-09-19T11:59:59.999Z'),
    signal('end', now.toISOString()),
    signal('future', '2026-10-01T00:00:00.000Z'),
    signal('invalid', 'not-a-date'),
  ]);
  assert.deepEqual(
    result.rankings.map((item) => item.signal.id),
    ['start'],
  );
  assert.deepEqual(result.exclusions, {
    legacy: 0,
    invalidDates: 1,
    futureDates: 2,
    duplicateCount: 0,
    outsideWindow: 2,
  });
});

test('time decay is reproducible, tie breaks by stable ID and TOP 10 never fills from old records', () => {
  assert.equal(
    compute([signal('two-days', '2026-09-24T12:00:00.000Z')]).rankings[0].recencyScore,
    50,
  );
  const entries = Array.from({ length: 12 }, (_, index) =>
    signal(`signal-${String(index).padStart(2, '0')}`),
  );
  const one = compute(entries),
    two = compute([...entries].reverse());
  assert.equal(one.rankings.length, 10);
  assert.equal(one.recentCount, 12);
  assert.deepEqual(one, two);
  assert.equal(one.rankingVersion, radarRankingVersion);
  assert.equal(compute([signal('only')]).rankings.length, 1);
  assert.deepEqual(compute([]).rankings, []);
});

test('deduplicates current revisions and exact content, without conflating similar events', () => {
  const original = signal('a');
  const updated = signal('a', undefined, { publication_revision: 2, summary: 'Updated fact' });
  const duplicate = { ...updated, id: 'b' };
  const distinct = signal('c', undefined, { title: updated.title, summary: 'Different fact' });
  const result = compute([original, updated, duplicate, distinct]);
  assert.equal(result.recentCount, 2);
  assert.equal(result.exclusions.duplicateCount, 2);
  assert.equal(result.rankings[0].signal.summary, 'Updated fact');
});

test('withdrawal from the public source removes ranking and domain counts on the next computation', () => {
  const before = compute([signal('removed')]);
  assert.equal(before.rankings.length, 1);
  assert.equal(before.domains[0].currentCount, 1);
  const after = compute([]);
  assert.equal(after.rankings.length, 0);
  assert.ok(after.domains.every((domain) => domain.currentCount === 0));
});

test('domain observations use independent UTC complete-day windows and no double counting of sibling topics', () => {
  const entries = [
    signal('previous-start', '2026-09-12T00:00:00.000Z'),
    signal('current-start', '2026-09-19T00:00:00.000Z', {
      topics: ['topic-models', 'topic-agents', 'topic-security'],
    }),
    signal('today', '2026-09-26T00:00:00.000Z'),
    signal('before-all', '2026-09-11T23:59:59.999Z'),
  ];
  const short = compute(entries, { range: '24h' }),
    long = compute(entries, { range: '30d' });
  assert.deepEqual(short.domains, long.domains);
  const ai = short.domains.find((domain) => domain.id === 'topic-ai');
  assert.equal(ai.previousCount, 1);
  assert.equal(ai.currentCount, 1);
  assert.equal(ai.dailyCounts[0], 1);
  assert.equal(ai.dailyCounts[7], 1);
  assert.equal(short.domains.find((domain) => domain.id === 'topic-security').currentCount, 1);
  assert.equal(short.trendEnd, '2026-09-26T00:00:00.000Z');
  assert.equal(short.trendStart, '2026-09-19T00:00:00.000Z');
});

test('neither small samples nor apparent large growth produce an unsupported trend conclusion', () => {
  assert.equal(compute([signal('a')]).domains[0].state, 'insufficient_sample');
  const enough = [
    ...Array.from({ length: 3 }, (_, i) => signal(`old-${i}`, `2026-09-${13 + i}T00:00:00.000Z`)),
    ...Array.from({ length: 12 }, (_, i) => signal(`new-${i}`)),
  ];
  const observed = compute(enough).domains[0];
  assert.equal(observed.currentCount, 12);
  assert.equal(observed.previousCount, 3);
  assert.equal(observed.state, 'coverage_unverified');
  assert.equal('growthRate' in observed, false);
});

test('range parsing is bounded and invalid cutoffs fail rather than showing invented time', () => {
  assert.equal(parseRadarRange(undefined), '7d');
  assert.equal(parseRadarRange('invalid'), '7d');
  assert.equal(parseRadarRange(['24h', '30d']), '24h');
  assert.equal(parseRadarRange('30d'), '30d');
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

test('radar rendering exposes score limitations, publication basis, count gaps, and safe public text', () => {
  const html = render(
    compute([signal('one', undefined, { title: '<script>not markup</script>' })]),
  );
  assert.match(html, /管理员确认/);
  assert.match(html, /未提供，不参与排序/);
  assert.match(html, /不是综合热度或重要度排名/);
  assert.match(html, /radar-recency-v1/);
  assert.match(html, /不补满十条/);
  assert.match(html, /href="\/signals\/one"/);
  assert.match(html, /&lt;script&gt;/);
  assert.doesNotMatch(html, /<script>not markup/);
  assert.match(html, /aria-label="热点时间窗口"/);
  assert.match(html, /aria-current="page"/);
  assert.match(render(compute([])), /暂无符合窗口的当前公开信号/);
  assert.doesNotMatch(html, /历史回顾样例|实时热度|独立核验通过/);
});

test('homepage authority, redirect and shared navigation preserve history outside primary menus', async () => {
  assert.deepEqual(
    primaryNavigation.map((item) => item.href),
    ['/', '/signals', '/topics', '/resources'],
  );
  assert.deepEqual(
    primaryNavigation.map((item) => item.label),
    ['雷达', '信号', '专题洞察', '资源'],
  );
  assert.deepEqual(
    historicalNavigation.map((item) => item.href),
    ['/daily', '/weekly'],
  );
  const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');
  const home = await read('../app/page.tsx');
  assert.match(home, /getPublicExploration/);
  assert.match(home, /force-dynamic/);
  assert.doesNotMatch(home, /getRadarEntries|getDailyEntries|catch\s*\(/);
  assert.match(await read('../app/radar/page.tsx'), /permanentRedirect\('\/'\)/);
  assert.match(await read('../components/site-shell.tsx'), /historicalNavigation\.map/);
  assert.match(await read('../components/mobile-navigation.tsx'), /primaryNavigation\.map/);
});
