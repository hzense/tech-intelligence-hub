import { createHash, randomUUID } from 'node:crypto';
import { Buffer } from 'node:buffer';

const columns = `id,owner_id,run_id,candidate_index,material_hash,profile_id,profile_revision,
 fingerprint,snapshot,configuration,status,lease_token,lease_until,budget_day,reserved_microusd,
 charged_microusd,result,error_code,progress_phase,progress_at,started_at,created_at,finished_at`;

const codes = new Set([
  'invalid_request',
  'invalid_snapshot',
  'invalid_configuration',
  'invalid_result',
  'not_found',
  'request_id_conflict',
  'worker_busy',
  'budget_exceeded',
  'stale_attempt',
  'database_unavailable',
  'commit_unknown',
]);

export class CandidateEnrichmentStoreError extends Error {
  constructor(code = 'invalid_request') {
    super(codes.has(code) ? code : 'invalid_request');
    this.name = 'CandidateEnrichmentStoreError';
    this.code = this.message;
  }
}
const fail = (code) => {
  throw new CandidateEnrichmentStoreError(code);
};
const uuid = (value) => {
  if (typeof value !== 'string' || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value))
    fail('invalid_request');
  return value;
};
const owner = (value) => {
  if (
    typeof value !== 'string' ||
    !value ||
    value.length > 200 ||
    [...value].some((character) => {
      const code = character.charCodeAt(0);
      return code <= 31 || code === 127;
    })
  )
    fail('invalid_request');
  return value;
};
const integer = (value, min = 0) => {
  if (!Number.isSafeInteger(value) || value < min) fail('invalid_configuration');
  return value;
};
function canonical(value, depth = 0) {
  if (depth > 30) fail('invalid_snapshot');
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (Array.isArray(value)) return value.map((item) => canonical(item, depth + 1));
  if (!value || Object.getPrototypeOf(value) !== Object.prototype) fail('invalid_snapshot');
  const result = {};
  for (const key of Object.keys(value).sort()) {
    if (
      [
        '__proto__',
        'constructor',
        'prototype',
        'api_key',
        'apiKey',
        'encrypted_key',
        'authorization',
      ].includes(key)
    )
      fail('invalid_snapshot');
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !Object.hasOwn(descriptor, 'value')) fail('invalid_snapshot');
    result[key] = canonical(descriptor.value, depth + 1);
  }
  return result;
}
const digest = (value) =>
  createHash('sha256')
    .update(JSON.stringify(canonical(value)))
    .digest('hex');

async function transaction(pool, work, readOnly = false) {
  let client;
  let committing = false;
  try {
    client = await pool.connect();
    await client.query(readOnly ? 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY' : 'BEGIN');
    await client.query('SET LOCAL search_path=pg_catalog,pg_temp');
    await client.query("SET LOCAL statement_timeout='15s'");
    await client.query("SET LOCAL lock_timeout='5s'");
    const value = await work(client);
    committing = true;
    await client.query('COMMIT');
    return value;
  } catch (error) {
    await client?.query('ROLLBACK').catch(() => undefined);
    if (error instanceof CandidateEnrichmentStoreError) throw error;
    fail(committing && !readOnly ? 'commit_unknown' : 'database_unavailable');
  } finally {
    client?.release();
  }
}
async function row(client, ownerId, id, lock = false) {
  const result = (
    await client.query(
      `SELECT ${columns} FROM public.candidate_enrichment_runs WHERE id=$1 AND owner_id=$2${lock ? ' FOR UPDATE' : ''}`,
      [uuid(id), owner(ownerId)],
    )
  ).rows[0];
  if (!result) fail('not_found');
  return result;
}

export async function createCandidateEnrichment({
  pool,
  owner: ownerId,
  request,
  snapshot,
  configuration,
}) {
  ownerId = owner(ownerId);
  if (!request || typeof request !== 'object' || Array.isArray(request)) fail('invalid_request');
  const identity = {
    ownerId,
    runId: uuid(request.runId),
    candidateIndex: integer(request.candidateIndex),
    materialHash: request.materialHash,
    profileId: uuid(request.profileId),
    profileRevision: integer(request.profileRevision, 1),
  };
  uuid(request.id);
  if (identity.candidateIndex > 4 || !/^[a-f0-9]{64}$/.test(identity.materialHash))
    fail('invalid_request');
  const safeSnapshot = canonical(snapshot);
  const safeConfiguration = canonical(configuration);
  if (
    Buffer.byteLength(JSON.stringify(safeSnapshot)) > 1400000 ||
    safeSnapshot.materialHash !== identity.materialHash ||
    safeSnapshot.profile?.id !== identity.profileId ||
    safeSnapshot.profile?.revision !== identity.profileRevision ||
    safeSnapshot.profile?.stages?.verify?.connection_id !== safeSnapshot.connection?.id ||
    safeSnapshot.profile?.stages?.verify?.connection_revision !== safeSnapshot.connection?.revision
  )
    fail('invalid_snapshot');
  for (const key of ['batchLimitMicrousd', 'dailyLimitMicrousd', 'reserveMicrousd'])
    integer(safeConfiguration[key], 1);
  if (
    safeConfiguration.version !== 'candidate-enrichment-v1' ||
    safeConfiguration.reserveMicrousd > safeConfiguration.batchLimitMicrousd ||
    safeConfiguration.reserveMicrousd > safeConfiguration.dailyLimitMicrousd
  )
    fail('invalid_configuration');
  const fingerprint = digest({
    ...identity,
    snapshot: safeSnapshot,
    configuration: safeConfiguration,
  });
  return transaction(pool, async (client) => {
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
      `candidate-enrichment:create:${ownerId}:${identity.runId}:${identity.candidateIndex}`,
    ]);
    const byId = (
      await client.query(`SELECT ${columns} FROM public.candidate_enrichment_runs WHERE id=$1`, [
        request.id,
      ])
    ).rows[0];
    if (byId) {
      if (byId.owner_id === ownerId && byId.fingerprint === fingerprint) return byId;
      fail('request_id_conflict');
    }
    const existing = (
      await client.query(
        `SELECT ${columns} FROM public.candidate_enrichment_runs WHERE owner_id=$1 AND run_id=$2 AND candidate_index=$3 AND material_hash=$4 AND profile_id=$5 AND profile_revision=$6 AND status<>'failed'`,
        [
          ownerId,
          identity.runId,
          identity.candidateIndex,
          identity.materialHash,
          identity.profileId,
          identity.profileRevision,
        ],
      )
    ).rows[0];
    if (existing) {
      if (existing.fingerprint !== fingerprint) fail('request_id_conflict');
      return existing;
    }
    return (
      await client.query(
        `INSERT INTO public.candidate_enrichment_runs(id,owner_id,run_id,candidate_index,material_hash,profile_id,profile_revision,fingerprint,snapshot,configuration)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10::jsonb) RETURNING ${columns}`,
        [
          request.id,
          ownerId,
          identity.runId,
          identity.candidateIndex,
          identity.materialHash,
          identity.profileId,
          identity.profileRevision,
          fingerprint,
          JSON.stringify(safeSnapshot),
          JSON.stringify(safeConfiguration),
        ],
      )
    ).rows[0];
  });
}

export const getCandidateEnrichment = ({ pool, owner: ownerId, id }) =>
  transaction(pool, (client) => row(client, ownerId, id), true);

export async function listCandidateEnrichments({ pool, owner: ownerId, runId, candidateIndex }) {
  ownerId = owner(ownerId);
  uuid(runId);
  integer(candidateIndex);
  return transaction(
    pool,
    async (client) =>
      (
        await client.query(
          `SELECT ${columns} FROM public.candidate_enrichment_runs WHERE owner_id=$1 AND run_id=$2 AND candidate_index=$3 ORDER BY created_at DESC,id DESC LIMIT 10`,
          [ownerId, runId, candidateIndex],
        )
      ).rows,
    true,
  );
}

export async function queueCandidateEnrichment({ pool, owner: ownerId, id }) {
  return transaction(pool, async (client) => {
    const current = await row(client, ownerId, id, true);
    if (current.status !== 'pending') return current;
    return (
      await client.query(
        `UPDATE public.candidate_enrichment_runs SET progress_phase='queued',progress_at=clock_timestamp() WHERE id=$1 RETURNING ${columns}`,
        [id],
      )
    ).rows[0];
  });
}

export async function claimCandidateEnrichment({ pool, owner: ownerId, id, currentLimits }) {
  if (!currentLimits || typeof currentLimits !== 'object') fail('invalid_configuration');
  integer(currentLimits.batchLimitMicrousd, 1);
  integer(currentLimits.dailyLimitMicrousd, 1);
  return transaction(pool, async (client) => {
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtextextended('generation:capacity-and-budget',0))",
    );
    let current = await row(client, ownerId, id, true);
    if (current.status === 'running' && new Date(current.lease_until).getTime() <= Date.now()) {
      current = (
        await client.query(
          `UPDATE public.candidate_enrichment_runs SET status='unknown',error_code='outcome_unknown',finished_at=clock_timestamp() WHERE id=$1 RETURNING ${columns}`,
          [id],
        )
      ).rows[0];
    }
    if (current.status !== 'pending') return { claimed: false, run: current };
    const active = (
      await client.query(`SELECT
        (SELECT count(*) FROM public.signal_generation_runs WHERE status IN ('running','unknown','cancelled') AND lease_until>clock_timestamp()) +
        (SELECT count(*) FROM public.candidate_enrichment_runs WHERE status IN ('running','unknown') AND lease_until>clock_timestamp()) AS n`)
    ).rows[0];
    if (Number(active.n) > 0) fail('worker_busy');
    const context = (
      await client.query(
        `SELECT batch_id,(clock_timestamp() AT TIME ZONE 'UTC')::date::text AS day FROM public.signal_generation_runs WHERE id=$1 AND owner_id=$2 AND deleted_at IS NULL`,
        [current.run_id, ownerId],
      )
    ).rows[0];
    if (!context) fail('not_found');
    const usage = (
      await client.query(
        `SELECT
          (SELECT COALESCE(sum(greatest(reserved_microusd,charged_microusd)),0) FROM public.signal_generation_runs WHERE budget_day=$1::date) +
          (SELECT COALESCE(sum(greatest(reserved_microusd,charged_microusd)),0) FROM public.candidate_enrichment_runs WHERE budget_day=$1::date) AS daily,
          (SELECT COALESCE(sum(greatest(reserved_microusd,charged_microusd)),0) FROM public.signal_generation_runs WHERE batch_id=$2) +
          (SELECT COALESCE(sum(greatest(e.reserved_microusd,e.charged_microusd)),0) FROM public.candidate_enrichment_runs e JOIN public.signal_generation_runs g ON g.id=e.run_id WHERE g.batch_id=$2) AS batch`,
        [context.day, context.batch_id],
      )
    ).rows[0];
    const reserve = BigInt(current.configuration.reserveMicrousd);
    if (
      BigInt(usage.daily) + reserve >
        BigInt(
          Math.min(current.configuration.dailyLimitMicrousd, currentLimits.dailyLimitMicrousd),
        ) ||
      BigInt(usage.batch) + reserve >
        BigInt(Math.min(current.configuration.batchLimitMicrousd, currentLimits.batchLimitMicrousd))
    )
      fail('budget_exceeded');
    return {
      claimed: true,
      run: (
        await client.query(
          `UPDATE public.candidate_enrichment_runs SET status='running',lease_token=$2,lease_until=clock_timestamp()+interval '32 minutes',budget_day=$3,reserved_microusd=$4,progress_phase='preparing',progress_at=clock_timestamp(),started_at=clock_timestamp() WHERE id=$1 AND status='pending' RETURNING ${columns}`,
          [id, randomUUID(), context.day, reserve.toString()],
        )
      ).rows[0],
    };
  });
}

export async function updateCandidateEnrichmentProgress({
  pool,
  owner: ownerId,
  id,
  token,
  phase,
}) {
  uuid(token);
  if (!['generating', 'validating', 'saving'].includes(phase)) fail('invalid_request');
  return transaction(pool, async (client) => {
    const current = await row(client, ownerId, id, true);
    if (current.status !== 'running' || current.lease_token !== token) fail('stale_attempt');
    return (
      await client.query(
        `UPDATE public.candidate_enrichment_runs SET progress_phase=$2,progress_at=clock_timestamp() WHERE id=$1 RETURNING ${columns}`,
        [id, phase],
      )
    ).rows[0];
  });
}

export async function finishCandidateEnrichment({
  pool,
  owner: ownerId,
  id,
  token,
  outcome,
  result,
  chargedMicrousd = 0,
  providerCostMicrousd,
  errorCode = null,
}) {
  uuid(token);
  integer(chargedMicrousd);
  if (providerCostMicrousd !== undefined) integer(providerCostMicrousd);
  if (!['completed', 'failed', 'unknown'].includes(outcome)) fail('invalid_request');
  const safe = result === undefined ? null : canonical(result);
  if (
    outcome === 'completed' &&
    (safe?.classification !== 'private' || safe?.validation_version !== 1)
  )
    fail('invalid_result');
  if (safe && Buffer.byteLength(JSON.stringify(safe)) > 256000) fail('invalid_result');
  return transaction(pool, async (client) => {
    const current = await row(client, ownerId, id, true);
    if (current.status !== 'running' || current.lease_token !== token) fail('stale_attempt');
    const charged =
      providerCostMicrousd !== undefined
        ? BigInt(providerCostMicrousd)
        : BigInt(Math.max(chargedMicrousd, Number(current.reserved_microusd)));
    return (
      await client.query(
        `UPDATE public.candidate_enrichment_runs SET status=$2,result=$3::jsonb,error_code=$4,charged_microusd=$5,progress_phase='saving',progress_at=clock_timestamp(),finished_at=clock_timestamp() WHERE id=$1 RETURNING ${columns}`,
        [id, outcome, safe === null ? null : JSON.stringify(safe), errorCode, charged.toString()],
      )
    ).rows[0];
  });
}

export async function failQueuedCandidateEnrichment({ pool, owner: ownerId, id }) {
  return transaction(pool, async (client) => {
    const current = await row(client, ownerId, id, true);
    if (current.status !== 'pending') return current;
    return (
      await client.query(
        `UPDATE public.candidate_enrichment_runs SET status='failed',error_code='dispatch_failed',finished_at=clock_timestamp() WHERE id=$1 RETURNING ${columns}`,
        [id],
      )
    ).rows[0];
  });
}
