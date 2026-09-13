import { createHash } from 'node:crypto';
import { types } from 'node:util';
import {
  QualifiedPublicationError,
  qualifySignalPublicationBundle,
} from './signal-publication-qualification.mjs';

const maximumInteger = 2_147_483_647;
const maximumRows = 256;
const policyVersion = 'candidate-verification-v1';
const checkFields = [
  'claims_supported',
  'people_disambiguated',
  'people_are_participants',
  'organizations_supported',
  'public_sources_cleared',
  'contradictions_resolved',
];
const codes = new Set([
  'invalid_candidate_verification',
  'invalid_candidate_bundle',
  'invalid_verification_material',
  'invalid_material_request',
  'invalid_verification_request',
  'invalid_assembly_request',
  'invalid_material_timestamp',
  'verification_checks_incomplete',
  'candidate_edge_rejected',
  'too_many_dependencies',
  'verification_not_found',
  'verification_not_sealed',
  'verification_not_approved',
  'verification_expired',
  'verification_material_changed',
  'verification_key_reused',
  'assembly_key_reused',
  'verification_already_consumed',
  'assembly_write_conflict',
  'invalid_stored_verification',
  'signal_not_found',
  'target_version_not_new',
]);

/** The message never contains caller material, evidence excerpts or a database error. */
export class CandidateVerificationError extends Error {
  constructor(code) {
    const safeCode = codes.has(code) ? code : 'invalid_candidate_verification';
    super(safeCode);
    this.name = 'CandidateVerificationError';
    this.code = safeCode;
  }
}

function reject(code) {
  throw new CandidateVerificationError(code);
}

function safely(code, callback) {
  try {
    return callback();
  } catch (error) {
    if (error instanceof CandidateVerificationError || error instanceof QualifiedPublicationError) {
      throw error;
    }
    reject(code);
  }
}

function object(input, fields, code) {
  if (
    input === null ||
    typeof input !== 'object' ||
    types.isProxy(input) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(input))
  ) {
    reject(code);
  }
  const keys = Reflect.ownKeys(input);
  if (
    keys.length !== fields.length ||
    keys.some((key) => typeof key !== 'string' || !fields.includes(key))
  ) {
    reject(code);
  }
  const copy = {};
  for (const field of fields) {
    const descriptor = Object.getOwnPropertyDescriptor(input, field);
    if (!descriptor || !Object.hasOwn(descriptor, 'value')) reject(code);
    copy[field] = descriptor.value;
  }
  return copy;
}

function matches(value, expression, code) {
  if (typeof value !== 'string' || value.match(expression)?.[0] !== value) reject(code);
  return value;
}

function slug(value, code) {
  return matches(value, /^[a-z0-9]+(?:-[a-z0-9]+)*$/, code);
}

function uuid(value, code) {
  return matches(value, /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/, code);
}

function digest(value, code) {
  return matches(value, /^[a-f0-9]{64}$/, code);
}

function integer(value, minimum, code, maximum = maximumInteger) {
  if (!Number.isInteger(value) || value < minimum || value > maximum) reject(code);
  return value;
}

function text(value, code) {
  if (typeof value !== 'string' || !value.trim()) reject(code);
  return value;
}

function array(input, code) {
  if (
    !Array.isArray(input) ||
    types.isProxy(input) ||
    Object.getPrototypeOf(input) !== Array.prototype
  ) {
    reject(code);
  }
  if (input.length > maximumRows) reject('too_many_dependencies');
  if (Reflect.ownKeys(input).length !== input.length + 1) reject(code);
  const copy = [];
  for (let index = 0; index < input.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(input, String(index));
    if (!descriptor || !Object.hasOwn(descriptor, 'value')) reject(code);
    copy.push(descriptor.value);
  }
  return copy;
}

/**
 * Clone without reading accessors or hiding unrecognised fields. Shared input
 * references are legitimate (identity and candidate links may share a query),
 * cycles are not. Dates retain their type until the field schema validates them.
 */
function cloneMaterial(input, code, ancestors = new Set()) {
  if (input === null || typeof input !== 'object') return input;
  if (types.isProxy(input) || ancestors.has(input)) reject(code);
  ancestors.add(input);
  try {
    if (Object.getPrototypeOf(input) === Date.prototype) {
      if (Reflect.ownKeys(input).length !== 0) reject(code);
      return new Date(Date.prototype.getTime.call(input));
    }
    if (Array.isArray(input)) {
      return array(input, code).map((value) => cloneMaterial(value, code, ancestors));
    }
    const keys = Reflect.ownKeys(input);
    if (keys.some((key) => typeof key !== 'string' || key === '__proto__')) reject(code);
    const row = object(input, keys, code);
    for (const field of keys) row[field] = cloneMaterial(row[field], code, ancestors);
    return row;
  } finally {
    ancestors.delete(input);
  }
}

function prepareClone(input) {
  const code = 'invalid_candidate_bundle';
  const prepared = cloneMaterial(input, code);
  if (prepared === null || typeof prepared !== 'object' || Array.isArray(prepared)) reject(code);
  for (const field of ['people', 'organizations']) {
    for (const row of array(prepared[field], code)) {
      if (row === null || typeof row !== 'object' || Array.isArray(row)) reject(code);
      if (row.verification_status === 'rejected') reject('candidate_edge_rejected');
      if (!['pending', 'verified'].includes(row.verification_status)) reject(code);
      row.verification_status = 'verified';
    }
  }
  // This validates EVERY original field, not a picked/sanitized projection. It
  // also requires Evidence to be verified already; this helper does not edit it.
  qualifySignalPublicationBundle(prepared);
  return prepared;
}

/**
 * A private candidate assembly projection, never permission to publish. Only
 * pending/verified person/organization edges may become verified in a NEW row;
 * rejected edges and unverified supporting/context Evidence still fail closed.
 */
export function prepareVerifiedCandidateBundle(input) {
  return safely('invalid_candidate_bundle', () => prepareClone(input));
}

function timestamp(value) {
  const code = 'invalid_material_timestamp';
  let date;
  if (typeof value === 'string') {
    const match = value.match(
      /^(\d{4})-(\d{2})-(\d{2})T([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d)(?:\.(\d{1,3}))?)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/,
    );
    if (!match || match[0] !== value) reject(code);
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    if (month < 1 || month > 12 || day < 1 || day > days[month - 1]) reject(code);
    date = new Date(value);
  } else {
    if (
      value === null ||
      typeof value !== 'object' ||
      types.isProxy(value) ||
      Object.getPrototypeOf(value) !== Date.prototype ||
      Reflect.ownKeys(value).length !== 0
    ) {
      reject(code);
    }
    date = new Date(Date.prototype.getTime.call(value));
  }
  const year = date.getUTCFullYear();
  if (!Number.isFinite(date.getTime()) || year < 1 || year > 9999) reject(code);
  return date.toISOString();
}

function canonical(value, preserveArrays = false) {
  if (Array.isArray(value)) {
    const items = value.map((item) => canonical(item, preserveArrays));
    if (preserveArrays) return items;
    return items.sort((left, right) => {
      const leftJson = JSON.stringify(left);
      const rightJson = JSON.stringify(right);
      return leftJson < rightJson ? -1 : leftJson > rightJson ? 1 : 0;
    });
  }
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonical(value[key], preserveArrays || key === 'metadata')]),
    );
  }
  return value;
}

// JSONB metadata is opaque reviewed material, not a qualification claim. Unlike
// relation/alias collections, an array nested in metadata has ordered semantics.
function metadataJson(input, context = { nodes: 0, ancestors: new Set() }, depth = 0) {
  const code = 'invalid_verification_material';
  context.nodes += 1;
  if (depth > 16 || context.nodes > 4096) reject('too_many_dependencies');
  if (input === null || typeof input === 'boolean') return input;
  if (typeof input === 'string') {
    if (input.length > 16384) reject('too_many_dependencies');
    return input;
  }
  if (typeof input === 'number') {
    if (!Number.isFinite(input)) reject(code);
    return input;
  }
  if (typeof input !== 'object' || types.isProxy(input) || context.ancestors.has(input)) {
    reject(code);
  }
  context.ancestors.add(input);
  try {
    if (Array.isArray(input)) {
      return array(input, code).map((item) => metadataJson(item, context, depth + 1));
    }
    const keys = Reflect.ownKeys(input);
    if (keys.length > maximumRows) reject('too_many_dependencies');
    if (keys.some((key) => typeof key !== 'string' || key.length > 256 || key === '__proto__')) {
      reject(code);
    }
    const value = object(input, keys, code);
    return Object.fromEntries(
      keys.map((key) => [key, metadataJson(value[key], context, depth + 1)]),
    );
  } finally {
    context.ancestors.delete(input);
  }
}

function exactDetails(details, rows) {
  const ids = new Set(details.map((detail) => detail.id));
  if (
    ids.size !== details.length ||
    ids.size !== rows.length ||
    rows.some((row) => !ids.has(row.id))
  ) {
    reject('invalid_verification_material');
  }
}

function hash(value) {
  return createHash('sha256').update(JSON.stringify(value), 'utf8').digest('hex');
}

/**
 * Canonical all-field material digest: object keys and set-like arrays sorted,
 * metadata arrays retain order, text is byte-preserved, instants UTC milliseconds. Original edge statuses
 * remain in the digest; the prepared verified projection never replaces them.
 * A driver Date cannot reveal lost microseconds, so the store checks SQL precision.
 */
export function fingerprintCandidateVerificationMaterial(input) {
  const code = 'invalid_verification_material';
  return safely(code, () => {
    const row = object(
      input,
      ['bundle', 'evidence_details', 'entity_details', 'source_details'],
      code,
    );
    prepareClone(row.bundle);
    const bundle = cloneMaterial(row.bundle, code);
    bundle.snapshot.occurred_at = timestamp(bundle.snapshot.occurred_at);
    bundle.snapshot.captured_at = timestamp(bundle.snapshot.captured_at);
    const details = array(row.evidence_details, code).map((inputDetail) => {
      const detail = object(
        inputDetail,
        ['id', 'locator', 'excerpt', 'content_hash', 'captured_at', 'source_published_at'],
        code,
      );
      for (const field of ['id', 'locator', 'excerpt']) text(detail[field], code);
      digest(detail.content_hash, code);
      detail.captured_at = timestamp(detail.captured_at);
      if (detail.source_published_at !== null) {
        detail.source_published_at = timestamp(detail.source_published_at);
      }
      return detail;
    });
    exactDetails(details, bundle.evidence);
    const entityDetails = array(row.entity_details, code).map((inputDetail) => {
      const detail = object(
        inputDetail,
        ['id', 'name', 'aliases', 'metadata', 'metadata_text'],
        code,
      );
      text(detail.id, code);
      text(detail.name, code);
      detail.aliases = array(detail.aliases, code).map((alias) => text(alias, code));
      detail.metadata = metadataJson(detail.metadata);
      if (typeof detail.metadata_text !== 'string' || !detail.metadata_text.length) reject(code);
      if (detail.metadata_text.length > 65536) reject('too_many_dependencies');
      // JSONB's exact server text binds numbers that a JavaScript decoder could
      // round to the same value. Decode only to cross-check the companion view;
      // never replace the raw text in the fingerprint with reserialized JSON.
      const parsedMetadata = metadataJson(JSON.parse(detail.metadata_text));
      if (
        JSON.stringify(canonical(parsedMetadata, true)) !==
        JSON.stringify(canonical(detail.metadata, true))
      ) {
        reject(code);
      }
      return detail;
    });
    exactDetails(entityDetails, bundle.entities);
    const sourceDetails = array(row.source_details, code).map((inputDetail) => {
      const detail = object(inputDetail, ['id', 'name', 'type', 'url', 'trust_score'], code);
      text(detail.id, code);
      text(detail.name, code);
      if (
        ![
          'website',
          'rss',
          'paper',
          'company_blog',
          'research_lab',
          'news_media',
          'newsletter',
          'github',
          'social',
          'regulator',
          'patent_database',
        ].includes(detail.type)
      )
        reject(code);
      if (detail.url !== null && typeof detail.url !== 'string') reject(code);
      integer(detail.trust_score, 0, code, 100);
      return detail;
    });
    exactDetails(sourceDetails, bundle.sources);
    return hash(
      canonical({
        bundle,
        evidence_details: details,
        entity_details: entityDetails,
        source_details: sourceDetails,
      }),
    );
  });
}

/** Exact request for the private locked-material reader, not arbitrary SQL. */
export function parseCandidateMaterialRequest(input) {
  const code = 'invalid_material_request';
  return safely(code, () => {
    const row = object(input, ['signal_id', 'source_version'], code);
    slug(row.signal_id, code);
    integer(row.source_version, 1, code);
    return row;
  });
}

const recordFields = [
  'verification_id',
  'signal_id',
  'source_version',
  'source_content_hash',
  'bundle_fingerprint',
  'verifier_id',
  'policy_version',
  'decision',
  'checks',
  'valid_for_seconds',
];

/**
 * A trusted verifier's bounded recorded assertion, not evidence of identity or
 * independently established truth. The adapter binds this to its locked material.
 */
export function parseVerificationRecordRequest(input) {
  const code = 'invalid_verification_request';
  return safely(code, () => {
    const row = object(input, recordFields, code);
    uuid(row.verification_id, code);
    slug(row.signal_id, code);
    integer(row.source_version, 1, code);
    digest(row.source_content_hash, code);
    digest(row.bundle_fingerprint, code);
    uuid(row.verifier_id, code);
    if (row.policy_version !== policyVersion || !['approved', 'rejected'].includes(row.decision)) {
      reject(code);
    }
    integer(row.valid_for_seconds, 1, code, 86400);
    row.checks = object(row.checks, checkFields, code);
    for (const field of checkFields) {
      if (typeof row.checks[field] !== 'boolean') reject(code);
    }
    if (row.decision === 'approved' && checkFields.some((field) => !row.checks[field])) {
      reject('verification_checks_incomplete');
    }
    return row;
  });
}

/** Fixed-order report digest; source/material/expiry bindings are separately stored. */
export function fingerprintVerificationReport(input) {
  const row = parseVerificationRecordRequest(input);
  return hash({
    policy_version: row.policy_version,
    verifier_id: row.verifier_id,
    decision: row.decision,
    checks: row.checks,
  });
}

export function parseCandidateAssemblyRequest(input) {
  const code = 'invalid_assembly_request';
  return safely(code, () => {
    const row = object(
      input,
      ['request_key', 'verification_id', 'signal_id', 'source_version', 'target_version'],
      code,
    );
    matches(row.request_key, /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/, code);
    uuid(row.verification_id, code);
    slug(row.signal_id, code);
    integer(row.source_version, 1, code);
    integer(row.target_version, 1, code);
    if (row.target_version <= row.source_version) reject('target_version_not_new');
    return row;
  });
}

/** Request key is the replay lookup key, not semantic assembly content. */
export function fingerprintAssemblyRequest(input) {
  const row = parseCandidateAssemblyRequest(input);
  return hash({
    verification_id: row.verification_id,
    signal_id: row.signal_id,
    source_version: row.source_version,
    target_version: row.target_version,
  });
}
