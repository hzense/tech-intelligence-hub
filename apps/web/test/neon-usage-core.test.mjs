import assert from 'node:assert/strict';
import test from 'node:test';
import {
  appendNeonUsageSample,
  berlinUsageDate,
  berlinUsageMidnight,
  makeNeonUsageDashboard,
  neonUsageDays,
  neonUsageProjectId,
  parseNeonUsageHistory,
  parseNeonUsageSample,
} from '../lib/neon-usage-core.ts';

const projectId = 'synthetic-project-123';
const hour = 3_600_000;
const now = new Date('2026-11-02T12:00:00Z');
function sample(time, bytes, month = '2026-11') {
  const start = new Date(`${month}-01T00:00:00Z`);
  const end = new Date(start);
  end.setUTCMonth(end.getUTCMonth() + 1);
  return {
    sampledAt: new Date(time).toISOString(),
    periodStart: start.toISOString(),
    periodEnd: end.toISOString(),
    bytes,
  };
}
const history = (samples) => ({ version: 1, projectId, samples });
const day = (samples, date, at = now) =>
  neonUsageDays(history(samples), at).find((row) => row.date === date);

test('Neon counters accept only matching project, safe integer bytes and active bounded period', () => {
  const response = {
    project: {
      id: projectId,
      data_transfer_bytes: 123456,
      consumption_period_start: '2026-11-01T01:00:00+01:00',
      consumption_period_end: '2026-12-01T01:00:00+01:00',
      owner: { email: 'private@example.invalid' },
      settings: { password: 'never-save-me' },
    },
  };
  const parsed = parseNeonUsageSample(response, projectId, now);
  assert.deepEqual(parsed, sample(now, 123456));
  assert.doesNotMatch(JSON.stringify(parsed), /owner|email|password|never-save/);
  for (const patch of [
    { id: 'another-project' },
    { data_transfer_bytes: -1 },
    { data_transfer_bytes: 1.5 },
    { data_transfer_bytes: '12' },
    { data_transfer_bytes: Number.MAX_SAFE_INTEGER + 1 },
    { data_transfer_bytes: undefined },
    { consumption_period_start: '2026-12-01T00:00:00Z' },
    { consumption_period_end: '2026-11-02T00:00:00Z' },
    { consumption_period_end: '2027-12-01T00:00:00Z' },
  ]) {
    assert.throws(
      () => parseNeonUsageSample({ project: { ...response.project, ...patch } }, projectId, now),
      { code: 'invalid_metrics' },
    );
  }
  for (const bad of ['../project', 'https://evil.invalid', '', 'A-B', 'a b'])
    assert.equal(neonUsageProjectId(bad), false);
  assert.equal(neonUsageProjectId(projectId), true);
});

test('saved history is project-bound, sorted and redacted rather than accepting arbitrary JSON', () => {
  const a = sample('2026-11-02T10:00:00Z', 10);
  const b = sample('2026-11-02T11:00:00Z', 20);
  const parsed = parseNeonUsageHistory(
    { ...history([{ ...b, secret: 'private' }, a]), secret: 'private' },
    projectId,
  );
  assert.deepEqual(parsed, history([a, b]));
  for (const invalid of [
    null,
    [],
    { ...history([]), version: 2 },
    { ...history([]), projectId: 'wrong-project' },
    history([{ ...a, bytes: -1 }]),
    history(Array.from({ length: 6001 }, () => a)),
  ]) {
    assert.throws(() => parseNeonUsageHistory(invalid, projectId), { code: 'storage_unavailable' });
  }
});

test('no history and one first snapshot never fabricate daily zero or historical data', () => {
  const empty = neonUsageDays(null, now);
  assert.equal(empty.length, 30);
  assert.equal(empty.at(-1).date, '2026-11-02');
  assert.ok(empty.every((row) => row.bytes === null && row.status === 'missing'));
  const first = [sample('2026-11-02T12:00:00Z', 360_690_000)];
  assert.deepEqual(day(first, '2026-11-02'), {
    date: '2026-11-02',
    bytes: null,
    status: 'partial',
    samples: 1,
  });
  const view = makeNeonUsageDashboard({ history: history(first), now, projectId });
  assert.equal(view.totalBytes, 360_690_000);
  assert.equal(view.days.at(-1).bytes, null);
});

test('closed day settles from two midnight counters without hourly samples; today stays pending', () => {
  const start = berlinUsageMidnight('2026-11-02');
  const end = berlinUsageMidnight('2026-11-03');
  const samples = [sample(start, 1000), sample(end, 1325)];
  const settled = day(samples, '2026-11-02', new Date(end));
  assert.equal(settled.status, 'estimated');
  assert.equal(settled.bytes, 325);
  const unchanged = samples.map((s) => ({ ...s, bytes: 1000 }));
  assert.equal(day(unchanged, '2026-11-02', new Date(end)).bytes, 0);
  assert.equal(day(samples, '2026-11-02', new Date(end - 1)).bytes, null);
  assert.equal(day(samples, '2026-11-03', new Date(end + 12 * hour)).bytes, null);
});

test('midnight scheduling delay is bounded and a missing midnight cannot become multi-day usage', () => {
  const start = berlinUsageMidnight('2026-11-02');
  const end = berlinUsageMidnight('2026-11-03');
  const at = new Date(end + 5 * hour);
  assert.equal(day([sample(start + hour, 10), sample(end + hour, 30)], '2026-11-02', at).bytes, 20);
  const delayed = day([sample(start + 2 * hour, 10), sample(end, 30)], '2026-11-02', at);
  assert.equal(delayed.bytes, 20);
  assert.equal(delayed.status, 'partial');
  assert.equal(delayed.from, new Date(start + 2 * hour).toISOString());
  assert.equal(delayed.through, new Date(end).toISOString());
  assert.equal(day([sample(start, 10), sample(end + 2 * hour, 30)], '2026-11-02', at).bytes, 20);
  assert.equal(day([sample(start - 24 * hour, 10), sample(end, 30)], '2026-11-02', at).bytes, null);
});

test('Berlin daily boundaries handle DST days of 23 and 25 hours', () => {
  for (const [date, next, hours, month] of [
    ['2026-03-29', '2026-03-30', 23, '2026-03'],
    ['2026-10-25', '2026-10-26', 25, '2026-10'],
  ]) {
    const start = berlinUsageMidnight(date);
    const end = berlinUsageMidnight(next);
    assert.equal((end - start) / hour, hours);
    const samples = [sample(start, 0, month), sample(end, hours * 100, month)];
    const row = day(samples, date, new Date(end + 4 * hour));
    assert.equal(row.status, 'estimated');
    assert.equal(row.bytes, hours * 100);
  }
  assert.equal(berlinUsageDate(new Date('2026-11-02T23:30:00Z')), '2026-11-03');
});

test('month rollover and decreasing counters are partial and do not subtract across reset', () => {
  const samples = [
    sample('2026-10-31T23:00:00Z', 4000, '2026-10'),
    sample('2026-11-01T00:00:00Z', 10),
    sample('2026-11-01T01:00:00Z', 25),
  ];
  const row = day(samples, '2026-11-01', new Date('2026-11-02T01:00:00Z'));
  assert.equal(row.status, 'partial');
  assert.equal(row.bytes, null);
  assert.equal(
    day(
      [...samples, sample('2026-11-01T23:00:00Z', 50)],
      '2026-11-01',
      new Date('2026-11-02T01:00:00Z'),
    ).bytes,
    null,
  );
  const decreasing = [
    sample('2026-11-01T23:00:00Z', 100),
    sample('2026-11-02T10:00:00Z', 80),
    sample('2026-11-02T23:00:00Z', 100),
  ];
  const closed = new Date('2026-11-03T01:00:00Z');
  assert.equal(day(decreasing, '2026-11-02', closed).status, 'partial');
  assert.equal(day(decreasing, '2026-11-02', closed).bytes, null);
});

test('non-boundary and future observations cannot be turned into a settled daily count', () => {
  const samples = [
    sample('2026-11-01T10:00:00Z', 100),
    sample('2026-11-02T10:00:00Z', 500),
    sample('2026-11-02T11:00:00Z', 520),
    sample('2026-11-03T12:00:00Z', 99999),
  ];
  const row = day(samples, '2026-11-02');
  assert.equal(row.status, 'partial');
  assert.equal(row.bytes, 20);
  assert.equal(row.from, '2026-11-02T10:00:00.000Z');
  assert.equal(row.through, '2026-11-02T11:00:00.000Z');
  const view = makeNeonUsageDashboard({ history: history(samples), now, projectId });
  assert.equal(view.totalBytes, 520);
  assert.equal(view.sampledAt, '2026-11-02T11:00:00.000Z');
});

test('snapshot retention drops old records, deduplicates quarter-hour slots and preserves ordering', () => {
  const prior = history([
    sample('2026-08-01T00:00:00Z', 1, '2026-08'),
    sample('2026-11-02T11:00:00Z', 2),
  ]);
  const appended = appendNeonUsageSample(prior, sample(now, 3));
  assert.equal(appended.samples.length, 2);
  const sameSlot = appendNeonUsageSample(appended, sample('2026-11-02T12:05:00Z', 4));
  assert.equal(sameSlot.samples.length, 2);
  assert.equal(sameSlot.samples.at(-1).bytes, 3);
});

test('quota and freshness remain independent of daily baselines and reset at period expiry', () => {
  const make = (bytes, at = now) =>
    makeNeonUsageDashboard({
      history: history([sample('2026-11-02T12:00:00Z', bytes)]),
      now: at,
      projectId,
      quotaBytes: 1000,
    });
  assert.equal(make(799).alert, 'none');
  assert.equal(make(800).alert, 'warning');
  assert.equal(make(900).alert, 'critical');
  assert.ok(Math.abs(make(1100).quotaPercent - 110) < 0.000001);
  assert.equal(make(500).stale, false);
  assert.equal(make(500, new Date('2026-11-02T16:00:00Z')).stale, false);
  assert.equal(make(500, new Date('2026-11-02T23:30:00Z')).stale, false);
  assert.equal(make(500, new Date('2026-11-03T01:00:00Z')).stale, true);
  const expired = make(900, new Date('2026-12-01T00:00:00Z'));
  assert.equal(expired.totalBytes, null);
  assert.equal(expired.quotaPercent, null);
  assert.equal(expired.alert, 'none');
  const unavailable = makeNeonUsageDashboard({
    history: null,
    now,
    projectId: null,
    missing: ['HZENSE_NEON_API_KEY'],
    error: 'not_configured',
  });
  assert.equal(unavailable.configured, false);
  assert.equal(unavailable.available, false);
});

test('cost snapshots survive history reads, expire with the billing period and never fall back to an older price', () => {
  const costs = {
    status: 'free',
    plan: 'free',
    from: null,
    through: null,
    totalMicrousd: 0,
    items: [],
    reason: null,
    pricingVersion: '2026-11-02',
  };
  const stored = history([{ ...sample(now, 123), costs: { ...costs, secret: 'redact-me' } }]);
  const parsed = parseNeonUsageHistory(stored, projectId);
  assert.deepEqual(parsed.samples[0].costs, costs);
  const dashboard = makeNeonUsageDashboard({ history: parsed, now, projectId });
  assert.deepEqual(dashboard.costs, costs);
  assert.equal(dashboard.costSampledAt, now.toISOString());
  const later = appendNeonUsageSample(parsed, sample('2026-11-02T13:00:00Z', 124));
  const noCost = makeNeonUsageDashboard({
    history: later,
    now: new Date('2026-11-02T13:00:00Z'),
    projectId,
  });
  assert.equal(noCost.costs, null);
  assert.equal(noCost.costSampledAt, null);
  const expired = makeNeonUsageDashboard({
    history: parsed,
    now: new Date('2026-12-01T01:00:00Z'),
    projectId,
  });
  assert.equal(expired.costs, null);
  assert.equal(expired.costSampledAt, null);
  assert.throws(
    () =>
      parseNeonUsageHistory(
        history([{ ...sample(now, 1), costs: { ...costs, totalMicrousd: -1 } }]),
        projectId,
      ),
    { code: 'storage_unavailable' },
  );
});
