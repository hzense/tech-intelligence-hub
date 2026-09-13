import { randomUUID } from 'node:crypto';
import { types } from 'node:util';
import {
  CandidateVerificationError,
  fingerprintCandidateVerificationMaterial,
  fingerprintVerificationReport,
  parseVerificationRecordRequest,
  prepareVerifiedCandidateBundle,
} from './candidate-verification.mjs';
import { readLockedPublicCandidateMaterial } from './signal-candidate-verification-store.mjs';
import { PublicationControlError } from './signal-publication-control.mjs';
import { lockPublicPublicationControls } from './signal-publication-control-store.mjs';
import {
  QualifiedPublicationError,
  cloneSignalSnapshotForPublication,
  fingerprintQualifiedPublicationRequest,
  parseQualifiedPublicationRequest,
  qualifySignalPublicationBundle,
} from './signal-publication-qualification.mjs';
import { assembleVersion } from './signal-qualified-publication-store.mjs';
import {
  parseSignalPublicationRequest,
  planSignalPublicationTransition,
} from './signal-publication-transition.mjs';

// Trusted service boundary, NOT authentication. Only the authenticated server
// supplies this restricted pool. Neither HTTP input nor model output may supply
// a pool, principal identity, verification flags, raw content, or executable code.
export const publicPublicationErrorCodes = Object.freeze([
  'invalid_publication_request',
  'database_unavailable',
  'publication_rejected',
  'request_key_reused',
  'unbound_publication_receipt',
  'invalid_publication_receipt',
  'stale_revision',
  'revision_exhausted',
  'target_version_not_new',
  'content_version_not_increasing',
  'reason_code_mismatch',
  'signal_not_found',
  'assembly_not_found',
  'assembly_not_sealed',
  'assembly_mismatch',
  'verification_not_found',
  'verification_not_sealed',
  'verification_not_approved',
  'verification_expired',
  'verification_material_changed',
  'invalid_stored_verification',
  'dependency_invalidated',
  'publication_write_conflict',
  'publication_disabled',
  'task_disabled',
  'policy_disallows_publication',
  'intent_disallows_publication',
  'authorization_revoked',
  'authorization_not_found',
  'run_not_found',
  'run_not_running',
  'run_terminal',
  'lease_expired',
  'lease_owner_mismatch',
  'stale_fencing_token',
  'control_not_found',
  'task_not_found',
  'run_mismatch',
  'withdraw_requires_published_head',
  'already_withdrawn',
  'withdraw_target_mismatch',
]);
const codes = new Set(publicPublicationErrorCodes);
export class PublicPublicationError extends Error {
  constructor(code) {
    const safe = codes.has(code) ? code : 'publication_rejected';
    super(safe);
    this.name = 'PublicPublicationError';
    this.code = safe;
  }
}
const deny = (code) => {
  throw new PublicPublicationError(code);
};
const one = (result, code) => (result.rows.length === 1 ? result.rows[0] : deny(code));
const headColumns = 'signal_id,publication_revision,content_version,status';
const receiptColumns = `event_id,request_key,request_fingerprint,signal_id,expected_revision,
  publication_revision,content_version,status,reason_code`;
const verificationColumns = `verification_id,signal_id,source_version,source_content_hash,
  bundle_fingerprint,verifier_id,policy_version,report_hash,decision,checks,verified_at,expires_at`;

function safeError(error) {
  if (error instanceof PublicPublicationError) return error;
  if (
    error instanceof CandidateVerificationError ||
    error instanceof QualifiedPublicationError ||
    error instanceof PublicationControlError
  )
    return new PublicPublicationError(error.code);
  return new PublicPublicationError('database_unavailable');
}
function publishRequest(input) {
  try {
    return parseQualifiedPublicationRequest(input);
  } catch {
    deny('invalid_publication_request');
  }
}
function withdrawRequest(input) {
  const fields = ['request_key', 'signal_id', 'target_version', 'expected_revision', 'reason_code'];
  try {
    if (
      input === null ||
      typeof input !== 'object' ||
      types.isProxy(input) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(input))
    )
      throw new Error();
    const keys = Reflect.ownKeys(input);
    if (keys.length !== fields.length || keys.some((key) => !fields.includes(key)))
      throw new Error();
    const row = {};
    for (const field of fields) {
      const descriptor = Object.getOwnPropertyDescriptor(input, field);
      if (!descriptor || !Object.hasOwn(descriptor, 'value')) throw new Error();
      row[field] = descriptor.value;
    }
    const parsed = parseSignalPublicationRequest({ ...row, action: 'withdraw' });
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(parsed.signal_id)) throw new Error();
    return parsed;
  } catch {
    deny('invalid_publication_request');
  }
}
function transition(command) {
  return {
    request_key: command.request_key,
    signal_id: command.signal_id,
    action: 'publish',
    target_version: command.target_version,
    expected_revision: command.expected_revision,
    reason_code: command.reason_code,
  };
}
function gate(command) {
  return {
    run_id: command.run_id,
    lease_owner: command.lease_owner,
    fencing_token: command.fencing_token,
  };
}
async function lockRequest(client, key) {
  await client.query(
    `SELECT pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('hzense:signal-publication:' || $1::text,0))`,
    [key],
  );
}
async function head(client, id, locking = false) {
  return (
    (
      await client.query(
        `SELECT ${headColumns} FROM public.signal_publication_state
    WHERE signal_id=$1${locking ? ' FOR UPDATE' : ''}`,
        [id],
      )
    ).rows[0] ?? null
  );
}
async function receipt(client, key) {
  return (
    (
      await client.query(
        `SELECT ${receiptColumns} FROM public.signal_publication_outbox
    WHERE request_key=$1`,
        [key],
      )
    ).rows[0] ?? null
  );
}
function receiptPlan(command, currentHead, outbox) {
  const { event_id, ...stored } = outbox;
  const plan = planSignalPublicationTransition({ head: currentHead, receipt: stored }, command);
  if (plan.outcome !== 'replay') deny(plan.reason ?? 'invalid_publication_receipt');
  return { ...stored, event_id };
}
async function activeVerification(client, id) {
  const { sealed, current, ...row } = one(
    await client.query(
      `SELECT ${verificationColumns},
    created_xid<>pg_catalog.pg_current_xact_id() AS sealed,
    expires_at>pg_catalog.clock_timestamp() AND verified_at<=pg_catalog.clock_timestamp() AS current
    FROM public.signal_candidate_verifications WHERE verification_id=$1`,
      [id],
    ),
    'verification_not_found',
  );
  if (!sealed) deny('verification_not_sealed');
  let parsed;
  try {
    parsed = parseVerificationRecordRequest({
      verification_id: row.verification_id,
      signal_id: row.signal_id,
      source_version: row.source_version,
      source_content_hash: row.source_content_hash,
      bundle_fingerprint: row.bundle_fingerprint,
      verifier_id: row.verifier_id,
      policy_version: row.policy_version,
      decision: row.decision,
      checks: row.checks,
      valid_for_seconds: (row.expires_at.getTime() - row.verified_at.getTime()) / 1000,
    });
    if (row.report_hash !== fingerprintVerificationReport(parsed))
      deny('invalid_stored_verification');
  } catch {
    deny('invalid_stored_verification');
  }
  if (row.decision !== 'approved') deny('verification_not_approved');
  if (!current) deny('verification_expired');
  return row;
}
function expectedAssemblyMaterial(original, version) {
  const bundle = prepareVerifiedCandidateBundle(original.bundle);
  bundle.snapshot = cloneSignalSnapshotForPublication(bundle.snapshot, version);
  for (const field of ['evidence_links', 'people', 'organizations', 'topic_links']) {
    bundle[field] = bundle[field].map((row) => ({ ...row, version }));
  }
  return {
    bundle,
    evidence_details: original.evidence_details,
    entity_details: original.entity_details,
    source_details: original.source_details,
  };
}
async function writeTransition(client, event) {
  const inserted = one(
    await client.query(
      `INSERT INTO public.signal_publication_outbox
    (event_id,request_key,request_fingerprint,signal_id,expected_revision,publication_revision,
     content_version,status,reason_code,occurred_at)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,pg_catalog.date_trunc('milliseconds',pg_catalog.clock_timestamp()))
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
    VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(signal_id) DO UPDATE SET
    publication_revision=EXCLUDED.publication_revision,content_version=EXCLUDED.content_version,
    status=EXCLUDED.status,event_id=EXCLUDED.event_id,occurred_at=EXCLUDED.occurred_at
    WHERE public.signal_publication_state.publication_revision=$7`,
    [
      event.signal_id,
      event.publication_revision,
      event.content_version,
      event.status,
      inserted.event_id,
      inserted.occurred_at,
      event.expected_revision,
    ],
  );
  if (changed.rowCount !== 1) deny('publication_write_conflict');
  return { ...event, ...inserted };
}
async function applyPublish(client, command) {
  const fingerprint = fingerprintQualifiedPublicationRequest(command);
  await lockRequest(client, command.request_key);
  const previous = await receipt(client, command.request_key);
  const bound = (
    await client.query(
      `SELECT request_key,request_fingerprint,signal_id,source_version,
    target_version,run_id FROM public.signal_qualified_publication_receipts WHERE request_key=$1`,
      [command.request_key],
    )
  ).rows[0];
  if (previous || bound) {
    if (!previous || !bound) deny('unbound_publication_receipt');
    if (
      bound.request_fingerprint !== fingerprint ||
      ['request_key', 'signal_id', 'source_version', 'target_version', 'run_id'].some(
        (key) => bound[key] !== command[key],
      )
    )
      deny('request_key_reused');
    const permit = await client.query(
      'SELECT event_id FROM public.signal_publication_permits WHERE event_id=$1',
      [previous.event_id],
    );
    if (permit.rows.length !== 1) deny('unbound_publication_receipt');
    return {
      outcome: 'replay',
      row: receiptPlan(transition(command), await head(client, command.signal_id), previous),
    };
  }
  await lockPublicPublicationControls({ client, request: gate(command) });
  const assembly = one(
    await client.query(
      `SELECT a.verification_id,a.signal_id,a.source_version,a.target_version,
    a.content_hash,v.created_xid<>pg_catalog.pg_current_xact_id() AS sealed
    FROM public.signal_candidate_assembly_receipts a JOIN public.signal_versions v
      ON v.signal_id=a.signal_id AND v.version=a.target_version
    WHERE a.signal_id=$1 AND a.target_version=$2`,
      [command.signal_id, command.source_version],
    ),
    'assembly_not_found',
  );
  if (!assembly.sealed) deny('assembly_not_sealed');
  const verification = await activeVerification(client, assembly.verification_id);
  if (
    verification.signal_id !== command.signal_id ||
    verification.source_version !== assembly.source_version
  )
    deny('assembly_mismatch');
  const original = await readLockedPublicCandidateMaterial(client, {
    signal_id: command.signal_id,
    source_version: verification.source_version,
  });
  if (
    original.bundle_fingerprint !== verification.bundle_fingerprint ||
    original.bundle.snapshot.content_hash !== verification.source_content_hash
  )
    deny('verification_material_changed');
  const candidate = await readLockedPublicCandidateMaterial(client, command);
  if (
    assembly.content_hash !== candidate.bundle.snapshot.content_hash ||
    candidate.bundle_fingerprint !==
      fingerprintCandidateVerificationMaterial(
        expectedAssemblyMaterial(original, command.source_version),
      )
  )
    deny('assembly_mismatch');
  qualifySignalPublicationBundle(candidate.bundle);
  const currentHead = await head(client, command.signal_id, true);
  const plan = planSignalPublicationTransition(
    { head: currentHead, receipt: null },
    transition(command),
  );
  if (plan.outcome !== 'apply') deny(plan.reason);
  const { maximum } = one(
    await client.query(
      'SELECT max(version) AS maximum FROM public.signal_versions WHERE signal_id=$1',
      [command.signal_id],
    ),
    'signal_not_found',
  );
  if (maximum === null || command.target_version <= maximum) deny('target_version_not_new');
  const seal = one(
    await client.query(
      `SELECT verification_id,invalidated FROM public.signal_verification_dependency_seals
    WHERE verification_id=$1`,
      [verification.verification_id],
    ),
    'dependency_invalidated',
  );
  if (seal.invalidated !== false) deny('dependency_invalidated');
  await activeVerification(client, verification.verification_id);
  await lockPublicPublicationControls({ client, request: gate(command) });
  const snapshot = cloneSignalSnapshotForPublication(
    candidate.bundle.snapshot,
    command.target_version,
  );
  await assembleVersion(client, snapshot, candidate.bundle);
  const row = await writeTransition(client, plan.event);
  await client.query(
    `INSERT INTO public.signal_qualified_publication_receipts
    (request_key,request_fingerprint,signal_id,source_version,target_version,run_id,lease_owner,fencing_token)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
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
  const permitted = await client.query(
    `INSERT INTO public.signal_publication_permits(event_id,verification_id,dependency_seal)
    SELECT $1,verification_id,dependency_seal FROM public.signal_verification_dependency_seals
    WHERE verification_id=$2 AND invalidated=false`,
    [row.event_id, verification.verification_id],
  );
  if (permitted.rowCount !== 1) deny('dependency_invalidated');
  await client.query('SET CONSTRAINTS ALL IMMEDIATE');
  await activeVerification(client, verification.verification_id);
  await lockPublicPublicationControls({ client, request: gate(command) });
  return { outcome: 'apply', row };
}
async function applyWithdraw(client, command) {
  await lockRequest(client, command.request_key);
  const currentHead = await head(client, command.signal_id, true);
  const previous = await receipt(client, command.request_key);
  if (previous) return { outcome: 'replay', row: receiptPlan(command, currentHead, previous) };
  const plan = planSignalPublicationTransition({ head: currentHead, receipt: null }, command);
  if (plan.outcome !== 'apply') deny(plan.reason);
  const row = await writeTransition(client, plan.event);
  await client.query('SET CONSTRAINTS ALL IMMEDIATE');
  return { outcome: 'apply', row };
}
async function execute(pool, command, operation) {
  if (!pool || typeof pool.connect !== 'function') deny('database_unavailable');
  let client;
  let started = false;
  let discard;
  try {
    client = await pool.connect();
    await client.query('BEGIN ISOLATION LEVEL READ COMMITTED');
    started = true;
    await client.query('SET LOCAL search_path = pg_catalog, pg_temp');
    await client.query("SET LOCAL lock_timeout = '5s'");
    await client.query("SET LOCAL statement_timeout = '15s'");
    await client.query("SET LOCAL idle_in_transaction_session_timeout = '15s'");
    // Operation is an internal discriminant, never a caller-provided callback.
    const result =
      operation === 'publish'
        ? await applyPublish(client, command)
        : await applyWithdraw(client, command);
    await client.query('COMMIT');
    started = false;
    const current = await client.query(
      `SELECT signal_id FROM public.current_public_signals
       WHERE signal_id=$1 AND version=$2 AND publication_revision=$3`,
      [command.signal_id, result.row.content_version, result.row.publication_revision],
    );
    return {
      scope: operation === 'publish' ? 'public_publication_receipt' : 'public_withdrawal_receipt',
      outcome: result.outcome,
      signal_id: result.row.signal_id,
      publication_revision: result.row.publication_revision,
      content_version: result.row.content_version,
      status: result.row.status,
      event_id: result.row.event_id,
      current_public: current.rows.length === 1,
    };
  } catch (error) {
    discard = error;
    if (started) await client.query('ROLLBACK').catch(() => undefined);
    throw safeError(error);
  } finally {
    client?.release(discard);
  }
}

export async function publishVerifiedSignal({ pool, request }) {
  return execute(pool, publishRequest(request), 'publish');
}
export async function withdrawPublicSignal({ pool, request }) {
  return execute(pool, withdrawRequest(request), 'withdraw');
}
