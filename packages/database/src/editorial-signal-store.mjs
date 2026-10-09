import { createHash } from 'node:crypto';
import {
  EditorialSignalError,
  editorialFail as fail,
  editorialText,
  editorialUuid,
  normalizeEditorialRequest,
} from './editorial-signal-contract.mjs';
import { registerEditorialResources } from './editorial-resource-store.mjs';
import { editorialUnifiedContent } from './unified-signal-plan.mjs';
export { previewEditorialResources } from './editorial-resource-store.mjs';
export { EditorialSignalError } from './editorial-signal-contract.mjs';
const columns =
  'request_id,run_id,owner_id,candidate_index,revision,material_hash,action,content,created_at';
export async function saveEditorialSignal({ pool, owner, request, material, unified = false }) {
  owner = editorialText(owner, 200);
  const r = normalizeEditorialRequest(request, material, { checkPublication: false });
  const requestHash = createHash('sha256')
    .update(JSON.stringify({ owner, ...r }))
    .digest('hex');
  const client = await pool.connect();
  let committing = false;
  let discard = false;
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
    normalizeEditorialRequest(r, {
      ...material,
      // Only the committed latest revision may retain a previously selected
      // source after its import becomes unavailable. Read it under this lock,
      // never trust a stale service read or the caller's source selection.
      sourceOptions: [
        ...new Set([
          ...(material.sourceOptions ?? material.sourceUrls),
          ...(latest?.content.sourceUrls ?? []),
        ]),
      ],
    });
    let content = r.action === 'withdraw' ? latest.content : r.content;
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
      if (r.action === 'publish' && content.resources)
        content = {
          ...content,
          resources: await registerEditorialResources({
            client,
            resources: content.resources,
            catalog: material.resourceCatalog,
            sourceOptions: material.resourceSourceOptions,
            sourceUrls: content.sourceUrls,
            priorResources:
              latest?.action === 'publish' || latest?.action === 'withdraw'
                ? latest.content.resources
                : undefined,
            runId: r.runId,
            candidateIndex: r.candidateIndex,
          }),
        };
    }
    const row = (
      await client.query(
        `INSERT INTO public.editorial_signal_revisions(request_id,run_id,owner_id,candidate_index,revision,material_hash,action,content,request_hash${unified ? ',unified_content' : ''}) VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9${unified ? ',$10::jsonb' : ''}) RETURNING ${columns}`,
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
          ...(unified ? [JSON.stringify(editorialUnifiedContent(content))] : []),
        ],
      )
    ).rows[0];
    committing = true;
    await client.query('COMMIT');
    return row;
  } catch (error) {
    discard = !(error instanceof EditorialSignalError);
    await client.query('ROLLBACK').catch(() => {
      discard = true;
    });
    if (error instanceof EditorialSignalError) throw error;
    fail(
      committing
        ? 'commit_unknown'
        : error?.code === '23505'
          ? 'request_id_conflict'
          : 'database_unavailable',
    );
  } finally {
    client.release(discard);
  }
}
export async function readEditorialSignal({ pool, owner, runId, candidateIndex }) {
  owner = editorialText(owner, 200);
  editorialUuid(runId);
  if (!Number.isInteger(candidateIndex) || candidateIndex < 0 || candidateIndex > 4) fail();
  const client = await pool.connect();
  let discard = false;
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
    discard = true;
    fail('database_unavailable');
  } finally {
    client.release(discard);
  }
}

/** Read current publication receipts without reading private content or changing task state. */
export async function readEditorialSignalStatuses({ pool, owner, runIds }) {
  owner = editorialText(owner, 200);
  if (!Array.isArray(runIds) || runIds.length > 50) fail();
  const ids = [...new Set(Array.from(runIds, editorialUuid))];
  if (!ids.length) return [];
  const client = await pool.connect();
  let discard = false;
  try {
    const rows = (
      await client.query(
        `WITH owned_runs AS (
          SELECT id FROM public.signal_generation_runs
          WHERE owner_id=$1 AND id=ANY($2::uuid[]) AND status='completed' AND deleted_at IS NULL
        ), latest AS (
          SELECT DISTINCT ON (r.run_id,r.candidate_index)
            r.run_id,r.candidate_index,r.revision,r.action
          FROM public.editorial_signal_revisions r JOIN owned_runs g ON g.id=r.run_id
          WHERE r.owner_id=$1
          ORDER BY r.run_id,r.candidate_index,r.revision DESC
        )
        SELECT g.id AS run_id,r.candidate_index,r.revision,r.action,
          CASE WHEN r.action='publish' THEN 'editorial-' || md5(g.id::text || ':' || r.candidate_index::text)
            ELSE NULL END AS public_id
        FROM owned_runs g LEFT JOIN latest r ON r.run_id=g.id
        ORDER BY g.id,r.candidate_index`,
        [owner, ids],
      )
    ).rows;
    const statuses = new Map();
    for (const row of rows) {
      if (!ids.includes(row.run_id)) fail('database_unavailable');
      const entry = statuses.get(row.run_id) ?? { run_id: row.run_id, candidates: [] };
      if (row.candidate_index === null) {
        if (row.revision !== null || row.action !== null || row.public_id !== null)
          fail('database_unavailable');
      } else {
        if (
          !Number.isInteger(row.candidate_index) ||
          row.candidate_index < 0 ||
          row.candidate_index > 4 ||
          !Number.isSafeInteger(row.revision) ||
          row.revision < 1 ||
          !['draft', 'publish', 'withdraw'].includes(row.action) ||
          entry.candidates.some((candidate) => candidate.candidate_index === row.candidate_index) ||
          (row.action === 'publish'
            ? typeof row.public_id !== 'string' || !/^editorial-[a-f0-9]{32}$/.test(row.public_id)
            : row.public_id !== null)
        )
          fail('database_unavailable');
        entry.candidates.push({
          candidate_index: row.candidate_index,
          revision: row.revision,
          action: row.action,
          public_id: row.public_id,
        });
      }
      statuses.set(row.run_id, entry);
    }
    return [...statuses.values()];
  } catch {
    discard = true;
    fail('database_unavailable');
  } finally {
    client.release(discard);
  }
}
