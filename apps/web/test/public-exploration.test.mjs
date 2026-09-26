import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { Buffer } from 'node:buffer';
import { URL } from 'node:url';
import {
  buildPublicEntityDirectory,
  isCurrentSignal,
  parseSignalFilters,
  selectSignals,
  signalDomainIds,
  signalFilterHref,
} from '../lib/public-exploration-core.ts';

const topics = [
  { id: 'topic-ai', name: 'Artificial Intelligence', parentId: null },
  { id: 'topic-model', name: '模型', parentId: 'topic-ai' },
  { id: 'topic-security', name: '安全', parentId: null },
];
const person = { id: 'person-a', name: '张三', event_role: 'author' };
const organization = { id: 'org-a', name: '测试研究院', event_role: 'subject' };
function signal(overrides = {}) {
  return {
    id: 'signal-a',
    title: '模型研究',
    summary: '公开证据与成果',
    analysis: '安全评估',
    type: 'research',
    occurred_at: '2026-09-20T00:00:00.000Z',
    captured_at: '2026-09-25T00:00:00.000Z',
    status: 'accepted',
    source_id: 'source-a',
    source_url: 'https://example.com',
    topics: ['topic-model'],
    entities: ['person-a', 'org-a'],
    public_people: [person],
    public_organizations: [organization],
    public_version: 1,
    ...overrides,
  };
}
test('current authority is explicit publication, never accepted historical Seed status', () => {
  assert.equal(isCurrentSignal(signal()), true);
  assert.equal(
    isCurrentSignal(
      signal({ public_version: undefined, publication_basis: 'manual_confirmation' }),
    ),
    true,
  );
  const legacy = signal({ public_version: undefined });
  assert.equal(isCurrentSignal(legacy), false);
  assert.equal(
    selectSignals([signal(), { ...legacy, id: 'legacy' }], parseSignalFilters({}), topics).total,
    1,
  );
  assert.deepEqual(
    selectSignals(
      [signal(), { ...legacy, id: 'legacy' }],
      parseSignalFilters({ archive: '1' }),
      topics,
    ).entries.map((entry) => entry.id),
    ['legacy'],
  );
});
test('resolves descendants and de-duplicates roots without invented domains', () => {
  assert.deepEqual(
    signalDomainIds(
      signal({ topics: ['topic-model', 'topic-ai', 'topic-security', 'unknown'] }),
      topics,
    ),
    ['topic-ai', 'topic-security'],
  );
  assert.deepEqual(
    signalDomainIds(signal(), [{ id: 'topic-model', name: '', parentId: 'topic-model' }]),
    [],
  );
});
test('combines event dates, domain, topic, person, organization and normalized keyword filters', () => {
  const filters = parseSignalFilters({
    from: '2026-09-20',
    to: '2026-09-20',
    domain: 'topic-ai',
    topic: 'topic-model',
    person: 'person-a',
    organization: 'org-a',
    q: '张三 研究',
    keyword: '证据',
  });
  assert.equal(selectSignals([signal()], filters, topics).total, 1);
  assert.equal(selectSignals([signal()], { ...filters, from: '2026-09-21' }, topics).total, 0);
  assert.equal(selectSignals([signal()], { ...filters, person: 'other' }, topics).total, 0);
  assert.equal(selectSignals([signal()], { ...filters, organization: 'other' }, topics).total, 0);
  assert.equal(selectSignals([signal()], { ...filters, domain: 'other' }, topics).total, 0);
  assert.equal(
    selectSignals(
      [signal({ title: 'ＡＩ', summary: '模型' })],
      parseSignalFilters({ q: 'ai' }),
      topics,
    ).total,
    1,
  );
});
test('date boundaries use occurrence not capture date and reject impossible/reversed dates', () => {
  for (const params of [
    { from: '2026-02-30' },
    { to: 'bad' },
    { from: '2026-09-22', to: '2026-09-20' },
  ]) {
    const filters = parseSignalFilters(params);
    assert.equal(filters.invalid, true);
    assert.equal(selectSignals([signal()], filters, topics).total, 0);
  }
  assert.equal(
    selectSignals(
      [signal({ occurred_at: '2026-09-20T23:59:59.999Z' })],
      parseSignalFilters({ to: '2026-09-20' }),
      topics,
    ).total,
    1,
  );
  assert.equal(
    selectSignals([signal()], parseSignalFilters({ from: '2026-09-25' }), topics).total,
    0,
  );
});
test('keyset cursor preserves filters and survives withdrawn anchor without stale content', () => {
  const entries = Array.from({ length: 15 }, (_, index) =>
    signal({ id: `signal-${String(index).padStart(2, '0')}` }),
  );
  const filters = parseSignalFilters({ q: '研究', person: 'person-a' });
  const first = selectSignals(entries, filters, topics);
  assert.equal(first.entries.length, 12);
  assert.ok(first.nextCursor);
  const second = selectSignals(
    entries.filter((entry) => entry.id !== first.entries.at(-1).id),
    { ...filters, cursor: first.nextCursor },
    topics,
  );
  assert.deepEqual(
    second.entries.map((entry) => entry.id),
    ['signal-12', 'signal-13', 'signal-14'],
  );
  assert.equal(second.nextCursor, undefined);
  assert.equal(
    selectSignals(entries, { ...filters, q: '', cursor: first.nextCursor }, topics).invalidCursor,
    true,
  );
});
test('invalid cursors cannot silently select a different result set', () => {
  for (const cursor of [
    'bad',
    Buffer.from('{}').toString('base64url'),
    Buffer.from('null').toString('base64url'),
  ]) {
    const result = selectSignals([signal()], parseSignalFilters({ cursor }), topics);
    assert.equal(result.invalidCursor, true);
    assert.deepEqual(result.entries, []);
  }
});
test('URLs retain filters, encode values and reset only requested pagination', () => {
  const filters = parseSignalFilters({
    q: '模型 & AI',
    archive: '1',
    person: 'person-a',
    view: 'timeline',
    cursor: 'old',
  });
  const href = signalFilterHref(filters, { cursor: undefined });
  const url = new URL(href, 'https://example.com');
  assert.equal(url.searchParams.get('q'), '模型 & AI');
  assert.equal(url.searchParams.get('archive'), '1');
  assert.equal(url.searchParams.get('person'), 'person-a');
  assert.equal(url.searchParams.has('cursor'), false);
});
test('directory uses IDs not names; de-duplicates references and excludes future/old events from 30-day activity', () => {
  const entries = [
    signal(),
    signal(),
    signal({ id: 'old', occurred_at: '2026-01-01T00:00:00Z' }),
    signal({ id: 'future', occurred_at: '2027-01-01T00:00:00Z' }),
    signal({
      id: 'other',
      public_people: [{ ...person, id: 'person-b' }],
      public_organizations: [],
    }),
  ];
  const directory = buildPublicEntityDirectory(entries, [], new Date('2026-09-26T00:00:00Z'));
  assert.equal(directory.find((entry) => entry.id === 'org-a').recentCount, 1);
  assert.equal(directory.find((entry) => entry.id === 'org-a').signals.length, 3);
  assert.equal(directory.filter((entry) => entry.name === '张三').length, 2);
  assert.equal(directory.find((entry) => entry.id === 'org-a').relatedPeople.length, 1);
  assert.equal('employer' in directory.find((entry) => entry.id === 'person-a'), false);
});
test('withdrawals remove new entities and co-occurrence; archive registry remains only when requested', () => {
  assert.deepEqual(buildPublicEntityDirectory([]), []);
  const seeds = [
    { id: 'legacy-org', name: 'Legacy', type: 'company', status: 'active' },
    { id: 'hidden', name: 'Hidden', type: 'company', status: 'inactive' },
  ];
  const entries = buildPublicEntityDirectory([], seeds);
  assert.deepEqual(
    entries.map((entry) => entry.id),
    ['legacy-org'],
  );
  assert.equal(entries[0].recentCount, 0);
});
test('activity ranking orders current organizations by actual recent distinct Signal IDs', () => {
  const directory = buildPublicEntityDirectory(
    [
      signal(),
      signal({ id: 'signal-b' }),
      signal({ id: 'signal-c', public_organizations: [{ ...organization, id: 'org-b' }] }),
    ],
    [],
    new Date('2026-09-26T00:00:00Z'),
  );
  assert.deepEqual(
    directory
      .filter((entry) => entry.type === 'institution')
      .map((entry) => [entry.id, entry.recentCount]),
    [
      ['org-a', 2],
      ['org-b', 1],
    ],
  );
});
test('all new public routes are dynamic and read from the configured public authority', async () => {
  const source = (path) => readFile(new URL(path, import.meta.url), 'utf8');
  for (const route of [
    'signals/page.tsx',
    'resources/page.tsx',
    'resources/[id]/page.tsx',
    'persons/page.tsx',
    'persons/[id]/page.tsx',
  ]) {
    const page = await source(`../app/${route}`);
    assert.match(page, /export const dynamic = 'force-dynamic'/);
    assert.doesNotMatch(page, /generateStaticParams|candidate|new Pool/);
  }
  const runtime = await source('../lib/public-exploration-runtime.ts');
  assert.match(runtime, /getSignalEntries\(\)/);
  assert.doesNotMatch(runtime, /unstable_cache|use cache|new Pool|catch/);
});
