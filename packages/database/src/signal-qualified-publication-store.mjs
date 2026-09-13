import { randomUUID } from 'node:crypto';
import { lockPrivatePublicationControls } from './signal-publication-control-store.mjs';
import { planSignalPublicationTransition } from './signal-publication-transition.mjs';
import {
  QualifiedPublicationError,
  parseQualifiedPublicationRequest,
  fingerprintQualifiedPublicationRequest,
  cloneSignalSnapshotForPublication,
  qualifySignalPublicationBundle,
} from './signal-publication-qualification.mjs';

// PRIVATE trusted adapter, not an authenticated API, production Publisher or
// public-read permission. Inputs reference a previously sealed, recorded-verified
// candidate. This cannot upgrade writer-created pending evidence/person edges.
// Own the entire short transaction; never pass an existing Client as a fake Pool.
// No network/model calls, caller callbacks, arbitrary SQL or new grants here.
const snapshotColumns = [
  'signal_id',
  'version',
  'schema_version',
  'title',
  'type',
  'occurred_at',
  'date_precision',
  'date_basis',
  'captured_at',
  'summary',
  'analysis',
  'importance',
  'strength',
  'confidence',
  'novelty',
  'revision_reason',
  'origin',
  'legacy_status',
  'content_hash',
];
const headColumns = 'signal_id, publication_revision, content_version, status';
const receiptColumns = `request_key, request_fingerprint, signal_id, expected_revision,
  publication_revision, content_version, status, reason_code`;
const edgeColumns = {
  signal_version_evidence: ['signal_id', 'version', 'evidence_id', 'claim', 'relation'],
  signal_version_people: [
    'signal_id',
    'version',
    'person_id',
    'evidence_id',
    'event_role',
    'verification_status',
  ],
  signal_version_organizations: [
    'signal_id',
    'version',
    'organization_id',
    'evidence_id',
    'event_role',
    'verification_status',
  ],
  signal_version_topics: ['signal_id', 'version', 'topic_id'],
};
const edgeOrders = {
  signal_version_evidence: 'evidence_id COLLATE "C"',
  signal_version_people: 'person_id COLLATE "C", evidence_id COLLATE "C"',
  signal_version_organizations: 'organization_id COLLATE "C", evidence_id COLLATE "C"',
  signal_version_topics: 'topic_id COLLATE "C"',
};
const deny = (code) => {
  throw new QualifiedPublicationError(code);
};
const one = (result, code) => (result.rows.length === 1 ? result.rows[0] : deny(code));
const ids = (rows, key) => [...new Set(rows.map((row) => row[key]))].sort();
function bounded(rows) {
  if (rows.length > 256) deny('too_many_dependencies');
  return rows;
}
function transitionRequest(command) {
  return {
    request_key: command.request_key,
    signal_id: command.signal_id,
    action: 'publish',
    target_version: command.target_version,
    expected_revision: command.expected_revision,
    reason_code: command.reason_code,
  };
}
function gateRequest(command) {
  return {
    run_id: command.run_id,
    lease_owner: command.lease_owner,
    fencing_token: command.fencing_token,
  };
}

async function edges(client, table, signalId, version) {
  // table/columns/order are module-owned constants, never request input.
  return bounded(
    (
      await client.query(
        `SELECT ${edgeColumns[table].join(', ')} FROM public.${table}
     WHERE signal_id=$1 AND version=$2 ORDER BY ${edgeOrders[table]} LIMIT 257`,
        [signalId, version],
      )
    ).rows,
  );
}

// Internal shared reader for trusted candidate verification. Not a package API.
export async function lockBundle(client, command) {
  const result = await client.query(
    `SELECT ${snapshotColumns.join(', ')},
       created_xid <> pg_catalog.pg_current_xact_id() AS sealed,
       (pg_catalog.isfinite(occurred_at) AND pg_catalog.isfinite(captured_at)
        AND EXTRACT(YEAR FROM occurred_at AT TIME ZONE 'UTC') BETWEEN 1 AND 9999
        AND EXTRACT(YEAR FROM captured_at AT TIME ZONE 'UTC') BETWEEN 1 AND 9999
        AND pg_catalog.date_trunc('milliseconds',occurred_at)=occurred_at
        AND pg_catalog.date_trunc('milliseconds',captured_at)=captured_at) AS precise
     FROM public.signal_versions WHERE signal_id=$1 AND version=$2 FOR SHARE`,
    [command.signal_id, command.source_version],
  );
  const { sealed, precise, ...snapshot } = one(result, 'snapshot_not_found');
  if (!sealed) deny('snapshot_not_sealed');
  // pg's Date decoder truncates microseconds. Check the database value BEFORE
  // canonical JS hashing; do not silently bless a lossy timestamp round-trip.
  if (!precise) deny('snapshot_timestamp_precision');
  const identity = one(
    await client.query(
      `SELECT signal_id,event_key,basis_version,basis_evidence_id,identity_basis
     FROM public.signal_event_identities WHERE signal_id=$1 FOR SHARE`,
      [command.signal_id],
    ),
    'event_identity_not_found',
  );
  const evidence_links = await edges(
    client,
    'signal_version_evidence',
    command.signal_id,
    command.source_version,
  );
  const identity_links =
    identity.basis_version === command.source_version
      ? evidence_links
      : await edges(client, 'signal_version_evidence', command.signal_id, identity.basis_version);
  const people = await edges(
    client,
    'signal_version_people',
    command.signal_id,
    command.source_version,
  );
  const organizations = await edges(
    client,
    'signal_version_organizations',
    command.signal_id,
    command.source_version,
  );
  const topic_links = await edges(
    client,
    'signal_version_topics',
    command.signal_id,
    command.source_version,
  );
  const evidenceIds = bounded(ids([...evidence_links, ...identity_links], 'evidence_id'));
  // Evidence.source_id is sealed, so this unlocked routing read is safe. Current
  // evidence status is read again under its lock, never reused from routing.
  const routes = bounded(
    (
      await client.query(
        'SELECT id,source_id FROM public.public_source_evidence WHERE id=ANY($1::text[])',
        [evidenceIds],
      )
    ).rows,
  );
  // Mutable dependencies: Source -> Evidence -> Entity -> profiles -> Topic.
  // Sort immutable primary IDs with C collation within every table. Future
  // coordinated revocations must follow the same order; owner DDL is out of scope.
  const sources = bounded(
    (
      await client.query(
        `SELECT id,active,allowed_hosts FROM public.sources WHERE id=ANY($1::text[])
     ORDER BY id COLLATE "C" FOR SHARE`,
        [ids(routes, 'source_id')],
      )
    ).rows,
  );
  const evidence = bounded(
    (
      await client.query(
        `SELECT id,source_id,source_url,verification_status FROM public.public_source_evidence
     WHERE id=ANY($1::text[]) ORDER BY id COLLATE "C" FOR SHARE`,
        [evidenceIds],
      )
    ).rows,
  );
  const personIds = ids(people, 'person_id');
  const organizationIds = ids(organizations, 'organization_id');
  const entities = bounded(
    (
      await client.query(
        `SELECT id,type,status FROM public.entities WHERE id=ANY($1::text[])
     ORDER BY id COLLATE "C" FOR SHARE`,
        [bounded([...new Set([...personIds, ...organizationIds])].sort())],
      )
    ).rows,
  );
  const person_profiles = bounded(
    (
      await client.query(
        `SELECT entity_id,entity_type FROM public.person_profiles WHERE entity_id=ANY($1::text[])
     ORDER BY entity_id COLLATE "C" FOR SHARE`,
        [personIds],
      )
    ).rows,
  );
  const organization_profiles = bounded(
    (
      await client.query(
        `SELECT entity_id,entity_type FROM public.organization_profiles WHERE entity_id=ANY($1::text[])
     ORDER BY entity_id COLLATE "C" FOR SHARE`,
        [organizationIds],
      )
    ).rows,
  );
  const topics = bounded(
    (
      await client.query(
        `SELECT id,status,runtime_enabled FROM public.topics WHERE id=ANY($1::text[])
     ORDER BY id COLLATE "C" FOR SHARE`,
        [ids(topic_links, 'topic_id')],
      )
    ).rows,
  );
  return {
    snapshot,
    identity,
    evidence_links,
    identity_links,
    people,
    organizations,
    topic_links,
    evidence,
    sources,
    entities,
    person_profiles,
    organization_profiles,
    topics,
  };
}

// Internal shared writer: callers must own the transaction and validate all rows.
export async function assembleVersion(client, snapshot, bundle) {
  await client.query(
    `INSERT INTO public.signal_versions (${snapshotColumns.join(', ')})
     VALUES (${snapshotColumns.map((_, index) => `$${index + 1}`).join(', ')})`,
    snapshotColumns.map((column) => snapshot[column]),
  );
  for (const [table, rows] of [
    ['signal_version_evidence', bundle.evidence_links],
    ['signal_version_people', bundle.people],
    ['signal_version_organizations', bundle.organizations],
    ['signal_version_topics', bundle.topic_links],
  ]) {
    const columns = edgeColumns[table];
    for (const row of rows) {
      await client.query(
        `INSERT INTO public.${table} (${columns.join(', ')})
         VALUES (${columns.map((_, index) => `$${index + 1}`).join(', ')})`,
        columns.map((column) => (column === 'version' ? snapshot.version : row[column])),
      );
    }
  }
}

/**
 * Clone a sealed recorded-qualified candidate into a NEW immutable version and
 * write head + Outbox + bound receipt in the SAME transaction as all checks.
 * A completed receipt replay is private historical information, even if the
 * original run is now cancelled/expired. It never authorizes a new transition.
 */
export async function publishPrivateQualifiedSignalVersion({ pool, request }) {
  const command = parseQualifiedPublicationRequest(request);
  const fingerprint = fingerprintQualifiedPublicationRequest(command);
  if (!pool || typeof pool.connect !== 'function')
    throw new TypeError('A dedicated connection pool is required');
  const client = await pool.connect();
  let started = false;
  let discard;
  try {
    await client.query('BEGIN ISOLATION LEVEL READ COMMITTED');
    started = true;
    await client.query('SET LOCAL search_path = pg_catalog, pg_temp');
    await client.query("SET LOCAL lock_timeout = '5s'");
    await client.query("SET LOCAL statement_timeout = '15s'");
    await client.query("SET LOCAL idle_in_transaction_session_timeout = '15s'");
    // Share the old primitive's request namespace to reject cross-path reuse.
    await client.query(
      `SELECT pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended('hzense:signal-publication:' || $1::text,0))`,
      [command.request_key],
    );
    const bound = (
      await client.query(
        `SELECT request_key,request_fingerprint,signal_id,source_version,target_version,run_id
       FROM public.signal_qualified_publication_receipts WHERE request_key=$1`,
        [command.request_key],
      )
    ).rows[0];
    const outbox = (
      await client.query(
        `SELECT ${receiptColumns},event_id FROM public.signal_publication_outbox WHERE request_key=$1`,
        [command.request_key],
      )
    ).rows[0];
    if (bound) {
      if (
        bound.request_fingerprint !== fingerprint ||
        ['request_key', 'signal_id', 'source_version', 'target_version', 'run_id'].some(
          (key) => bound[key] !== command[key],
        )
      )
        deny('request_key_reused');
      if (!outbox) deny('invalid_publication_receipt');
      const { event_id, ...receipt } = outbox;
      const head =
        (
          await client.query(
            `SELECT ${headColumns} FROM public.signal_publication_state WHERE signal_id=$1`,
            [command.signal_id],
          )
        ).rows[0] ?? null;
      const replay = planSignalPublicationTransition({ head, receipt }, transitionRequest(command));
      if (replay.outcome !== 'replay') deny('invalid_publication_receipt');
      await client.query('COMMIT');
      started = false;
      return {
        ...replay,
        scope: 'private_historical_receipt',
        receipt: { ...replay.receipt, event_id },
      };
    }
    if (outbox) deny('unbound_publication_receipt');
    const controlRequest = gateRequest(command);
    await lockPrivatePublicationControls({ client, request: controlRequest });
    one(
      await client.query('SELECT id FROM public.signals WHERE id=$1 FOR UPDATE', [
        command.signal_id,
      ]),
      'signal_not_found',
    );
    const head =
      (
        await client.query(
          `SELECT ${headColumns} FROM public.signal_publication_state WHERE signal_id=$1 FOR UPDATE`,
          [command.signal_id],
        )
      ).rows[0] ?? null;
    const plan = planSignalPublicationTransition(
      { head, receipt: null },
      transitionRequest(command),
    );
    if (plan.outcome !== 'apply') deny(plan.reason);
    const { maximum } = one(
      await client.query(
        'SELECT max(version) AS maximum FROM public.signal_versions WHERE signal_id=$1',
        [command.signal_id],
      ),
      'snapshot_not_found',
    );
    if (maximum === null) deny('snapshot_not_found');
    if (command.target_version <= maximum) deny('target_version_not_new');
    const bundle = await lockBundle(client, command);
    qualifySignalPublicationBundle(bundle);
    const snapshot = cloneSignalSnapshotForPublication(bundle.snapshot, command.target_version);
    // The first gate can precede dependency waits. Check current clock again now.
    await lockPrivatePublicationControls({ client, request: controlRequest });
    await assembleVersion(client, snapshot, bundle);
    const event = plan.event;
    const inserted = one(
      await client.query(
        `INSERT INTO public.signal_publication_outbox
       (event_id,request_key,request_fingerprint,signal_id,expected_revision,publication_revision,
        content_version,status,reason_code,occurred_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,pg_catalog.date_trunc('milliseconds',pg_catalog.clock_timestamp()))
       RETURNING event_id,occurred_at`,
        [
          randomUUID(),
          event.request_key,
          event.request_fingerprint,
          event.signal_id,
          event.expected_revision,
          event.publication_revision,
          event.content_version,
          event.status,
          event.reason_code,
        ],
      ),
      'publication_write_conflict',
    );
    const changed = await client.query(
      `INSERT INTO public.signal_publication_state
       (signal_id,publication_revision,content_version,status,event_id,occurred_at)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (signal_id) DO UPDATE SET publication_revision=EXCLUDED.publication_revision,
         content_version=EXCLUDED.content_version,status=EXCLUDED.status,event_id=EXCLUDED.event_id,occurred_at=EXCLUDED.occurred_at
       WHERE public.signal_publication_state.publication_revision=$7`,
      [
        event.signal_id,
        event.publication_revision,
        event.content_version,
        event.status,
        inserted.event_id,
        inserted.occurred_at,
        command.expected_revision,
      ],
    );
    if (changed.rowCount !== 1) deny('publication_write_conflict');
    await client.query(
      `INSERT INTO public.signal_qualified_publication_receipts
       (request_key,request_fingerprint,signal_id,source_version,target_version,run_id,lease_owner,fencing_token)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [
        command.request_key,
        fingerprint,
        command.signal_id,
        command.source_version,
        command.target_version,
        command.run_id,
        command.lease_owner,
        command.fencing_token,
      ],
    );
    // Flush deferred pair/lease guards BEFORE the final clock check. Inserts and
    // constraint evaluation can wait too. Nothing caller-controlled runs after it.
    await client.query('SET CONSTRAINTS ALL IMMEDIATE');
    await lockPrivatePublicationControls({ client, request: controlRequest });
    await client.query('COMMIT');
    started = false;
    return {
      scope: 'private_recorded_qualification',
      outcome: 'apply',
      head: plan.head,
      event_id: inserted.event_id,
      source_version: command.source_version,
      request_key: command.request_key,
      content_hash: snapshot.content_hash,
    };
  } catch (error) {
    discard = error;
    if (started) {
      try {
        await client.query('ROLLBACK');
      } catch {
        /* Discard; preserve original failure. */
      }
    }
    throw error;
  } finally {
    client.release(discard);
  }
}
