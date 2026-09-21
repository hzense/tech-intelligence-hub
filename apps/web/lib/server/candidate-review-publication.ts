import 'server-only';
import pg from 'pg';
import {
  inspectReviewedCandidate,
  prepareReviewedSignalCandidate,
  readReviewedPublicationMaterial,
  recordReviewedVerification,
  assembleReviewedVerifiedCandidate,
  publishReviewedSignal,
  withdrawReviewedSignal,
  type ReviewedIdentity,
} from '../../../../packages/database/src/candidate-review-publication.mjs';
import { verifySignedCandidateReport } from '../../../../packages/database/src/signed-candidate-verification.mjs';
import {
  assertCandidatePipelineRole,
  type CandidatePipelineRole,
} from '../../../../packages/database/src/candidate-pipeline-role.mjs';
import {
  readCandidateRoleConfiguration,
  ReviewConfigurationError,
} from '../candidate-review-config';
import { requireReviewWrites } from './candidate-review';

function rolePool(variable: string, role: CandidatePipelineRole) {
  let pool: pg.Pool | undefined, url: string | undefined;
  return {
    async connect() {
      const value = readCandidateRoleConfiguration(process.env, variable, role);
      if (url && url !== value) throw new ReviewConfigurationError();
      if (!pool) {
        url = value;
        pool = new pg.Pool({
          connectionString: value,
          max: 2,
          idleTimeoutMillis: 10000,
          connectionTimeoutMillis: 3500,
          query_timeout: 20000,
          allowExitOnIdle: true,
          enableChannelBinding: true,
          application_name: `hzense-${role}`,
        });
        pool.on('error', () => console.error('candidate_pipeline_pool_unavailable'));
      }
      const client = await pool.connect();
      try {
        await assertCandidatePipelineRole(client, role);
        return client;
      } catch (error) {
        client.release(true);
        throw error;
      }
    },
  };
}
const pool = rolePool('HZENSE_CANDIDATE_DATABASE_URL', 'hzense_candidate_assembler');
const verificationPool = rolePool('HZENSE_VERIFICATION_DATABASE_URL', 'hzense_candidate_verifier');
const controlPool = rolePool(
  'HZENSE_PUBLICATION_CONTROL_DATABASE_URL',
  'hzense_publication_controller',
);
// The existing publisher store also enforces its SQL capability contract.
const publisherPool = rolePool('HZENSE_PUBLISHER_DATABASE_URL', 'hzense_publisher');
function invalid(): never {
  throw Object.assign(new Error('invalid_request'), { code: 'invalid_request' });
}
function identity(value: Record<string, unknown>, extras: string[]): ReviewedIdentity {
  const fields = [
    'runId',
    'candidateIndex',
    'expectedReviewRevision',
    'materialHash',
    'requestKey',
    ...extras,
  ];
  if (
    Object.keys(value).sort().join(',') !== fields.sort().join(',') ||
    typeof value.runId !== 'string' ||
    !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value.runId) ||
    !Number.isInteger(value.candidateIndex) ||
    Number(value.candidateIndex) < 0 ||
    Number(value.candidateIndex) > 4 ||
    !Number.isInteger(value.expectedReviewRevision) ||
    Number(value.expectedReviewRevision) < 1 ||
    typeof value.materialHash !== 'string' ||
    !/^[a-f0-9]{64}$/.test(value.materialHash) ||
    typeof value.requestKey !== 'string' ||
    !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(value.requestKey)
  )
    invalid();
  return {
    runId: value.runId,
    candidateIndex: Number(value.candidateIndex),
    expectedReviewRevision: Number(value.expectedReviewRevision),
    materialHash: value.materialHash,
  };
}
export async function operateCandidateReview(
  owner: string,
  action: string,
  request: Record<string, unknown>,
) {
  const extras =
    action === 'verify'
      ? ['envelope']
      : action === 'assemble'
        ? ['verificationId']
        : action === 'publish' || action === 'withdraw'
          ? ['expectedPublicationRevision', 'reasonCode']
          : [];
  const bound = identity(request, extras);
  if (
    process.env.HZENSE_CANDIDATE_PIPELINE_ENABLED !== '1' &&
    !['withdraw', 'inspect'].includes(action)
  ) {
    throw new ReviewConfigurationError();
  }
  const base = { pool, owner, request: bound };
  if (action === 'inspect') {
    const state = await inspectReviewedCandidate({ ...base, verificationPool, publisherPool });
    const next: Record<string, string> = {
      review_not_submitted: '该审核修订未送核验；可以检查已有历史回执，但不能按此修订发布。',
      conversion_required: '请先转换正式私有候选。',
      trusted_verification_required: '需要独立可信核验方提供签名报告。',
      verification_recorded: '核验已记录，下一步组装；操作时仍检查有效期与材料。',
      assembled_requires_live_release_checks:
        '已组装，正式发布仍须实时授权、开关、租约与依赖核对。',
      published: '存在发布回执；公开可见性以实时公开读取门禁为准。',
      not_currently_public: '此发布回执当前不再公开，请核对撤回及依赖状态。',
    };
    return {
      readiness: {
        ready: false,
        status: state.readiness,
        receipt: state,
        blocked: [next[state.readiness] ?? '请核对当前阶段回执。'],
      },
    };
  }
  if (action !== 'withdraw') requireReviewWrites();
  const requestKey = String(request.requestKey);
  if (action === 'prepare') {
    const receipt = await prepareReviewedSignalCandidate({
      ...base,
      request: { ...bound, requestKey },
    });
    const material = await readReviewedPublicationMaterial({ ...base, verificationPool });
    return {
      receipt,
      verificationMaterial: {
        signal_id: receipt.signal_id,
        source_version: receipt.source_version,
        source_content_hash: material.bundle.snapshot.content_hash,
        bundle_fingerprint: material.bundle_fingerprint,
      },
    };
  }
  if (action === 'verify') {
    let keyring;
    try {
      keyring = JSON.parse(process.env.HZENSE_VERIFIER_PUBLIC_KEYS ?? '');
    } catch {
      throw new ReviewConfigurationError();
    }
    const verified = verifySignedCandidateReport({
      envelope: request.envelope,
      keyring,
      identity: bound,
    });
    return recordReviewedVerification({
      ...base,
      verificationPool,
      request: {
        ...bound,
        report: verified.record,
        attestation: request.envelope as { keyId: string; payload: string; signature: string },
      },
    });
  }
  if (action === 'assemble') {
    if (typeof request.verificationId !== 'string') invalid();
    return assembleReviewedVerifiedCandidate({
      ...base,
      verificationPool,
      request: { ...bound, requestKey, verificationId: request.verificationId },
    });
  }
  if (action === 'publish' || action === 'withdraw') {
    if (
      !Number.isInteger(request.expectedPublicationRevision) ||
      Number(request.expectedPublicationRevision) < 0 ||
      typeof request.reasonCode !== 'string'
    )
      invalid();
    const command = {
      ...bound,
      requestKey,
      expectedPublicationRevision: Number(request.expectedPublicationRevision),
      reasonCode: request.reasonCode,
    };
    if (action === 'withdraw')
      return withdrawReviewedSignal({ ...base, publisherPool, request: command });
    if (process.env.HZENSE_SIGNAL_READ_MODE !== 'database') throw new ReviewConfigurationError();
    // Mapping is deployment-owned, never accepted from a request or inferred from email.
    let principals: Record<string, string>;
    try {
      principals = JSON.parse(process.env.HZENSE_REVIEW_PUBLISHER_PRINCIPALS ?? '');
      if (!principals || typeof principals !== 'object' || Array.isArray(principals))
        throw new ReviewConfigurationError();
    } catch {
      throw new ReviewConfigurationError();
    }
    const taskId = process.env.HZENSE_REVIEW_PUBLICATION_TASK_ID;
    const principalId = Object.hasOwn(principals, owner) ? principals[owner] : undefined;
    if (!taskId || typeof principalId !== 'string' || !principalId)
      throw new ReviewConfigurationError();
    return publishReviewedSignal({
      ...base,
      publisherPool,
      controlPool,
      request: command,
      trustedControl: { taskId, principalId },
    });
  }
  invalid();
}
