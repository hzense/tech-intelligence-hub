import { createHash } from 'node:crypto';
import { URL } from 'node:url';
import { types } from 'node:util';

const maximumInteger = 2_147_483_647;
const maximumRows = 256;
const codes = new Set([
  'invalid_publication_request',
  'invalid_publication_bundle',
  'invalid_publication_snapshot',
  'snapshot_hash_mismatch',
  'missing_supporting_evidence',
  'missing_qualified_person',
  'missing_qualified_topic',
  'unresolved_contradiction',
  'unverified_evidence',
  'inactive_source',
  'untrusted_source_url',
  'unverified_entity_link',
  'unsupported_entity_link',
  'inactive_entity',
  'invalid_entity_profile',
  'reporting_role_disallowed',
  'inactive_topic',
  'identity_basis_unqualified',
  'request_key_reused',
  'unbound_publication_receipt',
  'invalid_publication_receipt',
  'signal_not_found',
  'snapshot_not_found',
  'snapshot_not_sealed',
  'snapshot_timestamp_precision',
  'event_identity_not_found',
  'target_version_not_new',
  'too_many_dependencies',
  'stale_revision',
  'revision_exhausted',
  'content_version_not_increasing',
  'reason_code_mismatch',
  'publication_write_conflict',
]);

/** Fixed codes only. Neither a caller payload nor a database error becomes a public message. */
export class QualifiedPublicationError extends Error {
  constructor(code) {
    const safeCode = codes.has(code) ? code : 'invalid_publication_bundle';
    super(safeCode);
    this.name = 'QualifiedPublicationError';
    this.code = safeCode;
  }
}

function reject(code) {
  throw new QualifiedPublicationError(code);
}

function safely(code, callback) {
  try {
    return callback();
  } catch (error) {
    if (error instanceof QualifiedPublicationError) throw error;
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
  const output = {};
  for (const field of fields) {
    const descriptor = Object.getOwnPropertyDescriptor(input, field);
    if (!descriptor || !Object.hasOwn(descriptor, 'value')) reject(code);
    output[field] = descriptor.value;
  }
  return output;
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
  const keys = Reflect.ownKeys(input);
  if (keys.length !== input.length + 1) reject(code);
  const output = [];
  for (let index = 0; index < input.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(input, String(index));
    if (!descriptor || !Object.hasOwn(descriptor, 'value')) reject(code);
    output.push(descriptor.value);
  }
  return output;
}

function text(value, code) {
  if (typeof value !== 'string' || !value.trim()) reject(code);
  return value;
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

function integer(value, minimum, code) {
  if (!Number.isInteger(value) || value < minimum || value > maximumInteger) reject(code);
  return value;
}

function unitInterval(value, code) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
    reject(code);
  }
  return value;
}

function member(value, choices, code) {
  if (!choices.includes(value)) reject(code);
  return value;
}

function boolean(value, code) {
  if (typeof value !== 'boolean') reject(code);
  return value;
}

const requestFields = [
  'request_key',
  'signal_id',
  'source_version',
  'target_version',
  'expected_revision',
  'reason_code',
  'run_id',
  'lease_owner',
  'fencing_token',
];

/** Opaque identifiers only: neither identities nor a parsed request authenticate a caller. */
export function parseQualifiedPublicationRequest(input) {
  const code = 'invalid_publication_request';
  return safely(code, () => {
    const row = object(input, requestFields, code);
    matches(row.request_key, /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/, code);
    slug(row.signal_id, code);
    integer(row.source_version, 1, code);
    integer(row.target_version, 1, code);
    integer(row.expected_revision, 0, code);
    member(row.reason_code, ['initial_publication', 'content_correction', 'republication'], code);
    uuid(row.run_id, code);
    uuid(row.lease_owner, code);
    integer(row.fencing_token, 1, code);
    if (row.target_version <= row.source_version) reject('target_version_not_new');
    return row;
  });
}

/**
 * Same semantic command can survive a run lease takeover. The receipt key,
 * current lease owner and fence are not semantic content; run identity is.
 */
export function fingerprintQualifiedPublicationRequest(input) {
  const request = parseQualifiedPublicationRequest(input);
  return hash({
    signal_id: request.signal_id,
    source_version: request.source_version,
    target_version: request.target_version,
    expected_revision: request.expected_revision,
    reason_code: request.reason_code,
    run_id: request.run_id,
  });
}

const snapshotFields = [
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
];

function hash(value) {
  return createHash('sha256').update(JSON.stringify(value), 'utf8').digest('hex');
}

function timestamp(value, code) {
  let date;
  if (typeof value === 'string') {
    const matched = value.match(
      /^(\d{4})-(\d{2})-(\d{2})T([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d)(?:\.(\d{1,3}))?)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/,
    );
    if (!matched || matched[0] !== value) reject(code);
    const year = Number(matched[1]);
    const month = Number(matched[2]);
    const day = Number(matched[3]);
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

function parseSnapshot(input) {
  const code = 'invalid_publication_snapshot';
  const row = object(input, [...snapshotFields, 'content_hash'], code);
  slug(row.signal_id, code);
  integer(row.version, 1, code);
  member(row.schema_version, ['3.0.0'], code);
  for (const field of ['title', 'date_basis', 'summary', 'revision_reason']) text(row[field], code);
  member(
    row.type,
    [
      'research',
      'product',
      'funding',
      'acquisition',
      'hiring',
      'policy',
      'technology',
      'market',
      'people',
      'open_source',
      'security',
      'patent',
      'partnership',
      'regulation',
      'supply_chain',
    ],
    code,
  );
  row.occurred_at = timestamp(row.occurred_at, code);
  row.captured_at = timestamp(row.captured_at, code);
  member(row.date_precision, ['day', 'instant'], code);
  if (row.date_precision === 'day' && !row.occurred_at.endsWith('T00:00:00.000Z')) reject(code);
  if (row.analysis !== null) text(row.analysis, code);
  for (const field of ['importance', 'strength']) {
    integer(row[field], 1, code);
    if (row[field] > 5) reject(code);
  }
  unitInterval(row.confidence, code);
  unitInterval(row.novelty, code);
  member(row.origin, ['legacy_seed', 'pipeline', 'manual'], code);
  if (row.legacy_status !== null) {
    member(row.legacy_status, ['inbox', 'reviewed', 'accepted', 'rejected', 'archived'], code);
  }
  if ((row.origin === 'legacy_seed') !== (row.legacy_status !== null)) reject(code);
  matches(row.content_hash, /^[a-f0-9]{64}$/, code);
  const content = Object.fromEntries(snapshotFields.map((field) => [field, row[field]]));
  if (row.content_hash !== hash(content)) reject('snapshot_hash_mismatch');
  return row;
}

/**
 * Copy a sealed Signal 3.0.0 row without authoring facts, timestamps or legacy
 * semantics. Only version/hash change (timestamps normalize to the same UTC-ms
 * instant as the content package). PostgreSQL sub-ms values are already lost in
 * a driver's Date: the store MUST separately reject them in SQL before this call.
 */
export function cloneSignalSnapshotForPublication(input, targetVersion) {
  return safely('invalid_publication_snapshot', () => {
    const source = parseSnapshot(input);
    integer(targetVersion, 1, 'invalid_publication_request');
    if (targetVersion <= source.version) reject('target_version_not_new');
    const content = Object.fromEntries(snapshotFields.map((field) => [field, source[field]]));
    content.version = targetVersion;
    return { ...content, content_hash: hash(content) };
  });
}

const bundleFields = [
  'snapshot',
  'identity',
  'evidence_links',
  'identity_links',
  'people',
  'organizations',
  'topic_links',
  'evidence',
  'sources',
  'entities',
  'person_profiles',
  'organization_profiles',
  'topics',
];
const verificationStatuses = ['pending', 'verified', 'rejected'];
const evidenceRelations = ['supports', 'contradicts', 'context'];
const entityTypes = [
  'person',
  'company',
  'institution',
  'technology',
  'product',
  'model',
  'dataset',
  'standard_protocol',
  'paper',
  'event',
];

function table(input, fields, keyFields, validate) {
  const code = 'invalid_publication_bundle';
  const values = array(input, code).map((value) => {
    const row = object(value, fields, code);
    validate(row);
    return row;
  });
  const byKey = new Map();
  for (const row of values) {
    const key = JSON.stringify(keyFields.map((field) => row[field]));
    if (byKey.has(key)) reject(code);
    byKey.set(key, row);
  }
  return values;
}

function exactRows(values, references, key) {
  const map = new Map(values.map((row) => [row[key], row]));
  if (map.size !== references.size || [...references].some((id) => !map.has(id))) {
    reject('invalid_publication_bundle');
  }
  return map;
}

function parseLinks(input, signalId, version) {
  const code = 'invalid_publication_bundle';
  return table(
    input,
    ['signal_id', 'version', 'evidence_id', 'claim', 'relation'],
    ['signal_id', 'version', 'evidence_id'],
    (row) => {
      if (row.signal_id !== signalId || row.version !== version) reject(code);
      text(row.evidence_id, code);
      text(row.claim, code);
      member(row.relation, evidenceRelations, code);
    },
  );
}

function parseEntityLinks(input, signalId, version, kind) {
  const code = 'invalid_publication_bundle';
  const idField = kind === 'person' ? 'person_id' : 'organization_id';
  return table(
    input,
    ['signal_id', 'version', idField, 'evidence_id', 'event_role', 'verification_status'],
    ['signal_id', 'version', idField, 'evidence_id'],
    (row) => {
      if (row.signal_id !== signalId || row.version !== version) reject(code);
      text(row[idField], code);
      text(row.evidence_id, code);
      text(row.event_role, code);
      member(row.verification_status, verificationStatuses, code);
      if (kind !== 'person') {
        member(row.event_role, ['subject', 'participant', 'background'], code);
      }
    },
  );
}

function parseProfiles(input, choices) {
  return table(input, ['entity_id', 'entity_type'], ['entity_id'], (row) => {
    text(row.entity_id, 'invalid_publication_bundle');
    member(row.entity_type, choices, 'invalid_entity_profile');
  });
}

function checkSourceUrl(value, allowedHosts) {
  const code = 'untrusted_source_url';
  if (typeof value !== 'string' || !value.startsWith('https://') || /\s|\\/.test(value)) {
    reject(code);
  }
  return safely(code, () => {
    const url = new URL(value);
    const authority = value.slice('https://'.length).split(/[/?#]/, 1)[0];
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      authority.includes('@') ||
      !allowedHosts.includes(url.hostname.toLowerCase())
    ) {
      reject(code);
    }
  });
}

/**
 * Validate only the recorded, locked dependency projection. This is not proof of
 * facts, source independence, industry-person relevance, privacy clearance, or
 * caller authorization. The store owns complete SELECTs and locking; omitted
 * database rows cannot be discovered by a pure function. No publication occurs.
 */
export function qualifySignalPublicationBundle(input) {
  const code = 'invalid_publication_bundle';
  return safely(code, () => {
    const bundle = object(input, bundleFields, code);
    const snapshot = parseSnapshot(bundle.snapshot);
    const identity = object(
      bundle.identity,
      ['signal_id', 'event_key', 'basis_version', 'basis_evidence_id', 'identity_basis'],
      code,
    );
    if (identity.signal_id !== snapshot.signal_id) reject(code);
    slug(identity.event_key, code);
    if (identity.event_key.length > 200) reject(code);
    integer(identity.basis_version, 1, code);
    text(identity.basis_evidence_id, code);
    text(identity.identity_basis, code);
    if (identity.basis_version > snapshot.version) reject('identity_basis_unqualified');
    const evidenceLinks = parseLinks(bundle.evidence_links, snapshot.signal_id, snapshot.version);
    const identityLinks = parseLinks(
      bundle.identity_links,
      snapshot.signal_id,
      identity.basis_version,
    );
    if (identity.basis_version === snapshot.version) {
      const byId = new Map(evidenceLinks.map((row) => [row.evidence_id, row]));
      if (
        identityLinks.length !== evidenceLinks.length ||
        identityLinks.some((row) => {
          const equivalent = byId.get(row.evidence_id);
          return (
            !equivalent || equivalent.claim !== row.claim || equivalent.relation !== row.relation
          );
        })
      ) {
        reject(code);
      }
    }
    const people = parseEntityLinks(bundle.people, snapshot.signal_id, snapshot.version, 'person');
    const organizations = parseEntityLinks(
      bundle.organizations,
      snapshot.signal_id,
      snapshot.version,
      'organization',
    );
    const topicLinks = table(
      bundle.topic_links,
      ['signal_id', 'version', 'topic_id'],
      ['signal_id', 'version', 'topic_id'],
      (row) => {
        if (row.signal_id !== snapshot.signal_id || row.version !== snapshot.version) reject(code);
        text(row.topic_id, code);
      },
    );
    const evidence = table(
      bundle.evidence,
      ['id', 'source_id', 'source_url', 'verification_status'],
      ['id'],
      (row) => {
        for (const field of ['id', 'source_id', 'source_url']) text(row[field], code);
        member(row.verification_status, verificationStatuses, code);
      },
    );
    const sources = table(bundle.sources, ['id', 'active', 'allowed_hosts'], ['id'], (row) => {
      text(row.id, code);
      boolean(row.active, code);
      row.allowed_hosts = array(row.allowed_hosts, code).map((host) =>
        matches(
          host,
          /^(?=.{1,253}$)[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/,
          code,
        ).toLowerCase(),
      );
      if (
        !row.allowed_hosts.length ||
        new Set(row.allowed_hosts).size !== row.allowed_hosts.length
      ) {
        reject(code);
      }
    });
    const entities = table(bundle.entities, ['id', 'type', 'status'], ['id'], (row) => {
      text(row.id, code);
      member(row.type, entityTypes, code);
      text(row.status, code);
    });
    const personProfiles = parseProfiles(bundle.person_profiles, ['person']);
    const organizationProfiles = parseProfiles(bundle.organization_profiles, [
      'company',
      'institution',
    ]);
    const topics = table(bundle.topics, ['id', 'status', 'runtime_enabled'], ['id'], (row) => {
      text(row.id, code);
      member(row.status, ['watching', 'active', 'strategic', 'archived'], code);
      boolean(row.runtime_enabled, code);
    });

    const allLinks = [...evidenceLinks, ...identityLinks];
    const evidenceById = exactRows(evidence, new Set(allLinks.map((row) => row.evidence_id)), 'id');
    const sourceById = exactRows(sources, new Set(evidence.map((row) => row.source_id)), 'id');
    const peopleIds = new Set(people.map((row) => row.person_id));
    const organizationIds = new Set(organizations.map((row) => row.organization_id));
    const entityById = exactRows(entities, new Set([...peopleIds, ...organizationIds]), 'id');
    const personById = exactRows(personProfiles, peopleIds, 'entity_id');
    const organizationById = exactRows(organizationProfiles, organizationIds, 'entity_id');
    const topicById = exactRows(topics, new Set(topicLinks.map((row) => row.topic_id)), 'id');
    const linksById = new Map(evidenceLinks.map((row) => [row.evidence_id, row]));
    for (const link of allLinks) {
      const item = evidenceById.get(link.evidence_id);
      if (link.relation === 'contradicts') {
        if (item.verification_status !== 'rejected') reject('unresolved_contradiction');
        continue;
      }
      if (item.verification_status !== 'verified') reject('unverified_evidence');
      const source = sourceById.get(item.source_id);
      if (!source.active) reject('inactive_source');
      checkSourceUrl(item.source_url, source.allowed_hosts);
    }
    const supporting = evidenceLinks.filter((row) => row.relation === 'supports');
    if (!supporting.length) reject('missing_supporting_evidence');
    if (
      !identityLinks.some(
        (row) => row.evidence_id === identity.basis_evidence_id && row.relation === 'supports',
      ) ||
      linksById.get(identity.basis_evidence_id)?.relation !== 'supports'
    ) {
      reject('identity_basis_unqualified');
    }
    if (!people.length) reject('missing_qualified_person');
    for (const [rows, idField, profiles, permittedTypes] of [
      [people, 'person_id', personById, ['person']],
      [organizations, 'organization_id', organizationById, ['company', 'institution']],
    ]) {
      for (const row of rows) {
        if (row.verification_status !== 'verified') reject('unverified_entity_link');
        if (linksById.get(row.evidence_id)?.relation !== 'supports')
          reject('unsupported_entity_link');
        const entity = entityById.get(row[idField]);
        const profile = profiles.get(row[idField]);
        if (entity.status !== 'active') reject('inactive_entity');
        if (!permittedTypes.includes(entity.type) || profile.entity_type !== entity.type) {
          reject('invalid_entity_profile');
        }
        // A narrow exclusion of explicit reporting roles, not a fact/industry classifier.
        if (
          idField === 'person_id' &&
          /\b(?:reporter|journalist|byline)\b|记者/iu.test(row.event_role)
        ) {
          reject('reporting_role_disallowed');
        }
      }
    }
    if (!topicLinks.length) reject('missing_qualified_topic');
    for (const row of topicById.values()) {
      if (row.status === 'archived' || !row.runtime_enabled) reject('inactive_topic');
    }
    return {
      scope: 'recorded_qualification_only',
      signal_id: snapshot.signal_id,
      source_version: snapshot.version,
      identity_basis_version: identity.basis_version,
      counts: {
        supporting_evidence: supporting.length,
        people: peopleIds.size,
        organizations: organizationIds.size,
        topics: topicById.size,
      },
    };
  });
}
