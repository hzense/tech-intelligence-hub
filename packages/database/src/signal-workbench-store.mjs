import {
  SignalWorkbenchError,
  parseSignalWorkbenchListRequest,
  parseSignalWorkbenchDetailRequest,
  safeWorkbenchSourceUrl,
  verifySignalWorkbenchAccess,
} from './signal-workbench-contract.mjs';

const maximumRows = 50;
const checks = [
  'claims_supported',
  'people_disambiguated',
  'people_are_participants',
  'organizations_supported',
  'public_sources_cleared',
  'contradictions_resolved',
];
const statuses = new Set(['pending', 'verified', 'rejected']);
const unavailable = () => {
  throw new SignalWorkbenchError('database_unavailable');
};
function iso(value) {
  const date = new Date(value);
  if (value == null || !Number.isFinite(date.getTime())) unavailable();
  return date.toISOString();
}
function number(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) unavailable();
  return value;
}
function version(value) {
  if (!Number.isInteger(value) || value < 1 || value > 2_147_483_647) unavailable();
  return value;
}
function exactText(value, maximum = 200) {
  if (
    typeof value !== 'string' ||
    !value ||
    value.length > maximum ||
    [...value].some((character) => {
      const code = character.codePointAt(0);
      return code < 32 || (code >= 127 && code <= 159);
    })
  )
    unavailable();
  return value;
}
function signalId(value) {
  if (
    typeof value !== 'string' ||
    value.length > 200 ||
    value.match(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)?.[0] !== value
  )
    throw new SignalWorkbenchError('incompatible_data');
  return value;
}
function member(value, allowed) {
  if (!allowed.includes(value)) unavailable();
  return value;
}
function verificationStatus(value) {
  if (!statuses.has(value)) unavailable();
  return value;
}
function texts() {
  let truncated = false;
  return {
    read(value, maximum) {
      if (typeof value !== 'string') unavailable();
      if (value.length > maximum) truncated = true;
      // Stored source content is data, never HTML/Markdown or instructions.
      return value.slice(0, maximum);
    },
    mark(value) {
      if (value === true) truncated = true;
    },
    get truncated() {
      return truncated;
    },
  };
}
function head(row) {
  if (row.head_content_version == null) return null;
  return {
    content_version: version(row.head_content_version),
    publication_revision: version(row.head_publication_revision),
    status: member(row.head_status, ['published', 'withdrawn']),
    occurred_at: iso(row.head_occurred_at),
  };
}
const headSelect = `head.content_version AS head_content_version,
  head.publication_revision AS head_publication_revision,head.status AS head_status,
  head.occurred_at AS head_occurred_at,visible.version AS current_public_version`;

async function transaction(pool, operation) {
  let client;
  let started = false;
  let discard;
  try {
    if (!pool || typeof pool.connect !== 'function') unavailable();
    client = await pool.connect();
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    started = true;
    await client.query('SET LOCAL search_path = pg_catalog, pg_temp');
    await client.query("SET LOCAL statement_timeout='5s'");
    await client.query("SET LOCAL lock_timeout='5s'");
    await client.query("SET LOCAL idle_in_transaction_session_timeout='15s'");
    await verifySignalWorkbenchAccess(client);
    const clock = (
      await client.query('/* workbench:clock */ SELECT transaction_timestamp() AS observed_at')
    ).rows;
    if (clock.length !== 1) unavailable();
    const result = await operation(client, iso(clock[0].observed_at));
    await client.query('COMMIT');
    started = false;
    return result;
  } catch (error) {
    discard = error;
    if (started) await client?.query('ROLLBACK').catch(() => undefined);
    throw error instanceof SignalWorkbenchError
      ? error
      : new SignalWorkbenchError('database_unavailable');
  } finally {
    client?.release(discard);
  }
}

export async function listSignalWorkbench({ pool, request }) {
  const command = parseSignalWorkbenchListRequest(request);
  return transaction(pool, async (client, observedAt) => {
    const rows = (
      await client.query(
        `/* workbench:list */
      WITH latest AS (
        SELECT DISTINCT ON (signal_id COLLATE "C") signal_id,version,title,type,occurred_at
        FROM public.signal_versions ORDER BY signal_id COLLATE "C",version DESC
      ), page AS (
        SELECT signal_id,version,title,type,occurred_at FROM latest
        WHERE ($1::text='' OR strpos(lower(signal_id),lower($1::text))>0 OR strpos(lower(title),lower($1::text))>0)
          AND ($2::text='' OR signal_id COLLATE "C">$2::text COLLATE "C")
        ORDER BY signal_id COLLATE "C" LIMIT $3
      ) SELECT page.signal_id,page.version AS latest_snapshot_version,left(page.title,300) AS title,page.type,page.occurred_at,${headSelect}
      FROM page LEFT JOIN public.signal_publication_state head ON head.signal_id=page.signal_id
      LEFT JOIN public.current_public_signals visible ON visible.signal_id=page.signal_id
      ORDER BY page.signal_id COLLATE "C"`,
        [command.q, command.after, command.limit + 1],
      )
    ).rows;
    const items = rows.slice(0, command.limit).map((row) => ({
      signal_id: signalId(row.signal_id),
      title: texts().read(row.title, 300),
      type: exactText(row.type, 80),
      occurred_at: iso(row.occurred_at),
      latest_snapshot_version: version(row.latest_snapshot_version),
      recorded_head: head(row),
      current_public_version:
        row.current_public_version == null ? null : version(row.current_public_version),
    }));
    return {
      items,
      next_after: rows.length > command.limit ? items.at(-1).signal_id : null,
      observed_at: observedAt,
    };
  });
}

export async function getSignalWorkbenchDetail({ pool, request }) {
  const command = parseSignalWorkbenchDetailRequest(request);
  return transaction(pool, async (client, observedAt) => {
    const overviewRows = (
      await client.query(
        `/* workbench:overview */
      SELECT latest.signal_id,latest.version AS latest_snapshot_version,${headSelect}
      FROM (SELECT signal_id,version FROM public.signal_versions WHERE signal_id=$1 ORDER BY version DESC LIMIT 1) latest
      LEFT JOIN public.signal_publication_state head ON head.signal_id=latest.signal_id
      LEFT JOIN public.current_public_signals visible ON visible.signal_id=latest.signal_id`,
        [command.signal_id],
      )
    ).rows;
    if (overviewRows.length === 0) throw new SignalWorkbenchError('not_found');
    if (overviewRows.length !== 1) unavailable();
    const overview = overviewRows[0];
    const selectedVersion = command.version ?? version(overview.latest_snapshot_version);
    const values = [command.signal_id, selectedVersion];
    const snapshotRows = (
      await client.query(
        `/* workbench:snapshot */
      SELECT version,left(title,300) AS title,type,occurred_at,date_precision,left(date_basis,1000) AS date_basis,captured_at,
        left(summary,4000) AS summary,left(analysis,12000) AS analysis,importance,strength,confidence,novelty,
        left(revision_reason,1000) AS revision_reason,origin,created_at,
        (length(title)>300 OR length(date_basis)>1000 OR length(summary)>4000 OR COALESCE(length(analysis)>12000,false) OR length(revision_reason)>1000) AS text_truncated
      FROM public.signal_versions WHERE signal_id=$1 AND version=$2 LIMIT 1`,
        values,
      )
    ).rows;
    if (snapshotRows.length === 0) throw new SignalWorkbenchError('not_found');
    if (snapshotRows.length !== 1) unavailable();
    const text = texts();
    const snapshotRow = snapshotRows[0];
    text.mark(snapshotRow.text_truncated);
    const snapshot = {
      version: version(snapshotRow.version),
      title: text.read(snapshotRow.title, 300),
      type: exactText(snapshotRow.type, 80),
      occurred_at: iso(snapshotRow.occurred_at),
      date_precision: member(snapshotRow.date_precision, ['day', 'instant']),
      date_basis: text.read(snapshotRow.date_basis, 1000),
      captured_at: iso(snapshotRow.captured_at),
      summary: text.read(snapshotRow.summary, 4000),
      analysis: snapshotRow.analysis == null ? null : text.read(snapshotRow.analysis, 12000),
      importance: number(snapshotRow.importance),
      strength: number(snapshotRow.strength),
      confidence: number(snapshotRow.confidence),
      novelty: number(snapshotRow.novelty),
      revision_reason: text.read(snapshotRow.revision_reason, 1000),
      origin: member(snapshotRow.origin, ['legacy_seed', 'pipeline', 'manual']),
      created_at: iso(snapshotRow.created_at),
    };
    const truncated = {
      versions: false,
      evidence: false,
      people: false,
      organizations: false,
      topics: false,
      verifications: false,
      text: false,
    };
    async function bounded(kind, sql, parameters, mapper) {
      const rows = (await client.query(sql, parameters)).rows;
      truncated[kind] = rows.length > maximumRows;
      return rows.slice(0, maximumRows).map((row) => {
        text.mark(row.text_truncated);
        return mapper(row);
      });
    }
    const versions = await bounded(
      'versions',
      `/* workbench:versions */
      SELECT version,left(title,300) AS title,created_at,left(revision_reason,1000) AS revision_reason,origin,
        (length(title)>300 OR length(revision_reason)>1000) AS text_truncated,
        EXISTS(SELECT 1 FROM public.signal_candidate_assembly_receipts a WHERE a.signal_id=s.signal_id AND a.target_version=s.version) AS assembled_candidate,
        EXISTS(SELECT 1 FROM public.signal_qualified_publication_receipts q WHERE q.signal_id=s.signal_id AND q.target_version=s.version) AS publication_snapshot
      FROM public.signal_versions s WHERE signal_id=$1 ORDER BY version DESC LIMIT 51`,
      [command.signal_id],
      (row) => ({
        version: version(row.version),
        title: text.read(row.title, 300),
        created_at: iso(row.created_at),
        revision_reason: text.read(row.revision_reason, 1000),
        origin: member(row.origin, ['legacy_seed', 'pipeline', 'manual']),
        assembled_candidate: row.assembled_candidate === true,
        publication_snapshot: row.publication_snapshot === true,
      }),
    );
    const evidence = await bounded(
      'evidence',
      `/* workbench:evidence */
      SELECT link.evidence_id,left(link.claim,1000) AS claim,link.relation,e.verification_status,e.source_id,
        left(source.name,200) AS source_name,source.active AS source_active,
        CASE WHEN length(e.source_url)<=2048 THEN e.source_url ELSE NULL END AS source_url,e.captured_at,e.source_published_at,
        (length(link.claim)>1000 OR length(source.name)>200) AS text_truncated
      FROM public.signal_version_evidence link JOIN public.public_source_evidence e ON e.id=link.evidence_id
      JOIN public.sources source ON source.id=e.source_id
      WHERE link.signal_id=$1 AND link.version=$2 ORDER BY link.evidence_id COLLATE "C" LIMIT 51`,
      values,
      (row) => ({
        evidence_id: exactText(row.evidence_id),
        claim: text.read(row.claim, 1000),
        relation: member(row.relation, ['supports', 'contradicts', 'context']),
        verification_status: verificationStatus(row.verification_status),
        source_id: exactText(row.source_id),
        source_name: text.read(row.source_name, 200),
        source_active: row.source_active === true,
        source_url: safeWorkbenchSourceUrl(row.source_url),
        captured_at: iso(row.captured_at),
        source_published_at: row.source_published_at == null ? null : iso(row.source_published_at),
      }),
    );
    async function participants(kind, table, identityColumn) {
      // Both identifiers are fixed server constants, never request parameters.
      return bounded(
        kind,
        `/* workbench:${kind} */
        SELECT link.${identityColumn} AS entity_id,left(entity.name,200) AS name,entity.type AS entity_type,left(entity.status,80) AS entity_status,
          left(link.event_role,300) AS event_role,link.evidence_id,link.verification_status,
          (length(entity.name)>200 OR length(entity.status)>80 OR length(link.event_role)>300) AS text_truncated
        FROM public.${table} link JOIN public.entities entity ON entity.id=link.${identityColumn}
        WHERE link.signal_id=$1 AND link.version=$2 ORDER BY link.${identityColumn} COLLATE "C",link.evidence_id COLLATE "C" LIMIT 51`,
        values,
        (row) => ({
          entity_id: exactText(row.entity_id),
          name: text.read(row.name, 200),
          entity_type: exactText(row.entity_type, 80),
          entity_status: text.read(row.entity_status, 80),
          event_role: text.read(row.event_role, 300),
          evidence_id: exactText(row.evidence_id),
          verification_status: verificationStatus(row.verification_status),
        }),
      );
    }
    const people = await participants('people', 'signal_version_people', 'person_id');
    const organizations = await participants(
      'organizations',
      'signal_version_organizations',
      'organization_id',
    );
    const topics = await bounded(
      'topics',
      `/* workbench:topics */
      SELECT t.id,left(t.title,200) AS title,length(t.title)>200 AS text_truncated
      FROM public.signal_version_topics link JOIN public.topics t ON t.id=link.topic_id
      WHERE link.signal_id=$1 AND link.version=$2 ORDER BY t.id COLLATE "C" LIMIT 51`,
      values,
      (row) => ({ id: exactText(row.id), title: text.read(row.title, 200) }),
    );
    const verifications = await bounded(
      'verifications',
      `/* workbench:verifications */
      SELECT v.verification_id,v.source_version,v.decision,v.verified_at,v.expires_at,
        v.expires_at<=transaction_timestamp() AS expired,seal.invalidated AS dependency_invalidated,
        ${checks.map((field) => `CASE WHEN jsonb_typeof(v.checks->'${field}')='boolean' THEN (v.checks->>'${field}')::boolean ELSE NULL END AS ${field}`).join(',')}
      FROM public.signal_candidate_verifications v LEFT JOIN public.signal_verification_dependency_seals seal ON seal.verification_id=v.verification_id
      WHERE v.signal_id=$1 AND (v.source_version=$2 OR EXISTS(
        SELECT 1 FROM public.signal_candidate_assembly_receipts a WHERE a.signal_id=v.signal_id AND a.verification_id=v.verification_id
          AND (a.target_version=$2 OR EXISTS(SELECT 1 FROM public.signal_qualified_publication_receipts q
            WHERE q.signal_id=a.signal_id AND q.source_version=a.target_version AND q.target_version=$2))))
      ORDER BY v.verified_at DESC,v.verification_id LIMIT 51`,
      values,
      (row) => ({
        verification_id: exactText(row.verification_id, 36),
        source_version: version(row.source_version),
        decision: member(row.decision, ['approved', 'rejected']),
        verified_at: iso(row.verified_at),
        expires_at: iso(row.expires_at),
        expired: row.expired === true,
        dependency_invalidated:
          typeof row.dependency_invalidated === 'boolean' ? row.dependency_invalidated : null,
        checks: Object.fromEntries(
          checks.map((field) => [field, typeof row[field] === 'boolean' ? row[field] : null]),
        ),
      }),
    );
    truncated.text = text.truncated;
    return {
      signal_id: signalId(overview.signal_id),
      latest_snapshot_version: version(overview.latest_snapshot_version),
      selected_version: selectedVersion,
      snapshot,
      recorded_head: head(overview),
      current_public_version:
        overview.current_public_version == null ? null : version(overview.current_public_version),
      versions,
      evidence,
      people,
      organizations,
      topics,
      verifications,
      truncated,
      observed_at: observedAt,
    };
  });
}
