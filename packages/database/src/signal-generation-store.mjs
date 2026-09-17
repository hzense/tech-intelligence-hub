import { createHash, randomUUID } from 'node:crypto';
import { Buffer } from 'node:buffer';

// Private, preview-only generation receipts. This role cannot access imports,
// provider keys, Signal tables, verification attestations or publication state.
const columns = `id,owner_id,batch_id,item_id,source_fence,source_hash,profile_id,profile_revision,
 generation_version,fingerprint,snapshot,configuration,status,lease_token,lease_until,budget_day,
 reserved_microusd,charged_microusd,result,error_code,created_at,finished_at`;
const errorCodes = new Set([
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
export class SignalGenerationError extends Error {
  constructor(code) {
    super(errorCodes.has(code) ? code : 'invalid_request');
    this.name = 'SignalGenerationError';
    this.code = this.message;
  }
}
const fail = (code = 'invalid_request') => {
  throw new SignalGenerationError(code);
};
function uuid(value) {
  if (typeof value !== 'string' || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value))
    fail();
  return value;
}
function ownerId(value) {
  if (
    typeof value !== 'string' ||
    !value ||
    value.length > 200 ||
    [...value].some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)
  )
    fail();
  return value;
}
function integer(value, min = 0) {
  if (!Number.isSafeInteger(value) || value < min) fail('invalid_configuration');
  return value;
}
function object(value, fields, code = 'invalid_request') {
  if (
    !value ||
    Object.getPrototypeOf(value) !== Object.prototype ||
    Object.keys(value).length !== fields.length ||
    Object.keys(value).some((key) => !fields.includes(key))
  )
    fail(code);
  return value;
}
function canonical(value, code = 'invalid_snapshot', depth = 0) {
  if (depth > 30) fail(code);
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (Array.isArray(value)) return value.map((v) => canonical(v, code, depth + 1));
  if (!value || Object.getPrototypeOf(value) !== Object.prototype) fail(code);
  const out = {};
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
      fail(code);
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !Object.hasOwn(descriptor, 'value')) fail(code);
    out[key] = canonical(descriptor.value, code, depth + 1);
  }
  return out;
}
function bounded(value, limit, code) {
  const out = canonical(value, code);
  if (Buffer.byteLength(JSON.stringify(out), 'utf8') > limit) fail(code);
  return out;
}
const digest = (value) =>
  createHash('sha256')
    .update(JSON.stringify(canonical(value)))
    .digest('hex');
export const signalGenerationSourceHash = (source) => digest(source);
function inputs(owner, request, snapshot, configuration) {
  ownerId(owner);
  object(request, [
    'id',
    'batchId',
    'itemId',
    'sourceFence',
    'sourceHash',
    'profileId',
    'profileRevision',
  ]);
  for (const key of ['id', 'batchId', 'itemId', 'profileId']) uuid(request[key]);
  integer(request.sourceFence, 1);
  integer(request.profileRevision, 1);
  if (typeof request.sourceHash !== 'string' || !/^[a-f0-9]{64}$/.test(request.sourceHash)) fail();
  object(snapshot, ['source', 'profile', 'connection'], 'invalid_snapshot');
  const safe = bounded(snapshot, 1200000, 'invalid_snapshot');
  if (
    safe.source?.classification !== 'private' ||
    digest(safe.source) !== request.sourceHash ||
    safe.profile?.id !== request.profileId ||
    safe.profile.revision !== request.profileRevision ||
    safe.profile.stages?.extract?.connection_id !== safe.connection?.id ||
    safe.profile.stages?.extract?.connection_revision !== safe.connection?.revision
  )
    fail('invalid_snapshot');
  object(
    safe.connection,
    ['id', 'revision', 'protocol', 'base_url', 'settings'],
    'invalid_snapshot',
  );
  object(
    configuration,
    ['version', 'batchLimitMicrousd', 'dailyLimitMicrousd', 'reserveMicrousd'],
    'invalid_configuration',
  );
  if (
    typeof configuration.version !== 'string' ||
    !/^[a-zA-Z0-9._/-]{1,100}$/.test(configuration.version)
  )
    fail('invalid_configuration');
  for (const key of ['batchLimitMicrousd', 'dailyLimitMicrousd', 'reserveMicrousd'])
    integer(configuration[key], 1);
  if (
    configuration.reserveMicrousd > configuration.batchLimitMicrousd ||
    configuration.reserveMicrousd > configuration.dailyLimitMicrousd
  )
    fail('invalid_configuration');
  const config = canonical(configuration);
  const identity = { owner, ...request, snapshot: safe, configuration: config };
  delete identity.id;
  return { snapshot: safe, configuration: config, fingerprint: digest(identity) };
}
async function transaction(pool, work, readOnly = false) {
  let client,
    committing = false,
    discard;
  try {
    client = await pool.connect();
    await client.query(readOnly ? 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY' : 'BEGIN');
    await client.query('SET LOCAL search_path=pg_catalog,pg_temp');
    await client.query("SET LOCAL statement_timeout='15s'");
    await client.query("SET LOCAL lock_timeout='5s'");
    await client.query("SET LOCAL idle_in_transaction_session_timeout='15s'");
    const result = await work(client);
    committing = true;
    await client.query('COMMIT');
    return result;
  } catch (error) {
    discard = error;
    await client?.query('ROLLBACK').catch(() => undefined);
    if (committing && !readOnly) fail('commit_unknown');
    throw error instanceof SignalGenerationError
      ? error
      : new SignalGenerationError('database_unavailable');
  } finally {
    client?.release(discard);
  }
}
async function run(client, owner, id, locking = false) {
  const row = (
    await client.query(
      `SELECT ${columns} FROM public.signal_generation_runs WHERE id=$1 AND owner_id=$2${locking ? ' FOR UPDATE' : ''}`,
      [uuid(id), ownerId(owner)],
    )
  ).rows[0];
  if (!row) fail('not_found');
  return row;
}
export async function createSignalGeneration({ pool, owner, request, snapshot, configuration }) {
  const parsed = inputs(owner, request, snapshot, configuration);
  return transaction(pool, async (client) => {
    // One owner lock makes UUID replay and semantic (different UUID) replay atomic.
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
      `generation:create:${owner}`,
    ]);
    const old = (
      await client.query(`SELECT ${columns} FROM public.signal_generation_runs WHERE id=$1`, [
        request.id,
      ])
    ).rows[0];
    if (old) {
      if (old.owner_id !== owner || old.fingerprint !== parsed.fingerprint)
        fail('request_id_conflict');
      return old;
    }
    const previous = (
      await client.query(
        `SELECT ${columns} FROM public.signal_generation_runs
      WHERE owner_id=$1 AND item_id=$2 AND source_fence=$3 AND source_hash=$4 AND profile_id=$5 AND profile_revision=$6 AND generation_version=$7`,
        [
          owner,
          request.itemId,
          request.sourceFence,
          request.sourceHash,
          request.profileId,
          request.profileRevision,
          configuration.version,
        ],
      )
    ).rows[0];
    if (previous) {
      if (previous.fingerprint !== parsed.fingerprint) fail('request_id_conflict');
      return previous;
    }
    return (
      await client.query(
        `INSERT INTO public.signal_generation_runs
      (id,owner_id,batch_id,item_id,source_fence,source_hash,profile_id,profile_revision,generation_version,fingerprint,snapshot,configuration)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12::jsonb) RETURNING ${columns}`,
        [
          request.id,
          owner,
          request.batchId,
          request.itemId,
          request.sourceFence,
          request.sourceHash,
          request.profileId,
          request.profileRevision,
          configuration.version,
          parsed.fingerprint,
          JSON.stringify(parsed.snapshot),
          JSON.stringify(parsed.configuration),
        ],
      )
    ).rows[0];
  });
}
export async function getSignalGeneration({ pool, owner, id }) {
  ownerId(owner);
  uuid(id);
  return transaction(pool, async (client) => {
    await expireRunning(client, owner, { id });
    return run(client, owner, id);
  });
}
async function expireRunning(client, owner, { id, batchId, itemId } = {}) {
  // A query may recover a lost worker, but must never admit another provider call.
  // Keep its lease and full reservation; a late completion remains fenced out.
  await client.query(
    `UPDATE public.signal_generation_runs
    SET status='unknown',error_code='outcome_unknown',finished_at=clock_timestamp()
    WHERE owner_id=$1 AND ($2::uuid IS NULL OR id=$2)
    AND ($3::uuid IS NULL OR batch_id=$3) AND ($4::uuid IS NULL OR item_id=$4)
    AND status='running' AND lease_until<=clock_timestamp()`,
    [owner, id ?? null, batchId ?? null, itemId ?? null],
  );
}
export async function listSignalGenerations({ pool, owner, batchId, itemId }) {
  ownerId(owner);
  if (batchId !== undefined) uuid(batchId);
  if (itemId !== undefined) uuid(itemId);
  return transaction(pool, async (client) => {
    await expireRunning(client, owner, { batchId, itemId });
    return (
      await client.query(
        `SELECT ${columns} FROM public.signal_generation_runs
    WHERE owner_id=$1 AND ($2::uuid IS NULL OR batch_id=$2) AND ($3::uuid IS NULL OR item_id=$3)
    ORDER BY created_at DESC,id DESC LIMIT 50`,
        [owner, batchId ?? null, itemId ?? null],
      )
    ).rows;
  });
}
export async function claimSignalGeneration({ pool, owner, id, currentLimits }) {
  object(currentLimits, ['batchLimitMicrousd', 'dailyLimitMicrousd'], 'invalid_configuration');
  integer(currentLimits.batchLimitMicrousd);
  integer(currentLimits.dailyLimitMicrousd);
  return transaction(pool, async (client) => {
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtextextended('generation:capacity-and-budget',0))",
    );
    let row = await run(client, owner, id, true);
    if (row.status === 'running') {
      row =
        (
          await client.query(
            `UPDATE public.signal_generation_runs SET status='unknown',error_code='outcome_unknown',finished_at=clock_timestamp()
        WHERE id=$1 AND lease_until<=clock_timestamp() RETURNING ${columns}`,
            [id],
          )
        ).rows[0] ?? row;
    }
    if (row.status !== 'pending') return { claimed: false, run: row };
    const active = (
      await client.query(`SELECT count(*)::integer AS n FROM public.signal_generation_runs
      WHERE status IN ('running','unknown','cancelled') AND lease_until>clock_timestamp()`)
    ).rows[0];
    if (active.n > 0) fail('worker_busy');
    const day = (
      await client.query("SELECT (clock_timestamp() AT TIME ZONE 'UTC')::date::text AS day")
    ).rows[0].day;
    // AI reservations are a separate ledger, not a claim about parser/provider bills.
    const usage = (
      await client.query(
        `SELECT
      COALESCE(sum(greatest(reserved_microusd,charged_microusd)) FILTER (WHERE budget_day=$1::date),0)::text AS daily,
      COALESCE(sum(greatest(reserved_microusd,charged_microusd)) FILTER (WHERE batch_id=$2),0)::text AS batch
      FROM public.signal_generation_runs`,
        [day, row.batch_id],
      )
    ).rows[0];
    const reserve = BigInt(row.configuration.reserveMicrousd);
    if (
      BigInt(usage.daily) + reserve >
        BigInt(Math.min(row.configuration.dailyLimitMicrousd, currentLimits.dailyLimitMicrousd)) ||
      BigInt(usage.batch) + reserve >
        BigInt(Math.min(row.configuration.batchLimitMicrousd, currentLimits.batchLimitMicrousd))
    )
      fail('budget_exceeded');
    row = (
      await client.query(
        `UPDATE public.signal_generation_runs SET status='running',lease_token=$2,
      lease_until=clock_timestamp()+interval '7 minutes',budget_day=$3,reserved_microusd=$4
      WHERE id=$1 AND status='pending' RETURNING ${columns}`,
        [id, randomUUID(), day, reserve.toString()],
      )
    ).rows[0];
    return { claimed: true, run: row };
  });
}
export async function finishSignalGeneration({
  pool,
  owner,
  id,
  token,
  outcome,
  result,
  chargedMicrousd = 0,
  errorCode = null,
}) {
  uuid(token);
  integer(chargedMicrousd);
  if (
    !['completed', 'failed', 'unknown'].includes(outcome) ||
    (errorCode !== null &&
      (typeof errorCode !== 'string' || !/^[a-z][a-z0-9_]{0,79}$/.test(errorCode)))
  )
    fail();
  const safeResult = outcome === 'completed' ? bounded(result, 512000, 'invalid_result') : null;
  if (outcome === 'completed' && safeResult?.classification !== 'private') fail('invalid_result');
  return transaction(pool, async (client) => {
    const row = await run(client, owner, id, true);
    if (row.lease_token !== token) fail('stale_attempt');
    if (row.status !== 'running') {
      if (
        row.status === outcome &&
        JSON.stringify(canonical(row.result)) === JSON.stringify(safeResult) &&
        row.error_code === errorCode
      )
        return row;
      fail('stale_attempt');
    }
    const live = (
      await client.query('SELECT $1::timestamptz>clock_timestamp() AS live', [row.lease_until])
    ).rows[0].live;
    if (!live) fail('stale_attempt');
    const charged =
      BigInt(chargedMicrousd) > BigInt(row.reserved_microusd)
        ? BigInt(chargedMicrousd)
        : BigInt(row.reserved_microusd);
    return (
      await client.query(
        `UPDATE public.signal_generation_runs SET status=$2,result=$3::jsonb,
      error_code=$4,charged_microusd=$5,finished_at=clock_timestamp() WHERE id=$1 RETURNING ${columns}`,
        [
          id,
          outcome,
          safeResult === null ? null : JSON.stringify(safeResult),
          errorCode,
          charged.toString(),
        ],
      )
    ).rows[0];
  });
}
export async function cancelSignalGeneration({ pool, owner, id }) {
  return transaction(pool, async (client) => {
    const row = await run(client, owner, id, true);
    if (!['pending', 'running'].includes(row.status)) return row;
    // Keep the original lease and reservation: the external call may still finish.
    return (
      await client.query(
        `UPDATE public.signal_generation_runs SET status='cancelled',finished_at=clock_timestamp()
      WHERE id=$1 RETURNING ${columns}`,
        [id],
      )
    ).rows[0];
  });
}
