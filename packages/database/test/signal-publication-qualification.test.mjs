import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import {
  QualifiedPublicationError,
  cloneSignalSnapshotForPublication,
  fingerprintQualifiedPublicationRequest,
  parseQualifiedPublicationRequest,
  qualifySignalPublicationBundle,
} from '../src/signal-publication-qualification.mjs';

const runId = '00000000-0000-0000-0000-000000000001';
const ownerId = '00000000-0000-0000-0000-000000000002';
const otherId = '00000000-0000-0000-0000-000000000003';

function request(overrides = {}) {
  return {
    request_key: 'publish:example:2',
    signal_id: 'example-event',
    source_version: 1,
    target_version: 2,
    expected_revision: 0,
    reason_code: 'initial_publication',
    run_id: runId,
    lease_owner: ownerId,
    fencing_token: 1,
    ...overrides,
  };
}

// Independent literal order mirrors the public 3.0.0 specification. A separate
// content-package test also cross-checks its actual schema/hash implementation.
function snapshot(overrides = {}) {
  const content = {
    signal_id: 'example-event',
    version: 1,
    schema_version: '3.0.0',
    title: ' Example 信号 ',
    type: 'research',
    occurred_at: '2026-09-13T00:00:00.000Z',
    date_precision: 'day',
    date_basis: 'Documented event date',
    captured_at: '2026-09-14T12:34:56.789Z',
    summary: ' A source-grounded summary.\n',
    analysis: null,
    importance: 4,
    strength: 3,
    confidence: 0.9,
    novelty: 0.6,
    revision_reason: 'Candidate content',
    origin: 'manual',
    legacy_status: null,
    ...overrides,
  };
  const contentHash = createHash('sha256')
    .update(
      JSON.stringify({
        ...content,
        occurred_at: new Date(content.occurred_at).toISOString(),
        captured_at: new Date(content.captured_at).toISOString(),
      }),
      'utf8',
    )
    .digest('hex');
  return { ...content, content_hash: contentHash };
}

function link(evidenceId = 'evidence-one', relation = 'supports', version = 1) {
  return {
    signal_id: 'example-event',
    version,
    evidence_id: evidenceId,
    claim: 'The documented event occurred.',
    relation,
  };
}

function bundle() {
  return {
    snapshot: snapshot(),
    identity: {
      signal_id: 'example-event',
      event_key: 'example-event-2026',
      basis_version: 1,
      basis_evidence_id: 'evidence-one',
      identity_basis: 'Canonical event identity from the public record.',
    },
    evidence_links: [link()],
    identity_links: [link()],
    people: [
      {
        signal_id: 'example-event',
        version: 1,
        person_id: 'person-one',
        evidence_id: 'evidence-one',
        event_role: 'researcher',
        verification_status: 'verified',
      },
    ],
    organizations: [
      {
        signal_id: 'example-event',
        version: 1,
        organization_id: 'company-one',
        evidence_id: 'evidence-one',
        event_role: 'subject',
        verification_status: 'verified',
      },
    ],
    topic_links: [{ signal_id: 'example-event', version: 1, topic_id: 'topic-one' }],
    evidence: [
      {
        id: 'evidence-one',
        source_id: 'source-one',
        source_url: 'https://example.com/document',
        verification_status: 'verified',
      },
    ],
    sources: [{ id: 'source-one', active: true, allowed_hosts: ['example.com'] }],
    entities: [
      { id: 'person-one', type: 'person', status: 'active' },
      { id: 'company-one', type: 'company', status: 'active' },
    ],
    person_profiles: [{ entity_id: 'person-one', entity_type: 'person' }],
    organization_profiles: [{ entity_id: 'company-one', entity_type: 'company' }],
    topics: [{ id: 'topic-one', status: 'active', runtime_enabled: true }],
  };
}

function addEvidence(value, id, relation, verificationStatus = 'verified', both = true) {
  value.evidence_links.push(link(id, relation, value.snapshot.version));
  if (both) value.identity_links.push(link(id, relation, value.identity.basis_version));
  value.evidence.push({
    id,
    source_id: 'source-one',
    source_url: `https://example.com/${id}`,
    verification_status: verificationStatus,
  });
}

function expectCode(callback, code) {
  expect(callback).toThrowError(QualifiedPublicationError);
  expect(callback).toThrowError(expect.objectContaining({ code, message: code }));
}

describe('qualified publication command and replay fingerprint', () => {
  it('accepts an exact detached command including a null-prototype command', () => {
    const value = request();
    expect(parseQualifiedPublicationRequest(value)).toEqual(value);
    expect(parseQualifiedPublicationRequest(value)).not.toBe(value);
    expect(parseQualifiedPublicationRequest(Object.assign(Object.create(null), value))).toEqual(
      value,
    );
  });

  it.each(Object.keys(request()))('requires command field %s', (field) => {
    const value = request();
    delete value[field];
    expectCode(() => parseQualifiedPublicationRequest(value), 'invalid_publication_request');
  });

  it.each(['authorized', 'verified', 'action', 'snapshot', 'summary', 'now', 'can_publish'])(
    'does not accept caller-supplied %s',
    (field) =>
      expectCode(
        () => parseQualifiedPublicationRequest({ ...request(), [field]: true }),
        'invalid_publication_request',
      ),
  );

  it.each([
    ['request_key', ''],
    ['request_key', 'a'.repeat(201)],
    ['request_key', 'a\n'],
    ['request_key', '_a'],
    ['signal_id', 'Invalid ID'],
    ['signal_id', 'signal\n'],
    ['source_version', '1'],
    ['source_version', 0],
    ['target_version', 2_147_483_648],
    ['target_version', 1.5],
    ['expected_revision', -1],
    ['expected_revision', Number.NaN],
    ['reason_code', 'privacy'],
    ['run_id', otherId.toUpperCase().replace('003', 'ABC')],
    ['run_id', `${runId}\n`],
    ['lease_owner', null],
    ['fencing_token', 0],
    ['fencing_token', Number.POSITIVE_INFINITY],
  ])('rejects invalid %s value %j', (field, value) => {
    expectCode(
      () => parseQualifiedPublicationRequest(request({ [field]: value })),
      'invalid_publication_request',
    );
  });

  it.each([1, 0])('requires a newly numbered target instead of %s', (targetVersion) => {
    expectCode(
      () => parseQualifiedPublicationRequest(request({ target_version: targetVersion || 1 })),
      'target_version_not_new',
    );
  });

  it('retains semantic fingerprints across lease takeover but binds the run and content intent', () => {
    const value = request();
    const fingerprint = fingerprintQualifiedPublicationRequest(value);
    expect(fingerprint).toMatch(/^[a-f0-9]{64}$/);
    for (const change of [
      { request_key: 'another-key' },
      { lease_owner: otherId },
      { fencing_token: 2 },
    ]) {
      expect(fingerprintQualifiedPublicationRequest({ ...value, ...change })).toBe(fingerprint);
    }
    for (const change of [
      { signal_id: 'another-event' },
      { source_version: 2, target_version: 3 },
      { target_version: 3 },
      { expected_revision: 1 },
      { reason_code: 'republication' },
      { run_id: otherId },
    ]) {
      expect(fingerprintQualifiedPublicationRequest({ ...value, ...change })).not.toBe(fingerprint);
    }
    const reordered = Object.fromEntries(Object.entries(value).reverse());
    expect(fingerprintQualifiedPublicationRequest(reordered)).toBe(fingerprint);
  });

  it('rejects accessors, symbols and proxies without executing user code or leaking messages', () => {
    const getter = vi.fn(() => 'secret');
    const accessor = Object.defineProperty(request(), 'request_key', { get: getter });
    const trap = vi.fn(() => {
      throw new Error('secret');
    });
    const proxy = new Proxy(request(), { getPrototypeOf: trap });
    const revoked = Proxy.revocable(request(), {});
    revoked.revoke();
    for (const value of [
      accessor,
      proxy,
      revoked.proxy,
      { ...request(), [Symbol('secret')]: true },
      Object.assign(Object.create({ secret: true }), request()),
    ]) {
      expectCode(() => parseQualifiedPublicationRequest(value), 'invalid_publication_request');
    }
    expect(getter).not.toHaveBeenCalled();
    expect(trap).not.toHaveBeenCalled();
    expect(new QualifiedPublicationError('secret').message).toBe('invalid_publication_bundle');
    expect(new QualifiedPublicationError('publication_write_conflict').code).toBe(
      'publication_write_conflict',
    );
  });
});

describe('sealed Signal 3.0.0 cloning', () => {
  it('preserves source content byte-for-byte and changes only version and canonical hash', () => {
    const value = snapshot();
    const before = globalThis.structuredClone(value);
    const result = cloneSignalSnapshotForPublication(value, 2);
    expect(result).toEqual(snapshot({ version: 2 }));
    expect(value).toEqual(before);
    expect(result).not.toBe(value);
    expect(result.content_hash).not.toBe(value.content_hash);
    for (const field of Object.keys(value).filter(
      (field) => !['version', 'content_hash'].includes(field),
    )) {
      expect(result[field]).toEqual(value[field]);
    }
  });

  it('normalizes DB dates and explicit offsets without moving event or captured time', () => {
    const value = snapshot({
      occurred_at: '2026-09-13T02:00:00+02:00',
      captured_at: new Date('2026-09-14T12:34:56.789Z'),
    });
    expect(cloneSignalSnapshotForPublication(value, 2)).toEqual(snapshot({ version: 2 }));
    expect(value.occurred_at).toBe('2026-09-13T02:00:00+02:00');
    expect(value.captured_at).toBeInstanceOf(Date);
  });

  it.each(['inbox', 'reviewed', 'accepted', 'rejected', 'archived'])(
    'does not silently rewrite legacy %s semantics',
    (legacyStatus) => {
      const value = snapshot({ origin: 'legacy_seed', legacy_status: legacyStatus });
      expect(cloneSignalSnapshotForPublication(value, 2)).toEqual(
        snapshot({
          origin: 'legacy_seed',
          legacy_status: legacyStatus,
          version: 2,
        }),
      );
    },
  );

  it.each(['title', 'summary', 'analysis', 'revision_reason', 'occurred_at', 'version'])(
    'rejects unsealed tampering with %s',
    (field) => {
      const value = snapshot();
      const tampering = {
        title: 'Changed',
        summary: 'Changed',
        analysis: 'Changed',
        revision_reason: 'Changed',
        occurred_at: '2026-09-12T00:00:00.000Z',
        version: 2,
      };
      value[field] = tampering[field];
      expectCode(() => cloneSignalSnapshotForPublication(value, 3), 'snapshot_hash_mismatch');
    },
  );

  it.each([
    ['schema_version', '3.0.1'],
    ['title', ' \n'],
    ['summary', ''],
    ['analysis', ''],
    ['importance', 6],
    ['strength', 0],
    ['confidence', Number.NaN],
    ['novelty', 1.1],
    ['origin', 'unknown'],
    ['legacy_status', 'accepted'],
    ['content_hash', 'A'.repeat(64)],
    ['occurred_at', '2026-09-13T00:00:00.0001Z'],
    ['occurred_at', '2026-02-30T00:00:00.000Z'],
    ['occurred_at', '2026-09-13T24:00:00.000Z'],
    ['occurred_at', '0000-01-01T00:00:00.000Z'],
    ['occurred_at', '2026-09-13T01:00:00.000Z'],
    ['captured_at', '2026-09-14'],
    ['captured_at', '2026-09-14T00:00:00.000Z\n'],
    ['captured_at', new Date(Number.NaN)],
  ])('rejects invalid snapshot %s = %j before cloning', (field, invalid) => {
    const value = { ...snapshot(), [field]: invalid };
    expectCode(() => cloneSignalSnapshotForPublication(value, 2), 'invalid_publication_snapshot');
  });

  it('rejects unknown metadata and Date accessors without reading them', () => {
    expectCode(
      () => cloneSignalSnapshotForPublication({ ...snapshot(), created_at: new Date() }, 2),
      'invalid_publication_snapshot',
    );
    const getter = vi.fn(() => 1);
    const date = new Date('2026-09-14T12:34:56.789Z');
    Object.defineProperty(date, 'toISOString', { get: getter });
    expectCode(
      () => cloneSignalSnapshotForPublication({ ...snapshot(), captured_at: date }, 2),
      'invalid_publication_snapshot',
    );
    expect(getter).not.toHaveBeenCalled();
  });
});

describe('recorded publication qualification, not publication or authorization', () => {
  it('returns only a detached diagnostic and does not mutate a complete eligible projection', () => {
    const value = bundle();
    const before = globalThis.structuredClone(value);
    expect(qualifySignalPublicationBundle(value)).toEqual({
      scope: 'recorded_qualification_only',
      signal_id: 'example-event',
      source_version: 1,
      identity_basis_version: 1,
      counts: { supporting_evidence: 1, people: 1, organizations: 1, topics: 1 },
    });
    expect(value).toEqual(before);
  });

  it('permits verified context and rejected historical contradiction but does not count them as support', () => {
    const value = bundle();
    addEvidence(value, 'context-evidence', 'context');
    addEvidence(value, 'rejected-counter', 'contradicts', 'rejected');
    expect(qualifySignalPublicationBundle(value).counts.supporting_evidence).toBe(1);
  });

  it('requires a person but not an organization and accepts multiple verified people', () => {
    const value = bundle();
    value.organizations = [];
    value.organization_profiles = [];
    value.entities = value.entities.filter((row) => row.type === 'person');
    value.people.push({ ...value.people[0], person_id: 'person-two', event_role: 'paper author' });
    value.entities.push({ id: 'person-two', type: 'person', status: 'active' });
    value.person_profiles.push({ entity_id: 'person-two', entity_type: 'person' });
    expect(qualifySignalPublicationBundle(value).counts).toEqual({
      supporting_evidence: 1,
      people: 2,
      organizations: 0,
      topics: 1,
    });
  });

  it.each([
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
  ])('rejects duplicate, wrong-shape, unknown-field and oversized %s rows', (field) => {
    const value = bundle();
    value[field].push(globalThis.structuredClone(value[field][0]));
    expectCode(() => qualifySignalPublicationBundle(value), 'invalid_publication_bundle');
    const extra = bundle();
    extra[field][0].authorized = true;
    expectCode(() => qualifySignalPublicationBundle(extra), 'invalid_publication_bundle');
    const excessive = bundle();
    excessive[field] = Array.from({ length: 257 }, () =>
      globalThis.structuredClone(excessive[field][0]),
    );
    expectCode(() => qualifySignalPublicationBundle(excessive), 'too_many_dependencies');
  });

  it.each([
    'evidence',
    'sources',
    'entities',
    'person_profiles',
    'organization_profiles',
    'topics',
  ])('rejects missing or unrelated current %s projections', (field) => {
    const value = bundle();
    value[field] = [];
    expectCode(() => qualifySignalPublicationBundle(value), 'invalid_publication_bundle');
    const extra = bundle();
    const id = field.endsWith('profiles') ? 'entity_id' : 'id';
    extra[field].push({ ...extra[field][0], [id]: 'unrelated-row' });
    expectCode(() => qualifySignalPublicationBundle(extra), 'invalid_publication_bundle');
  });

  it.each(['evidence_links', 'identity_links', 'people', 'organizations', 'topic_links'])(
    'rejects references from another signal or version in %s',
    (field) => {
      for (const change of [{ signal_id: 'other-signal' }, { version: 2 }, { version: '1' }]) {
        const value = bundle();
        Object.assign(value[field][0], change);
        expectCode(() => qualifySignalPublicationBundle(value), 'invalid_publication_bundle');
      }
    },
  );

  it.each(['pending', 'verified'])(
    'blocks unresolved %s contradictions in the source version',
    (status) => {
      const value = bundle();
      addEvidence(value, 'counter-evidence', 'contradicts', status);
      expectCode(() => qualifySignalPublicationBundle(value), 'unresolved_contradiction');
    },
  );

  it.each(['supports', 'context'])(
    'requires current verified evidence for copied %s links',
    (relation) => {
      for (const status of ['pending', 'rejected']) {
        const value = bundle();
        addEvidence(value, 'extra-evidence', relation, status);
        expectCode(() => qualifySignalPublicationBundle(value), 'unverified_evidence');
      }
    },
  );

  it.each([
    'http://example.com/document',
    'https://wrong.example/document',
    'https://child.example.com/document',
    'https://example.com.evil.test/document',
    'https://user@example.com/document',
    'https://user:password@example.com/document',
    'https://@example.com/document',
    'https://example.com\\@evil.test/document',
    'https://example.com/white space',
    'https://example.com./document',
    'https://',
  ])('rejects untrusted or credential-bearing URL %s', (url) => {
    const value = bundle();
    value.evidence[0].source_url = url;
    expectCode(() => qualifySignalPublicationBundle(value), 'untrusted_source_url');
  });

  it('allows case-insensitive exact DNS matching without granting wildcard subdomains', () => {
    const value = bundle();
    value.sources[0].allowed_hosts = ['EXAMPLE.COM'];
    expect(qualifySignalPublicationBundle(value).counts.supporting_evidence).toBe(1);
    value.sources[0].allowed_hosts.push('example.com');
    expectCode(() => qualifySignalPublicationBundle(value), 'invalid_publication_bundle');
  });

  it('fails closed when a supporting source becomes inactive', () => {
    const value = bundle();
    value.sources[0].active = false;
    expectCode(() => qualifySignalPublicationBundle(value), 'inactive_source');
  });

  it.each(['people', 'organizations'])(
    'rejects any unverified %s edge instead of silently dropping it',
    (field) => {
      for (const status of ['pending', 'rejected']) {
        const value = bundle();
        value[field][0].verification_status = status;
        expectCode(() => qualifySignalPublicationBundle(value), 'unverified_entity_link');
      }
    },
  );

  it.each(['people', 'organizations'])(
    'requires each %s edge to use same-version supporting evidence',
    (field) => {
      const value = bundle();
      addEvidence(value, 'context-evidence', 'context');
      value[field][0].evidence_id = 'context-evidence';
      expectCode(() => qualifySignalPublicationBundle(value), 'unsupported_entity_link');
      value[field][0].evidence_id = 'missing-evidence';
      expectCode(() => qualifySignalPublicationBundle(value), 'unsupported_entity_link');
    },
  );

  it.each(['person', 'company'])(
    'requires %s entities to remain active and profile-typed',
    (type) => {
      const value = bundle();
      value.entities.find((row) => row.type === type).status = 'archived';
      expectCode(() => qualifySignalPublicationBundle(value), 'inactive_entity');
      const wrongType = bundle();
      wrongType.entities.find((row) => row.type === type).type = 'product';
      expectCode(() => qualifySignalPublicationBundle(wrongType), 'invalid_entity_profile');
    },
  );

  it.each(['reporter', 'Journalist', 'byline', 'industry reporter', 'co-reporter', '新闻记者'])(
    'does not treat explicit reporting role %s as event participation',
    (role) => {
      const value = bundle();
      value.people[0].event_role = role;
      expectCode(() => qualifySignalPublicationBundle(value), 'reporting_role_disallowed');
    },
  );

  it('requires at least one person, supporting link and runtime topic', () => {
    const noPeople = bundle();
    noPeople.people = [];
    noPeople.person_profiles = [];
    noPeople.entities = noPeople.entities.filter((row) => row.type !== 'person');
    expectCode(() => qualifySignalPublicationBundle(noPeople), 'missing_qualified_person');
    const noSupport = bundle();
    noSupport.evidence_links[0].relation = 'context';
    noSupport.identity_links[0].relation = 'context';
    expectCode(() => qualifySignalPublicationBundle(noSupport), 'missing_supporting_evidence');
    const noTopics = bundle();
    noTopics.topic_links = [];
    noTopics.topics = [];
    expectCode(() => qualifySignalPublicationBundle(noTopics), 'missing_qualified_topic');
    for (const change of [{ status: 'archived' }, { runtime_enabled: false }]) {
      const invalid = bundle();
      Object.assign(invalid.topics[0], change);
      expectCode(() => qualifySignalPublicationBundle(invalid), 'inactive_topic');
    }
  });

  it('requires the canonical anchor as verified support in both its basis and the candidate', () => {
    const value = bundle();
    value.identity.basis_evidence_id = 'unknown-evidence';
    expectCode(() => qualifySignalPublicationBundle(value), 'identity_basis_unqualified');
    const future = bundle();
    future.identity.basis_version = 2;
    expectCode(() => qualifySignalPublicationBundle(future), 'identity_basis_unqualified');
    const mismatch = bundle();
    mismatch.identity_links[0].relation = 'context';
    expectCode(() => qualifySignalPublicationBundle(mismatch), 'invalid_publication_bundle');
  });

  it('supports an older identity basis with a full dependency union and checks historical counterevidence', () => {
    const value = bundle();
    value.snapshot = snapshot({ version: 2 });
    for (const field of ['evidence_links', 'people', 'organizations', 'topic_links']) {
      for (const row of value[field]) row.version = 2;
    }
    value.identity_links.push(link('old-counter', 'contradicts', 1));
    value.evidence.push({
      id: 'old-counter',
      source_id: 'old-source',
      source_url: 'https://old.example.com/report',
      verification_status: 'rejected',
    });
    value.sources.push({ id: 'old-source', active: false, allowed_hosts: ['old.example.com'] });
    expect(qualifySignalPublicationBundle(value).identity_basis_version).toBe(1);
    value.evidence.find((row) => row.id === 'old-counter').verification_status = 'pending';
    expectCode(() => qualifySignalPublicationBundle(value), 'unresolved_contradiction');
  });

  it('does not infer a new identity link when a candidate stops supporting the canonical anchor', () => {
    const value = bundle();
    value.snapshot = snapshot({ version: 2 });
    for (const field of ['evidence_links', 'people', 'organizations', 'topic_links']) {
      for (const row of value[field]) row.version = 2;
    }
    addEvidence(value, 'new-support', 'supports', 'verified', false);
    value.evidence_links = value.evidence_links.filter((row) => row.evidence_id !== 'evidence-one');
    value.people[0].evidence_id = 'new-support';
    value.organizations[0].evidence_id = 'new-support';
    expectCode(() => qualifySignalPublicationBundle(value), 'identity_basis_unqualified');
  });

  it('rejects sparse or accessor arrays, custom prototypes and unknown bundle fields', () => {
    const getter = vi.fn(() => 'secret');
    const value = bundle();
    Object.defineProperty(value.people, '0', { get: getter });
    expectCode(() => qualifySignalPublicationBundle(value), 'invalid_publication_bundle');
    expect(getter).not.toHaveBeenCalled();
    const sparse = bundle();
    sparse.people = new Array(1);
    expectCode(() => qualifySignalPublicationBundle(sparse), 'invalid_publication_bundle');
    const prototype = bundle();
    prototype.sources[0] = Object.assign(Object.create({ secret: true }), prototype.sources[0]);
    expectCode(() => qualifySignalPublicationBundle(prototype), 'invalid_publication_bundle');
    const unknown = { ...bundle(), verified: true };
    expectCode(() => qualifySignalPublicationBundle(unknown), 'invalid_publication_bundle');
  });
});
