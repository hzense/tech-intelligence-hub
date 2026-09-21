import { createHash, randomUUID } from 'node:crypto';
import {
  CandidateReviewError,
  normalizeCandidateReviewRequest,
  candidateReviewMaterialHash,
  reviewOwner,
  reviewUuid,
} from './candidate-review-contract.mjs';
export { CandidateReviewError } from './candidate-review-contract.mjs';
const columns = 'id,run_id,candidate_index,revision,decision,note,draft,material_hash,created_at';
const fail = (code) => {
  throw new CandidateReviewError(code);
};
export async function saveCandidateReview({ pool, owner, request, materialHash }) {
  owner = reviewOwner(owner);
  const r = normalizeCandidateReviewRequest(request);
  if (materialHash !== r.materialHash) fail('material_changed');
  const fingerprint = createHash('sha256')
    .update(JSON.stringify({ owner, ...r }))
    .digest('hex');
  const client = await pool.connect();
  let committing = false;
  try {
    await client.query('BEGIN');
    await client.query('SET LOCAL search_path=pg_catalog,pg_temp');
    await client.query("SET LOCAL lock_timeout='5s'");
    await client.query("SET LOCAL statement_timeout='15s'");
    await client.query("SET LOCAL idle_in_transaction_session_timeout='20s'");
    // Serializes all reviewers for this run without granting UPDATE on generation.
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [r.runId]);
    const run = (
      await client.query(
        'SELECT id,owner_id,status,deleted_at,snapshot,source_hash,result FROM public.signal_generation_runs WHERE id=$1 AND owner_id=$2',
        [r.runId, owner],
      )
    ).rows[0];
    if (!run || run.deleted_at) fail('not_found');
    if (candidateReviewMaterialHash(run, r.candidateIndex) !== materialHash)
      fail('material_changed');
    const old = (
      await client.query(
        `SELECT ${columns},fingerprint FROM public.candidate_reviews WHERE request_id=$1 AND owner_id=$2`,
        [r.requestId, owner],
      )
    ).rows[0];
    if (old) {
      if (old.fingerprint !== fingerprint) fail('request_id_conflict');
      await client.query('COMMIT');
      const record = { ...old };
      delete record.fingerprint;
      return record;
    }
    const latest = (
      await client.query(
        'SELECT revision FROM public.candidate_reviews WHERE run_id=$1 AND candidate_index=$2 ORDER BY revision DESC LIMIT 1',
        [r.runId, r.candidateIndex],
      )
    ).rows[0];
    if ((latest?.revision ?? 0) !== r.expectedRevision) fail('revision_conflict');
    const row = (
      await client.query(
        `INSERT INTO public.candidate_reviews(id,request_id,owner_id,run_id,candidate_index,revision,material_hash,fingerprint,decision,note,draft) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb) RETURNING ${columns}`,
        [
          randomUUID(),
          r.requestId,
          owner,
          r.runId,
          r.candidateIndex,
          r.expectedRevision + 1,
          materialHash,
          fingerprint,
          r.decision,
          r.note,
          JSON.stringify(r.draft),
        ],
      )
    ).rows[0];
    committing = true;
    await client.query('COMMIT');
    return row;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    if (error instanceof CandidateReviewError) throw error;
    fail(
      committing
        ? 'commit_unknown'
        : error?.code === '23505'
          ? 'request_id_conflict'
          : 'database_unavailable',
    );
  } finally {
    client.release();
  }
}
export async function readCandidateReviews({ pool, owner, runId, candidateIndex }) {
  owner = reviewOwner(owner);
  runId = reviewUuid(runId);
  if (!Number.isInteger(candidateIndex) || candidateIndex < 0 || candidateIndex > 4)
    fail('invalid_request');
  const client = await pool.connect();
  try {
    await client.query('BEGIN READ ONLY');
    await client.query("SET LOCAL statement_timeout='15s'");
    const rows = (
      await client.query(
        `SELECT ${columns
          .split(',')
          .map((c) => `r.${c}`)
          .join(
            ',',
          )} FROM public.candidate_reviews r JOIN public.signal_generation_runs g ON g.id=r.run_id AND g.owner_id=r.owner_id WHERE r.owner_id=$1 AND r.run_id=$2 AND r.candidate_index=$3 AND g.deleted_at IS NULL ORDER BY r.revision DESC`,
        [owner, runId, candidateIndex],
      )
    ).rows;
    await client.query('COMMIT');
    return rows;
  } catch {
    await client.query('ROLLBACK').catch(() => {});
    fail('database_unavailable');
  } finally {
    client.release();
  }
}
