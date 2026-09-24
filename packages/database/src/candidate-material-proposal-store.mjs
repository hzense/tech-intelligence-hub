import { createHash, randomUUID } from 'node:crypto';
import { Buffer } from 'node:buffer';
import {
  reviewOwner,
  reviewUuid,
  candidateReviewMaterialHash,
} from './candidate-review-contract.mjs';
import { normalizeMaterialPlan, materialPlanHash } from './material-registration-contract.mjs';
import { CandidateMaterialStoreError } from './candidate-material-store.mjs';

const fail = (code = 'invalid_request') => {
  throw new CandidateMaterialStoreError(code);
};
function identity(owner, requestId) {
  try {
    return { owner: reviewOwner(owner), requestId: reviewUuid(requestId) };
  } catch {
    fail();
  }
}
function uuid(value) {
  try {
    return reviewUuid(value);
  } catch {
    fail();
  }
}
function hash(value) {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) fail();
  return value;
}
function canonical(value, depth = 0) {
  if (depth > 30) fail();
  if (value === null || ['string', 'boolean'].includes(typeof value)) return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (Array.isArray(value)) return Array.from(value, (item) => canonical(item, depth + 1));
  if (!value || Object.getPrototypeOf(value) !== Object.prototype) fail();
  const result = {};
  for (const key of Object.keys(value).sort()) {
    if (['__proto__', 'constructor', 'prototype'].includes(key)) fail();
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !Object.hasOwn(descriptor, 'value')) fail();
    result[key] = canonical(descriptor.value, depth + 1);
  }
  return result;
}
function payloadValue(payload) {
  const safe = canonical(payload);
  if (
    !safe ||
    Array.isArray(safe) ||
    typeof safe !== 'object' ||
    Object.keys(safe).sort().join(',') !== 'dossier,plan' ||
    !safe.dossier ||
    Array.isArray(safe.dossier) ||
    typeof safe.dossier !== 'object' ||
    Buffer.byteLength(JSON.stringify(safe)) > 2_000_000
  )
    fail();
  try {
    safe.plan = normalizeMaterialPlan(safe.plan);
  } catch {
    fail('invalid_plan');
  }
  return canonical(safe);
}
export function materialProposalHash({ owner, requestId, payload }) {
  ({ owner, requestId } = identity(owner, requestId));
  return createHash('sha256')
    .update('hzense/material-proposal/v1\0')
    .update(JSON.stringify(canonical({ owner, requestId, payload: payloadValue(payload) })))
    .digest('hex');
}
async function transaction(pool, work, readOnly = false) {
  let client,
    committing = false;
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
async function requestRow(client, owner, requestId, lock) {
  const request = (
    await client.query(
      'SELECT * FROM public.candidate_material_requests WHERE id=$1 AND owner_id=$2',
      [requestId, owner],
    )
  ).rows[0];
  if (!request) fail('not_found');
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
  if (!run || run.deleted_at || run.status !== 'completed') fail('not_found');
  try {
    if (candidateReviewMaterialHash(run, request.candidate_index) !== request.base_material_hash)
      fail('material_changed');
  } catch {
    fail('material_changed');
  }
  return request;
}
function bindPlan(plan, request) {
  if (
    plan.owner !== request.owner_id ||
    plan.runId !== request.run_id ||
    plan.candidateIndex !== request.candidate_index ||
    plan.baseMaterialHash !== request.base_material_hash ||
    plan.sourceBundleHash !== request.bundle_hash
  )
    fail('material_changed');
}
function checkProposal(proposal, request) {
  const payload = payloadValue(proposal.payload);
  bindPlan(payload.plan, request);
  if (
    proposal.owner_id !== request.owner_id ||
    proposal.request_id !== request.id ||
    materialPlanHash(payload.plan) !== proposal.plan_hash ||
    materialProposalHash({ owner: request.owner_id, requestId: request.id, payload }) !==
      proposal.proposal_hash
  )
    fail('material_changed');
  return proposal;
}
async function proposalRow(client, owner, requestId, proposalId) {
  const row = (
    await client.query(
      'SELECT * FROM public.candidate_material_proposals WHERE id=$1 AND request_id=$2 AND owner_id=$3',
      [proposalId, requestId, owner],
    )
  ).rows[0];
  if (!row) fail('not_found');
  return row;
}
export async function createMaterialProposal({
  pool,
  owner,
  requestId,
  id = randomUUID(),
  payload,
}) {
  ({ owner, requestId } = identity(owner, requestId));
  id = uuid(id);
  const safe = payloadValue(payload);
  const planHash = materialPlanHash(safe.plan);
  const proposalHash = materialProposalHash({ owner, requestId, payload: safe });
  return transaction(pool, async (client) => {
    const request = await requestRow(client, owner, requestId, true);
    bindPlan(safe.plan, request);
    const byId = (
      await client.query(
        'SELECT * FROM public.candidate_material_proposals WHERE id=$1 AND request_id=$2 AND owner_id=$3',
        [id, requestId, owner],
      )
    ).rows[0];
    if (byId) {
      if (byId.proposal_hash !== proposalHash) fail('request_id_conflict');
      return checkProposal(byId, request);
    }
    const duplicate = (
      await client.query(
        'SELECT * FROM public.candidate_material_proposals WHERE request_id=$1 AND owner_id=$2 AND proposal_hash=$3',
        [requestId, owner, proposalHash],
      )
    ).rows[0];
    if (duplicate) return checkProposal(duplicate, request);
    return (
      (
        await client.query(
          `INSERT INTO public.candidate_material_proposals(id,request_id,owner_id,plan_hash,proposal_hash,payload)
      SELECT $1,r.id,r.owner_id,$4,$5,$6::jsonb FROM public.candidate_material_requests r
      WHERE r.id=$2 AND r.owner_id=$3 RETURNING *`,
          [id, requestId, owner, planHash, proposalHash, JSON.stringify(safe)],
        )
      ).rows[0] ?? fail('not_found')
    );
  });
}
export async function getMaterialProposal({ pool, owner, requestId, proposalId }) {
  ({ owner, requestId } = identity(owner, requestId));
  proposalId = uuid(proposalId);
  return transaction(
    pool,
    async (client) => {
      const request = await requestRow(client, owner, requestId, false);
      return checkProposal(await proposalRow(client, owner, requestId, proposalId), request);
    },
    true,
  );
}
export async function readMaterialProposals({ pool, owner, requestId }) {
  ({ owner, requestId } = identity(owner, requestId));
  return transaction(
    pool,
    async (client) => {
      const request = await requestRow(client, owner, requestId, false);
      return (
        await client.query(
          'SELECT * FROM public.candidate_material_proposals WHERE request_id=$1 AND owner_id=$2 ORDER BY created_at DESC,id DESC LIMIT 10',
          [requestId, owner],
        )
      ).rows.map((row) => checkProposal(row, request));
    },
    true,
  );
}
export async function approveMaterialProposal({
  pool,
  owner,
  requestId,
  proposalId,
  proposalHash,
  approvedBy,
}) {
  ({ owner, requestId } = identity(owner, requestId));
  proposalId = uuid(proposalId);
  proposalHash = hash(proposalHash);
  if (approvedBy !== owner) fail();
  return transaction(pool, async (client) => {
    const request = await requestRow(client, owner, requestId, true);
    const proposal = checkProposal(
      await proposalRow(client, owner, requestId, proposalId),
      request,
    );
    if (proposal.proposal_hash !== proposalHash) fail('material_changed');
    const old = (
      await client.query(
        'SELECT * FROM public.candidate_material_approvals WHERE proposal_id=$1 AND request_id=$2 AND owner_id=$3',
        [proposalId, requestId, owner],
      )
    ).rows[0];
    if (old) {
      if (old.proposal_hash !== proposalHash || old.approved_by !== owner) fail('material_changed');
      return old;
    }
    return (
      (
        await client.query(
          `INSERT INTO public.candidate_material_approvals(id,proposal_id,request_id,owner_id,proposal_hash,approved_by)
      SELECT $1,p.id,p.request_id,p.owner_id,p.proposal_hash,p.owner_id FROM public.candidate_material_proposals p
      JOIN public.candidate_material_requests r ON r.id=p.request_id AND r.owner_id=p.owner_id
      WHERE p.id=$2 AND p.request_id=$3 AND p.owner_id=$4 AND p.proposal_hash=$5 RETURNING *`,
          [randomUUID(), proposalId, requestId, owner, proposalHash],
        )
      ).rows[0] ?? fail('not_found')
    );
  });
}
export async function latestApprovedMaterialProposal({ pool, owner, requestId }) {
  ({ owner, requestId } = identity(owner, requestId));
  return transaction(
    pool,
    async (client) => {
      const request = await requestRow(client, owner, requestId, false);
      const approval = (
        await client.query(
          'SELECT * FROM public.candidate_material_approvals WHERE request_id=$1 AND owner_id=$2 ORDER BY created_at DESC,id DESC LIMIT 1',
          [requestId, owner],
        )
      ).rows[0];
      if (!approval) return null;
      const proposal = checkProposal(
        await proposalRow(client, owner, requestId, approval.proposal_id),
        request,
      );
      if (approval.proposal_hash !== proposal.proposal_hash || approval.approved_by !== owner)
        fail('material_changed');
      return { proposal, approval };
    },
    true,
  );
}
