import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { QualifiedPublicationError } from '../src/signal-publication-qualification.mjs';
import {
  CandidateVerificationError,
  fingerprintAssemblyRequest,
  fingerprintCandidateVerificationMaterial,
  fingerprintVerificationReport,
  parseCandidateAssemblyRequest,
  parseCandidateMaterialRequest,
  parseVerificationRecordRequest,
  prepareVerifiedCandidateBundle,
} from '../src/candidate-verification.mjs';

const verificationId = '00000000-0000-0000-0000-000000000001';
const verifierId = '00000000-0000-0000-0000-000000000002';
const otherId = '00000000-0000-0000-0000-000000000003';
const checkNames = [
  'claims_supported',
  'people_disambiguated',
  'people_are_participants',
  'organizations_supported',
  'public_sources_cleared',
  'contradictions_resolved',
];

function record(overrides = {}) {
  return {
    verification_id: verificationId,
    signal_id: 'candidate-one',
    source_version: 1,
    source_content_hash: 'a'.repeat(64),
    bundle_fingerprint: 'b'.repeat(64),
    verifier_id: verifierId,
    policy_version: 'candidate-verification-v1',
    decision: 'approved',
    checks: Object.fromEntries(checkNames.map((name) => [name, true])),
    valid_for_seconds: 3600,
    ...overrides,
  };
}

function assembly(overrides = {}) {
  return {
    request_key: 'assemble:candidate-one:2',
    verification_id: verificationId,
    signal_id: 'candidate-one',
    source_version: 1,
    target_version: 2,
    ...overrides,
  };
}

function version(overrides = {}) {
  const value = {
    signal_id: 'candidate-one',
    version: 1,
    schema_version: '3.0.0',
    title: ' Candidate title ',
    type: 'research',
    occurred_at: '2026-09-13T00:00:00.000Z',
    date_precision: 'day',
    date_basis: 'Public record dates the event.',
    captured_at: '2026-09-14T12:34:56.789Z',
    summary: ' Source-grounded summary.\n',
    analysis: null,
    importance: 4,
    strength: 3,
    confidence: 0.9,
    novelty: 0.5,
    revision_reason: 'Initial candidate',
    origin: 'manual',
    legacy_status: null,
    ...overrides,
  };
  return {
    ...value,
    content_hash: createHash('sha256')
      .update(
        JSON.stringify({
          ...value,
          occurred_at: new Date(value.occurred_at).toISOString(),
          captured_at: new Date(value.captured_at).toISOString(),
        }),
      )
      .digest('hex'),
  };
}

function material() {
  const edge = {
    signal_id: 'candidate-one',
    version: 1,
    evidence_id: 'evidence-one',
    claim: 'The event occurred.',
    relation: 'supports',
  };
  return {
    bundle: {
      snapshot: version(),
      identity: {
        signal_id: 'candidate-one',
        event_key: 'candidate-event',
        basis_version: 1,
        basis_evidence_id: 'evidence-one',
        identity_basis: 'Canonical identity from evidence.',
      },
      evidence_links: [{ ...edge }],
      identity_links: [{ ...edge }],
      people: [
        {
          signal_id: 'candidate-one',
          version: 1,
          person_id: 'person-one',
          evidence_id: 'evidence-one',
          event_role: 'researcher',
          verification_status: 'pending',
        },
      ],
      organizations: [
        {
          signal_id: 'candidate-one',
          version: 1,
          organization_id: 'company-one',
          evidence_id: 'evidence-one',
          event_role: 'subject',
          verification_status: 'pending',
        },
      ],
      topic_links: [{ signal_id: 'candidate-one', version: 1, topic_id: 'topic-one' }],
      evidence: [
        {
          id: 'evidence-one',
          source_id: 'source-one',
          source_url: 'https://example.com/report',
          verification_status: 'verified',
        },
      ],
      sources: [{ id: 'source-one', active: true, allowed_hosts: ['example.com', 'example.org'] }],
      entities: [
        { id: 'person-one', type: 'person', status: 'active' },
        { id: 'company-one', type: 'company', status: 'active' },
      ],
      person_profiles: [{ entity_id: 'person-one', entity_type: 'person' }],
      organization_profiles: [{ entity_id: 'company-one', entity_type: 'company' }],
      topics: [{ id: 'topic-one', status: 'active', runtime_enabled: true }],
    },
    evidence_details: [
      {
        id: 'evidence-one',
        locator: 'Section 1',
        excerpt: 'Exact public excerpt.',
        content_hash: 'c'.repeat(64),
        captured_at: '2026-09-14T12:34:56.789Z',
        source_published_at: '2026-09-13T01:02:03.004Z',
      },
    ],
    entity_details: [
      {
        id: 'person-one',
        name: 'Person One',
        aliases: ['P. One', 'One'],
        metadata: { roles: ['researcher', 'founder'], nested: { established: true } },
        metadata_text: '{"roles":["researcher","founder"],"nested":{"established":true}}',
      },
      { id: 'company-one', name: 'Company One', aliases: [], metadata: {}, metadata_text: '{}' },
    ],
    source_details: [
      {
        id: 'source-one',
        name: 'Reviewed public source',
        type: 'website',
        url: 'https://example.com',
        trust_score: 80,
      },
    ],
  };
}

function expectCode(callback, code, ErrorClass = CandidateVerificationError) {
  expect(callback).toThrowError(ErrorClass);
  expect(callback).toThrowError(expect.objectContaining({ code, message: code }));
}

function reverseKeys(value, preserveArrays = false) {
  if (Array.isArray(value)) {
    const items = value.map((item) => reverseKeys(item, preserveArrays));
    return preserveArrays ? items : items.reverse();
  }
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .reverse()
        .map(([key, item]) => [key, reverseKeys(item, preserveArrays || key === 'metadata')]),
    );
  }
  return value;
}

describe('private verification and assembly command boundaries', () => {
  it('accepts exact, detached reader, record and assembly commands', () => {
    const reader = { signal_id: 'candidate-one', source_version: 1 };
    expect(parseCandidateMaterialRequest(reader)).toEqual(reader);
    const source = record();
    const parsed = parseVerificationRecordRequest(source);
    expect(parsed).toEqual(source);
    expect(parsed).not.toBe(source);
    expect(parsed.checks).not.toBe(source.checks);
    expect(parseCandidateAssemblyRequest(assembly())).toEqual(assembly());
    expect(parseVerificationRecordRequest(Object.assign(Object.create(null), source))).toEqual(
      source,
    );
  });

  it.each(Object.keys(record()))('requires verification field %s', (field) => {
    const value = record();
    delete value[field];
    expectCode(() => parseVerificationRecordRequest(value), 'invalid_verification_request');
  });

  it.each(Object.keys(assembly()))('requires assembly field %s', (field) => {
    const value = assembly();
    delete value[field];
    expectCode(() => parseCandidateAssemblyRequest(value), 'invalid_assembly_request');
  });

  it.each([
    ['verification_id', 'not-a-uuid'],
    ['verification_id', `${verificationId}\n`],
    ['signal_id', 'Not valid'],
    ['source_version', 0],
    ['source_version', '1'],
    ['source_version', 2_147_483_648],
    ['source_content_hash', 'A'.repeat(64)],
    ['bundle_fingerprint', 'b'.repeat(63)],
    ['verifier_id', null],
    ['policy_version', 'candidate-verification-v2'],
    ['decision', 'verified'],
    ['valid_for_seconds', 0],
    ['valid_for_seconds', 86401],
    ['valid_for_seconds', 1.5],
    ['valid_for_seconds', Number.NaN],
  ])('rejects invalid verification %s = %j', (field, value) => {
    expectCode(
      () => parseVerificationRecordRequest(record({ [field]: value })),
      'invalid_verification_request',
    );
  });

  it.each(checkNames)('requires a boolean and affirmative approved check %s', (field) => {
    const value = record();
    value.checks[field] = false;
    expectCode(() => parseVerificationRecordRequest(value), 'verification_checks_incomplete');
    expect(parseVerificationRecordRequest({ ...value, decision: 'rejected' }).checks[field]).toBe(
      false,
    );
    value.checks[field] = 'true';
    expectCode(() => parseVerificationRecordRequest(value), 'invalid_verification_request');
    delete value.checks[field];
    expectCode(() => parseVerificationRecordRequest(value), 'invalid_verification_request');
  });

  it('requires exactly the six checks and refuses supplied clocks/report hashes/permission flags', () => {
    const extra = record();
    extra.checks.additional = true;
    expectCode(() => parseVerificationRecordRequest(extra), 'invalid_verification_request');
    for (const field of [
      'verified_at',
      'expires_at',
      'created_xid',
      'report_hash',
      'authorized',
      'payload',
    ]) {
      expectCode(
        () => parseVerificationRecordRequest({ ...record(), [field]: true }),
        'invalid_verification_request',
      );
    }
    for (const field of ['verified', 'bundle', 'source_content_hash', 'decision']) {
      expectCode(
        () => parseCandidateAssemblyRequest({ ...assembly(), [field]: true }),
        'invalid_assembly_request',
      );
    }
  });

  it('requires a newer bounded target version and bounded opaque assembly key', () => {
    for (const version of [1, 2]) {
      expectCode(
        () =>
          parseCandidateAssemblyRequest(assembly({ source_version: 2, target_version: version })),
        'target_version_not_new',
      );
    }
    for (const key of ['', 'a'.repeat(201), 'x\n', '_x']) {
      expectCode(
        () => parseCandidateAssemblyRequest(assembly({ request_key: key })),
        'invalid_assembly_request',
      );
    }
    expectCode(
      () => parseCandidateAssemblyRequest(assembly({ target_version: 2_147_483_648 })),
      'invalid_assembly_request',
    );
  });

  it('reader allows only signal and source-version identifiers', () => {
    for (const value of [
      {},
      { signal_id: 'candidate-one' },
      { signal_id: 'candidate-one', source_version: 0 },
      { signal_id: 'bad id', source_version: 1 },
      { signal_id: 'candidate-one', source_version: 1, sql: 'SELECT 1' },
    ]) {
      expectCode(() => parseCandidateMaterialRequest(value), 'invalid_material_request');
    }
  });

  it('rejects hostile containers/accessors/proxies without reading or exposing them', () => {
    const getter = vi.fn(() => 'secret');
    const trap = vi.fn(() => {
      throw new Error('private credential');
    });
    const value = Object.defineProperty(record(), 'verification_id', { get: getter });
    const proxy = new Proxy(record(), { getPrototypeOf: trap });
    const revoked = Proxy.revocable(record(), {});
    revoked.revoke();
    for (const input of [
      value,
      proxy,
      revoked.proxy,
      { ...record(), [Symbol('secret')]: true },
      Object.assign(Object.create({ admin: true }), record()),
    ]) {
      expectCode(() => parseVerificationRecordRequest(input), 'invalid_verification_request');
    }
    const checks = record();
    Object.defineProperty(checks.checks, 'claims_supported', { get: getter });
    expectCode(() => parseVerificationRecordRequest(checks), 'invalid_verification_request');
    expect(getter).not.toHaveBeenCalled();
    expect(trap).not.toHaveBeenCalled();
    expect(new CandidateVerificationError('private credential').code).toBe(
      'invalid_candidate_verification',
    );
  });

  it('report hash is stable for key order and binds only report semantics', () => {
    const value = record();
    const fingerprint = fingerprintVerificationReport(value);
    expect(fingerprintVerificationReport(reverseKeys(value))).toBe(fingerprint);
    for (const change of [
      { verification_id: otherId },
      { valid_for_seconds: 1 },
      { source_content_hash: 'd'.repeat(64) },
      { bundle_fingerprint: 'e'.repeat(64) },
    ]) {
      expect(fingerprintVerificationReport({ ...value, ...change })).toBe(fingerprint);
    }
    for (const change of [
      { verifier_id: otherId },
      { decision: 'rejected' },
      { decision: 'rejected', checks: { ...value.checks, claims_supported: false } },
    ]) {
      expect(fingerprintVerificationReport({ ...value, ...change })).not.toBe(fingerprint);
    }
  });

  it('assembly fingerprint excludes lookup key but binds every semantic identifier/version', () => {
    const value = assembly();
    const fingerprint = fingerprintAssemblyRequest(value);
    expect(fingerprintAssemblyRequest(reverseKeys(value))).toBe(fingerprint);
    expect(fingerprintAssemblyRequest({ ...value, request_key: 'other-key' })).toBe(fingerprint);
    for (const change of [
      { verification_id: otherId },
      { signal_id: 'candidate-two' },
      { source_version: 2, target_version: 3 },
      { target_version: 3 },
    ]) {
      expect(fingerprintAssemblyRequest({ ...value, ...change })).not.toBe(fingerprint);
    }
  });
});

describe('non-mutating verified candidate projection', () => {
  it('changes only pending person/organization status and keeps all other fields', () => {
    const value = material().bundle;
    const before = globalThis.structuredClone(value);
    const prepared = prepareVerifiedCandidateBundle(value);
    expect(value).toEqual(before);
    const expected = globalThis.structuredClone(before);
    expected.people[0].verification_status = 'verified';
    expected.organizations[0].verification_status = 'verified';
    expect(prepared).toEqual(expected);
    expect(prepared).not.toBe(value);
    expect(prepared.snapshot).not.toBe(value.snapshot);
    expect(prepared.evidence).not.toBe(value.evidence);
    expect(prepareVerifiedCandidateBundle(prepared)).toEqual(prepared);
  });

  it.each(['people', 'organizations'])(
    'rejects rejected or malformed %s without upgrading it',
    (field) => {
      const value = material().bundle;
      value[field][0].verification_status = 'rejected';
      expectCode(() => prepareVerifiedCandidateBundle(value), 'candidate_edge_rejected');
      expect(value[field][0].verification_status).toBe('rejected');
      for (const status of [undefined, true, 'auto_verified']) {
        value[field][0].verification_status = status;
        expectCode(() => prepareVerifiedCandidateBundle(value), 'invalid_candidate_bundle');
      }
    },
  );

  it.each(['pending', 'rejected'])('never upgrades %s supporting Evidence', (status) => {
    const value = material().bundle;
    value.evidence[0].verification_status = status;
    expectCode(
      () => prepareVerifiedCandidateBundle(value),
      'unverified_evidence',
      QualifiedPublicationError,
    );
    expect(value.evidence[0].verification_status).toBe(status);
  });

  it.each([
    'snapshot',
    'identity',
    'people',
    'organizations',
    'evidence',
    'sources',
    'entities',
    'topics',
  ])('does not sanitize away unknown %s fields before qualification', (field) => {
    const value = material().bundle;
    const row = Array.isArray(value[field]) ? value[field][0] : value[field];
    row.authorized = true;
    expect(() => prepareVerifiedCandidateBundle(value)).toThrowError(QualifiedPublicationError);
  });

  it('retains qualification requirements for people, links, source hosts and topics', () => {
    for (const [mutate, code] of [
      [
        (value) => {
          value.people[0].event_role = 'reporter';
        },
        'reporting_role_disallowed',
      ],
      [
        (value) => {
          value.people[0].evidence_id = 'absent';
        },
        'unsupported_entity_link',
      ],
      [
        (value) => {
          value.sources[0].active = false;
        },
        'inactive_source',
      ],
      [
        (value) => {
          value.evidence[0].source_url = 'https://evil.test';
        },
        'untrusted_source_url',
      ],
      [
        (value) => {
          value.topics[0].runtime_enabled = false;
        },
        'inactive_topic',
      ],
    ]) {
      const value = material().bundle;
      mutate(value);
      expectCode(() => prepareVerifiedCandidateBundle(value), code, QualifiedPublicationError);
    }
  });

  it('rejects getters, symbols, custom prototypes and cycles while accepting legitimate shared query arrays', () => {
    const getter = vi.fn(() => 'pending');
    const value = material().bundle;
    Object.defineProperty(value.people[0], 'verification_status', { get: getter });
    expectCode(() => prepareVerifiedCandidateBundle(value), 'invalid_candidate_bundle');
    expect(getter).not.toHaveBeenCalled();
    for (const mutate of [
      (item) => {
        item.people[0][Symbol('secret')] = true;
      },
      (item) => {
        item.people[0] = new Proxy(item.people[0], {});
      },
      (item) => {
        item.people[0] = Object.assign(Object.create({ authorization: true }), item.people[0]);
      },
      (item) => {
        item.cycle = item;
      },
      (item) => {
        item.people = new Array(1);
      },
    ]) {
      const candidate = material().bundle;
      mutate(candidate);
      expectCode(() => prepareVerifiedCandidateBundle(candidate), 'invalid_candidate_bundle');
    }
    const shared = material().bundle;
    shared.identity_links = shared.evidence_links;
    expect(prepareVerifiedCandidateBundle(shared).people[0].verification_status).toBe('verified');
  });
});

describe('complete recorded material fingerprint', () => {
  it('binds exact JSONB numeric text even when the JS metadata decoder loses precision', () => {
    const left = material();
    const right = material();
    left.entity_details[0].metadata_text = '{"counter":9007199254740992}';
    right.entity_details[0].metadata_text = '{"counter":9007199254740993}';
    left.entity_details[0].metadata = JSON.parse(left.entity_details[0].metadata_text);
    right.entity_details[0].metadata = JSON.parse(right.entity_details[0].metadata_text);
    expect(left.entity_details[0].metadata).toEqual(right.entity_details[0].metadata);
    expect(fingerprintCandidateVerificationMaterial(left)).not.toBe(
      fingerprintCandidateVerificationMaterial(right),
    );
  });

  it('requires bounded valid metadata text compatible with its separately decoded view', () => {
    for (const text of [undefined, '', 'not JSON', '{"different":true}', '[]', 'null']) {
      const value = material();
      value.entity_details[0].metadata_text = text;
      expectCode(
        () => fingerprintCandidateVerificationMaterial(value),
        'invalid_verification_material',
      );
    }
    const oversize = material();
    oversize.entity_details[0].metadata_text = ' '.repeat(65537);
    expectCode(() => fingerprintCandidateVerificationMaterial(oversize), 'too_many_dependencies');
  });

  it('binds entity display identity and source properties, preserving metadata array order', () => {
    const fingerprint = fingerprintCandidateVerificationMaterial(material());
    for (const mutate of [
      (value) => {
        value.entity_details[0].name = 'A different person';
      },
      (value) => {
        value.entity_details[0].aliases.push('Another identity');
      },
      (value) => {
        value.entity_details[0].metadata.roles.reverse();
        value.entity_details[0].metadata_text = JSON.stringify(value.entity_details[0].metadata);
      },
      (value) => {
        value.entity_details[0].metadata.nested.established = false;
        value.entity_details[0].metadata_text = JSON.stringify(value.entity_details[0].metadata);
      },
      (value) => {
        value.source_details[0].name = 'A different source';
      },
      (value) => {
        value.source_details[0].type = 'social';
      },
      (value) => {
        value.source_details[0].url = null;
      },
      (value) => {
        value.source_details[0].trust_score = 79;
      },
    ]) {
      const value = material();
      mutate(value);
      expect(fingerprintCandidateVerificationMaterial(value)).not.toBe(fingerprint);
    }
  });

  it.each(['entity_details', 'source_details'])(
    'requires exact, unique and complete %s',
    (field) => {
      for (const mutate of [
        (value) => {
          value[field] = [];
        },
        (value) => {
          value[field].push({ ...value[field][0] });
        },
        (value) => {
          value[field][0].id = 'unrelated';
        },
        (value) => {
          value[field][0].authorized = true;
        },
        (value) => {
          delete value[field][0].name;
        },
      ]) {
        const value = material();
        mutate(value);
        expectCode(
          () => fingerprintCandidateVerificationMaterial(value),
          'invalid_verification_material',
        );
      }
    },
  );

  it.each([
    ['type', 'unknown'],
    ['trust_score', -1],
    ['trust_score', 101],
    ['trust_score', '80'],
    ['url', {}],
  ])('rejects invalid source detail %s = %j', (field, changed) => {
    const value = material();
    value.source_details[0][field] = changed;
    expectCode(
      () => fingerprintCandidateVerificationMaterial(value),
      'invalid_verification_material',
    );
  });

  it.each([
    undefined,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    1n,
    new Date(),
    () => 'secret',
    Symbol('secret'),
  ])('rejects non-JSON metadata value %s', (metadata) => {
    const value = material();
    value.entity_details[0].metadata = metadata;
    expectCode(
      () => fingerprintCandidateVerificationMaterial(value),
      'invalid_verification_material',
    );
  });

  it('bounds metadata size and rejects cycles/proxies/getters without executing them', () => {
    for (const metadata of [
      'a'.repeat(16385),
      Array.from({ length: 257 }, () => true),
      Object.fromEntries(Array.from({ length: 257 }, (_, index) => [`k${index}`, true])),
      Array.from({ length: 17 }).reduce((child) => ({ child }), null),
    ]) {
      const value = material();
      value.entity_details[0].metadata = metadata;
      expectCode(() => fingerprintCandidateVerificationMaterial(value), 'too_many_dependencies');
    }
    const getter = vi.fn(() => 'secret');
    const getterObject = Object.defineProperty({}, 'private', { get: getter });
    const cycle = {};
    cycle.self = cycle;
    for (const metadata of [
      getterObject,
      cycle,
      new Proxy({}, {}),
      Object.create({ inherited: true }),
    ]) {
      const value = material();
      value.entity_details[0].metadata = metadata;
      expectCode(
        () => fingerprintCandidateVerificationMaterial(value),
        'invalid_verification_material',
      );
    }
    expect(getter).not.toHaveBeenCalled();
  });

  it('is stable for set/key ordering and does not mutate original pending evidence links', () => {
    const value = material();
    const before = globalThis.structuredClone(value);
    const fingerprint = fingerprintCandidateVerificationMaterial(value);
    expect(fingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(fingerprintCandidateVerificationMaterial(reverseKeys(value))).toBe(fingerprint);
    expect(value).toEqual(before);
    expect(value.bundle.people[0].verification_status).toBe('pending');
  });

  it('normalizes exact Date/ISO offset instants including nullable publication dates', () => {
    const value = material();
    const expected = fingerprintCandidateVerificationMaterial(value);
    value.bundle.snapshot.occurred_at = new Date(value.bundle.snapshot.occurred_at);
    value.bundle.snapshot.captured_at = '2026-09-14T14:34:56.789+02:00';
    value.evidence_details[0].captured_at = new Date(value.evidence_details[0].captured_at);
    value.evidence_details[0].source_published_at = '2026-09-13T03:02:03.004+02:00';
    expect(fingerprintCandidateVerificationMaterial(value)).toBe(expected);
    value.evidence_details[0].source_published_at = null;
    expect(fingerprintCandidateVerificationMaterial(value)).not.toBe(expected);
  });

  it.each([
    ['locator', 'Section 2'],
    ['excerpt', 'A different excerpt.'],
    ['content_hash', 'd'.repeat(64)],
    ['captured_at', '2026-09-14T12:34:56.790Z'],
    ['source_published_at', '2026-09-12T01:02:03.004Z'],
  ])('binds evidence detail %s', (field, changed) => {
    const value = material();
    const fingerprint = fingerprintCandidateVerificationMaterial(value);
    value.evidence_details[0][field] = changed;
    expect(fingerprintCandidateVerificationMaterial(value)).not.toBe(fingerprint);
  });

  it('binds every valid changed bundle projection, including original edge statuses and identity', () => {
    const fingerprint = fingerprintCandidateVerificationMaterial(material());
    for (const mutate of [
      (value) => {
        value.bundle.snapshot = version({ summary: 'An amended summary.' });
      },
      (value) => {
        value.bundle.identity.identity_basis = 'Updated recorded identity explanation';
      },
      (value) => {
        value.bundle.people[0].verification_status = 'verified';
      },
      (value) => {
        value.bundle.organizations[0].verification_status = 'verified';
      },
      (value) => {
        value.bundle.people[0].event_role = 'founder';
      },
      (value) => {
        value.bundle.topics[0].status = 'strategic';
      },
      (value) => {
        value.bundle.sources[0].allowed_hosts.push('another.example');
      },
      (value) => {
        value.bundle.evidence[0].source_url = 'https://example.com/another';
      },
      (value) => {
        value.bundle.evidence_links[0].claim = 'Amended supporting claim';
        value.bundle.identity_links[0].claim = 'Amended supporting claim';
      },
    ]) {
      const value = material();
      mutate(value);
      expect(fingerprintCandidateVerificationMaterial(value)).not.toBe(fingerprint);
    }
  });

  it('requires an exact one-to-one details projection for all candidate and identity Evidence', () => {
    for (const mutate of [
      (value) => {
        value.evidence_details = [];
      },
      (value) => {
        value.evidence_details.push({ ...value.evidence_details[0] });
      },
      (value) => {
        value.evidence_details[0].id = 'unrelated-evidence';
      },
      (value) => {
        value.evidence_details.push({ ...value.evidence_details[0], id: 'unrelated-evidence' });
      },
      (value) => {
        value.evidence_details[0].verification_status = 'verified';
      },
      (value) => {
        delete value.evidence_details[0].locator;
      },
    ]) {
      const value = material();
      mutate(value);
      expectCode(
        () => fingerprintCandidateVerificationMaterial(value),
        'invalid_verification_material',
      );
    }
  });

  it.each([
    '2026-09-14T12:34:56.7891Z',
    '2026-02-30T00:00:00.000Z',
    '2026-09-14',
    '2026-09-14T24:00:00Z',
    '0000-01-01T00:00:00Z',
    '2026-09-14T12:34:56.789Z\n',
    new Date(Number.NaN),
    null,
  ])('rejects malformed or lossy evidence timestamps %j', (timestamp) => {
    const value = material();
    value.evidence_details[0].captured_at = timestamp;
    expectCode(() => fingerprintCandidateVerificationMaterial(value), 'invalid_material_timestamp');
  });

  it('refuses to normalize a Date used in a non-date field into permitted text', () => {
    const value = material();
    value.bundle.people[0].event_role = new Date('2026-09-13T00:00:00.000Z');
    expect(() => fingerprintCandidateVerificationMaterial(value)).toThrowError(
      QualifiedPublicationError,
    );
  });

  it('rejects unknown top-level fields, malformed arrays, detail getters and oversized dependencies', () => {
    expectCode(
      () => fingerprintCandidateVerificationMaterial({ ...material(), authorized: true }),
      'invalid_verification_material',
    );
    const getter = vi.fn(() => 'secret');
    const value = material();
    Object.defineProperty(value.evidence_details[0], 'excerpt', { get: getter });
    expectCode(
      () => fingerprintCandidateVerificationMaterial(value),
      'invalid_verification_material',
    );
    expect(getter).not.toHaveBeenCalled();
    const proxy = material();
    proxy.evidence_details[0] = new Proxy(proxy.evidence_details[0], {});
    expectCode(
      () => fingerprintCandidateVerificationMaterial(proxy),
      'invalid_verification_material',
    );
    const excessive = material();
    excessive.evidence_details = Array.from({ length: 257 }, () => ({
      ...excessive.evidence_details[0],
    }));
    expectCode(() => fingerprintCandidateVerificationMaterial(excessive), 'too_many_dependencies');
  });
});
