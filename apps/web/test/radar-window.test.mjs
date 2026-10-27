import test from 'node:test';
import assert from 'node:assert/strict';
import { filterRadarWindow } from '../lib/radar-window.ts';

const asOf = '2026-10-27T12:00:00.000Z';
const ids = (entries) => entries.map((entry) => entry.id);

function fixture(events, resourceMemberships = []) {
  const signalIndex = events
    .map(([id, occurredAt, domainId = 'ai']) => ({
      id,
      title: `Signal ${id}`,
      summary: `Summary ${id}`,
      occurredAt,
      domainIds: [domainId],
    }))
    .sort((left, right) => Date.parse(right.occurredAt) - Date.parse(left.occurredAt));
  const domains = [...new Set(signalIndex.flatMap((signal) => signal.domainIds))].map((id) => {
    const signalIds = signalIndex
      .filter((signal) => signal.domainIds.includes(id))
      .map((s) => s.id);
    return {
      id,
      name: id,
      totalCount: signalIds.length,
      recentCount: 0,
      previousCount: 0,
      signalIds,
    };
  });
  const categories = domains.map((domain) => ({
    id: `${domain.id}-category`,
    name: `${domain.name} category`,
    parentId: domain.id,
    domainId: domain.id,
    depth: 1,
    totalCount: domain.totalCount,
    recentCount: 0,
    signalIds: [...domain.signalIds],
  }));
  const resources = resourceMemberships.map(([id, signalIds], index) => ({
    id,
    name: id,
    type: index % 2 ? 'person' : 'company',
    totalCount: signalIds.length,
    recentCount: 0,
    signalIds,
  }));
  return {
    asOf,
    recentStart: '2026-09-27T12:00:00.000Z',
    totalCount: signalIndex.length,
    recentCount: 0,
    previousCount: 0,
    domains,
    categories,
    resources,
    signalIndex,
  };
}

test('rolling windows use the fixed snapshot cutoff and disjoint inclusive-start boundaries', () => {
  const data = fixture([
    ['latest', '2026-10-27T11:00:00.000Z'],
    ['start', '2026-10-20T12:00:00.000Z'],
    ['before', '2026-10-20T11:59:59.999Z'],
    ['previous-start', '2026-10-13T12:00:00.000Z'],
    ['too-old', '2026-10-13T11:59:59.999Z'],
    ['old-security', '2026-08-01T00:00:00.000Z', 'security'],
  ]);
  const result = filterRadarWindow(data, { kind: 'days', days: 7 });
  assert.equal(result.rangeStart, '2026-10-20T12:00:00.000Z');
  assert.equal(result.rangeEnd, asOf);
  assert.equal(result.recentCount, 2);
  assert.equal(result.previousCount, 2);
  assert.equal(result.totalCount, 6);
  assert.deepEqual(ids(result.signalIndex), ['latest', 'start']);
  assert.deepEqual(ids(result.domains), ['ai']);
  assert.equal(result.domains[0].totalCount, 5);
  assert.equal(result.domains[0].recentCount, 2);
  assert.equal(result.domains[0].previousCount, 2);
  assert.deepEqual(result.domains[0].signalIds, ['latest', 'start']);
  assert.deepEqual(ids(result.categories), ['ai-category']);
  assert.equal(result.categories[0].recentCount, 2);
  assert.equal(result.categories[0].totalCount, 5);
  assert.deepEqual(result.categories[0].signalIds, ['latest', 'start']);
});

test('expanding the window brings older domains, categories and associated signals back', () => {
  const data = fixture([
    ['recent', '2026-10-26T00:00:00.000Z'],
    ['older', '2026-08-01T00:00:00.000Z', 'security'],
  ]);
  assert.deepEqual(ids(filterRadarWindow(data, { kind: 'days', days: 30 }).domains), ['ai']);
  const wider = filterRadarWindow(data, { kind: 'days', days: 90 });
  assert.deepEqual(ids(wider.signalIndex), ['recent', 'older']);
  assert.deepEqual(ids(wider.domains), ['ai', 'security']);
  assert.deepEqual(ids(wider.categories), ['ai-category', 'security-category']);
  assert.equal(wider.recentCount, 2);
});

test('resource TOP5 is reranked from all resources with count, total and identity tie breakers', () => {
  const data = fixture(
    [
      ['new-a', '2026-10-26T00:00:00.000Z'],
      ['new-b', '2026-10-25T00:00:00.000Z'],
      ['new-c', '2026-10-24T00:00:00.000Z'],
      ['old-a', '2026-08-01T00:00:00.000Z'],
      ['old-b', '2026-07-01T00:00:00.000Z'],
    ],
    [
      ['r-e', ['new-a']],
      ['r-d', ['new-a']],
      ['r-c', ['new-a']],
      ['r-b', ['new-a']],
      ['r-a', ['new-a', 'old-a']],
      ['r-new-leader', ['new-a', 'new-b', 'new-c']],
      ['r-old-only', ['old-a', 'old-b']],
    ],
  );
  const result = filterRadarWindow(data, { kind: 'days', days: 7 });
  assert.deepEqual(ids(result.topResources), ['r-new-leader', 'r-a', 'r-b', 'r-c', 'r-d']);
  assert.equal(result.topResources[0].recentCount, 3);
  assert.deepEqual(result.topResources[0].signalIds, ['new-a', 'new-b', 'new-c']);
  assert.equal(result.topResources[1].recentCount, 1);
  assert.equal(result.topResources[1].totalCount, 2);
  assert.deepEqual(result.topResources[1].signalIds, ['new-a']);
  assert.ok(result.topResources.some((resource) => resource.type === 'person'));
  assert.ok(result.topResources.some((resource) => resource.type === 'company'));
});

test('custom UTC dates include the whole last day and compare the preceding equal-length interval', () => {
  const data = fixture([
    ['after', '2026-10-22T00:00:00.000Z'],
    ['end-day', '2026-10-21T23:59:59.999Z'],
    ['start-day', '2026-10-20T00:00:00.000Z'],
    ['previous-end', '2026-10-19T23:59:59.999Z'],
    ['previous-start', '2026-10-18T00:00:00.000Z'],
    ['before-previous', '2026-10-17T23:59:59.999Z'],
  ]);
  const result = filterRadarWindow(data, {
    kind: 'custom',
    startDate: '2026-10-20',
    endDate: '2026-10-21',
  });
  assert.equal(result.rangeStart, '2026-10-20T00:00:00.000Z');
  assert.equal(result.rangeEnd, '2026-10-22T00:00:00.000Z');
  assert.equal(result.recentCount, 2);
  assert.equal(result.previousCount, 2);
  assert.equal(result.domains[0].previousCount, 2);
  assert.deepEqual(ids(result.signalIndex), ['end-day', 'start-day']);
  assert.ok(result.previousLabel);
});

test('custom ranges ending today stop at the snapshot and keep comparison intervals equal', () => {
  const data = fixture([
    ['current', '2026-10-27T11:59:59.999Z'],
    ['previous-start', '2026-10-24T12:00:00.000Z'],
    ['before-previous', '2026-10-24T11:59:59.999Z'],
  ]);
  const result = filterRadarWindow(data, {
    kind: 'custom',
    startDate: '2026-10-26',
    endDate: '2026-10-27',
  });
  assert.equal(result.rangeStart, '2026-10-26T00:00:00.000Z');
  assert.equal(result.rangeEnd, asOf);
  assert.equal(result.recentCount, 1);
  assert.equal(result.previousCount, 1);
  assert.deepEqual(ids(result.signalIndex), ['current']);
});

test('all time retains every eligible signal without inventing a previous period', () => {
  const data = fixture([
    ['recent', '2026-10-26T00:00:00.000Z'],
    ['older', '2026-08-01T00:00:00.000Z', 'security'],
  ]);
  const result = filterRadarWindow(data, { kind: 'all' });
  assert.equal(result.recentCount, 2);
  assert.equal(result.previousCount, 0);
  assert.equal(result.previousLabel, null);
  assert.equal(result.rangeStart, '2026-08-01T00:00:00.000Z');
  assert.equal(result.rangeEnd, asOf);
  assert.deepEqual(ids(result.signalIndex), ['recent', 'older']);
  assert.ok(result.domains.every((domain) => domain.previousCount === 0));
});

test('empty periods have no selectable nodes or resources and retain cumulative totals', () => {
  const data = fixture([['older', '2026-08-01T00:00:00.000Z']], [['company', ['older']]]);
  const result = filterRadarWindow(data, { kind: 'days', days: 7 });
  assert.equal(result.totalCount, 1);
  assert.equal(result.recentCount, 0);
  assert.deepEqual(result.signalIndex, []);
  assert.deepEqual(result.domains, []);
  assert.deepEqual(result.categories, []);
  assert.deepEqual(result.topResources, []);
  const emptyAll = filterRadarWindow(fixture([]), { kind: 'all' });
  assert.equal(emptyAll.recentCount, 0);
  assert.equal(emptyAll.previousLabel, null);
  assert.ok(Number.isFinite(Date.parse(emptyAll.rangeStart)));
  assert.ok(Number.isFinite(Date.parse(emptyAll.rangeEnd)));
});

test('invalid rolling durations and custom dates cannot silently alter the requested window', () => {
  const data = fixture([]);
  for (const days of [0, -1, 1.5, 3651, NaN, Infinity]) {
    assert.throws(() => filterRadarWindow(data, { kind: 'days', days }));
  }
  for (const [startDate, endDate] of [
    ['2026-02-30', '2026-03-01'],
    ['2026-10-20', '2026-10-19'],
    ['2026-10-28', '2026-10-28'],
    ['2026-10-01', '2026-10-28'],
    ['not-a-date', '2026-10-21'],
    ['2026-10-20', ''],
    ['2026-1-1', '2026-10-21'],
  ]) {
    assert.throws(() => filterRadarWindow(data, { kind: 'custom', startDate, endDate }));
  }
});

test('time selection does not mutate the loaded snapshot needed by later selections', () => {
  const data = fixture(
    [
      ['recent', '2026-10-26T00:00:00.000Z'],
      ['older', '2026-08-01T00:00:00.000Z'],
    ],
    [['company', ['recent', 'older']]],
  );
  const before = globalThis.structuredClone(data);
  const freeze = (value) => {
    if (value && typeof value === 'object') {
      Object.values(value).forEach(freeze);
      Object.freeze(value);
    }
    return value;
  };
  freeze(data);
  const narrow = filterRadarWindow(data, { kind: 'days', days: 7 });
  const all = filterRadarWindow(data, { kind: 'all' });
  assert.equal(narrow.recentCount, 1);
  assert.equal(all.recentCount, 2);
  assert.deepEqual(all.topResources[0].signalIds, ['recent', 'older']);
  assert.deepEqual(data, before);
});
