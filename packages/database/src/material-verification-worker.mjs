import { createHash, createPrivateKey, sign } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { validateCandidateSourceBundle } from '../../ingestion/src/candidate-source-bundle.mjs';
import { normalizeMaterialPlan, materialPlanHash } from './material-registration-contract.mjs';

const checkNames = [
  'sourceAuthenticity',
  'usageRights',
  'entityIdentity',
  'eventRelevance',
  'claimSupport',
  'taxonomy',
];
const maximumReviewAge = 24 * 60 * 60 * 1000;
const maximumSnapshotAge = 5 * 60 * 1000;
const assessments = new WeakMap();
export class MaterialWorkerError extends Error {
  constructor(code = 'material_worker_invalid') {
    super(code);
    this.code = code;
  }
}
const fail = (code) => {
  throw new MaterialWorkerError(code);
};
const hash = (value) => createHash('sha256').update(value, 'utf8').digest('hex');
function canonical(value, depth = 0) {
  if (depth > 40) fail();
  if (value === null || ['string', 'boolean'].includes(typeof value)) return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (!value || typeof value !== 'object') fail();
  if (Array.isArray(value)) {
    if (value.length > 10000 || Reflect.ownKeys(value).length !== value.length + 1) fail();
    return Array.from({ length: value.length }, (_, i) => {
      const field = Object.getOwnPropertyDescriptor(value, String(i));
      if (!field || !Object.hasOwn(field, 'value')) fail();
      return canonical(field.value, depth + 1);
    });
  }
  if (Object.getPrototypeOf(value) !== Object.prototype) fail();
  const output = {};
  for (const key of Reflect.ownKeys(value).sort()) {
    if (typeof key !== 'string' || ['__proto__', 'constructor', 'prototype'].includes(key)) fail();
    const field = Object.getOwnPropertyDescriptor(value, key);
    if (!field?.enumerable || !Object.hasOwn(field, 'value')) fail();
    output[key] = canonical(field.value, depth + 1);
  }
  return output;
}
function clone(value) {
  return canonical(value);
}
function exact(value, fields) {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).sort().join(',') !== [...fields].sort().join(',')
  )
    fail();
}
function text(value, limit = 2000) {
  if (
    typeof value !== 'string' ||
    value !== value.trim() ||
    !value ||
    [...value].length > limit ||
    [...value].some((character) => {
      const code = character.codePointAt(0);
      return code === 127 || (code < 32 && ![9, 10, 13].includes(code));
    })
  )
    fail();
  return value;
}
function instant(value) {
  if (
    typeof value !== 'string' ||
    !Number.isFinite(Date.parse(value)) ||
    new Date(value).toISOString() !== value
  )
    fail();
  return Date.parse(value);
}
function unique(values) {
  if (!Array.isArray(values) || new Set(values).size !== values.length) fail();
  return values;
}
const sameSet = (a, b) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());
const normalizedName = (name) => name.normalize('NFKC').trim().toLocaleLowerCase('en-US');
function approved(value, fields = ['approved', 'rationale']) {
  exact(value, fields);
  if (value.approved !== true) fail('material_review_incomplete');
  text(value.rationale);
}
function dossierFor(request, plan, dossier, now) {
  exact(dossier, [
    'version',
    'requestId',
    'planHash',
    'sourceBundleHash',
    'approvedBy',
    'approvedAt',
    'expiresAt',
    'checks',
    'sources',
    'eventDate',
  ]);
  if (
    dossier.version !== 'reviewed-material-dossier-v1' ||
    dossier.requestId !== request.requestId ||
    dossier.planHash !== materialPlanHash(plan) ||
    dossier.sourceBundleHash !== plan.sourceBundleHash
  )
    fail('material_review_mismatch');
  text(dossier.approvedBy, 200);
  const approvedAt = instant(dossier.approvedAt),
    expiresAt = instant(dossier.expiresAt);
  if (
    approvedAt > now ||
    expiresAt <= now ||
    expiresAt <= approvedAt ||
    expiresAt - approvedAt > maximumReviewAge
  )
    fail('material_review_expired');
  exact(dossier.checks, checkNames);
  for (const name of checkNames) approved(dossier.checks[name]);
  const urls = [...new Set(plan.evidence.map((row) => row.sourceUrl))];
  if (!Array.isArray(dossier.sources) || dossier.sources.length !== urls.length) fail();
  unique(dossier.sources.map((row) => row.sourceUrl));
  for (const policy of dossier.sources) {
    exact(policy, ['sourceUrl', 'excerptHashes', 'authenticity', 'usageRights']);
    if (!urls.includes(policy.sourceUrl)) fail('material_rights_missing');
    const expected = [
      ...new Set(
        plan.evidence
          .filter((row) => row.sourceUrl === policy.sourceUrl)
          .map((row) => row.contentHash),
      ),
    ];
    if (!sameSet(unique(policy.excerptHashes), expected)) fail('material_rights_missing');
    approved(policy.authenticity);
    approved(policy.usageRights, ['approved', 'rationale', 'basis']);
    text(policy.usageRights.basis);
  }
  exact(dossier.eventDate, ['value', 'evidenceId', 'quote', 'rationale']);
  text(dossier.eventDate.quote, 40000);
  text(dossier.eventDate.rationale);
  const dateEvidence = plan.evidence.find((row) => row.id === dossier.eventDate.evidenceId);
  if (
    dossier.eventDate.value !== plan.candidate.eventDate ||
    !dateEvidence ||
    !dateEvidence.excerpt.includes(dossier.eventDate.quote)
  )
    fail('material_date_unsupported');
}
function bind(request, plan) {
  const bundle = validateCandidateSourceBundle(request.bundle);
  const candidate = request.candidate;
  if (
    typeof request.requestId !== 'string' ||
    !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(request.requestId)
  )
    fail();
  for (const key of ['owner', 'runId', 'candidateIndex', 'baseMaterialHash'])
    if (request[key] !== plan[key]) fail('material_changed');
  if (
    bundle.baseMaterialHash !== plan.baseMaterialHash ||
    bundle.sourceBundleHash !== plan.sourceBundleHash ||
    plan.candidate.title !== candidate.title ||
    plan.candidate.summary !== candidate.summary ||
    (candidate.event_date !== null && plan.candidate.eventDate !== candidate.event_date) ||
    JSON.stringify(plan.candidate.claims.map((row) => row.text)) !==
      JSON.stringify(candidate.claims.map((row) => row.text))
  )
    fail('material_changed');
  const entities = new Map(plan.entities.map((row) => [row.id, row]));
  for (const person of candidate.persons) {
    if (
      !plan.candidate.persons.some(
        (row) =>
          entities.get(row.entityId)?.name === person.name &&
          row.role === person.role &&
          (person.organization === null ||
            entities.get(row.organizationId)?.name === person.organization),
      )
    )
      fail('material_changed');
  }
  for (const name of candidate.organizations)
    if (!plan.candidate.organizationIds.some((id) => entities.get(id)?.name === name))
      fail('material_changed');
  for (const evidence of plan.evidence) {
    if (
      !bundle.source.fragments.some((fragment, index) => {
        const provenance = bundle.provenance[index];
        return (
          fragment.text.includes(evidence.excerpt) &&
          (provenance.kind === 'supplement'
            ? provenance.sourceUrl === evidence.sourceUrl
            : request.originalSourceUrl === evidence.sourceUrl)
        );
      })
    )
      fail('material_source_mismatch');
  }
}
function catalogFor(request, plan) {
  const { topics, entities, sources } = request.catalog;
  for (const rows of [topics, entities, sources]) {
    if (!Array.isArray(rows) || rows.length > 1000) fail('material_catalog_invalid');
    unique(rows.map((row) => row.id));
  }
  for (const id of plan.topicIds)
    if (
      !topics.some(
        (row) => row.id === id && row.runtime_enabled !== false && row.status !== 'archived',
      )
    )
      fail('material_catalog_invalid');
  for (const entity of plan.entities) {
    const names = new Set([entity.name, ...entity.aliases].map(normalizedName));
    const matches = entities.filter(
      (row) =>
        row.id === entity.id ||
        [row.name, ...(row.aliases ?? [])].some((name) => names.has(normalizedName(name))),
    );
    if (
      matches.length > 1 ||
      (matches.length === 1 &&
        (matches[0].id !== entity.id ||
          matches[0].type !== entity.type ||
          matches[0].name !== entity.name ||
          matches[0].status !== 'active' ||
          !sameSet(matches[0].aliases ?? [], entity.aliases)))
    )
      fail('material_catalog_invalid');
  }
  for (const source of plan.sources) {
    const current = sources.find((row) => row.id === source.id);
    if (
      current &&
      (current.active !== true ||
        current.name !== source.name ||
        current.url !== source.url ||
        !sameSet(current.allowed_hosts ?? [], source.allowedHosts))
    )
      fail('material_catalog_invalid');
  }
}

/** Hash explicit reviewer decisions, not a model's suggested approval booleans. */
export function materialReviewDossierHash(dossier) {
  return hash(JSON.stringify(clone(dossier)));
}

/**
 * No AI, database writes, or signing. fetchSource MUST be a runner-owned, pinned,
 * bounded HTTPS fetch/parser; sourceUrl is its actual final URL, not caller input.
 * Transport success never establishes rights: those require the reviewed dossier.
 */
export async function assessMaterialVerification({
  request: input,
  plan: proposal,
  dossier: review,
  fetchSource,
  clock = () => new Date(),
}) {
  try {
    const request = clone(input),
      plan = normalizeMaterialPlan(clone(proposal)),
      dossier = clone(review);
    const time = clock().getTime();
    if (!Number.isFinite(time) || typeof fetchSource !== 'function') fail();
    bind(request, plan);
    catalogFor(request, plan);
    dossierFor(request, plan, dossier, time);
    const evidence = [];
    for (const url of new Set(plan.evidence.map((row) => row.sourceUrl))) {
      let snapshot;
      try {
        snapshot = clone(await fetchSource(url));
      } catch {
        fail('material_live_source_unavailable');
      }
      exact(snapshot, ['sourceUrl', 'text', 'fetchedAt']);
      if (
        snapshot.sourceUrl !== url ||
        typeof snapshot.text !== 'string' ||
        Buffer.byteLength(snapshot.text, 'utf8') > 4 * 1024 * 1024
      )
        fail('material_live_source_mismatch');
      const fetched = instant(snapshot.fetchedAt);
      const observed = clock().getTime();
      if (
        !Number.isFinite(observed) ||
        observed < time ||
        fetched > observed ||
        fetched < observed - maximumSnapshotAge
      )
        fail('material_live_source_stale');
      for (const row of plan.evidence.filter((entry) => entry.sourceUrl === url)) {
        if (!snapshot.text.includes(row.excerpt)) fail('material_live_source_mismatch');
        if (
          instant(row.capturedAt) > time ||
          (row.sourcePublishedAt !== null && instant(row.sourcePublishedAt) > time)
        )
          fail();
        evidence.push(
          Object.freeze({
            id: row.id,
            contentHash: row.contentHash,
            liveTextHash: hash(snapshot.text),
            fetchedAt: snapshot.fetchedAt,
          }),
        );
      }
    }
    const assessment = Object.freeze({
      requestId: request.requestId,
      planHash: materialPlanHash(plan),
      dossierHash: materialReviewDossierHash(dossier),
      approvedBy: dossier.approvedBy,
      expiresAt: dossier.expiresAt,
      evidence: Object.freeze(evidence),
    });
    assessments.set(assessment, { plan, dossier });
    return assessment;
  } catch (error) {
    if (error instanceof MaterialWorkerError) throw error;
    throw new MaterialWorkerError();
  }
}

/** Protected runner only. Approval must bind the exact dossier hash; never copy it from untrusted plan input. */
export function signMaterialVerification({
  assessment,
  approvedDossierHash,
  keyId,
  verifierId,
  privateKey,
  now = new Date(),
  ttlMs = 60000,
}) {
  try {
    const saved = assessments.get(assessment),
      time = now.getTime();
    if (!saved || approvedDossierHash !== assessment.dossierHash)
      fail('material_approval_mismatch');
    if (
      !Number.isFinite(time) ||
      time >= instant(assessment.expiresAt) ||
      time < instant(saved.dossier.approvedAt)
    )
      fail('material_review_expired');
    if (
      assessment.evidence.some(
        (row) =>
          instant(row.fetchedAt) > time || instant(row.fetchedAt) < time - maximumSnapshotAge,
      )
    )
      fail('material_live_source_stale');
    if (!Number.isSafeInteger(ttlMs) || ttlMs < 1 || ttlMs > 60000) fail();
    text(keyId, 200);
    text(verifierId, 200);
    const key = createPrivateKey(privateKey);
    if (key.asymmetricKeyType !== 'ed25519') fail('material_signing_key_invalid');
    const { plan, dossier } = saved;
    const payload = {
      version: 'signed-material-verification-v1',
      planHash: assessment.planHash,
      owner: plan.owner,
      runId: plan.runId,
      candidateIndex: plan.candidateIndex,
      baseMaterialHash: plan.baseMaterialHash,
      sourceBundleHash: plan.sourceBundleHash,
      verifierId,
      issuedAt: now.toISOString(),
      ingestBefore: new Date(Math.min(time + ttlMs, instant(dossier.expiresAt))).toISOString(),
      checks: Object.fromEntries(checkNames.map((name) => [name, dossier.checks[name].approved])),
      rationale: Object.fromEntries(
        checkNames.map((name) => [name, dossier.checks[name].rationale]),
      ),
    };
    const bytes = Buffer.from(JSON.stringify(payload), 'utf8');
    return {
      keyId,
      payload: bytes.toString('base64'),
      signature: sign(null, bytes, key).toString('base64'),
    };
  } catch (error) {
    if (error instanceof MaterialWorkerError) throw error;
    throw new MaterialWorkerError('material_signing_key_invalid');
  }
}
