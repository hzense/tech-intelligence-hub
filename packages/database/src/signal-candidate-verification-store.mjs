import {
  CandidateVerificationError,
  parseCandidateMaterialRequest,
  parseVerificationRecordRequest,
  fingerprintVerificationReport,
  parseCandidateAssemblyRequest,
  fingerprintAssemblyRequest,
  fingerprintCandidateVerificationMaterial,
  prepareVerifiedCandidateBundle,
} from './candidate-verification.mjs';
import { cloneSignalSnapshotForPublication } from './signal-publication-qualification.mjs';
import {
  lockBundle,
  lockPublicPublicationBundle,
  assembleVersion,
} from './signal-qualified-publication-store.mjs';

// PRIVATE trusted verification adapter, not a route, verifier model, authenticated
// service or public publication permission. Reviewer IDs and hashes are NOT auth.
// In particular this never promotes global Evidence or changes sealed source edges.
const deny = (code) => {
  throw new CandidateVerificationError(code);
};
const one = (result, code) => (result.rows.length === 1 ? result.rows[0] : deny(code));
const recordColumns = `verification_id,signal_id,source_version,source_content_hash,
  bundle_fingerprint,verifier_id,policy_version,report_hash,decision,checks,
  verified_at,expires_at`;
const receiptColumns = `request_key,request_fingerprint,verification_id,signal_id,
  source_version,target_version,content_hash`;

// Callbacks here are module-owned functions, never caller-provided executable input.
async function transaction(pool, work) {
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
    const result = await work(client);
    await client.query('COMMIT');
    started = false;
    return result;
  } catch (error) {
    discard = error;
    if (started) {
      try {
        await client.query('ROLLBACK');
      } catch {
        // Preserve the original error and discard this connection.
      }
    }
    throw error;
  } finally {
    client.release(discard);
  }
}

async function lockKey(client, namespace, value) {
  await client.query(
    `SELECT pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended($1::text,0))`,
    [`hzense:candidate-${namespace}:${value}`],
  );
}

async function material(client, command, restricted = false) {
  const bundle = restricted
    ? await lockPublicPublicationBundle(client, command)
    : await lockBundle(client, command);
  // lockBundle already holds every Evidence row FOR SHARE. Read the sealed
  // original metadata under those locks, not only the publication projection.
  const rows = (
    await client.query(
      `SELECT id,locator,excerpt,content_hash,captured_at,source_published_at,
       (pg_catalog.isfinite(captured_at)
        AND EXTRACT(YEAR FROM captured_at AT TIME ZONE 'UTC') BETWEEN 1 AND 9999
        AND pg_catalog.date_trunc('milliseconds',captured_at)=captured_at
        AND (source_published_at IS NULL OR (pg_catalog.isfinite(source_published_at)
         AND EXTRACT(YEAR FROM source_published_at AT TIME ZONE 'UTC') BETWEEN 1 AND 9999
         AND pg_catalog.date_trunc('milliseconds',source_published_at)=source_published_at))) AS precise
       FROM public.public_source_evidence WHERE id=ANY($1::text[]) ORDER BY id COLLATE "C"`,
      [bundle.evidence.map((row) => row.id)],
    )
  ).rows;
  const evidence_details = rows.map(({ precise, ...row }) => {
    if (!precise) deny('invalid_material_timestamp');
    return row;
  });
  // Names, aliases and metadata participate in person disambiguation; source
  // classification participates in source review. Their rows are already locked.
  const entity_details = (
    await client.query(
      'SELECT id,name,aliases,metadata,metadata::text AS metadata_text FROM public.entities WHERE id=ANY($1::text[]) ORDER BY id COLLATE "C"',
      [bundle.entities.map((row) => row.id)],
    )
  ).rows;
  const source_details = (
    await client.query(
      'SELECT id,name,type,url,trust_score FROM public.sources WHERE id=ANY($1::text[]) ORDER BY id COLLATE "C"',
      [bundle.sources.map((row) => row.id)],
    )
  ).rows;
  const input = { bundle, evidence_details, entity_details, source_details };
  return { ...input, bundle_fingerprint: fingerprintCandidateVerificationMaterial(input) };
}

// Internal service helper, not a route or package-root API. Owns no transaction.
export async function readLockedPublicCandidateMaterial(client, command) {
  return material(client, command, true);
}

async function lockSignal(client, id, exclusive = false) {
  one(
    await client.query(
      `SELECT id FROM public.signals WHERE id=$1 ${exclusive ? 'FOR UPDATE' : 'FOR SHARE'}`,
      [id],
    ),
    'signal_not_found',
  );
}

/** Obtain the exact, locked material to hand to a trusted verification stage. */
export async function readPrivateCandidateVerificationMaterial({ pool, request }) {
  const command = parseCandidateMaterialRequest(request);
  return transaction(pool, async (client) => {
    await lockSignal(client, command.signal_id);
    return { scope: 'private_verification_material', ...(await material(client, command)) };
  });
}

function recordRequest(row) {
  // The database precision constraints make this TTL conversion lossless.
  const valid_for_seconds = (row.expires_at.getTime() - row.verified_at.getTime()) / 1000;
  return parseVerificationRecordRequest({
    verification_id: row.verification_id,
    signal_id: row.signal_id,
    source_version: row.source_version,
    source_content_hash: row.source_content_hash,
    bundle_fingerprint: row.bundle_fingerprint,
    verifier_id: row.verifier_id,
    policy_version: row.policy_version,
    decision: row.decision,
    checks: row.checks,
    valid_for_seconds,
  });
}

function validateStoredRecord(row) {
  const request = recordRequest(row);
  if (row.report_hash !== fingerprintVerificationReport(request))
    deny('invalid_stored_verification');
  return request;
}

function sameRecord(row, command) {
  const previous = validateStoredRecord(row);
  // Both parsers return fixed field order and fixed check order, not arbitrary JSONB order.
  if (JSON.stringify(previous) !== JSON.stringify(command)) deny('verification_key_reused');
}

/**
 * Trusted verifier-result ingestion, deliberately unavailable to runtime/writer.
 * Re-read the reviewed material; mismatched or stale results cannot bless a new
 * candidate. This stores an attestation, not proof that this function read the web.
 */
export async function recordPrivateCandidateVerification({ pool, request }) {
  const command = parseVerificationRecordRequest(request);
  const reportHash = fingerprintVerificationReport(command);
  return transaction(pool, async (client) => {
    await lockKey(client, 'verification', command.verification_id);
    const existing = (
      await client.query(
        `SELECT ${recordColumns} FROM public.signal_candidate_verifications WHERE verification_id=$1`,
        [command.verification_id],
      )
    ).rows[0];
    if (existing) {
      sameRecord(existing, command);
      return { scope: 'private_historical_verification', outcome: 'replay', record: existing };
    }
    await lockSignal(client, command.signal_id);
    const reviewed = await material(client, command);
    if (
      reviewed.bundle.snapshot.content_hash !== command.source_content_hash ||
      reviewed.bundle_fingerprint !== command.bundle_fingerprint
    )
      deny('verification_material_changed');
    const row = one(
      await client.query(
        `INSERT INTO public.signal_candidate_verifications
         (verification_id,signal_id,source_version,source_content_hash,bundle_fingerprint,
          verifier_id,policy_version,report_hash,decision,checks,verified_at,expires_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,
          pg_catalog.date_trunc('milliseconds',pg_catalog.statement_timestamp()),
          pg_catalog.date_trunc('milliseconds',pg_catalog.statement_timestamp()) + $11 * interval '1 second')
         RETURNING ${recordColumns}`,
        [
          command.verification_id,
          command.signal_id,
          command.source_version,
          command.source_content_hash,
          command.bundle_fingerprint,
          command.verifier_id,
          command.policy_version,
          reportHash,
          command.decision,
          JSON.stringify(command.checks),
          command.valid_for_seconds,
        ],
      ),
      'assembly_write_conflict',
    );
    return { scope: 'private_recorded_verification', outcome: 'recorded', record: row };
  });
}

async function activeRecord(client, verificationId) {
  const { sealed, current, ...row } = one(
    await client.query(
      `SELECT ${recordColumns},created_xid<>pg_catalog.pg_current_xact_id() AS sealed,
       expires_at>pg_catalog.clock_timestamp() AND verified_at<=pg_catalog.clock_timestamp() AS current
       FROM public.signal_candidate_verifications WHERE verification_id=$1 FOR SHARE`,
      [verificationId],
    ),
    'verification_not_found',
  );
  if (!sealed) deny('verification_not_sealed');
  validateStoredRecord(row);
  if (row.decision !== 'approved') deny('verification_not_approved');
  if (!current) deny('verification_expired');
  return row;
}

/**
 * Assemble, commit and seal a NEW private candidate. No head/outbox/search writes.
 * Only references are accepted: no body, verified flags, callbacks or SQL.
 * An already-consumed record cannot create additional versions under new keys.
 */
export async function assemblePrivateVerifiedSignalCandidate({ pool, request }) {
  const command = parseCandidateAssemblyRequest(request);
  const fingerprint = fingerprintAssemblyRequest(command);
  return transaction(pool, async (client) => {
    await lockKey(client, 'assembly', command.request_key);
    const previous = (
      await client.query(
        `SELECT ${receiptColumns} FROM public.signal_candidate_assembly_receipts WHERE request_key=$1`,
        [command.request_key],
      )
    ).rows[0];
    if (previous) {
      if (
        previous.request_fingerprint !== fingerprint ||
        Object.keys(command).some((key) => previous[key] !== command[key])
      )
        deny('assembly_key_reused');
      return { scope: 'private_historical_assembly', outcome: 'replay', receipt: previous };
    }
    await lockKey(client, 'verification', command.verification_id);
    if (
      (
        await client.query(
          'SELECT request_key FROM public.signal_candidate_assembly_receipts WHERE verification_id=$1',
          [command.verification_id],
        )
      ).rows.length
    )
      deny('verification_already_consumed');
    const verification = await activeRecord(client, command.verification_id);
    if (
      verification.signal_id !== command.signal_id ||
      verification.source_version !== command.source_version
    )
      deny('verification_material_changed');
    await lockSignal(client, command.signal_id, true);
    const { maximum } = one(
      await client.query(
        'SELECT max(version) AS maximum FROM public.signal_versions WHERE signal_id=$1',
        [command.signal_id],
      ),
      'signal_not_found',
    );
    if (maximum === null || command.target_version <= maximum) deny('target_version_not_new');
    const current = await material(client, command);
    if (
      current.bundle_fingerprint !== verification.bundle_fingerprint ||
      current.bundle.snapshot.content_hash !== verification.source_content_hash
    )
      deny('verification_material_changed');
    const qualified = prepareVerifiedCandidateBundle(current.bundle);
    const snapshot = cloneSignalSnapshotForPublication(qualified.snapshot, command.target_version);
    await activeRecord(client, command.verification_id);
    await assembleVersion(client, snapshot, qualified);
    const receipt = one(
      await client.query(
        `INSERT INTO public.signal_candidate_assembly_receipts
         (request_key,request_fingerprint,verification_id,signal_id,source_version,target_version,content_hash)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING ${receiptColumns}`,
        [
          command.request_key,
          fingerprint,
          command.verification_id,
          command.signal_id,
          command.source_version,
          command.target_version,
          snapshot.content_hash,
        ],
      ),
      'assembly_write_conflict',
    );
    await client.query('SET CONSTRAINTS ALL IMMEDIATE');
    await activeRecord(client, command.verification_id);
    return { scope: 'private_verified_candidate', outcome: 'assembled', receipt };
  });
}
