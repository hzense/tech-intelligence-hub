import { createHash } from 'node:crypto';
import { URL } from 'node:url';
import {
  assessGeneratedCandidates,
  validateGenerationSource,
} from '../../ingestion/src/signal-generation-contract.mjs';
import { signalGenerationSourceHash } from './signal-generation-store.mjs';

export class CandidateReviewError extends Error {
  constructor(code = 'invalid_request') {
    super(code);
    this.name = 'CandidateReviewError';
    this.code = code;
  }
}
const fail = (code) => {
  throw new CandidateReviewError(code);
};
const uuidPattern = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
export const reviewUuid = (value) => {
  if (typeof value !== 'string' || !uuidPattern.test(value)) fail();
  return value;
};
export function reviewOwner(value) {
  if (
    typeof value !== 'string' ||
    !value ||
    value.length > 200 ||
    [...value].some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127)
  )
    fail();
  return value;
}
function string(value, max, empty = false) {
  if (
    typeof value !== 'string' ||
    (!empty && !value.trim()) ||
    [...value].length > max ||
    [...value].some(
      (c) =>
        (c.charCodeAt(0) < 32 && ![9, 10, 13].includes(c.charCodeAt(0))) || c.charCodeAt(0) === 127,
    )
  )
    fail();
  return value.trim();
}
function list(value, validate) {
  if (!Array.isArray(value) || value.length > 50) fail();
  const result = value.map(validate);
  if (new Set(result).size !== result.length) fail();
  return result;
}
function exact(value, keys) {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).some((k) => !keys.includes(k))
  )
    fail();
}
export function normalizeCandidateReviewRequest(value) {
  exact(value, [
    'requestId',
    'runId',
    'candidateIndex',
    'materialHash',
    'expectedRevision',
    'decision',
    'note',
    'draft',
  ]);
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail();
  const { draft: d } = value;
  exact(d, [
    'title',
    'summary',
    'eventDate',
    'sourceUrls',
    'personIds',
    'organizationIds',
    'topicIds',
    'eventKey',
    'publicEvidenceIds',
    'claims',
  ]);
  if (!d || typeof d !== 'object' || Array.isArray(d)) fail();
  if (
    !Number.isInteger(value.candidateIndex) ||
    value.candidateIndex < 0 ||
    value.candidateIndex > 4 ||
    !Number.isSafeInteger(value.expectedRevision) ||
    value.expectedRevision < 0
  )
    fail();
  if (
    !/^[a-f0-9]{64}$/.test(value.materialHash) ||
    !['draft', 'needs_evidence', 'rejected', 'submit_verification'].includes(value.decision)
  )
    fail();
  const eventDate = d.eventDate;
  if (
    eventDate !== null &&
    (typeof eventDate !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}$/.test(eventDate) ||
      !Number.isFinite(Date.parse(eventDate)) ||
      new Date(eventDate).toISOString().slice(0, 10) !== eventDate)
  )
    fail();
  const entityId = (v) => string(v, 200);
  const publicEvidenceIds = list(d.publicEvidenceIds ?? [], entityId);
  if (!Array.isArray(d.claims ?? []) || (d.claims ?? []).length > 50) fail();
  const claims = (d.claims ?? []).map((c) => {
    exact(c, ['text', 'evidenceId']);
    return {
      text: string(c.text, 1000),
      evidenceId: entityId(c.evidenceId),
    };
  });
  const draft = {
    title: string(d.title, 80),
    summary: string(d.summary, 500),
    eventDate,
    sourceUrls: list(d.sourceUrls, (v) => {
      const s = string(v, 2048);
      let u;
      try {
        u = new URL(s);
      } catch {
        fail();
      }
      if (u.protocol !== 'https:' || u.username || u.password || u.hash) fail();
      return s;
    }),
    personIds: list(d.personIds, entityId),
    organizationIds: list(d.organizationIds, entityId),
    topicIds: list(d.topicIds, (v) => string(v, 100)),
    eventKey: string(d.eventKey, 200, true),
    publicEvidenceIds,
    claims,
  };
  if (
    value.decision === 'submit_verification' &&
    (!eventDate ||
      !draft.eventKey ||
      !draft.personIds.length ||
      !draft.topicIds.length ||
      !draft.sourceUrls.length ||
      !publicEvidenceIds.length ||
      !claims.length ||
      claims.some((c) => !publicEvidenceIds.includes(c.evidenceId)))
  )
    fail('review_incomplete');
  return {
    requestId: reviewUuid(value.requestId),
    runId: reviewUuid(value.runId),
    candidateIndex: value.candidateIndex,
    materialHash: value.materialHash,
    expectedRevision: value.expectedRevision,
    decision: value.decision,
    note: string(value.note, 4000, true),
    draft,
  };
}
export function candidateReviewMaterialHash(run, index) {
  try {
    if (
      run.status !== 'completed' ||
      run.deleted_at ||
      run.result?.classification !== 'private' ||
      !Array.isArray(run.result.candidates) ||
      run.result.candidates.length > 5
    )
      fail();
    const indices = run.result.candidates.map((c) => c.index);
    if (
      new Set(indices).size !== indices.length ||
      indices.some((i) => !Number.isInteger(i) || i < 0 || i > 4)
    )
      fail();
    const saved = run.result.candidates.find((c) => c.index === index);
    if (!saved || saved.classification !== 'private' || saved.status !== 'needs_review') fail();
    const source = validateGenerationSource(run.snapshot.source);
    if (signalGenerationSourceHash(source) !== run.source_hash) fail();
    const input = Object.fromEntries(
      Object.entries(saved).filter(
        ([k]) => !['index', 'classification', 'status', 'issues'].includes(k),
      ),
    );
    const assessed = assessGeneratedCandidates(
      { candidates: [input], reason: '审核前只读检查' },
      source,
    );
    if (assessed.candidates.length !== 1) fail();
    const candidate = { ...assessed.candidates[0], index };
    return createHash('sha256')
      .update(JSON.stringify({ runId: run.id, sourceHash: run.source_hash, candidate }))
      .digest('hex');
  } catch {
    fail('material_changed');
  }
}
