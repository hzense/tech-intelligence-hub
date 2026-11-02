import assert from 'node:assert/strict';
import test from 'node:test';
import { fetchNeonUsageCosts, parseNeonUsageCosts } from '../lib/neon-usage-costs.ts';

const { Response, structuredClone, URL, AbortSignal } = globalThis;
const projectId = 'synthetic-project';
const orgId = 'org-synthetic';
const apiKey = 'synthetic-key-never-persist';
const options = {
  projectId,
  orgId,
  apiKey,
  periodStart: '2026-11-01T00:00:00Z',
  periodEnd: '2026-12-01T00:00:00Z',
  now: new Date('2026-11-03T12:24:00Z'),
};
const metric = (metric_name, value) => ({ metric_name, value });
const frame = (date, values = []) => ({
  timeframe_start: `2026-11-${date}T00:00:00Z`,
  timeframe_end: `2026-11-${String(Number(date) + 1).padStart(2, '0')}T00:00:00Z`,
  metrics: values,
});
const fixture = (plan = 'launch') => ({
  projects: [
    {
      project_id: projectId,
      periods: [
        {
          period_id: 'private-period-id',
          period_plan: plan,
          period_start: options.periodStart,
          consumption: [
            frame('01', [
              metric('compute_unit_seconds', 3600),
              metric('root_branch_bytes_month', 1e9),
              metric('child_branch_bytes_month', 0.5e9),
              metric('instant_restore_bytes_month', 2e9),
              metric('snapshot_storage_bytes_month', 0.1e9),
              metric('public_network_transfer_bytes', 300e9),
              metric('extra_branches_month', plan === 'launch' ? 288 : 600),
              ...(plan === 'scale' ? [metric('private_network_transfer_bytes', 123e9)] : []),
            ]),
            frame('02', [
              metric('compute_unit_seconds', 7200),
              metric('root_branch_bytes_month', 0.5e9),
              metric('child_branch_bytes_month', 0.5e9),
              metric('instant_restore_bytes_month', 1e9),
              metric('snapshot_storage_bytes_month', 0.2e9),
              metric('public_network_transfer_bytes', 250e9),
            ]),
          ],
        },
      ],
    },
  ],
  pagination: { cursor: projectId },
});
function provider(plan = 'launch', data = fixture(plan), organization = {}) {
  const calls = [];
  return {
    calls,
    fetcher: async (url, request) => {
      calls.push({ url: new URL(url), request });
      return Response.json(
        calls.length === 1 ? { id: orgId, plan, owner: 'private-owner', ...organization } : data,
      );
    },
  };
}
const period = (data) => data.projects[0].periods[0];
const itemMap = (costs) =>
  Object.fromEntries(costs.items.map((item) => [item.kind, item.microusd]));

test('Launch uses documented units, monthly project transfer allowance and per-day branch allowance', async () => {
  const mock = provider();
  const costs = await fetchNeonUsageCosts({ ...options, fetcher: mock.fetcher });
  assert.equal(costs.status, 'estimated');
  assert.equal(costs.plan, 'launch');
  assert.equal(costs.from, '2026-11-01T00:00:00.000Z');
  assert.equal(costs.through, '2026-11-03T00:00:00.000Z');
  assert.equal(costs.pricingVersion, '2026-11-02');
  assert.deepEqual(itemMap(costs), {
    compute: 318000,
    storage: 875000,
    history: 600000,
    snapshots: 27000,
    publicTransfer: 5000000,
    privateTransfer: 0,
    branches: 145161,
  });
  assert.equal(costs.totalMicrousd, 6965161);
  assert.equal(costs.reason, null);
  assert.equal(mock.calls.length, 2);
  for (const { url, request } of mock.calls) {
    assert.equal(url.origin, 'https://console.neon.tech');
    assert.equal(request.method, 'GET');
    assert.equal(request.redirect, 'error');
    assert.equal(request.cache, 'no-store');
    assert.equal(request.headers.Authorization, `Bearer ${apiKey}`);
    assert.ok(request.signal instanceof AbortSignal);
  }
  assert.equal(mock.calls[0].url.pathname, `/api/v2/organizations/${orgId}`);
  const query = mock.calls[1].url.searchParams;
  assert.equal(mock.calls[1].url.pathname, '/api/v2/consumption_history/v2/projects');
  assert.equal(query.get('org_id'), orgId);
  assert.equal(query.get('project_ids'), projectId);
  assert.equal(query.get('limit'), '1');
  assert.equal(query.get('granularity'), 'daily');
  assert.equal(query.get('from'), costs.from);
  assert.equal(query.get('to'), costs.through);
  assert.equal(query.get('metrics').split(',').length, 8);
  assert.doesNotMatch(JSON.stringify(costs), /private-owner|private-period-id|synthetic-key/);
});

test('Scale uses Scale compute, private traffic and 24 included child branches', async () => {
  const mock = provider('scale');
  const costs = await fetchNeonUsageCosts({ ...options, fetcher: mock.fetcher });
  assert.equal(costs.status, 'estimated');
  assert.equal(costs.totalMicrousd, 8446387);
  assert.equal(itemMap(costs).compute, 666000);
  assert.equal(itemMap(costs).privateTransfer, 1230000);
  assert.equal(itemMap(costs).branches, 48387);
});

test('zero metric omissions are permitted, but missing days cannot become zero charges', async () => {
  const data = fixture();
  period(data).consumption = [frame('02'), frame('01')];
  let mock = provider('launch', data);
  const zero = await fetchNeonUsageCosts({ ...options, fetcher: mock.fetcher });
  assert.equal(zero.status, 'estimated');
  assert.equal(zero.totalMicrousd, 0);
  assert.equal(zero.items.length, 7);
  period(data).consumption.pop();
  mock = provider('launch', data);
  const missing = await fetchNeonUsageCosts({ ...options, fetcher: mock.fetcher });
  assert.equal(missing.status, 'unavailable');
  assert.equal(missing.reason, 'incomplete_period');
  assert.equal(missing.totalMicrousd, null);
});

test('rounding happens once per category after summing daily fractional usage', async () => {
  const data = fixture();
  period(data).consumption = [
    frame('01', [metric('compute_unit_seconds', 0.018)]),
    frame('02', [metric('compute_unit_seconds', 0.018)]),
  ];
  const mock = provider('launch', data);
  const costs = await fetchNeonUsageCosts({ ...options, fetcher: mock.fetcher });
  assert.equal(costs.totalMicrousd, 1);
  assert.equal(itemMap(costs).compute, 1);
});

test('Free reports current plan zero without calling paid consumption history', async () => {
  const mock = provider('free');
  const costs = await fetchNeonUsageCosts({ ...options, fetcher: mock.fetcher });
  assert.deepEqual(costs, {
    status: 'free',
    plan: 'free',
    from: null,
    through: null,
    totalMicrousd: 0,
    items: [],
    reason: null,
    pricingVersion: '2026-11-02',
  });
  assert.equal(mock.calls.length, 1);
});

test('unknown organization or plan produces unavailable rather than fake zero', async () => {
  for (const invalidOrg of [
    undefined,
    null,
    '',
    'a'.repeat(61),
    '../other',
    'org_with_underscore',
  ]) {
    const mock = provider();
    const costs = await fetchNeonUsageCosts({
      ...options,
      orgId: invalidOrg,
      fetcher: mock.fetcher,
    });
    assert.equal(costs.reason, 'missing_org');
    assert.equal(costs.totalMicrousd, null);
    assert.equal(mock.calls.length, 0);
  }
  for (const plan of ['agent', 'enterprise', 'business', 'scale_v3', null]) {
    const mock = provider(plan);
    const costs = await fetchNeonUsageCosts({ ...options, fetcher: mock.fetcher });
    assert.equal(costs.reason, 'unsupported_plan');
    assert.equal(costs.totalMicrousd, null);
    assert.equal(mock.calls.length, 1);
  }
  const nonPrefixed = provider('free', undefined, { id: 'example-123' });
  assert.equal(
    (await fetchNeonUsageCosts({ ...options, orgId: 'example-123', fetcher: nonPrefixed.fetcher }))
      .status,
    'free',
  );
});

test('only completed UTC days are queried and partial billing starts cannot reset the free allowance', async () => {
  for (const [change, reason] of [
    [{ now: new Date('2026-11-01T23:59:59Z') }, 'waiting_data'],
    [{ periodStart: '2026-11-01T01:00:00Z' }, 'incomplete_period'],
    [{ periodEnd: '2026-11-02T00:00:00Z' }, 'invalid_metrics'],
    [{ periodStart: '2026-11-04T00:00:00Z' }, 'invalid_metrics'],
    [{ now: new Date('invalid') }, 'invalid_metrics'],
  ]) {
    const mock = provider();
    const costs = await fetchNeonUsageCosts({ ...options, ...change, fetcher: mock.fetcher });
    assert.equal(costs.reason, reason);
    assert.equal(costs.totalMicrousd, null);
    assert.equal(mock.calls.length, 1);
  }
  const data = fixture();
  period(data).period_start = '2026-10-31T18:00:00Z';
  const mock = provider('launch', data);
  const costs = await fetchNeonUsageCosts({
    ...options,
    fetcher: mock.fetcher,
  });
  assert.equal(costs.status, 'estimated');
  assert.equal(costs.from, '2026-11-01T00:00:00.000Z');
  assert.equal(costs.through, '2026-11-03T00:00:00.000Z');
  assert.equal(mock.calls[1].url.searchParams.get('from'), costs.from);
});

test('wrong project, mixed plans, overlapping frames and unsafe metrics fail closed', async () => {
  const cases = [
    [(data) => (data.projects[0].project_id = 'wrong-project'), 'invalid_metrics'],
    [(data) => data.projects.push(structuredClone(data.projects[0])), 'invalid_metrics'],
    [(data) => (period(data).period_plan = 'scale'), 'unsupported_plan'],
    [(data) => (period(data).period_start = '2026-11-02T00:00:00Z'), 'unsupported_plan'],
    [
      (data) => period(data).consumption.push(structuredClone(period(data).consumption[0])),
      'invalid_metrics',
    ],
    [(data) => period(data).consumption.push(frame('03')), 'invalid_metrics'],
    [
      (data) => (period(data).consumption[0].timeframe_end = '2026-11-01T23:00:00Z'),
      'invalid_metrics',
    ],
    [(data) => (period(data).consumption[0].metrics = [metric('unknown', 1)]), 'invalid_metrics'],
    [
      (data) =>
        (period(data).consumption[0].metrics = [
          metric('compute_unit_seconds', 1),
          metric('compute_unit_seconds', 1),
        ]),
      'invalid_metrics',
    ],
    [
      (data) => (period(data).consumption[0].metrics = [metric('compute_unit_seconds', -1)]),
      'invalid_metrics',
    ],
    [
      (data) => (period(data).consumption[0].metrics = [metric('compute_unit_seconds', '1')]),
      'invalid_metrics',
    ],
    [
      (data) =>
        (period(data).consumption[0].metrics = [
          metric('compute_unit_seconds', Number.MAX_SAFE_INTEGER + 1),
        ]),
      'invalid_metrics',
    ],
    [
      (data) =>
        (period(data).consumption[0].metrics = [metric('private_network_transfer_bytes', 1)]),
      'invalid_metrics',
    ],
    [(data) => (period(data).consumption = []), 'incomplete_period'],
  ];
  for (const [mutate, reason] of cases) {
    const data = fixture();
    mutate(data);
    const mock = provider('launch', data);
    const costs = await fetchNeonUsageCosts({ ...options, fetcher: mock.fetcher });
    assert.equal(costs.status, 'unavailable');
    assert.equal(costs.reason, reason);
    assert.equal(costs.totalMicrousd, null);
    assert.deepEqual(costs.items, []);
  }
});

test('provider failures and oversized or malformed JSON never leak raw errors', async () => {
  for (const status of [301, 401, 403, 404, 429, 500]) {
    const costs = await fetchNeonUsageCosts({
      ...options,
      fetcher: async () => new Response(`secret ${apiKey}`, { status }),
    });
    assert.equal(costs.reason, 'provider_unavailable');
    assert.doesNotMatch(JSON.stringify(costs), /synthetic-key|secret/);
  }
  for (const body of [
    'not-json',
    'x'.repeat(524289),
    JSON.stringify({ id: 'wrong', plan: 'free' }),
  ]) {
    const costs = await fetchNeonUsageCosts({
      ...options,
      fetcher: async () => new Response(body),
    });
    assert.equal(costs.reason, 'invalid_metrics');
  }
  const costs = await fetchNeonUsageCosts({
    ...options,
    fetcher: async () => {
      throw new Error(apiKey);
    },
  });
  assert.equal(costs.reason, 'provider_unavailable');
  assert.doesNotMatch(JSON.stringify(costs), /synthetic-key/);
});

test('request and body share a six-second deadline even if fetch ignores abort', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let signal;
  const pending = fetchNeonUsageCosts({
    ...options,
    fetcher: async (_url, request) => {
      signal = request.signal;
      return new Promise(() => {});
    },
  });
  t.mock.timers.tick(6000);
  const costs = await pending;
  assert.equal(signal.aborted, true);
  assert.equal(costs.reason, 'provider_unavailable');
});

test('persisted cost parser validates consistency and whitelists a bounded output', async () => {
  const mock = provider();
  const costs = await fetchNeonUsageCosts({ ...options, fetcher: mock.fetcher });
  assert.deepEqual(parseNeonUsageCosts({ ...costs, secret: apiKey }), costs);
  assert.ok(JSON.stringify(costs).length < 2048);
  for (const change of [
    { totalMicrousd: 1 },
    { items: [...costs.items, costs.items[0]] },
    { items: costs.items.slice(1) },
    { pricingVersion: 'future' },
    { reason: 'provider_unavailable' },
    { plan: 'free' },
    { from: '2026-11-01T01:00:00Z' },
    { through: '2026-11-01T00:00:00Z' },
    { items: [{ ...costs.items[0], microusd: -1 }, ...costs.items.slice(1)] },
    { items: [{ ...costs.items[0], microusd: 0.1 }, ...costs.items.slice(1)] },
  ])
    assert.throws(() => parseNeonUsageCosts({ ...costs, ...change }), {
      message: 'invalid_metrics',
    });
  for (const value of [undefined, null, [], {}, { pricingVersion: '2026-11-02', items: [] }])
    assert.throws(() => parseNeonUsageCosts(value), { message: 'invalid_metrics' });
});
