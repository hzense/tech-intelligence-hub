import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import process from 'node:process';
import test from 'node:test';
import { URL } from 'node:url';
import pg from 'pg';
import { readAiUsageCosts } from '../lib/ai-usage-costs.ts';
import { validateConnectionTarget } from '../../../packages/database/src/connection-policy.mjs';

const adminUrl = process.env.AI_USAGE_COSTS_TEST_ADMIN_URL;
const owner = 'synthetic-owner-a';
const now = new Date('2026-11-02T10:00:00.000Z');
const today = '2026-11-02';
const amount = (chargedMicrousd, unsettledMicrousd = 0) => ({
  chargedMicrousd,
  unsettledMicrousd,
});
const tables = [
  'signal_generation_runs',
  'candidate_enrichment_runs',
  'automation_runs',
  'ai_probe_runs',
];

function assertDisposableCluster(identity, environment = process.env) {
  assert.equal(identity.database, 'postgres');
  assert.equal(identity.role, 'postgres');
  const dedicated = identity.cluster === 'hzense-ai-usage-test';
  const isolatedCI =
    identity.cluster === '' &&
    environment.CI === 'true' &&
    environment.RUNTIME_READER_TEST_ISOLATED_CLUSTER === '1';
  assert.ok(dedicated || isolatedCI, 'Only an explicitly isolated disposable cluster is allowed');
}

test('PostgreSQL integration guard accepts unnamed CI clusters only with both isolation flags', () => {
  const identity = { database: 'postgres', role: 'postgres', cluster: '' };
  const environment = { CI: 'true', RUNTIME_READER_TEST_ISOLATED_CLUSTER: '1' };
  assert.doesNotThrow(() => assertDisposableCluster(identity, environment));
  assert.doesNotThrow(() =>
    assertDisposableCluster({ ...identity, cluster: 'hzense-ai-usage-test' }, {}),
  );
  for (const invalid of [
    {},
    { CI: 'true' },
    { RUNTIME_READER_TEST_ISOLATED_CLUSTER: '1' },
    { CI: 'false', RUNTIME_READER_TEST_ISOLATED_CLUSTER: '1' },
    { CI: 'true', RUNTIME_READER_TEST_ISOLATED_CLUSTER: 'true' },
  ])
    assert.throws(() => assertDisposableCluster(identity, invalid));
  for (const patch of [
    { cluster: 'existing-user-cluster' },
    { database: 'hzense_local' },
    { role: 'hzense_runtime' },
  ])
    assert.throws(() => assertDisposableCluster({ ...identity, ...patch }, environment));
});

test(
  'AI accounting queries run against an isolated PostgreSQL cluster with real date, JSONB and permission semantics',
  { skip: !adminUrl },
  async (t) => {
    validateConnectionTarget({ connectionString: adminUrl, profile: 'local-test' });
    const administrator = new pg.Client({ connectionString: adminUrl });
    const suffix = randomUUID().replaceAll('-', '');
    const database = `hzense_ai_usage_${suffix}`;
    const reader = `hzense_ai_usage_reader_${suffix}`;
    let created = false;
    let roleCreated = false;
    let pool;
    let restricted;
    let inspectedQueries = 0;
    await administrator.connect();
    try {
      assertDisposableCluster(
        (
          await administrator.query(
            "SELECT current_database() AS database,session_user AS role,current_setting('cluster_name') AS cluster",
          )
        ).rows[0],
      );
      assert.equal(
        (
          await administrator.query(
            "SELECT datname FROM pg_database WHERE NOT datistemplate AND datname<>'postgres'",
          )
        ).rowCount,
        0,
        'Existing user databases must never be used by this integration test',
      );
      await administrator.query(`CREATE DATABASE "${database}" TEMPLATE template0`);
      created = true;
      const target = new URL(adminUrl);
      target.pathname = `/${database}`;
      pool = new pg.Pool({ connectionString: target.href, max: 1 });
      await pool.query(`
        CREATE TABLE public.signal_generation_runs (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(), owner_id text NOT NULL,
          budget_day date, status text NOT NULL, reserved_microusd bigint NOT NULL,
          charged_microusd bigint NOT NULL, generation_version text NOT NULL,
          deleted_at timestamptz
        );
        CREATE TABLE public.candidate_enrichment_runs (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(), owner_id text NOT NULL,
          budget_day date, status text NOT NULL, reserved_microusd bigint NOT NULL,
          charged_microusd bigint NOT NULL
        );
        CREATE TABLE public.automation_runs (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(), owner_id text NOT NULL,
          budget_day date, status text NOT NULL, reserved_microusd bigint NOT NULL,
          charged_microusd bigint NOT NULL, cost_source text, snapshot jsonb NOT NULL,
          result jsonb, phase text NOT NULL, lease_token uuid, lease_until timestamptz,
          finished_at timestamptz
        );
        CREATE TABLE public.ai_probe_runs (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(), created_at timestamptz NOT NULL,
          status text NOT NULL, reserved_microusd bigint NOT NULL,
          charged_microusd bigint NOT NULL, result jsonb NOT NULL DEFAULT '{}'
        );
      `);
      const checkedPool = {
        async connect() {
          const client = await pool.connect();
          return {
            async query(text, values) {
              if (text.startsWith('/* ai-usage:')) {
                assert.equal(
                  (await client.query('SHOW transaction_read_only')).rows[0].transaction_read_only,
                  'on',
                );
                assert.equal(
                  (await client.query('SHOW statement_timeout')).rows[0].statement_timeout,
                  '5s',
                );
                inspectedQueries++;
              }
              return client.query(text, values);
            },
            release: (destroy) => client.release(destroy),
          };
        },
      };
      const pools = {
        generation: checkedPool,
        enrichment: checkedPool,
        automation: checkedPool,
        probe: checkedPool,
      };
      const read = (overrides = {}) => readAiUsageCosts({ owner, now, pools, ...overrides });
      const insert = async (table, values) => {
        assert.ok(tables.includes(table));
        const columns = Object.keys(values);
        assert.ok(columns.every((column) => /^[a-z_]+$/.test(column)));
        await pool.query(
          `INSERT INTO public.${table} (${columns.join(',')}) VALUES (${columns.map((_, i) => `$${i + 1}`).join(',')})`,
          Object.values(values),
        );
      };
      const generation = (values = {}) =>
        insert('signal_generation_runs', {
          owner_id: owner,
          budget_day: today,
          status: 'completed',
          reserved_microusd: 1000,
          charged_microusd: 100,
          generation_version: 'signal-generation-v1',
          ...values,
        });
      const enrichment = (values = {}) =>
        insert('candidate_enrichment_runs', {
          owner_id: owner,
          budget_day: today,
          status: 'completed',
          reserved_microusd: 1000,
          charged_microusd: 200,
          ...values,
        });
      const automation = (values = {}) =>
        insert('automation_runs', {
          owner_id: owner,
          budget_day: today,
          status: 'completed',
          reserved_microusd: 1000,
          charged_microusd: 300,
          cost_source: 'provider',
          snapshot: { kind: 'source_collection' },
          result: {},
          phase: 'completed',
          lease_token: null,
          lease_until: null,
          finished_at: now,
          ...values,
        });
      const probe = (values = {}) =>
        insert('ai_probe_runs', {
          created_at: now,
          status: 'succeeded',
          reserved_microusd: 1000,
          charged_microusd: 400,
          result: {},
          ...values,
        });
      const clear = () =>
        pool.query(`TRUNCATE ${tables.map((table) => `public.${table}`).join(',')}`);
      const find = (result, kind) => {
        const item = result.items.find((value) => value.kind === kind);
        assert.ok(item, `${kind} summary exists`);
        return item;
      };

      await t.test(
        'empty configured ledgers produce observed zero in a read-only transaction',
        async () => {
          const result = await read();
          assert.equal(result.status, 'available');
          assert.equal(result.day, today);
          assert.equal(result.month, '2026-11');
          assert.deepEqual(result.today, amount(0));
          assert.deepEqual(result.monthToDate, amount(0));
          assert.equal(result.items.length, 5);
          assert.equal(inspectedQueries, 5);
        },
      );

      await t.test(
        'owner, UTC date and month filters preserve deleted real charges while excluding simulation',
        async () => {
          await clear();
          await generation({ deleted_at: now });
          await generation({ status: 'failed', charged_microusd: 20 });
          await generation({ budget_day: '2026-11-01', charged_microusd: 50 });
          await generation({ budget_day: '2026-10-31', charged_microusd: 90000 });
          await generation({ budget_day: '2026-11-03', charged_microusd: 90000 });
          await generation({ owner_id: 'synthetic-owner-b', charged_microusd: 90000 });
          await generation({ generation_version: 'local-simulation-v1', charged_microusd: 90000 });
          await generation({
            generation_version: `local-simulation-v1/retry/${randomUUID()}`,
            charged_microusd: 90000,
          });
          await enrichment();
          await enrichment({ owner_id: 'synthetic-owner-b', charged_microusd: 90000 });
          await automation();
          await automation({ snapshot: { kind: 'topic_insight' }, charged_microusd: 600 });
          await automation({ owner_id: 'synthetic-owner-b', charged_microusd: 90000 });
          await probe();
          await probe({ created_at: '2026-11-01T23:59:59.999Z', charged_microusd: 40 });
          await probe({ created_at: '2026-10-31T23:59:59.999Z', charged_microusd: 90000 });
          await probe({ created_at: '2026-11-02T10:00:00.001Z', charged_microusd: 90000 });
          const result = await read();
          assert.equal(result.status, 'available');
          assert.deepEqual(find(result, 'generation').today, amount(120));
          assert.deepEqual(find(result, 'generation').monthToDate, amount(170));
          assert.deepEqual(find(result, 'enrichment').today, amount(200));
          assert.deepEqual(find(result, 'collection').today, amount(300));
          assert.deepEqual(find(result, 'insight').today, amount(600));
          assert.deepEqual(find(result, 'probe').today, amount(400));
          assert.deepEqual(find(result, 'probe').monthToDate, amount(440));
          assert.equal(find(result, 'probe').scope, 'site');
          assert.deepEqual(result.today, amount(1620));
          assert.deepEqual(result.monthToDate, amount(1710));
          const stranger = await read({ owner: "synthetic-owner-a' OR true --" });
          assert.deepEqual(find(stranger, 'generation').today, amount(0));
          assert.deepEqual(find(stranger, 'enrichment').today, amount(0));
          assert.deepEqual(find(stranger, 'collection').today, amount(0));
          assert.deepEqual(find(stranger, 'insight').today, amount(0));
          assert.deepEqual(find(stranger, 'probe').today, amount(400));
        },
      );

      await t.test(
        'reservations and legacy copied charges stay separate until a finishing path settles them',
        async () => {
          await clear();
          await generation({ status: 'unknown', reserved_microusd: 500, charged_microusd: 500 });
          await generation({ status: 'running', reserved_microusd: 300, charged_microusd: 0 });
          await generation({ status: 'cancelled', reserved_microusd: 0, charged_microusd: 0 });
          await enrichment({ status: 'pending', reserved_microusd: 200, charged_microusd: 0 });
          await automation({ status: 'failed', cost_source: 'reserve', charged_microusd: 1000 });
          await automation({ status: 'unknown', phase: 'discovery', charged_microusd: 700 });
          await automation({
            status: 'completed',
            snapshot: { kind: 'topic_insight' },
            cost_source: 'estimate',
            charged_microusd: 50,
          });
          await probe({ status: 'running', charged_microusd: 1000 });
          await probe({ status: 'stale', charged_microusd: 1000 });
          await probe({
            status: 'stale',
            charged_microusd: 25,
            result: { accounting: { version: 1, source: 'provider' } },
          });
          await probe({
            status: 'stale',
            charged_microusd: 1000,
            result: { accounting: { version: 1, source: 'provider', unverified: true } },
          });
          const result = await read();
          assert.equal(result.status, 'available');
          assert.deepEqual(find(result, 'generation').today, amount(0, 800));
          assert.deepEqual(find(result, 'enrichment').today, amount(0, 200));
          assert.deepEqual(find(result, 'collection').today, amount(0, 2000));
          assert.deepEqual(find(result, 'insight').today, amount(50));
          assert.deepEqual(find(result, 'probe').today, amount(25, 3000));
          assert.deepEqual(result.today, amount(75, 6000));
        },
      );

      await t.test(
        'unknown discovery is settled only with the complete typed provider receipt boundary',
        async () => {
          await clear();
          const receipt = {
            status: 'unknown',
            phase: 'source_failed',
            snapshot: { kind: 'source_collection', discovery: {} },
            cost_source: 'provider',
            charged_microusd: 15,
            result: { discoveryCostSource: 'provider', discoveryCostMicrousd: 15 },
          };
          await automation(receipt);
          await automation({
            ...receipt,
            result: { discoveryCostSource: 'provider', discoveryCostMicrousd: '15' },
          });
          await automation({ ...receipt, lease_token: randomUUID() });
          await automation({ ...receipt, finished_at: null });
          await automation({ ...receipt, snapshot: { kind: 'source_collection' } });
          const result = await read();
          assert.deepEqual(find(result, 'collection').today, amount(15, 4000));
          assert.deepEqual(result.today, amount(15, 4000));
        },
      );

      await t.test(
        'one denied ledger yields partial known totals without leaking SQL or blocking other categories',
        async () => {
          await clear();
          await generation();
          await enrichment();
          await probe();
          await administrator.query(`CREATE ROLE "${reader}" NOLOGIN`);
          roleCreated = true;
          await pool.query(
            `GRANT SELECT ON public.signal_generation_runs,public.automation_runs,public.ai_probe_runs TO "${reader}"`,
          );
          restricted = new pg.Pool({
            connectionString: target.href,
            options: `-c role=${reader}`,
            max: 1,
          });
          const result = await read({
            pools: {
              generation: restricted,
              enrichment: restricted,
              automation: restricted,
              probe: restricted,
            },
          });
          assert.equal(result.status, 'partial');
          assert.equal(find(result, 'enrichment').status, 'unavailable');
          assert.equal(find(result, 'enrichment').today, null);
          assert.equal(find(result, 'generation').status, 'available');
          assert.equal(find(result, 'collection').status, 'available');
          assert.equal(find(result, 'insight').status, 'available');
          assert.equal(find(result, 'probe').status, 'available');
          assert.deepEqual(result.today, amount(500));
          assert.deepEqual(result.monthToDate, amount(500));
          assert.doesNotMatch(
            JSON.stringify(result),
            /permission denied|candidate_enrichment_runs|SELECT|postgres:/,
          );
        },
      );
    } finally {
      await restricted?.end();
      await pool?.end();
      if (created) await administrator.query(`DROP DATABASE "${database}"`);
      if (roleCreated) await administrator.query(`DROP ROLE "${reader}"`);
      await administrator.end();
    }
  },
);
