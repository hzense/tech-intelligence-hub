import { createHash } from 'node:crypto';
import { URL } from 'node:url';
import {
  candidateReviewMaterialHash,
  reviewOwner,
  reviewUuid,
} from './candidate-review-contract.mjs';
import { assembleVersion } from './signal-qualified-publication-store.mjs';
import { cloneSignalSnapshotForPublication } from './signal-publication-qualification.mjs';
import {
  readPrivateCandidateVerificationMaterial,
  recordPrivateCandidateVerification,
  assemblePrivateVerifiedSignalCandidate,
} from './signal-candidate-verification-store.mjs';
import {
  publishVerifiedSignal,
  withdrawPublicSignal,
} from './signal-publication-service-store.mjs';
import {
  createPrivatePublicationRun,
  claimPrivatePublicationRun,
  completePrivatePublicationRun,
} from './signal-publication-control-store.mjs';

const codes = new Set([
  'invalid_request',
  'not_found',
  'revision_conflict',
  'material_changed',
  'review_not_submitted',
  'review_revision_required',
  'conversion_not_found',
  'conversion_conflict',
  'event_already_exists',
  'public_evidence_required',
  'entity_reference_invalid',
  'topic_reference_invalid',
  'trusted_verification_required',
  'database_unavailable',
  'commit_unknown',
]);
export class CandidatePublicationError extends Error {
  constructor(code) {
    super(codes.has(code) ? code : 'database_unavailable');
    this.name = 'CandidatePublicationError';
    this.code = this.message;
  }
}
const fail = (code) => {
  throw new CandidatePublicationError(code);
};
const hash = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const stableUuid = (value) => {
  const d = hash(value);
  return `${d.slice(0, 8)}-${d.slice(8, 12)}-${d.slice(12, 16)}-${d.slice(16, 20)}-${d.slice(20, 32)}`;
};
async function queryPool(pool, sql, args) {
  const client = await pool.connect();
  try {
    return await client.query(sql, args);
  } finally {
    client.release();
  }
}
function command(input, extras = []) {
  const fields = ['runId', 'candidateIndex', 'expectedReviewRevision', 'materialHash', ...extras];
  if (
    !input ||
    typeof input !== 'object' ||
    Object.keys(input).length !== fields.length ||
    Object.keys(input).some((key) => !fields.includes(key))
  )
    fail('invalid_request');
  reviewUuid(input.runId);
  if (
    !Number.isInteger(input.candidateIndex) ||
    input.candidateIndex < 0 ||
    input.candidateIndex > 4 ||
    !Number.isInteger(input.expectedReviewRevision) ||
    input.expectedReviewRevision < 1 ||
    !/^[a-f0-9]{64}$/.test(input.materialHash)
  )
    fail('invalid_request');
  if (
    extras.includes('requestKey') &&
    (typeof input.requestKey !== 'string' ||
      !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(input.requestKey))
  )
    fail('invalid_request');
  if (extras.includes('verificationId')) reviewUuid(input.verificationId);
  return input;
}
async function bound(pool, owner, request, work, withdrawing = false) {
  owner = reviewOwner(owner);
  const client = await pool.connect();
  let committing = false;
  try {
    await client.query('BEGIN');
    await client.query("SET LOCAL lock_timeout='5s'");
    await client.query("SET LOCAL statement_timeout='15s'");
    // Same namespace as saveCandidateReview; reject/edit cannot race a release.
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [request.runId]);
    const run = (
      await client.query(
        'SELECT id,owner_id,status,deleted_at,snapshot,source_hash,result FROM public.signal_generation_runs WHERE id=$1 AND owner_id=$2',
        [request.runId, owner],
      )
    ).rows[0];
    if (!run || (run.deleted_at && !withdrawing)) fail('not_found');
    if (
      candidateReviewMaterialHash(
        withdrawing ? { ...run, deleted_at: null } : run,
        request.candidateIndex,
      ) !== request.materialHash
    )
      fail('material_changed');
    const review = (
      await client.query(
        `SELECT id,revision,decision,draft,material_hash FROM public.candidate_reviews WHERE run_id=$1 AND candidate_index=$2 AND owner_id=$3 ${withdrawing ? 'AND revision=$4' : ''} ORDER BY revision DESC LIMIT 1`,
        withdrawing
          ? [request.runId, request.candidateIndex, owner, request.expectedReviewRevision]
          : [request.runId, request.candidateIndex, owner],
      )
    ).rows[0];
    if (!review || review.revision !== request.expectedReviewRevision) fail('revision_conflict');
    if (review.material_hash !== request.materialHash) fail('material_changed');
    if (review.decision !== 'submit_verification' && !withdrawing) fail('review_not_submitted');
    const result = await work(client, review, owner);
    committing = true;
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    if (
      error instanceof CandidatePublicationError ||
      (typeof error?.code === 'string' && /^[a-z_]+$/.test(error.code))
    )
      throw error;
    fail(committing ? 'commit_unknown' : 'database_unavailable');
  } finally {
    client.release();
  }
}
async function receipt(client, review, owner) {
  const row = (
    await client.query(
      'SELECT request_key,review_id,signal_id,source_version FROM public.candidate_review_conversions WHERE review_id=$1 AND owner_id=$2',
      [review.id, owner],
    )
  ).rows[0];
  if (!row) fail('conversion_not_found');
  return row;
}
const slug = (value) => typeof value === 'string' && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value);
function draftCheck(draft) {
  if (
    !draft ||
    typeof draft !== 'object' ||
    !slug(draft.eventKey) ||
    draft.eventKey.length > 200 ||
    typeof draft.title !== 'string' ||
    !draft.title.trim() ||
    [...draft.title].length > 80 ||
    typeof draft.summary !== 'string' ||
    !draft.summary.trim() ||
    [...draft.summary].length > 500 ||
    !/^\d{4}-\d{2}-\d{2}$/.test(draft.eventDate ?? '')
  )
    fail('invalid_request');
  const occurred = new Date(`${draft.eventDate}T00:00:00.000Z`);
  if (
    !Number.isFinite(occurred.getTime()) ||
    occurred.toISOString().slice(0, 10) !== draft.eventDate
  )
    fail('invalid_request');
  for (const key of [
    'sourceUrls',
    'personIds',
    'organizationIds',
    'topicIds',
    'publicEvidenceIds',
  ]) {
    if (
      !Array.isArray(draft[key]) ||
      draft[key].length > 32 ||
      new Set(draft[key]).size !== draft[key].length ||
      draft[key].some((value) => typeof value !== 'string' || !value.trim())
    )
      fail('invalid_request');
  }
  if (
    !draft.personIds.length ||
    !draft.topicIds.length ||
    !draft.publicEvidenceIds.length ||
    !draft.sourceUrls.length
  )
    fail('invalid_request');
  if (
    !Array.isArray(draft.claims) ||
    !draft.claims.length ||
    draft.claims.length > 32 ||
    draft.claims.some(
      (c) =>
        !c ||
        typeof c.text !== 'string' ||
        !c.text.trim() ||
        c.text.length > 2000 ||
        !draft.publicEvidenceIds.includes(c.evidenceId),
    )
  )
    fail('invalid_request');
  if (draft.publicEvidenceIds.some((id) => !draft.claims.some((c) => c.evidenceId === id)))
    fail('public_evidence_required');
  return draft;
}
async function references(client, draft) {
  const evidence = (
    await client.query(
      `SELECT e.id,e.source_id,e.source_url,e.verification_status,s.active,s.allowed_hosts FROM public.public_source_evidence e JOIN public.sources s ON s.id=e.source_id WHERE e.id=ANY($1::text[]) ORDER BY e.id`,
      [draft.publicEvidenceIds],
    )
  ).rows;
  if (
    evidence.length !== draft.publicEvidenceIds.length ||
    evidence.some((e) => {
      try {
        const url = new URL(e.source_url);
        return (
          e.verification_status !== 'verified' ||
          e.active !== true ||
          !draft.sourceUrls.includes(e.source_url) ||
          url.protocol !== 'https:' ||
          !!url.username ||
          !!url.password ||
          !e.allowed_hosts.includes(url.hostname)
        );
      } catch {
        return true;
      }
    }) ||
    draft.sourceUrls.some((url) => !evidence.some((e) => e.source_url === url))
  )
    fail('public_evidence_required');
  const people = (
    await client.query(
      `SELECT e.id FROM public.entities e JOIN public.person_profiles p ON p.entity_id=e.id WHERE e.id=ANY($1::text[]) AND e.type='person' AND e.status='active' ORDER BY e.id`,
      [draft.personIds],
    )
  ).rows;
  const organizations = (
    await client.query(
      `SELECT e.id FROM public.entities e JOIN public.organization_profiles p ON p.entity_id=e.id AND p.entity_type=e.type WHERE e.id=ANY($1::text[]) AND e.type IN ('company','institution') AND e.status='active' ORDER BY e.id`,
      [draft.organizationIds],
    )
  ).rows;
  if (
    people.length !== draft.personIds.length ||
    organizations.length !== draft.organizationIds.length
  )
    fail('entity_reference_invalid');
  const topics = (
    await client.query(
      `SELECT id FROM public.topics WHERE id=ANY($1::text[]) AND status<>'archived' AND runtime_enabled=true ORDER BY id`,
      [draft.topicIds],
    )
  ).rows;
  if (topics.length !== draft.topicIds.length) fail('topic_reference_invalid');
  return evidence;
}

/** No model/network calls. Only reviewed text and EXISTING public evidence enter the sealed draft. */
export async function prepareReviewedSignalCandidate({ pool, owner, request }) {
  const input = command(request, ['requestKey']);
  return bound(pool, owner, input, async (client, review, principal) => {
    const previous = (
      await client.query(
        'SELECT request_key,review_id,signal_id,source_version FROM public.candidate_review_conversions WHERE request_key=$1 OR review_id=$2',
        [input.requestKey, review.id],
      )
    ).rows;
    if (previous.length) {
      if (
        previous.length !== 1 ||
        previous[0].request_key !== input.requestKey ||
        previous[0].review_id !== review.id
      )
        fail('conversion_conflict');
      return { outcome: 'replay', ...previous[0] };
    }
    const draft = draftCheck(review.draft);
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtextextended('candidate-event:' || $1,0))",
      [draft.eventKey],
    );
    const existing = (
      await client.query(
        'SELECT signal_id FROM public.signal_event_identities WHERE event_key=$1',
        [draft.eventKey],
      )
    ).rows[0];
    const prior = (
      await client.query(
        'SELECT c.signal_id FROM public.candidate_review_conversions c JOIN public.candidate_reviews r ON r.id=c.review_id WHERE c.owner_id=$1 AND r.owner_id=$1 AND r.run_id=$2 AND r.candidate_index=$3 ORDER BY r.revision DESC LIMIT 1',
        [principal, input.runId, input.candidateIndex],
      )
    ).rows[0];
    if (existing && (!prior || prior.signal_id !== existing.signal_id))
      fail('event_already_exists');
    if (prior && (!existing || prior.signal_id !== existing.signal_id)) fail('conversion_conflict');
    const evidence = await references(client, draft);
    const signalId = existing?.signal_id ?? `review-${review.id}`;
    const version = existing
      ? (
          await client.query(
            'SELECT max(version) AS maximum FROM public.signal_versions WHERE signal_id=$1',
            [signalId],
          )
        ).rows[0].maximum + 1
      : 1;
    const captured = (
      await client.query("SELECT date_trunc('milliseconds',clock_timestamp()) AS captured_at")
    ).rows[0].captured_at;
    const content = {
      signal_id: signalId,
      version,
      schema_version: '3.0.0',
      title: draft.title,
      type: 'technology',
      occurred_at: `${draft.eventDate}T00:00:00.000Z`,
      date_precision: 'day',
      date_basis: 'Human-reviewed event date; verification required',
      captured_at: new Date(captured).toISOString(),
      summary: draft.summary,
      analysis: null,
      importance: 3,
      strength: 3,
      confidence: 0.5,
      novelty: 0.5,
      revision_reason: `Candidate review ${review.id}`,
      origin: 'manual',
      legacy_status: null,
    };
    const snapshot = { ...content, content_hash: hash(content) };
    // Independent canonical parser validates our fixed-order v3 preimage.
    cloneSignalSnapshotForPublication(snapshot, version + 1);
    const first = evidence[0];
    if (!existing)
      await client.query(
        `INSERT INTO public.signals(id,title,type,occurred_at,captured_at,source_id,source_url,summary,importance,strength,confidence,novelty,metadata) VALUES($1,$2,'technology',$3,$4,$5,$6,$7,3,3,0.5,0.5,$8::jsonb)`,
        [
          signalId,
          draft.title,
          content.occurred_at,
          content.captured_at,
          first.source_id,
          first.source_url,
          draft.summary,
          JSON.stringify({ candidate_review_id: review.id }),
        ],
      );
    const edge = (evidenceId) => ({ signal_id: signalId, version, evidence_id: evidenceId });
    await assembleVersion(client, snapshot, {
      evidence_links: evidence.map((e) => ({
        ...edge(e.id),
        claim: draft.claims
          .filter((c) => c.evidenceId === e.id)
          .map((c) => c.text)
          .join('\n'),
        relation: 'supports',
      })),
      people: [],
      organizations: [],
      topic_links: draft.topicIds.map((id) => ({ signal_id: signalId, version, topic_id: id })),
    });
    // No INSERT grant on verification_status: initial edges use the pending default.
    for (const id of draft.personIds)
      await client.query(
        'INSERT INTO public.signal_version_people(signal_id,version,person_id,evidence_id,event_role) VALUES($1,$5,$2,$3,$4)',
        [signalId, id, first.id, 'reviewed_participant_pending_verification', version],
      );
    for (const id of draft.organizationIds)
      await client.query(
        'INSERT INTO public.signal_version_organizations(signal_id,version,organization_id,evidence_id,event_role) VALUES($1,$5,$2,$3,$4)',
        [signalId, id, first.id, 'reviewed_organization_pending_verification', version],
      );
    if (!existing)
      await client.query(
        'INSERT INTO public.signal_event_identities(signal_id,event_key,basis_version,basis_evidence_id,identity_basis) VALUES($1,$2,1,$3,$4)',
        [
          signalId,
          draft.eventKey,
          first.id,
          `Human-reviewed event identity from ${review.id}; not a verification attestation`,
        ],
      );
    await client.query(
      'INSERT INTO public.candidate_review_conversions(request_key,review_id,owner_id,signal_id,source_version) VALUES($1,$2,$3,$4,$5)',
      [input.requestKey, review.id, principal, signalId, version],
    );
    return {
      outcome: 'prepared',
      signal_id: signalId,
      source_version: version,
      review_id: review.id,
      request_key: input.requestKey,
    };
  });
}

export async function readReviewedPublicationMaterial({ pool, verificationPool, owner, request }) {
  if (pool === verificationPool) fail('invalid_request');
  return bound(pool, owner, command(request), async (client, review, principal) => {
    const converted = await receipt(client, review, principal);
    return readPrivateCandidateVerificationMaterial({
      pool: verificationPool,
      restricted: true,
      request: { signal_id: converted.signal_id, source_version: converted.source_version },
    });
  });
}

/** SERVER ONLY: report must be authenticated by the independent verifier signature adapter. */
export async function recordReviewedVerification({ pool, verificationPool, owner, request }) {
  if (pool === verificationPool) fail('invalid_request');
  return bound(
    pool,
    owner,
    command(request, ['report', 'attestation']),
    async (client, review, principal) => {
      const converted = await receipt(client, review, principal);
      if (
        request.report?.signal_id !== converted.signal_id ||
        request.report?.source_version !== converted.source_version
      )
        fail('material_changed');
      return recordPrivateCandidateVerification({
        pool: verificationPool,
        request: request.report,
        restricted: true,
        trustedAudit: {
          review_id: review.id,
          owner_id: principal,
          key_id: request.attestation?.keyId,
          payload: request.attestation?.payload,
          signature: request.attestation?.signature,
        },
      });
    },
  );
}

export async function inspectReviewedCandidate({
  pool,
  verificationPool,
  publisherPool,
  owner,
  request,
}) {
  if (pool === verificationPool || pool === publisherPool) fail('invalid_request');
  return bound(
    pool,
    owner,
    command(request),
    async (client, review, principal) => {
      const row =
        (
          await client.query(
            'SELECT request_key,review_id,signal_id,source_version FROM public.candidate_review_conversions WHERE review_id=$1 AND owner_id=$2',
            [review.id, principal],
          )
        ).rows[0] ?? null;
      let verification = null,
        assembly = null,
        publication = null;
      if (row && verificationPool) {
        verification =
          (
            await queryPool(
              verificationPool,
              'SELECT verification_id,decision,expires_at,expires_at>clock_timestamp() AS current FROM public.signal_candidate_verifications WHERE signal_id=$1 AND source_version=$2 ORDER BY verified_at DESC,verification_id DESC LIMIT 1',
              [row.signal_id, row.source_version],
            )
          ).rows[0] ?? null;
        assembly =
          (
            await queryPool(
              verificationPool,
              'SELECT verification_id,target_version FROM public.signal_candidate_assembly_receipts WHERE signal_id=$1 AND source_version=$2 ORDER BY target_version DESC LIMIT 1',
              [row.signal_id, row.source_version],
            )
          ).rows[0] ?? null;
      }
      if (row && publisherPool)
        publication =
          (
            await queryPool(
              publisherPool,
              'SELECT s.publication_revision,s.content_version,s.status,EXISTS(SELECT 1 FROM public.current_public_signals p WHERE p.signal_id=s.signal_id) AS current_public FROM public.signal_publication_state s WHERE s.signal_id=$1',
              [row.signal_id],
            )
          ).rows[0] ?? null;
      const readiness = publication
        ? publication.current_public
          ? 'published'
          : 'not_currently_public'
        : assembly
          ? 'assembled_requires_live_release_checks'
          : verification?.decision === 'approved' && verification.current
            ? 'verification_recorded'
            : row
              ? 'trusted_verification_required'
              : review.decision === 'submit_verification'
                ? 'conversion_required'
                : 'review_not_submitted';
      return {
        reviewId: review.id,
        reviewRevision: review.revision,
        conversion: row,
        verification,
        assembly,
        publication,
        readiness,
      };
    },
    true,
  );
}

export async function assembleReviewedVerifiedCandidate({
  pool,
  verificationPool,
  owner,
  request,
}) {
  if (pool === verificationPool) fail('invalid_request');
  return bound(
    pool,
    owner,
    command(request, ['verificationId', 'requestKey']),
    async (client, review, principal) => {
      const converted = await receipt(client, review, principal);
      // Consumption validates the exact current evidence bundle and the independently recorded signed attestation.
      return assemblePrivateVerifiedSignalCandidate({
        pool: verificationPool,
        restricted: true,
        request: {
          request_key: request.requestKey,
          verification_id: request.verificationId,
          signal_id: converted.signal_id,
          source_version: converted.source_version,
          target_version: converted.source_version + 1,
        },
      });
    },
  );
}

/** trustedControl is SERVER configuration, never body input. Publication requires its own restricted role. */
export async function publishReviewedSignal({
  pool,
  publisherPool,
  controlPool,
  owner,
  request,
  trustedControl,
}) {
  if (pool === publisherPool || pool === controlPool) fail('invalid_request');
  command(request, ['requestKey', 'expectedPublicationRevision', 'reasonCode']);
  if (
    !Number.isInteger(request.expectedPublicationRevision) ||
    request.expectedPublicationRevision < 0 ||
    !['initial_publication', 'content_correction', 'republication'].includes(request.reasonCode) ||
    (request.expectedPublicationRevision === 0) !== (request.reasonCode === 'initial_publication')
  )
    fail('invalid_request');
  return bound(pool, owner, request, async (client, review, principal) => {
    const converted = await receipt(client, review, principal);
    reviewUuid(trustedControl.taskId);
    reviewUuid(trustedControl.principalId);
    const previous = (
      await queryPool(
        publisherPool,
        `SELECT q.request_key,q.signal_id,q.source_version,q.target_version,q.run_id,q.lease_owner,q.fencing_token,o.expected_revision,o.reason_code FROM public.signal_qualified_publication_receipts q JOIN public.signal_publication_outbox o ON o.request_key=q.request_key WHERE q.request_key=$1`,
        [request.requestKey],
      )
    ).rows[0];
    if (previous) {
      if (
        previous.signal_id !== converted.signal_id ||
        previous.source_version !== converted.source_version + 1 ||
        previous.target_version !== converted.source_version + 2 ||
        previous.expected_revision !== request.expectedPublicationRevision ||
        previous.reason_code !== request.reasonCode
      )
        fail('conversion_conflict');
      const replay = await publishVerifiedSignal({ pool: publisherPool, request: previous });
      // A prior COMMIT response may have been lost before control-run cleanup.
      try {
        await completePrivatePublicationRun({
          pool: controlPool,
          restricted: true,
          request: {
            run_id: previous.run_id,
            lease_owner: previous.lease_owner,
            fencing_token: previous.fencing_token,
          },
        });
      } catch {
        /* Already terminal/expired does not undo the historical public receipt. */
      }
      return replay;
    }
    // An assembly is single-use for a publication. A new request after withdrawal
    // requires a new reviewed draft and a fresh independent verification record.
    const consumed = (
      await queryPool(
        publisherPool,
        'SELECT request_key FROM public.signal_qualified_publication_receipts WHERE signal_id=$1 AND source_version=$2 LIMIT 1',
        [converted.signal_id, converted.source_version + 1],
      )
    ).rows.length;
    if (consumed) fail('review_revision_required');
    const runId = stableUuid({ review: review.id, requestKey: request.requestKey });
    const leaseOwner = stableUuid({ runId, purpose: 'review-publication-lease' });
    const created = await createPrivatePublicationRun({
      pool: controlPool,
      restricted: true,
      request: {
        run_id: runId,
        task_id: trustedControl.taskId,
        principal_id: trustedControl.principalId,
        original_intent: 'auto_publish',
      },
    });
    const active =
      (
        await queryPool(
          controlPool,
          'SELECT lease_expires_at>clock_timestamp() AS active FROM public.signal_publication_runs WHERE run_id=$1',
          [runId],
        )
      ).rows[0]?.active === true;
    const lease =
      created.run.status === 'running' && created.run.lease_owner === leaseOwner && active
        ? { run: created.run }
        : await claimPrivatePublicationRun({
            pool: controlPool,
            restricted: true,
            request: { run_id: runId, lease_owner: leaseOwner, lease_seconds: 60 },
          });
    const result = await publishVerifiedSignal({
      pool: publisherPool,
      request: {
        request_key: request.requestKey,
        signal_id: converted.signal_id,
        source_version: converted.source_version + 1,
        target_version: converted.source_version + 2,
        expected_revision: request.expectedPublicationRevision,
        reason_code: request.reasonCode,
        run_id: runId,
        lease_owner: leaseOwner,
        fencing_token: lease.run.fencing_token,
      },
    });
    try {
      await completePrivatePublicationRun({
        pool: controlPool,
        restricted: true,
        request: { run_id: runId, lease_owner: leaseOwner, fencing_token: lease.run.fencing_token },
      });
    } catch {
      return { ...result, control_cleanup_pending: true };
    }
    return result;
  });
}

export async function withdrawReviewedSignal({ pool, publisherPool, owner, request }) {
  if (pool === publisherPool) fail('invalid_request');
  command(request, ['requestKey', 'expectedPublicationRevision', 'reasonCode']);
  if (
    !Number.isInteger(request.expectedPublicationRevision) ||
    request.expectedPublicationRevision < 1 ||
    !['factual_error', 'privacy', 'evidence_revoked', 'operator_request'].includes(
      request.reasonCode,
    )
  )
    fail('invalid_request');
  return bound(
    pool,
    owner,
    request,
    async (client, review, principal) => {
      const converted = await receipt(client, review, principal);
      return withdrawPublicSignal({
        pool: publisherPool,
        request: {
          request_key: request.requestKey,
          signal_id: converted.signal_id,
          target_version: converted.source_version + 2,
          expected_revision: request.expectedPublicationRevision,
          reason_code: request.reasonCode,
        },
      });
    },
    true,
  );
}
