import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRadarHotspots } from '../lib/radar-hotspots.ts';
import { filterRadarWindow } from '../lib/radar-window.ts';
import { buildSignalRadar } from '../lib/signal-radar-model.ts';
import { buildPublicEntityDirectory } from '../lib/public-exploration-core.ts';
import { radarTopicLabel } from '../lib/radar-topic-labels.ts';
import { readFile } from 'node:fs/promises';
import { URL } from 'node:url';
import { parse } from 'yaml';

const asOf = '2026-10-27T00:00:00.000Z';
const day = 86_400_000;
const ago = (days) => new Date(Date.parse(asOf) - days * day).toISOString();
const entry = (id, days = 1, domainIds = ['ai']) => ({
  id,
  title: id,
  summary: `Summary ${id}`,
  occurredAt: ago(days),
  domainIds,
});
const node = (id, signalIds, extras = {}) => ({
  id,
  name: id,
  signalIds,
  totalCount: signalIds.length,
  recentCount: 0,
  previousCount: 0,
  ...extras,
});
const category = (id, parentId, signalIds, depth = 1) =>
  node(id, signalIds, { parentId, domainId: 'ai', depth });
const data = (signalIndex, { categories = [], domains, resources = [] } = {}) => ({
  asOf,
  recentStart: ago(30),
  recentCount: 0,
  previousCount: 0,
  totalCount: signalIndex.length,
  signalIndex,
  domains: domains ?? [
    node(
      'ai',
      signalIndex.map((signal) => signal.id),
    ),
  ],
  categories,
  resources,
});
const compute = (source, range = { kind: 'days', days: 8 }) =>
  buildRadarHotspots(source, filterRadarWindow(source, range));

test('word cloud covers the current taxonomy in Chinese without renaming identities or unknown topics', async () => {
  const taxonomy = parse(
    await readFile(new URL('../../../data/taxonomy/taxonomy.yaml', import.meta.url), 'utf8'),
  );
  const abbreviations = new Set(['GPU', 'CPU', 'HBM', 'DRAM', 'EDA']);
  const visit = (topics) => {
    for (const topic of topics) {
      const name = radarTopicLabel(topic.id, topic.name);
      assert.ok(
        abbreviations.has(name) || /[\u4e00-\u9fff]/.test(name),
        `Missing Chinese display label for ${topic.id}`,
      );
      visit(topic.children ?? []);
    }
  };
  visit(taxonomy.root_topics);
  assert.equal(radarTopicLabel('new-topic', 'New Topic'), 'New Topic');
  assert.equal(radarTopicLabel('constructor', 'Unknown topic'), 'Unknown topic');
  const source = data([entry('one')], {
    domains: [node('topic-artificial-intelligence', ['one'], { name: 'Artificial Intelligence' })],
    categories: [category('topic-language-models', 'topic-artificial-intelligence', ['one'])],
  });
  source.categories[0].domainId = 'topic-artificial-intelligence';
  const [hotspot] = compute(source);
  assert.equal(hotspot.id, 'topic-language-models');
  assert.equal(hotspot.name, '语言模型');
  assert.equal(hotspot.domainName, '人工智能');
  assert.equal(source.domains[0].name, 'Artificial Intelligence');
});

test('hotspots share the selected half-open window, eight bins and deduplicated identities', () => {
  const entries = Array.from({ length: 8 }, (_, i) => entry(`current-${i}`, 8 - i));
  const source = data([
    ...entries,
    entry('prior', 8 + 1 / day),
    entry('boundary', 0),
    entry('future', -1),
    { ...entry('invalid'), occurredAt: 'bad-date' },
  ]);
  source.domains[0].signalIds.push('current-0');
  const [hotspot] = compute(source);
  assert.equal(hotspot.recentCount, 8);
  assert.equal(hotspot.previousCount, 1);
  assert.deepEqual(
    hotspot.series.map((bucket) => bucket.count),
    Array(8).fill(1),
  );
  assert.equal(hotspot.series[0].start, ago(8));
  assert.equal(hotspot.series.at(-1).end, asOf);
  assert.equal(new Set(hotspot.signalIds).size, 8);
  assert.equal(hotspot.trend.state, 'rising');
});

test('specific topic words replace ancestor duplicates without losing parent-only assignments', () => {
  const entries = ['tool', 'memory', 'parent-only', 'domain-only', 'both'].map((id) => entry(id));
  const source = data(entries, {
    categories: [
      category('agents', 'ai', ['tool', 'memory', 'parent-only', 'both']),
      category('tools', 'agents', ['tool', 'both'], 2),
      category('memory', 'agents', ['memory', 'both'], 2),
    ],
  });
  const result = compute(source);
  const byId = new Map(result.map((item) => [item.id, item]));
  assert.deepEqual(byId.get('agents').signalIds, ['parent-only']);
  assert.equal(byId.get('agents').name, 'agents');
  assert.match(byId.get('agents').scopeNote, /数量不包含子分类/);
  assert.equal(byId.get('tools').scopeNote, undefined);
  assert.deepEqual(byId.get('ai').signalIds, ['domain-only']);
  assert.equal(byId.get('ai').kind, 'domain');
  assert.equal(byId.get('tools').recentCount, 2);
  assert.equal(byId.get('memory').recentCount, 2);
  assert.equal(new Set(result.flatMap((item) => item.signalIds)).size, entries.length);

  const exact = data([entry('one')], {
    categories: [category('agents', 'ai', ['one']), category('tools', 'agents', ['one'], 2)],
  });
  assert.deepEqual(
    compute(exact).map((item) => item.id),
    ['tools'],
  );
});

test('every visible topic has a signal in the selected window, even when the previous period was active', () => {
  const prior = Array.from({ length: 4 }, (_, i) => entry(`prior-${i}`, 9));
  const old = entry('old', 20);
  const source = data([...prior, old], {
    categories: [
      category(
        'cooling',
        'ai',
        prior.map((signal) => signal.id),
      ),
      category('gone', 'ai', [old.id]),
    ],
  });
  assert.deepEqual(compute(source), [], 'previous-period activity cannot create an empty word');
  const result = compute(source, { kind: 'all' });
  assert.deepEqual(
    result.map((item) => item.id),
    ['cooling', 'gone'],
  );
  assert.ok(result.every((item) => item.recentCount > 0 && item.signalIds.length > 0));
  assert.equal(result[0].recentCount, 4);
  assert.equal(result[0].previousCount, null);
  assert.equal(result[0].trend.state, 'unavailable');
  assert.equal(
    result[0].series.reduce((sum, bucket) => sum + bucket.count, 0),
    4,
  );
  assert.deepEqual(result[0].resources, []);
  const custom = compute(source, {
    kind: 'custom',
    startDate: ago(9).slice(0, 10),
    endDate: ago(9).slice(0, 10),
  });
  assert.deepEqual(
    custom.map((item) => item.id),
    ['cooling'],
  );
  assert.equal(custom[0].recentCount, 4);
});

test('zero baselines and sparse samples are not presented as percentage growth or breakthroughs', () => {
  const fresh = Array.from({ length: 4 }, (_, i) => entry(`fresh-${i}`));
  assert.deepEqual(compute(data(fresh))[0].trend, { state: 'new', label: '新收录', delta: 4 });
  assert.deepEqual(compute(data([entry('one')]))[0].trend, {
    state: 'insufficient',
    label: '样本较少',
    delta: 1,
  });
  const balanced = [entry('new-1'), entry('new-2'), entry('old-1', 9), entry('old-2', 9)];
  assert.equal(compute(data(balanced))[0].trend.state, 'steady');
  assert.equal('growthRate' in compute(data(fresh))[0], false);
});

test('resource ranks use the hotspot and time intersection, retaining both resource types', () => {
  const entries = Array.from({ length: 7 }, (_, i) => entry(`s-${i}`));
  const prior = entry('prior', 10);
  const outside = entry('elsewhere');
  const localIds = entries.map((signal) => signal.id);
  const companies = Array.from({ length: 6 }, (_, i) =>
    node(`company-${i}`, [...localIds.slice(i), 'prior'], { type: 'company' }),
  );
  const source = data([...entries, prior, outside], {
    categories: [category('focus', 'ai', [...localIds, 'prior'])],
    resources: [
      ...companies,
      node('person', ['s-0', 's-0'], {
        type: 'person',
        summary: '公开的研究者简介',
        profileSourceUrl: 'https://example.com/person',
      }),
      node('unrelated', ['elsewhere'], { type: 'company' }),
      node('old-only', ['prior'], { type: 'person' }),
    ],
  });
  const result = compute(source).find((hotspot) => hotspot.id === 'focus');
  assert.equal(result.resources.length, 5);
  assert.equal(result.resources[0].id, 'company-0');
  assert.equal(result.resources[0].recentCount, 7);
  assert.equal(result.resources[0].totalCount, 8);
  const person = result.resources.find((resource) => resource.id === 'person');
  assert.equal(person.recentCount, 1);
  assert.equal(person.summary, '公开的研究者简介');
  assert.equal(
    result.resources.some((resource) => ['unrelated', 'old-only'].includes(resource.id)),
    false,
  );
  assert.equal(
    source.resources[0].signalIds.length,
    8,
    'projection does not mutate the shared snapshot',
  );
});

test('custom ranges and all-time use their own bins, with no invented all-time comparison', () => {
  const source = data([entry('early', 50), entry('mid', 20), entry('late', 1)]);
  const [all] = compute(source, { kind: 'all' });
  assert.equal(all.recentCount, 3);
  assert.equal(all.previousCount, null);
  assert.deepEqual(all.trend, { state: 'unavailable', label: '仅展示历史', delta: null });
  assert.equal(
    all.series.reduce((sum, bucket) => sum + bucket.count, 0),
    3,
  );
  const [custom] = compute(source, {
    kind: 'custom',
    startDate: '2026-10-07',
    endDate: '2026-10-07',
  });
  assert.deepEqual(custom.signalIds, ['mid']);
  assert.equal(custom.series[0].start, '2026-10-07T00:00:00.000Z');
  assert.equal(custom.series.at(-1).end, '2026-10-08T00:00:00.000Z');
  assert.deepEqual(compute(data([]), { kind: 'all' }), []);
});

test('radar serializes sourced public profiles and curated media without inventing missing data', () => {
  const signal = {
    id: 'published',
    title: 'Example',
    summary: 'Example summary',
    occurred_at: ago(1),
    captured_at: ago(1),
    type: 'editorial',
    status: 'accepted',
    publication_basis: 'manual_confirmation',
    publication_revision: 1,
    topics: ['ai'],
    entities: [],
    source_id: '',
    source_url: '',
    public_sources: [],
    public_people: [
      { id: 'person-new', canonical_entity_id: 'person-new', name: 'Researcher', event_role: '' },
    ],
    public_organizations: [
      {
        id: 'company-openai',
        canonical_entity_id: 'company-openai',
        name: 'OpenAI',
        event_role: '',
      },
    ],
  };
  const model = buildSignalRadar([signal], [{ id: 'ai', name: 'AI', parentId: null }], {
    now: new Date(asOf),
    entities: [
      {
        id: 'person-new',
        name: 'Researcher',
        type: 'person',
        profile: {
          introduction: '有来源的公开研究者简介',
          sourceUrl: 'https://example.com/bio',
          sourceUrls: ['https://example.com/bio'],
        },
      },
      { id: 'company-openai', name: 'OpenAI', type: 'company' },
    ],
  });
  const person = model.resources.find((resource) => resource.id === 'person-new');
  assert.equal(person.summary, '有来源的公开研究者简介');
  assert.equal(person.profileSourceUrl, 'https://example.com/bio');
  assert.equal(person.media, undefined);
  const company = model.resources.find((resource) => resource.id === 'company-openai');
  assert.equal(company.media.kind, 'logo');
  assert.ok(company.media.sourceUrl);
  assert.ok(company.summary);
  assert.equal(
    'signals' in person,
    false,
    'full entity Signal records do not cross the client boundary',
  );
});

test('a newly published organization without a Seed company record remains a visible resource', () => {
  const signal = {
    id: 'new-organization-publication',
    title: 'Organization result',
    summary: 'A public result',
    occurred_at: ago(1),
    captured_at: ago(1),
    type: 'editorial',
    status: 'accepted',
    publication_basis: 'manual_confirmation',
    publication_revision: 1,
    topics: ['ai'],
    entities: [],
    source_id: '',
    source_url: '',
    public_sources: [],
    public_people: [],
    public_organizations: [
      {
        id: 'org-public',
        canonical_entity_id: 'org-public',
        name: 'Public Lab',
        event_role: '研究单位',
      },
    ],
  };
  const entities = buildPublicEntityDirectory([signal], [], new Date(asOf));
  assert.equal(entities[0].type, 'institution');
  const source = buildSignalRadar([signal], [{ id: 'ai', name: 'AI', parentId: null }], {
    now: new Date(asOf),
    entities,
  });
  const [hotspot] = compute(source);
  assert.deepEqual(
    hotspot.resources.map((resource) => [resource.id, resource.type, resource.recentCount]),
    [['org-public', 'institution', 1]],
  );
  assert.equal(hotspot.resources[0].summary, undefined);
  assert.equal(hotspot.resources[0].media, undefined);
});
