import { createHash } from 'node:crypto';
import {
  EditorialSignalError,
  editorialFail as fail,
  editorialText,
  editorialUuid,
  normalizeEditorialRequest,
} from './editorial-signal-contract.mjs';
export { EditorialSignalError } from './editorial-signal-contract.mjs';
const columns =
  'request_id,run_id,owner_id,candidate_index,revision,material_hash,action,content,created_at';
export async function saveEditorialSignal({ pool, owner, request, material }) {
  owner = editorialText(owner, 200);
  const r = normalizeEditorialRequest(request, material);
  const requestHash = createHash('sha256')
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
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [r.runId]);
    const run = (
      await client.query(
        "SELECT id FROM public.signal_generation_runs WHERE id=$1 AND owner_id=$2 AND status='completed' AND deleted_at IS NULL",
        [r.runId, owner],
      )
    ).rows[0];
    if (!run) fail('not_found');
    const old = (
      await client.query(
        `SELECT ${columns},request_hash FROM public.editorial_signal_revisions WHERE request_id=$1`,
        [r.requestId],
      )
    ).rows[0];
    if (old) {
      if (old.owner_id !== owner || old.request_hash !== requestHash) fail('request_id_conflict');
      await client.query('COMMIT');
      const receipt = { ...old };
      delete receipt.request_hash;
      return receipt;
    }
    const latest = (
      await client.query(
        `SELECT ${columns} FROM public.editorial_signal_revisions WHERE run_id=$1 AND candidate_index=$2 AND owner_id=$3 ORDER BY revision DESC LIMIT 1`,
        [r.runId, r.candidateIndex, owner],
      )
    ).rows[0];
    if ((latest?.revision ?? 0) !== r.expectedRevision) fail('revision_conflict');
    if (r.action === 'draft' && latest?.action === 'publish') fail('published_draft_forbidden');
    if (r.action === 'withdraw' && latest?.action !== 'publish') fail('not_published');
    const content = r.action === 'withdraw' ? latest.content : r.content;
    if (r.action !== 'withdraw') {
      const topics = (
        await client.query(
          "SELECT id,title FROM public.topics WHERE id=ANY($1::text[]) AND runtime_enabled AND status<>'archived'",
          [content.topics.map((item) => item.id)],
        )
      ).rows;
      if (
        topics.length !== content.topics.length ||
        content.topics.some(
          (item) => !topics.some((topic) => topic.id === item.id && topic.title === item.title),
        )
      )
        fail('topic_reference_invalid');
    }
    const row = (
      await client.query(
        `INSERT INTO public.editorial_signal_revisions(request_id,run_id,owner_id,candidate_index,revision,material_hash,action,content,request_hash) VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9) RETURNING ${columns}`,
        [
          r.requestId,
          r.runId,
          owner,
          r.candidateIndex,
          r.expectedRevision + 1,
          r.materialHash,
          r.action,
          JSON.stringify(content),
          requestHash,
        ],
      )
    ).rows[0];
    committing = true;
    await client.query('COMMIT');
    return row;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    if (error instanceof EditorialSignalError) throw error;
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
export async function readEditorialSignal({ pool, owner, runId, candidateIndex }) {
  owner = editorialText(owner, 200);
  editorialUuid(runId);
  if (!Number.isInteger(candidateIndex) || candidateIndex < 0 || candidateIndex > 4) fail();
  const client = await pool.connect();
  try {
    return (
      (
        await client.query(
          `SELECT ${columns
            .split(',')
            .map((column) => `r.${column}`)
            .join(
              ',',
            )} FROM public.editorial_signal_revisions r JOIN public.signal_generation_runs g ON g.id=r.run_id AND g.owner_id=r.owner_id WHERE r.run_id=$1 AND r.candidate_index=$2 AND r.owner_id=$3 AND g.deleted_at IS NULL ORDER BY r.revision DESC LIMIT 1`,
          [runId, candidateIndex, owner],
        )
      ).rows[0] ?? null
    );
  } catch {
    fail('database_unavailable');
  } finally {
    client.release();
  }
}
