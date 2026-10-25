import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import process from 'node:process';
import { URL } from 'node:url';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { validateConnectionTarget } from '../src/connection-policy.mjs';
import {
  claimSignalGeneration,
  finishSignalGeneration,
  getSignalGenerationDailyUsage,
} from '../src/signal-generation-store.mjs';
import {
  claimCandidateEnrichment,
  finishCandidateEnrichment,
} from '../src/candidate-enrichment-store.mjs';
import {
  signalGenerationRoleColumns,
  candidateEnrichmentRoleColumns,
} from '../src/signal-generation-role-columns.mjs';

const adminUrl = process.env.MIGRATION_TEST_ADMIN_URL;
if (adminUrl) validateConnectionTarget({ connectionString: adminUrl, profile: 'local-test' });
const suite = adminUrl ? describe.sequential : describe.skip;
const name = `hzense_shared_budget_${process.pid}_${Date.now()}`;
const owner = 'shared-ledger-owner';
const batchId = randomUUID();
const limits = { batchLimitMicrousd: 100, dailyLimitMicrousd: 100 };
let admin, pool, rolePool;
let databaseCreated = false;
let roleCreated = false;

async function generation(status, reserve, charged, nextReserve = 10) {
  const id = randomUUID();
  await pool.query(
    `INSERT INTO public.signal_generation_runs
    (id,owner_id,batch_id,item_id,source_fence,source_hash,profile_id,profile_revision,
     generation_version,fingerprint,snapshot,configuration,status,budget_day,reserved_microusd,charged_microusd)
    VALUES($1,$2,$3,$4,1,$5,$6,1,'shared-budget-test',$5,'{}',$7,$8,
     (clock_timestamp() AT TIME ZONE 'UTC')::date,$9,$10)`,
    [
      id,
      owner,
      batchId,
      randomUUID(),
      'a'.repeat(64),
      randomUUID(),
      { ...limits, reserveMicrousd: nextReserve },
      status,
      reserve,
      charged,
    ],
  );
  return id;
}
async function enrichment(runId, status, reserve, charged, nextReserve = 10) {
  const id = randomUUID();
  await pool.query(
    `INSERT INTO public.candidate_enrichment_runs
    (id,owner_id,run_id,candidate_index,material_hash,profile_id,profile_revision,
     fingerprint,snapshot,configuration,status,budget_day,reserved_microusd,charged_microusd)
    VALUES($1,$2,$3,0,$4,$5,1,$4,'{}',$6,$7,
     (clock_timestamp() AT TIME ZONE 'UTC')::date,$8,$9)`,
    [
      id,
      owner,
      runId,
      'b'.repeat(64),
      randomUUID(),
      { ...limits, reserveMicrousd: nextReserve },
      status,
      reserve,
      charged,
    ],
  );
  return id;
}
const args = (id) => ({ pool: rolePool, owner, id, currentLimits: limits });

suite('generation and enrichment share settled budgets with existing column permissions', () => {
  beforeAll(async () => {
    if (process.env.RUNTIME_READER_TEST_ISOLATED_CLUSTER !== '1')
      throw new Error('Shared budget tests require an isolated disposable cluster');
    admin = new pg.Client({ connectionString: adminUrl });
    await admin.connect();
    await admin.query(`CREATE DATABASE "${name}" TEMPLATE template0 ENCODING 'UTF8'`);
    databaseCreated = true;
    const url = new URL(adminUrl);
    url.pathname = `/${name}`;
    pool = new pg.Pool({ connectionString: url.toString() });
    for (const migration of [
      '0015_signal_generation.sql',
      '0018_generation_task_visibility.sql',
      '0019_generation_progress.sql',
      '0022_candidate_enrichment_runs.sql',
    ])
      await pool.query(
        await readFile(new URL(`../../../db/migrations/${migration}`, import.meta.url), 'utf8'),
      );
    await admin.query(`CREATE ROLE "${name}" NOLOGIN`);
    roleCreated = true;
    await pool.query(`GRANT USAGE ON SCHEMA public TO "${name}"`);
    for (const [table, contract] of [
      ['signal_generation_runs', signalGenerationRoleColumns],
      ['candidate_enrichment_runs', candidateEnrichmentRoleColumns],
    ])
      for (const [privilege, columns] of Object.entries(contract))
        await pool.query(
          `GRANT ${privilege}(${columns.join(',')}) ON public.${table} TO "${name}"`,
        );
    // Unique fixture role avoids cluster-wide names used by other integration suites.
    rolePool = {
      async connect() {
        const client = await pool.connect();
        await client.query(`SET ROLE "${name}"`);
        return {
          query: (...values) => client.query(...values),
          release: () => client.release(true),
        };
      },
    };
  });
  beforeEach(async () => {
    await pool.query('TRUNCATE public.candidate_enrichment_runs,public.signal_generation_runs');
  });
  afterAll(async () => {
    await pool?.end();
    if (databaseCreated) await admin.query(`DROP DATABASE "${name}" WITH (FORCE)`);
    if (roleCreated) await admin.query(`DROP ROLE "${name}"`);
    await admin?.end();
  });

  it('settles completed/failed rows in both ledgers and retains all uncertain reservations', async () => {
    const parent = await generation('completed', 100, 35);
    await generation('failed', 100, 0);
    await generation('pending', 0, 0);
    await generation('running', 100, 10);
    await generation('unknown', 100, 5);
    await generation('cancelled', 100, 0);
    await enrichment(parent, 'completed', 50, 7);
    await enrichment(parent, 'failed', 50, 3);
    await enrichment(parent, 'unknown', 50, 4);
    expect(await getSignalGenerationDailyUsage({ pool: rolePool, owner })).toMatchObject({
      charged_microusd: '64',
      budget_used_microusd: '395',
    });
  });

  it('generation and enrichment admit against the same settled balance and protect unknown costs', async () => {
    const parent = await generation('completed', 80, 10);
    await enrichment(parent, 'completed', 70, 5);
    const nextGeneration = await generation('pending', 0, 0, 60);
    const claim = await claimSignalGeneration(args(nextGeneration));
    expect(claim.claimed).toBe(true);
    await finishSignalGeneration({
      ...args(nextGeneration),
      token: claim.run.lease_token,
      outcome: 'failed',
      providerCostMicrousd: 12,
      errorCode: 'generation_invalid_output',
    });
    const nextEnrichment = await enrichment(parent, 'pending', 0, 0, 70);
    const enrichmentClaim = await claimCandidateEnrichment(args(nextEnrichment));
    expect(enrichmentClaim.claimed).toBe(true);
    await finishCandidateEnrichment({
      ...args(nextEnrichment),
      token: enrichmentClaim.run.lease_token,
      outcome: 'unknown',
      providerCostMicrousd: 1,
      errorCode: 'outcome_unknown',
    });
    // After lease expiry it must be budget, not the execution slot, that blocks admission.
    await pool.query(
      "UPDATE public.candidate_enrichment_runs SET lease_until=clock_timestamp()-interval '1 second' WHERE id=$1",
      [nextEnrichment],
    );
    expect(await getSignalGenerationDailyUsage({ pool: rolePool, owner })).toMatchObject({
      charged_microusd: '28',
      budget_used_microusd: '97',
    });
    const blocked = await generation('pending', 0, 0, 10);
    await expect(claimSignalGeneration(args(blocked))).rejects.toMatchObject({
      code: 'budget_exceeded',
    });
  });
});
