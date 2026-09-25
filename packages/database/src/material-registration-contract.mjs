import { createHash, createPublicKey, verify } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { TextDecoder } from 'node:util';
import { URL } from 'node:url';

export class MaterialRegistrationError extends Error {
  constructor(code = 'invalid_material_plan') {
    super(code);
    this.code = code;
  }
}
const fail = (code) => {
  throw new MaterialRegistrationError(code);
};
const hash = (text) => createHash('sha256').update(text, 'utf8').digest('hex');
const checkNames = [
  'sourceAuthenticity',
  'usageRights',
  'entityIdentity',
  'eventRelevance',
  'claimSupport',
  'taxonomy',
];
const exact = (value, keys) => {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).sort().join(',') !== [...keys].sort().join(',')
  )
    fail();
};
const string = (value, max = 2000) => {
  if (
    typeof value !== 'string' ||
    !value.trim() ||
    value !== value.trim() ||
    [...value].length > max ||
    [...value].some((character) => {
      const code = character.codePointAt(0);
      return code === 127 || (code < 32 && ![9, 10, 13].includes(code));
    })
  )
    fail();
  return value;
};
const id = (value) => {
  if (!/^[a-z0-9][a-z0-9._:-]{0,199}$/.test(string(value, 200))) fail();
  return value;
};
const digest = (value) => {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) fail();
  return value;
};
const uuid = (value) => {
  if (typeof value !== 'string' || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value))
    fail();
  return value;
};
const array = (value, max, min = 0) => {
  if (
    !Array.isArray(value) ||
    value.length < min ||
    value.length > max ||
    Object.keys(value).length !== value.length
  )
    fail();
  return value;
};
const unique = (rows, key = (row) => row) => {
  if (new Set(rows.map(key)).size !== rows.length) fail();
  return rows;
};
const ids = (value, max, min = 0) => unique(array(value, max, min).map(id)).sort();
const instant = (value) => {
  if (
    typeof value !== 'string' ||
    !Number.isFinite(Date.parse(value)) ||
    new Date(value).toISOString() !== value
  )
    fail();
  return value;
};
const host = (value) => {
  string(value, 253);
  if (
    value !== value.toLowerCase() ||
    value.endsWith('.') ||
    value.split('.').length < 2 ||
    /^\d+(?:\.\d+)*$/.test(value) ||
    value.split('.').some((part) => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(part)) ||
    /(?:^|\.)(?:localhost|local|internal|lan|home|invalid|test|arpa)$/.test(value)
  )
    fail();
  return value;
};
/** DNS names only, matching import boundaries. This does not resolve DNS or fetch a URL. */
const httpsUrl = (value) => {
  string(value, 4096);
  let url;
  try {
    url = new URL(value);
  } catch {
    fail();
  }
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.hash ||
    url.port ||
    /[\s\\]/u.test(value) ||
    value.includes('#') ||
    !value.startsWith('https://') ||
    value.slice(8).split('/')[0].includes('@')
  )
    fail();
  host(url.hostname);
  return url.href;
};
const canonicalJson = (value) =>
  JSON.stringify(value, function (key, item) {
    return item && typeof item === 'object' && !Array.isArray(item)
      ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : item;
  });
const sortedRows = (rows) =>
  unique(rows, (row) => row.id).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

/** A private registration proposal. No status, authenticity, or publication authority is inferred. */
export function normalizeMaterialPlan(value) {
  try {
    if (Buffer.byteLength(JSON.stringify(value), 'utf8') > 240 * 1024) fail();
    exact(value, [
      'version',
      'owner',
      'runId',
      'candidateIndex',
      'baseMaterialHash',
      'sourceBundleHash',
      'entities',
      'sources',
      'evidence',
      'topicIds',
      'candidate',
    ]);
    if (
      value.version !== 'material-registration-v1' ||
      !Number.isInteger(value.candidateIndex) ||
      value.candidateIndex < 0 ||
      value.candidateIndex > 4
    )
      fail();
    const entities = sortedRows(
      // A generated candidate permits 12 people, 12 top-level organizations,
      // and a distinct organization for each person.
      array(value.entities, 36, 1).map((row) => {
        exact(row, ['id', 'type', 'name', 'aliases', 'evidenceIds']);
        if (!['person', 'company', 'institution'].includes(row.type)) fail();
        return {
          id: id(row.id),
          type: row.type,
          name: string(row.name, 200),
          aliases: unique(array(row.aliases, 12).map((name) => string(name, 200))).sort(),
          evidenceIds: ids(row.evidenceIds, 20, 1),
        };
      }),
    );
    const sources = sortedRows(
      array(value.sources, 8, 1).map((row) => {
        exact(row, ['id', 'name', 'url', 'allowedHosts']);
        const url = httpsUrl(row.url);
        const allowedHosts = unique(array(row.allowedHosts, 12, 1).map(host)).sort();
        if (!allowedHosts.includes(new URL(url).hostname)) fail();
        return { id: id(row.id), name: string(row.name, 200), url, allowedHosts };
      }),
    );
    const sourceById = new Map(sources.map((row) => [row.id, row]));
    const evidence = sortedRows(
      array(value.evidence, 20, 1).map((row) => {
        exact(row, [
          'id',
          'sourceId',
          'sourceUrl',
          'locator',
          'excerpt',
          'contentHash',
          'capturedAt',
          'sourcePublishedAt',
        ]);
        const sourceId = id(row.sourceId),
          sourceUrl = httpsUrl(row.sourceUrl);
        if (!sourceById.get(sourceId)?.allowedHosts.includes(new URL(sourceUrl).hostname)) fail();
        const excerpt = string(row.excerpt, 40000),
          contentHash = digest(row.contentHash);
        if (hash(excerpt) !== contentHash) fail();
        return {
          id: id(row.id),
          sourceId,
          sourceUrl,
          locator: string(row.locator, 2000),
          excerpt,
          contentHash,
          capturedAt: instant(row.capturedAt),
          sourcePublishedAt: row.sourcePublishedAt === null ? null : instant(row.sourcePublishedAt),
        };
      }),
    );
    const evidenceById = new Map(evidence.map((row) => [row.id, row]));
    const entityById = new Map(entities.map((row) => [row.id, row]));
    const excerpts = (refs) =>
      refs
        .map((ref) => {
          const found = evidenceById.get(ref);
          if (!found) fail();
          return found.excerpt;
        })
        .join('\n');
    for (const row of entities) if (!excerpts(row.evidenceIds).includes(row.name)) fail();
    const c = value.candidate;
    exact(c, ['title', 'summary', 'eventDate', 'persons', 'organizationIds', 'claims']);
    if (
      typeof c.eventDate !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}$/.test(c.eventDate) ||
      !Number.isFinite(Date.parse(`${c.eventDate}T00:00:00.000Z`)) ||
      new Date(`${c.eventDate}T00:00:00.000Z`).toISOString().slice(0, 10) !== c.eventDate
    )
      fail();
    const organizationIds = ids(c.organizationIds, 24);
    const organization = (ref) => {
      const row = entityById.get(ref);
      if (!row || !['company', 'institution'].includes(row.type)) fail();
      return row;
    };
    organizationIds.forEach(organization);
    const persons = unique(
      array(c.persons, 12, 1).map((row) => {
        exact(row, ['entityId', 'role', 'organizationId', 'evidenceIds']);
        const entityId = id(row.entityId),
          person = entityById.get(entityId);
        if (person?.type !== 'person') fail();
        const role = string(row.role, 300),
          evidenceIds = ids(row.evidenceIds, 20, 1);
        const text = excerpts(evidenceIds);
        const organizationId = row.organizationId === null ? null : id(row.organizationId);
        if (!text.includes(person.name) || !text.includes(role)) fail();
        if (
          organizationId !== null &&
          (!organizationIds.includes(organizationId) ||
            !text.includes(organization(organizationId).name))
        )
          fail();
        return { entityId, role, organizationId, evidenceIds };
      }),
      (row) => row.entityId,
    ).sort((a, b) => (a.entityId < b.entityId ? -1 : a.entityId > b.entityId ? 1 : 0));
    const claims = unique(
      array(c.claims, 12, 1).map((row) => {
        exact(row, ['text', 'evidenceId']);
        const evidenceId = id(row.evidenceId);
        if (!evidenceById.has(evidenceId)) fail();
        return { text: string(row.text, 2000), evidenceId };
      }),
      (row) => canonicalJson(row),
    );
    const owner = string(value.owner, 200);
    if ([...owner].some((character) => character.codePointAt(0) < 32)) fail();
    return {
      version: value.version,
      owner,
      runId: uuid(value.runId),
      candidateIndex: value.candidateIndex,
      baseMaterialHash: digest(value.baseMaterialHash),
      sourceBundleHash: digest(value.sourceBundleHash),
      entities,
      sources,
      evidence,
      topicIds: ids(value.topicIds, 5, 1),
      candidate: {
        title: string(c.title, 500),
        summary: string(c.summary, 2000),
        eventDate: c.eventDate,
        persons,
        organizationIds,
        claims,
      },
    };
  } catch (error) {
    if (error instanceof MaterialRegistrationError) throw error;
    throw new MaterialRegistrationError();
  }
}

export function materialPlanHash(plan) {
  return hash(canonicalJson(normalizeMaterialPlan(plan)));
}

const decode = (value, max) => {
  if (typeof value !== 'string' || value.length > max || !/^[A-Za-z0-9+/]+={0,2}$/.test(value))
    fail();
  const bytes = Buffer.from(value, 'base64');
  if (bytes.toString('base64') !== value) fail();
  return bytes;
};

/** Independent attestation admission only. The web application holds public keys, never signing keys. */
export function verifyMaterialAttestation({ envelope, plan, trustedVerifiers, now = new Date() }) {
  try {
    const normalized = normalizeMaterialPlan(plan);
    exact(envelope, ['keyId', 'payload', 'signature']);
    if (typeof envelope.keyId !== 'string' || !Object.hasOwn(trustedVerifiers, envelope.keyId))
      fail();
    const trusted = trustedVerifiers[envelope.keyId];
    exact(trusted, ['publicKey', 'verifierId']);
    if (
      typeof trusted.publicKey !== 'string' ||
      !trusted.publicKey.startsWith('-----BEGIN PUBLIC KEY-----')
    )
      fail();
    const key = createPublicKey(trusted.publicKey);
    if (key.asymmetricKeyType !== 'ed25519') fail();
    const bytes = decode(envelope.payload, 48000),
      signature = decode(envelope.signature, 100);
    if (signature.length !== 64 || !verify(null, bytes, key, signature)) fail();
    const payload = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    exact(payload, [
      'version',
      'planHash',
      'owner',
      'runId',
      'candidateIndex',
      'baseMaterialHash',
      'sourceBundleHash',
      'verifierId',
      'issuedAt',
      'ingestBefore',
      'checks',
      'rationale',
    ]);
    if (
      payload.version !== 'signed-material-verification-v1' ||
      payload.planHash !== materialPlanHash(normalized) ||
      payload.verifierId !== string(trusted.verifierId, 200)
    )
      fail();
    for (const field of [
      'owner',
      'runId',
      'candidateIndex',
      'baseMaterialHash',
      'sourceBundleHash',
    ])
      if (payload[field] !== normalized[field]) fail();
    const issued = Date.parse(instant(payload.issuedAt)),
      until = Date.parse(instant(payload.ingestBefore));
    const time = now.getTime();
    if (!Number.isFinite(time) || issued > time || until <= issued || until - issued > 60000)
      fail();
    if (time >= until) fail('material_verification_expired');
    exact(payload.checks, checkNames);
    exact(payload.rationale, checkNames);
    for (const name of checkNames) {
      if (payload.checks[name] !== true) fail();
      string(payload.rationale[name], 2000);
    }
    return payload;
  } catch (error) {
    if (
      error instanceof MaterialRegistrationError &&
      error.code === 'material_verification_expired'
    )
      throw error;
    throw new MaterialRegistrationError('material_verification_invalid');
  }
}
