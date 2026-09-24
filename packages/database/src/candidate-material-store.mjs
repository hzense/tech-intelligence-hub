import { createHash, randomUUID } from 'node:crypto';
import { Buffer } from 'node:buffer';
import {
  candidateReviewMaterialHash,
  reviewOwner,
  reviewUuid,
} from './candidate-review-contract.mjs';
import { validateCandidateSourceBundle } from '../../ingestion/src/candidate-source-bundle.mjs';
import { normalizeMaterialPlan, materialPlanHash } from './material-registration-contract.mjs';

// Deliberately bounded detail reads: newest 10 requests, newest 3 reports each,
// and the (at most two) stage receipts belonging to each returned report.
export const materialHistoryLimits = Object.freeze({ requests: 10, reports: 3 });
const codes = new Set([
  'invalid_request',
  'invalid_bundle',
  'invalid_plan',
  'invalid_attestation',
  'not_found',
  'material_changed',
  'request_id_conflict',
  'stage_conflict',
  'database_unavailable',
  'commit_unknown',
]);
export class CandidateMaterialStoreError extends Error {
  constructor(code = 'invalid_request') {
    super(codes.has(code) ? code : 'invalid_request');
    this.name = 'CandidateMaterialStoreError';
    this.code = this.message;
  }
}
const fail = (code) => {
  throw new CandidateMaterialStoreError(code);
};
function identity(owner, id) {
  try {
    return { owner: reviewOwner(owner), id: reviewUuid(id) };
  } catch {
    fail('invalid_request');
  }
}
function hash(value) {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) fail('invalid_request');
  return value;
}
function candidateIndex(value) {
  if (!Number.isInteger(value) || value < 0 || value > 4) fail('invalid_request');
  return value;
}
function canonical(value, depth = 0) {
  if (depth > 30) fail('invalid_request');
  if (value === null || ['boolean', 'string'].includes(typeof value)) return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (Array.isArray(value)) return value.map((item) => canonical(item, depth + 1));
  if (!value || Object.getPrototypeOf(value) !== Object.prototype) fail('invalid_request');
  const result = {};
  for (const key of Object.keys(value).sort()) {
    if (['__proto__', 'constructor', 'prototype'].includes(key)) fail('invalid_request');
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !Object.hasOwn(descriptor, 'value')) fail('invalid_request');
    result[key] = canonical(descriptor.value, depth + 1);
  }
  return result;
}
function jsonObject(value) {
  const safe = canonical(value);
  if (
    !safe ||
    Array.isArray(safe) ||
    typeof safe !== 'object' ||
    Buffer.byteLength(JSON.stringify(safe)) > 2_000_000
  )
    fail('invalid_request');
  return safe;
}
async function transaction(pool, work, readOnly = false) {
  let client;
  let committing = false;
  try {
    client = await pool.connect();
    await client.query(readOnly ? 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY' : 'BEGIN');
    await client.query('SET LOCAL search_path=pg_catalog,pg_temp');
    await client.query("SET LOCAL lock_timeout='5s'");
    await client.query("SET LOCAL statement_timeout='15s'");
    await client.query("SET LOCAL idle_in_transaction_session_timeout='20s'");
    const result = await work(client);
    committing = true;
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client?.query('ROLLBACK').catch(() => {});
    if (error instanceof CandidateMaterialStoreError) throw error;
    fail(
      committing && !readOnly
        ? 'commit_unknown'
        : error?.code === '23505'
          ? 'request_id_conflict'
          : 'database_unavailable',
    );
  } finally {
    client?.release();
  }
}
async function bindRun(client, owner, request, lock = true) {
  if (lock)
    await client.query(
      'SELECT pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended($1,0))',
      [request.run_id],
    );
  const run = (
    await client.query(
      'SELECT id,owner_id,status,deleted_at,snapshot,source_hash,result FROM public.signal_generation_runs WHERE id=$1 AND owner_id=$2',
      [request.run_id, owner],
    )
  ).rows[0];
  if (!run || run.deleted_at) fail('not_found');
  let materialHash;
  try {
    materialHash = candidateReviewMaterialHash(run, request.candidate_index);
  } catch {
    fail('material_changed');
  }
  if (materialHash !== request.base_material_hash) fail('material_changed');
  // A caller-supplied matching hash alone does not establish which original
  // fragments were bundled. Rebind the immutable original text as well.
  if (request.bundle) {
    const originalFragments = request.bundle.source.fragments.filter(
      (_, index) => request.bundle.provenance[index].kind === 'original',
    );
    if (
      JSON.stringify(canonical(originalFragments)) !==
      JSON.stringify(canonical(run.snapshot.source.fragments))
    )
      fail('invalid_bundle');
  }
}
async function requestRow(client, owner, id) {
  const row = (
    await client.query(
      `SELECT r.* FROM public.candidate_material_requests r
     JOIN public.signal_generation_runs g ON g.id=r.run_id AND g.owner_id=r.owner_id
     WHERE r.id=$1 AND r.owner_id=$2 AND g.deleted_at IS NULL AND g.status='completed'`,
      [id, owner],
    )
  ).rows[0];
  if (!row) fail('not_found');
  return row;
}
async function reports(client, owner, requestId) {
  const rows = (
    await client.query(
      'SELECT * FROM public.candidate_material_reports WHERE request_id=$1 AND owner_id=$2 ORDER BY received_at DESC,id LIMIT 3',
      [requestId, owner],
    )
  ).rows;
  const receipts = (
    await client.query(
      'SELECT * FROM public.candidate_material_receipts WHERE request_id=$1 AND owner_id=$2 AND report_id=ANY($3::uuid[]) ORDER BY created_at,id LIMIT 6',
      [requestId, owner, rows.map((row) => row.id)],
    )
  ).rows;
  return rows.map((row) => ({
    ...row,
    receipts: receipts.filter((receipt) => receipt.report_id === row.id),
  }));
}
async function withReports(client, owner, request) {
  return { ...request, reports: await reports(client, owner, request.id) };
}

export async function createMaterialRequest({ pool, owner, request, bundle }) {
  if (!request || typeof request !== 'object' || Array.isArray(request)) fail('invalid_request');
  ({ owner } = identity(owner, request.id));
  const runId = identity(owner, request.runId).id;
  const index = candidateIndex(request.candidateIndex);
  const baseHash = hash(request.baseMaterialHash);
  const bundleHash = hash(request.bundleHash);
  let safeBundle;
  try {
    safeBundle = validateCandidateSourceBundle(jsonObject(bundle));
  } catch {
    fail('invalid_bundle');
  }
  if (safeBundle.sourceBundleHash !== bundleHash || safeBundle.baseMaterialHash !== baseHash)
    fail('invalid_bundle');
  const fingerprint = createHash('sha256')
    .update(
      JSON.stringify(
        canonical({
          owner,
          runId,
          candidateIndex: index,
          baseMaterialHash: baseHash,
          bundleHash,
          bundle: safeBundle,
        }),
      ),
    )
    .digest('hex');
  return transaction(pool, async (client) => {
    await bindRun(client, owner, {
      run_id: runId,
      candidate_index: index,
      base_material_hash: baseHash,
      bundle: safeBundle,
    });
    const old = (
      await client.query(
        'SELECT * FROM public.candidate_material_requests WHERE id=$1 AND owner_id=$2',
        [request.id, owner],
      )
    ).rows[0];
    if (old) {
      if (old.fingerprint !== fingerprint) fail('request_id_conflict');
      return withReports(client, owner, old);
    }
    const duplicate = (
      await client.query(
        'SELECT * FROM public.candidate_material_requests WHERE owner_id=$1 AND run_id=$2 AND candidate_index=$3 AND base_material_hash=$4 AND bundle_hash=$5',
        [owner, runId, index, baseHash, bundleHash],
      )
    ).rows[0];
    if (duplicate) {
      if (duplicate.fingerprint !== fingerprint) fail('request_id_conflict');
      return withReports(client, owner, duplicate);
    }
    const row = (
      await client.query(
        `INSERT INTO public.candidate_material_requests(id,owner_id,run_id,candidate_index,base_material_hash,bundle_hash,fingerprint,bundle)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb) RETURNING *`,
        [
          request.id,
          owner,
          runId,
          index,
          baseHash,
          bundleHash,
          fingerprint,
          JSON.stringify(safeBundle),
        ],
      )
    ).rows[0];
    return { ...row, reports: [] };
  });
}
export async function readMaterialRequests({ pool, owner, runId, candidateIndex: index }) {
  ({ owner, id: runId } = identity(owner, runId));
  candidateIndex(index);
  return transaction(
    pool,
    async (client) => {
      const rows = (
        await client.query(
          `SELECT r.* FROM public.candidate_material_requests r
       JOIN public.signal_generation_runs g ON g.id=r.run_id AND g.owner_id=r.owner_id
       WHERE r.owner_id=$1 AND r.run_id=$2 AND r.candidate_index=$3
         AND g.deleted_at IS NULL AND g.status='completed' ORDER BY r.created_at DESC,r.id LIMIT 10`,
          [owner, runId, index],
        )
      ).rows;
      const result = [];
      for (const row of rows) result.push(await withReports(client, owner, row));
      return result;
    },
    true,
  );
}
export async function getMaterialRequest({ pool, owner, id }) {
  ({ owner, id } = identity(owner, id));
  return transaction(
    pool,
    async (client) => withReports(client, owner, await requestRow(client, owner, id)),
    true,
  );
}

/** The trusted server provides a synchronous signature verifier. Admission uses
 * the same database transaction timestamp as the received_at DEFAULT; replay
 * verifies the persisted signature at its original received_at. The store does
 * not implement cryptographic or factual verification itself. */
export async function saveMaterialReport({
  pool,
  owner,
  requestId,
  planHash,
  plan,
  attestation,
  assertAttestationAt,
}) {
  if (typeof assertAttestationAt !== 'function') fail('invalid_request');
  ({ owner, id: requestId } = identity(owner, requestId));
  hash(planHash);
  let safePlan;
  try {
    safePlan = normalizeMaterialPlan(jsonObject(plan));
  } catch {
    fail('invalid_plan');
  }
  if (materialPlanHash(safePlan) !== planHash) fail('invalid_plan');
  const safeAttestation = jsonObject(attestation);
  return transaction(pool, async (client) => {
    const request = await requestRow(client, owner, requestId);
    await bindRun(client, owner, request);
    if (
      safePlan.owner !== owner ||
      safePlan.runId !== request.run_id ||
      safePlan.candidateIndex !== request.candidate_index ||
      safePlan.baseMaterialHash !== request.base_material_hash ||
      safePlan.sourceBundleHash !== request.bundle_hash
    )
      fail('invalid_plan');
    const old = (
      await client.query(
        'SELECT * FROM public.candidate_material_reports WHERE request_id=$1 AND owner_id=$2 AND plan_hash=$3',
        [requestId, owner, planHash],
      )
    ).rows[0];
    const assertAt = (checkedPlan, checkedAttestation, receivedAt) => {
      try {
        if (!Number.isFinite(new Date(receivedAt).getTime())) fail('invalid_attestation');
        const result = assertAttestationAt(checkedPlan, checkedAttestation, receivedAt);
        if (result && typeof result.then === 'function') fail('invalid_attestation');
      } catch {
        fail('invalid_attestation');
      }
    };
    if (old) {
      assertAt(old.plan, old.attestation, old.received_at);
      return old;
    }
    const receivedAt = (await client.query('SELECT transaction_timestamp() AS received_at')).rows[0]
      ?.received_at;
    assertAt(safePlan, safeAttestation, receivedAt);
    return (
      await client.query(
        `INSERT INTO public.candidate_material_reports(id,request_id,owner_id,plan_hash,plan,attestation)
       VALUES($1,$2,$3,$4,$5::jsonb,$6::jsonb) RETURNING *`,
        [
          randomUUID(),
          requestId,
          owner,
          planHash,
          JSON.stringify(safePlan),
          JSON.stringify(safeAttestation),
        ],
      )
    ).rows[0];
  });
}
export async function readMaterialReports({ pool, owner, requestId }) {
  ({ owner, id: requestId } = identity(owner, requestId));
  return transaction(
    pool,
    async (client) => {
      await requestRow(client, owner, requestId);
      return reports(client, owner, requestId);
    },
    true,
  );
}

async function reportWithReceipts(client, owner, report) {
  const receipts = (
    await client.query(
      'SELECT * FROM public.candidate_material_receipts WHERE report_id=$1 AND request_id=$2 AND owner_id=$3 ORDER BY created_at,id LIMIT 2',
      [report.id, report.request_id, owner],
    )
  ).rows;
  return { ...report, receipts };
}

/** Exact identity lookup, independent of the bounded dashboard history. */
export async function getMaterialReport({ pool, owner, requestId, reportId, planHash }) {
  ({ owner, id: requestId } = identity(owner, requestId));
  if ((reportId === undefined) === (planHash === undefined)) fail('invalid_request');
  const value = reportId === undefined ? hash(planHash) : identity(owner, reportId).id;
  const column = reportId === undefined ? 'plan_hash' : 'id';
  return transaction(
    pool,
    async (client) => {
      await requestRow(client, owner, requestId);
      const report = (
        await client.query(
          `SELECT * FROM public.candidate_material_reports WHERE request_id=$1 AND owner_id=$2 AND ${column}=$3 LIMIT 1`,
          [requestId, owner, value],
        )
      ).rows[0];
      if (!report) fail('not_found');
      return reportWithReceipts(client, owner, report);
    },
    true,
  );
}

/** The authoritative newest completed verification, not the newest request or
 * report. Pending reports cannot hide a previously verified material plan. */
export async function latestVerifiedMaterialReport({
  pool,
  owner,
  runId,
  candidateIndex: index,
  baseMaterialHash,
}) {
  ({ owner, id: runId } = identity(owner, runId));
  candidateIndex(index);
  hash(baseMaterialHash);
  return transaction(
    pool,
    async (client) => {
      const row = (
        await client.query(
          `SELECT r.*,to_jsonb(p) AS selected_report FROM public.candidate_material_requests r
       JOIN public.signal_generation_runs g ON g.id=r.run_id AND g.owner_id=r.owner_id
       JOIN public.candidate_material_reports p ON p.request_id=r.id AND p.owner_id=r.owner_id
       JOIN public.candidate_material_receipts c ON c.report_id=p.id AND c.request_id=r.id
         AND c.owner_id=r.owner_id AND c.plan_hash=p.plan_hash AND c.stage='verified'
       WHERE r.owner_id=$1 AND r.run_id=$2 AND r.candidate_index=$3 AND r.base_material_hash=$4
         AND g.deleted_at IS NULL AND g.status='completed'
       ORDER BY c.created_at DESC,c.id DESC LIMIT 1`,
          [owner, runId, index, baseMaterialHash],
        )
      ).rows[0];
      if (!row) return null;
      const { selected_report: selected, ...request } = row;
      const report = await reportWithReceipts(client, owner, selected);
      return { request: { ...request, reports: [report] }, report };
    },
    true,
  );
}

/** Trusted registration/verification service only. A receipt records an already
 * completed stage; passing stage='verified' does not perform verification. Never
 * expose this function as an endpoint accepting a browser-supplied stage. */
export async function saveMaterialReceipt({ pool, owner, requestId, reportId, planHash, stage }) {
  ({ owner, id: requestId } = identity(owner, requestId));
  identity(owner, reportId);
  hash(planHash);
  if (!['registered', 'verified'].includes(stage)) fail('invalid_request');
  return transaction(pool, async (client) => {
    const request = await requestRow(client, owner, requestId);
    await bindRun(client, owner, request);
    const report = (
      await client.query(
        'SELECT * FROM public.candidate_material_reports WHERE id=$1 AND request_id=$2 AND owner_id=$3 AND plan_hash=$4',
        [reportId, requestId, owner, planHash],
      )
    ).rows[0];
    if (!report) fail('not_found');
    const old = (
      await client.query(
        'SELECT * FROM public.candidate_material_receipts WHERE report_id=$1 AND request_id=$2 AND owner_id=$3',
        [reportId, requestId, owner],
      )
    ).rows;
    const replay = old.find((row) => row.stage === stage);
    if (replay) return replay;
    if (stage === 'verified' && !old.some((row) => row.stage === 'registered'))
      fail('stage_conflict');
    return (
      await client.query(
        `INSERT INTO public.candidate_material_receipts(id,request_id,report_id,owner_id,plan_hash,stage)
       VALUES($1,$2,$3,$4,$5,$6) RETURNING *`,
        [randomUUID(), requestId, reportId, owner, planHash, stage],
      )
    ).rows[0];
  });
}
