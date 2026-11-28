import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildSourceDirectory } from '../lib/source-directory.ts';
import { filterSourceDirectoryRows } from '../lib/source-directory-view.ts';

function registration(id, name, allowed_hosts, active = true) {
  return { id, name, type: 'website', active, allowed_hosts };
}

function signal(id, date, ...urls) {
  return { id, title: `信号 ${id}`, date, topicIds: [], sources: urls.map((url) => ({ url })) };
}

test('groups registered hosts, private suffix tenants and cited-only sites without losing zero-count entries', () => {
  const directory = buildSourceDirectory(
    [
      registration('news', '新闻', ['finance.example.com.cn', 'www.example.com.cn']),
      registration('press', '新闻', ['Finance.Example.Com.Cn.', 'wire.partner.org']),
      registration('old', '已停用', ['unused.co.uk'], false),
    ],
    [
      signal('a', '2026-06-01', 'https://other.example.com.cn/a', 'https://one.github.io/a'),
      signal('b', '2026-07-01', 'https://two.github.io/same', 'https://one.github.io/b'),
      signal('c', '2026-07-02'),
    ],
    [],
  );
  assert.deepEqual(directory.stats, {
    sites: 5,
    registeredSources: 3,
    citedSites: 3,
    unregisteredCitedSites: 2,
    signalsWithSources: 2,
    signalsWithoutSources: 1,
  });
  assert.deepEqual(
    directory.rows.map((row) => row.domain),
    ['one.github.io', 'example.com.cn', 'two.github.io', 'partner.org', 'unused.co.uk'],
  );
  const shared = directory.rows.find((row) => row.domain === 'example.com.cn');
  assert.deepEqual(shared.registeredHosts, ['finance.example.com.cn', 'www.example.com.cn']);
  assert.deepEqual(directory.rows.find((row) => row.domain === 'partner.org').registeredHosts, [
    'wire.partner.org',
  ]);
  assert.deepEqual(
    directory.rows.find((row) => row.domain === 'one.github.io').registeredHosts,
    [],
  );
  assert.deepEqual(
    shared.registrations.map((entry) => entry.id),
    ['news', 'press'],
  );
  assert.equal(shared.references.length, 1);
  const inactive = directory.rows.find((row) => row.domain === 'unused.co.uk');
  assert.equal(inactive.registrations[0].active, false);
  assert.equal(inactive.urlCount, 0);
  assert.equal(inactive.latestDate, null);
});

test('tracks distinct signals and articles separately and preserves article query parameters', () => {
  const canonical = 'https://news.example.org/story?id=a%20b';
  const first = signal(
    'first',
    '2026-08-01T12:34:56.000Z',
    canonical,
    canonical + '&UTM_source=feed#g',
    canonical + '&fbclid=one&gclid=two&msclkid=three',
    'https://news.example.org/story?id=c',
  );
  const second = signal('second', '2026-08-02', canonical + '#f');
  const result = buildSourceDirectory([], [first, second, first], []);
  const [row] = result.rows;
  assert.equal(result.stats.signalsWithSources, 2);
  assert.equal(row.signalCount, 2);
  assert.equal(row.urlCount, 2);
  assert.equal(row.latestDate, '2026-08-02');
  assert.deepEqual(row.references, [
    {
      id: 'second',
      title: '信号 second',
      date: '2026-08-02',
      urls: [canonical],
      domainIds: ['unclassified'],
    },
    {
      id: 'first',
      title: '信号 first',
      date: '2026-08-01',
      domainIds: ['unclassified'],
      urls: [canonical, 'https://news.example.org/story?id=c'],
    },
  ]);
  assert.deepEqual(result, buildSourceDirectory([], [second, first], []));
});

test('omits unsupported schemes, credentials and local hosts from both links and totals', () => {
  const directory = buildSourceDirectory(
    [],
    [
      signal(
        'hidden',
        '2026-09-01',
        'data:text/plain,private',
        'javascript:alert(1)',
        'https://user:pass@public.org/a',
        'https://localhost/a',
        'https://internal.lan/a',
        'https://server.internal./a',
        'http://127.0.0.1/a',
        'https://[::1]/a',
        'broken',
      ),
      signal('ok', '2026-09-02', 'http://news.public.org/x?id=2'),
    ],
    [],
  );
  assert.deepEqual(
    directory.rows.map((row) => row.domain),
    ['public.org'],
  );
  assert.deepEqual(directory.rows[0].references[0].urls, ['http://news.public.org/x?id=2']);
  assert.equal(directory.stats.signalsWithoutSources, 1);
  assert.equal(directory.stats.signalsWithSources, 1);
});

test('groups source sites through the signal topic hierarchy and scopes the full evidence to the selected domain', () => {
  const topics = [
    { id: 'topic-artificial-intelligence', parentId: null, name: 'Artificial Intelligence' },
    { id: 'topic-quantum', parentId: null, name: 'Quantum' },
    { id: 'topic-unused', parentId: null, name: '其他领域' },
    { id: 'topic-model', parentId: 'topic-artificial-intelligence', name: '模型' },
    { id: 'topic-small', parentId: 'topic-model', name: '小模型' },
    { id: 'topic-hardware', parentId: 'topic-quantum', name: '量子硬件' },
  ];
  const registry = [registration('empty', '已登记', ['unused.org'])];
  const a = 'https://shared.org/a';
  const b = 'https://shared.org/b';
  const c = 'https://other.org/c';
  const signals = [
    {
      ...signal('cross', '2026-02-02', a, b, c),
      topicIds: ['topic-model', 'topic-small', 'topic-hardware', 'unknown'],
    },
    { ...signal('only-ai', '2026-03-03', a), topicIds: ['topic-artificial-intelligence'] },
    { ...signal('unknown', '2026-04-04', b), topicIds: ['unknown'] },
  ];
  const { domains, rows } = buildSourceDirectory(registry, signals, topics);
  assert.deepEqual(
    domains.map(({ key, siteCount }) => [key, siteCount]),
    [
      ['topic-artificial-intelligence', 2],
      ['topic-quantum', 2],
      ['topic-unused', 0],
      ['unclassified', 1],
      ['uncited', 1],
    ],
  );
  assert.equal(domains[0].label, '人工智能');
  assert.equal(domains[2].label, '其他领域');
  const shared = rows.find((row) => row.domain === 'shared.org');
  assert.deepEqual(shared.domainIds, [
    'topic-artificial-intelligence',
    'topic-quantum',
    'unclassified',
  ]);
  assert.deepEqual(shared.references.find((ref) => ref.id === 'cross').domainIds, [
    'topic-artificial-intelligence',
    'topic-quantum',
  ]);
  assert.deepEqual(shared.references.find((ref) => ref.id === 'unknown').domainIds, [
    'unclassified',
  ]);
  assert.equal(shared.signalCount, 3);
  assert.equal(shared.latestDate, '2026-04-04');
  assert.equal(filterSourceDirectoryRows(rows, 'all'), rows);
  assert.deepEqual(filterSourceDirectoryRows(rows, 'topic-unused'), []);
  const [ai] = filterSourceDirectoryRows(rows, 'topic-artificial-intelligence');
  assert.deepEqual(
    ai.references.map((ref) => ref.id),
    ['only-ai', 'cross'],
  );
  assert.equal(ai.signalCount, 2);
  assert.equal(ai.urlCount, 2);
  assert.equal(ai.latestDate, '2026-03-03');
  const [uncategorized] = filterSourceDirectoryRows(rows, 'unclassified');
  assert.deepEqual(uncategorized.domainIds, shared.domainIds);
  assert.deepEqual(
    uncategorized.references.map((ref) => ref.urls),
    [[b]],
  );
  assert.equal(uncategorized.urlCount, 1);
  const [uncited] = filterSourceDirectoryRows(rows, 'uncited');
  assert.equal(uncited.domain, 'unused.org');
  assert.deepEqual(uncited.domainIds, ['uncited']);
  assert.deepEqual(uncited.references, []);
  assert.equal(uncited.latestDate, null);
});
