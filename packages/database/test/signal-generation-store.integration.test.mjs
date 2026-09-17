import { readFile } from 'node:fs/promises';
import process from 'node:process';
import { randomUUID } from 'node:crypto';
import { URL } from 'node:url';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { validateConnectionTarget } from '../src/connection-policy.mjs';
import {
  createSignalGeneration,
  getSignalGeneration,
  listSignalGenerations,
  claimSignalGeneration,
  finishSignalGeneration,
  cancelSignalGeneration,
  signalGenerationSourceHash,
} from '../src/signal-generation-store.mjs';
import { signalGenerationChecks } from '../src/signal-generation-catalog.mjs';
import { canonicalPublicationControlCheck } from '../src/signal-publication-control-catalog.mjs';
import {
  assertGenerationRole,
  signalGenerationRoleColumns,
} from '../src/signal-generation-role.mjs';

const adminUrl = process.env.MIGRATION_TEST_ADMIN_URL;
if (adminUrl) validateConnectionTarget({ connectionString: adminUrl, profile: 'local-test' });
const suite = adminUrl ? describe.sequential : describe.skip;
const name = `hzense_generation_${process.pid}_${Date.now()}`;
const owner = 'test-generation-owner';
let admin, pool, rolePool;
const ddl = await readFile(
  new URL('../../../db/migrations/0015_signal_generation.sql', import.meta.url),
  'utf8',
);
function input(overrides = {}) {
  const source = {
    classification: 'private',
    fragments: [{ index: 0, text: 'Synthetic source', locator: { paragraph: 1 } }],
    warnings: [],
  };
  const connection = {
    id: randomUUID(),
    revision: 1,
    protocol: 'openai-compatible',
    base_url: 'https://provider.example/v1',
    settings: {},
  };
  const profile = {
    id: randomUUID(),
    revision: 1,
    stages: { extract: { connection_id: connection.id, connection_revision: 1 } },
  };
  return {
    pool,
    owner,
    request: {
      id: randomUUID(),
      batchId: randomUUID(),
      itemId: randomUUID(),
      sourceFence: 1,
      sourceHash: signalGenerationSourceHash(source),
      profileId: profile.id,
      profileRevision: 1,
    },
    snapshot: { source, profile, connection },
    configuration: {
      version: 'test-v1',
      reserveMicrousd: 10,
      batchLimitMicrousd: 100,
      dailyLimitMicrousd: 100,
    },
    ...overrides,
  };
}
const args = (run) => ({
  pool,
  owner,
  id: run.id,
  currentLimits: { batchLimitMicrousd: 100, dailyLimitMicrousd: 100 },
});
const result = {
  classification: 'private',
  candidates: [{ title: 'Synthetic candidate' }],
  usage: { input_tokens: 1, output_tokens: 1 },
};
async function claimed(value = input()) {
  const run = await createSignalGeneration(value);
  return (await claimSignalGeneration(args(run))).run;
}
function uncertainCommit(basePool) {
  return {
    connect: async () => {
      const client = await basePool.connect();
      return {
        query: async (text, values) => {
          const answer = await client.query(text, values);
          if (text === 'COMMIT') throw new Error('synthetic lost commit reply');
          return answer;
        },
        release: () => client.release(),
      };
    },
  };
}
suite('private AI generation PostgreSQL ledger', () => {
  beforeAll(async () => {
    admin = new pg.Client({ connectionString: adminUrl });
    await admin.connect();
    await admin.query(`CREATE DATABASE "${name}" TEMPLATE template0 ENCODING 'UTF8'`);
    const url = new URL(adminUrl);
    url.pathname = `/${name}`;
    pool = new pg.Pool({ connectionString: url.toString(), max: 5 });
    await pool.query(ddl);
  });
  beforeEach(async () => {
    await pool.query('TRUNCATE public.signal_generation_runs');
  });
  afterAll(async () => {
    await rolePool?.end();
    await pool?.end();
    if (admin) {
      await admin.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
      await admin.query('DROP ROLE IF EXISTS hzense_generation_admin');
      await admin.end();
    }
  });
  it('matches real PostgreSQL CHECK expressions to the independent catalog', async () => {
    const rows = (
      await pool.query(
        "SELECT pg_get_constraintdef(oid,false) AS definition FROM pg_constraint WHERE conrelid='public.signal_generation_runs'::regclass AND contype='c'",
      )
    ).rows;
    expect(rows).toHaveLength(signalGenerationChecks.signal_generation_runs.length);
    for (const alternatives of signalGenerationChecks.signal_generation_runs)
      expect(
        rows.some((r) => alternatives.includes(canonicalPublicationControlCheck(r.definition))),
      ).toBe(true);
  });
  it('deduplicates identical source/profile with concurrent different UUIDs', async () => {
    const first = input();
    const second = { ...first, request: { ...first.request, id: randomUUID() } };
    const [a, b] = await Promise.all([
      createSignalGeneration(first),
      createSignalGeneration(second),
    ]);
    expect(a.id).toBe(b.id);
    const claims = await Promise.all([
      claimSignalGeneration(args(a)),
      claimSignalGeneration(args(a)),
    ]);
    expect(claims.filter((entry) => entry.claimed)).toHaveLength(1);
    expect(
      (await pool.query('SELECT count(*)::int AS n FROM public.signal_generation_runs')).rows[0].n,
    ).toBe(1);
  });
  it('binds request UUID and every read/cancel/claim to the authenticated owner', async () => {
    const value = input();
    const row = await createSignalGeneration(value);
    await expect(createSignalGeneration({ ...value, owner: 'another' })).rejects.toMatchObject({
      code: 'request_id_conflict',
    });
    for (const operation of [getSignalGeneration, claimSignalGeneration, cancelSignalGeneration])
      await expect(operation({ ...args(row), owner: 'another' })).rejects.toMatchObject({
        code: 'not_found',
      });
    expect(await listSignalGenerations({ pool, owner: 'another' })).toEqual([]);
  });
  it('refuses changed request snapshot under the same source/profile identity', async () => {
    const value = input();
    await createSignalGeneration(value);
    value.request.id = randomUUID();
    value.configuration.dailyLimitMicrousd = 200;
    await expect(createSignalGeneration(value)).rejects.toMatchObject({
      code: 'request_id_conflict',
    });
  });
  it('holds global concurrency during cancellation until the original lease expires', async () => {
    const a = await claimed();
    const b = await createSignalGeneration(input());
    await cancelSignalGeneration(args(a));
    await expect(claimSignalGeneration(args(b))).rejects.toMatchObject({ code: 'worker_busy' });
    await expect(
      finishSignalGeneration({ ...args(a), token: a.lease_token, outcome: 'completed', result }),
    ).rejects.toMatchObject({ code: 'stale_attempt' });
    await pool.query(
      "UPDATE public.signal_generation_runs SET lease_until=clock_timestamp()-interval '1 second' WHERE id=$1",
      [a.id],
    );
    expect((await claimSignalGeneration(args(b))).claimed).toBe(true);
    expect((await getSignalGeneration(args(a))).reserved_microusd).toBe('10');
  });
  it('turns expired running requests into unknown instead of invoking again', async () => {
    const a = await claimed();
    await pool.query(
      "UPDATE public.signal_generation_runs SET lease_until=clock_timestamp()-interval '1 second' WHERE id=$1",
      [a.id],
    );
    const after = await claimSignalGeneration(args(a));
    expect(after.claimed).toBe(false);
    expect(after.run.status).toBe('unknown');
    expect(after.run.reserved_microusd).toBe('10');
    expect((await claimSignalGeneration(args(a))).claimed).toBe(false);
  });
  it('persists private candidate receipts and token usage without publication writes', async () => {
    const a = await claimed();
    const completed = await finishSignalGeneration({
      ...args(a),
      token: a.lease_token,
      outcome: 'completed',
      result,
      chargedMicrousd: 15,
    });
    expect(completed.result).toEqual(result);
    expect(completed.charged_microusd).toBe('15');
    expect((await claimSignalGeneration(args(a))).claimed).toBe(false);
    expect(
      (await listSignalGenerations({ pool, owner, batchId: a.batch_id, itemId: a.item_id })).map(
        (r) => r.id,
      ),
    ).toEqual([a.id]);
  });
  it('retains max(reserved, actual) for failures and prohibits a new paid retry', async () => {
    const a = await claimed();
    const failed = await finishSignalGeneration({
      ...args(a),
      token: a.lease_token,
      outcome: 'failed',
      errorCode: 'configuration_changed',
      chargedMicrousd: 0,
    });
    expect(failed.charged_microusd).toBe('10');
    expect(failed.result).toBeNull();
    expect((await claimSignalGeneration(args(a))).claimed).toBe(false);
  });
  it('counts pending external/unknown costs in the global UTC daily cap across owners', async () => {
    const value = input();
    value.configuration.dailyLimitMicrousd = 10;
    const a = await claimed(value);
    await finishSignalGeneration({
      ...args(a),
      token: a.lease_token,
      outcome: 'failed',
      errorCode: 'provider_rejected',
    });
    const b = await createSignalGeneration(
      input({ owner: 'second', configuration: value.configuration }),
    );
    await expect(claimSignalGeneration({ ...args(b), owner: 'second' })).rejects.toMatchObject({
      code: 'budget_exceeded',
    });
  });
  it('limits all items and later UTC days in the same batch using its full AI ledger', async () => {
    const value = input();
    value.configuration.batchLimitMicrousd = 10;
    const a = await claimed(value);
    await finishSignalGeneration({
      ...args(a),
      token: a.lease_token,
      outcome: 'completed',
      result,
    });
    await pool.query(
      'UPDATE public.signal_generation_runs SET budget_day=budget_day-1 WHERE id=$1',
      [a.id],
    );
    const next = input({ configuration: value.configuration });
    next.request.batchId = a.batch_id;
    const b = await createSignalGeneration(next);
    await expect(claimSignalGeneration(args(b))).rejects.toMatchObject({ code: 'budget_exceeded' });
  });
  it('never treats a lost claim COMMIT reply as authorization to call a model', async () => {
    const a = await createSignalGeneration(input());
    await expect(
      claimSignalGeneration({ ...args(a), pool: uncertainCommit(pool) }),
    ).rejects.toMatchObject({ code: 'commit_unknown' });
    expect((await claimSignalGeneration(args(a))).claimed).toBe(false);
  });
  it('honors budget reductions made after a run was queued', async () => {
    const a = await createSignalGeneration(input());
    for (const currentLimits of [
      { batchLimitMicrousd: 9, dailyLimitMicrousd: 100 },
      { batchLimitMicrousd: 100, dailyLimitMicrousd: 9 },
    ])
      await expect(claimSignalGeneration({ ...args(a), currentLimits })).rejects.toMatchObject({
        code: 'budget_exceeded',
      });
    expect((await getSignalGeneration(args(a))).status).toBe('pending');
  });
  it('retains completed data when the finish COMMIT response is unknown', async () => {
    const a = await claimed();
    await expect(
      finishSignalGeneration({
        ...args(a),
        pool: uncertainCommit(pool),
        token: a.lease_token,
        outcome: 'completed',
        result,
      }),
    ).rejects.toMatchObject({ code: 'commit_unknown' });
    expect((await getSignalGeneration(args(a))).result).toEqual(result);
    expect((await claimSignalGeneration(args(a))).claimed).toBe(false);
  });
  it('enforces result privacy at the SQL boundary too', async () => {
    const a = await createSignalGeneration(input());
    for (const invalid of [{}, { classification: 'public' }, []])
      await expect(
        pool.query('UPDATE public.signal_generation_runs SET result=$2::jsonb WHERE id=$1', [
          a.id,
          JSON.stringify(invalid),
        ]),
      ).rejects.toMatchObject({ code: '23514' });
  });
  it('requires the exact restricted service role and denies unrelated/private access', async () => {
    await pool.query(`REVOKE ALL ON SCHEMA public FROM PUBLIC; REVOKE TEMPORARY ON DATABASE "${name}" FROM PUBLIC;
      CREATE ROLE hzense_generation_admin LOGIN NOINHERIT CONNECTION LIMIT 2;
      GRANT CONNECT ON DATABASE "${name}" TO hzense_generation_admin;
      GRANT USAGE ON SCHEMA public TO hzense_generation_admin;
      CREATE TABLE public.unrelated_private(secret text)`);
    for (const [privilege, names] of Object.entries(signalGenerationRoleColumns))
      await pool.query(
        `GRANT ${privilege}(${names.join(',')}) ON public.signal_generation_runs TO hzense_generation_admin`,
      );
    const url = new URL(adminUrl);
    url.pathname = `/${name}`;
    url.username = 'hzense_generation_admin';
    rolePool = new pg.Pool({ connectionString: url.toString(), max: 1 });
    await expect(assertGenerationRole(rolePool)).resolves.toBeUndefined();
    const value = input({ pool: rolePool });
    const a = await createSignalGeneration(value);
    expect((await claimSignalGeneration({ ...args(a), pool: rolePool })).claimed).toBe(true);
    for (const sql of [
      'SELECT * FROM public.unrelated_private',
      'DELETE FROM public.signal_generation_runs',
      "UPDATE public.signal_generation_runs SET owner_id='hijacked'",
      'CREATE TABLE public.nope(id integer)',
    ])
      await expect(rolePool.query(sql)).rejects.toMatchObject({ code: '42501' });
    await pool.query('GRANT SELECT(secret) ON public.unrelated_private TO hzense_generation_admin');
    await expect(assertGenerationRole(rolePool)).rejects.toThrow('generation_role_invalid');
    await pool.query(
      'REVOKE SELECT(secret) ON public.unrelated_private FROM hzense_generation_admin',
    );
    await expect(assertGenerationRole(pool)).rejects.toThrow('generation_role_invalid');
  });
});
