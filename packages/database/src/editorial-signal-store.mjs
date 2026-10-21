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
async function hasPublicationBasis(client) {
  const row = (
    await client.query(
      "SELECT has_column_privilege(c.oid,a.attnum,'SELECT') AS available FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace JOIN pg_catalog.pg_attribute a ON a.attrelid=c.oid WHERE n.nspname='public' AND c.relname='editorial_signal_revisions' AND a.attname='publication_basis' AND NOT a.attisdropped",
    )
  ).rows[0];
  // Only an absent column denotes the old manual-only schema. If the column
  // exists but ACL is incomplete, do not mislabel automatic publications.
  if (row?.available === false) fail('automatic_publication_unavailable');
  return row?.available === true;
}
export async function saveEditorialSignal({
  pool,
  owner,
  request,
  material,
  unified = false,
  automatic = false,
}) {
  owner = editorialText(owner, 200);
  const r = normalizeEditorialRequest(request, material, { checkPublication: false, automatic });
  if (automatic && (r.action !== 'publish' || r.expectedRevision !== 0 || r.consent !== false))
    fail('automatic_publication_invalid');
  const requestHash = createHash('sha256')
    .update(
      JSON.stringify({
        owner,
        ...r,
        ...(automatic ? { publicationBasis: 'automatic_checks' } : {}),
      }),
    )
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
    const basisAvailable = await hasPublicationBasis(client);
    if (automatic && !basisAvailable) fail('automatic_publication_unavailable');
    const selectedColumns = columns + (basisAvailable ? ',publication_basis' : '');
    const run = (
      await client.query(
        `SELECT id${automatic ? ',snapshot' : ''} FROM public.signal_generation_runs WHERE id=$1 AND owner_id=$2 AND status='completed' AND deleted_at IS NULL`,
        [r.runId, owner],
      )
    ).rows[0];
    if (!run) fail('not_found');
    if (automatic) {
      const policy = run.snapshot?.publication;
      if (policy?.mode !== 'automatic' || policy?.policy !== 'auto-publication-v1')
        fail('automatic_publication_not_authorized');
      if (
        !Array.isArray(policy.sourceUrls) ||
        !r.content.sourceUrls.length ||
        r.content.sourceUrls.some((url) => !policy.sourceUrls.includes(url))
      )
        fail('automatic_publication_source_invalid');
    }
    const old = (
      await client.query(
        `SELECT ${selectedColumns},request_hash FROM public.editorial_signal_revisions WHERE request_id=$1`,
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
        `SELECT ${selectedColumns} FROM public.editorial_signal_revisions WHERE run_id=$1 AND candidate_index=$2 AND owner_id=$3 ORDER BY revision DESC LIMIT 1`,
        [r.runId, r.candidateIndex, owner],
      )
    ).rows[0];
    if ((latest?.revision ?? 0) !== r.expectedRevision) fail('revision_conflict');
    if (r.action === 'draft' && latest?.action === 'publish') fail('published_draft_forbidden');
    if (r.action === 'withdraw' && latest?.action !== 'publish') fail('not_published');
    normalizeEditorialRequest(
      r,
      {
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
      },
      { automatic },
    );
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
            automatic,
          }),
        };
    }
    const row = (
      await client.query(
        `INSERT INTO public.editorial_signal_revisions(request_id,run_id,owner_id,candidate_index,revision,material_hash,action,content,request_hash${unified ? ',unified_content' : ''}${automatic ? ',publication_basis' : ''}) VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9${unified ? ',$10::jsonb' : ''}${automatic ? ",'automatic_checks'" : ''}) RETURNING ${selectedColumns}`,
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
    const selectedColumns =
      columns + ((await hasPublicationBasis(client)) ? ',publication_basis' : '');
    return (
      (
        await client.query(
          `SELECT ${selectedColumns
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
    const basisAvailable = await hasPublicationBasis(client);
    const rows = (
      await client.query(
        `WITH owned_runs AS (
          SELECT id FROM public.signal_generation_runs
          WHERE owner_id=$1 AND id=ANY($2::uuid[]) AND status='completed' AND deleted_at IS NULL
        ), latest AS (
          SELECT DISTINCT ON (r.run_id,r.candidate_index)
            r.run_id,r.candidate_index,r.revision,r.action${basisAvailable ? ',r.publication_basis' : ''}
          FROM public.editorial_signal_revisions r JOIN owned_runs g ON g.id=r.run_id
          WHERE r.owner_id=$1
          ORDER BY r.run_id,r.candidate_index,r.revision DESC
        )
        SELECT g.id AS run_id,r.candidate_index,r.revision,r.action,${basisAvailable ? 'r.publication_basis,' : ''}
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
          (basisAvailable &&
            !['manual_confirmation', 'automatic_checks'].includes(row.publication_basis)) ||
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
          ...(basisAvailable ? { publication_basis: row.publication_basis } : {}),
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
