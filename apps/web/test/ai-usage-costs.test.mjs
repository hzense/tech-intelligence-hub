import assert from 'node:assert/strict';
import test from 'node:test';
import { readAiUsageCosts } from '../lib/ai-usage-costs.ts';

const now = new Date('2026-11-02T00:15:00Z');
const owner = 'admin@example.invalid';
const row = (charged = '123', unsettled = '40', month = '456', monthUnsettled = '60') => ({
  today_charged: charged,
  today_unsettled: unsettled,
  month_charged: month,
  month_unsettled: monthUnsettled,
});
function pool(result = row(), failure) {
  const calls = [];
  const releases = [];
  let busy = false;
  return {
    calls,
    releases,
    async connect() {
      assert.equal(busy, false, 'a shared max:1 pool must not be acquired concurrently');
      busy = true;
      return {
        async query(sql, values) {
          calls.push({ sql, values });
          if (sql.startsWith('/* ai-usage:')) {
            if (failure) throw failure;
            return { rows: Array.isArray(result) ? result : [result] };
          }
          return { rows: [] };
        },
        release(destroy) {
          releases.push(destroy);
          busy = false;
        },
      };
    },
  };
}
const allPools = (p) => ({ generation: p, enrichment: p, automation: p, probe: p });

test('summaries expose only safe aggregates, use UTC periods and acquire shared pools sequentially', async () => {
  const p = pool();
  const result = await readAiUsageCosts({ owner, now, pools: allPools(p) });
  assert.equal(result.sampledAt, now.toISOString());
  assert.equal(result.day, '2026-11-02');
  assert.equal(result.month, '2026-11');
  assert.equal(result.status, 'available');
  assert.deepEqual(result.today, { chargedMicrousd: 615, unsettledMicrousd: 200 });
  assert.deepEqual(result.monthToDate, { chargedMicrousd: 2280, unsettledMicrousd: 300 });
  assert.deepEqual(
    result.items.map(({ kind, scope }) => [kind, scope]),
    [
      ['generation', 'owner'],
      ['enrichment', 'owner'],
      ['collection', 'owner'],
      ['insight', 'owner'],
      ['probe', 'site'],
    ],
  );
  assert.doesNotMatch(JSON.stringify(result), /admin@example|owner_id|snapshot|configuration/);
  assert.deepEqual(p.releases, Array(5).fill(false));
  for (let offset = 0; offset < 20; offset += 4) {
    assert.equal(p.calls[offset].sql, 'BEGIN TRANSACTION READ ONLY');
    assert.equal(p.calls[offset + 1].sql, "SET LOCAL statement_timeout = '5000ms'");
    assert.match(p.calls[offset + 2].sql, /COALESCE\(sum\(charged\)/);
    assert.doesNotMatch(p.calls[offset + 2].sql, /deleted_at|\bLIMIT\b|SELECT \*/);
    assert.equal(p.calls[offset + 3].sql, 'COMMIT');
  }
});

test('partial or inaccessible ledgers remain unavailable instead of becoming false zero totals', async () => {
  const good = pool(row('0', '0', '0', '0'));
  const denied = pool(null, new Error('private host password and source contents'));
  const result = await readAiUsageCosts({
    owner,
    now,
    pools: { generation: good, enrichment: denied, probe: good },
  });
  assert.equal(result.status, 'partial');
  assert.deepEqual(result.today, { chargedMicrousd: 0, unsettledMicrousd: 0 });
  assert.deepEqual(
    result.items.filter((item) => item.status === 'unavailable').map((item) => item.kind),
    ['enrichment', 'collection', 'insight'],
  );
  for (const item of result.items.filter((item) => item.status === 'unavailable')) {
    assert.equal(item.today, null);
    assert.equal(item.monthToDate, null);
  }
  assert.equal(denied.calls.at(-1).sql, 'ROLLBACK');
  assert.doesNotMatch(JSON.stringify(result), /private|password|contents/);
  const missing = await readAiUsageCosts({ owner, now, pools: {} });
  assert.equal(missing.status, 'unavailable');
  assert.equal(missing.today, null);
  assert.equal(missing.monthToDate, null);
});

test('month boundaries and owner are bound values while local mock rows and old soft deletions keep their correct scope', async () => {
  const p = pool(row('0', '0', '0', '0'));
  const utcNewMonth = new Date('2026-11-30T23:15:00-01:00');
  const result = await readAiUsageCosts({ owner, now: utcNewMonth, pools: allPools(p) });
  assert.equal(result.day, '2026-12-01');
  assert.equal(result.month, '2026-12');
  const queries = p.calls.filter((call) => call.values);
  assert.equal(queries.length, 5);
  for (const call of queries.slice(0, 4)) {
    assert.deepEqual(call.values, [result.day, '2026-12-01', utcNewMonth.toISOString(), owner]);
    assert.doesNotMatch(call.sql, /admin@example/);
  }
  assert.deepEqual(queries[4].values, [result.day, '2026-12-01', utcNewMonth.toISOString()]);
  assert.match(queries[0].sql, /local-simulation-v1/);
  assert.match(queries[2].sql, /snapshot->>'kind'='source_collection'/);
  assert.match(queries[3].sql, /snapshot->>'kind'='topic_insight'/);
  assert.match(queries[4].sql, /created_at AT TIME ZONE 'UTC'/);
});

test('invalid, rounded or inconsistent aggregate data fails the affected category closed', async () => {
  for (const invalid of [
    row('-1'),
    row(1),
    row('9007199254740992'),
    row('1.5'),
    row('900', '0', '456', '0'),
    row('0', '900', '0', '456'),
    [],
    [row(), row()],
  ]) {
    const p = pool(invalid);
    const result = await readAiUsageCosts({ owner, now, pools: { generation: p } });
    assert.equal(result.status, 'unavailable');
    assert.equal(result.today, null);
    assert.equal(p.calls.at(-1).sql, 'ROLLBACK');
  }
});

test('safe source amounts that overflow the total do not become an imprecise dashboard total', async () => {
  const amount = String(Number.MAX_SAFE_INTEGER);
  const p = pool(row(amount, '0', amount, '0'));
  const result = await readAiUsageCosts({ owner, now, pools: allPools(p) });
  assert.equal(result.status, 'partial');
  assert.ok(result.items.every((item) => item.status === 'available'));
  assert.equal(result.today, null);
  assert.equal(result.monthToDate, null);
});

test('rollback failure destroys the client and missing owner never executes a global query', async () => {
  const calls = [];
  const releases = [];
  const p = {
    async connect() {
      return {
        async query(sql) {
          calls.push(sql);
          if (sql.startsWith('/* ai-usage:') || sql === 'ROLLBACK') throw Error('private');
          return { rows: [] };
        },
        release(destroy) {
          releases.push(destroy);
        },
      };
    },
  };
  await readAiUsageCosts({ owner, now, pools: { generation: p } });
  assert.deepEqual(releases, [true]);
  calls.length = 0;
  const result = await readAiUsageCosts({ owner: '', now, pools: allPools(p) });
  assert.deepEqual(calls, []);
  assert.equal(result.status, 'unavailable');
});
