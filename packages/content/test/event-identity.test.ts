import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { loadSeedCatalog } from '../src/seed.js';
import {
  parseSignalEventIdentityCatalog,
  planSignalEventIdentities,
  signalEventIdentityCatalogSchema,
  signalEventIdentityProposalSchema,
  signalEventIdentitySchema,
  signalEventKeySchema,
  type SignalEventIdentity,
  type SignalEventIdentityCatalog,
  type SignalEventIdentityProposal,
} from '../src/event-identity.js';

function identity(overrides: Partial<SignalEventIdentity> = {}): SignalEventIdentity {
  return {
    signal_id: 'signal-a',
    event_key: 'product-announcement',
    basis_version: 1,
    basis_evidence_id: 'evidence-a',
    identity_basis: ' Explicitly reviewed identity basis.\n',
    ...overrides,
  };
}

function proposal(
  overrides: Partial<SignalEventIdentityProposal> = {},
): SignalEventIdentityProposal {
  return { ...identity(), identity_status: 'confirmed', ...overrides };
}

function catalog(): SignalEventIdentityCatalog {
  return {
    signal_versions: [
      { signal_id: 'signal-a', version: 1 },
      { signal_id: 'signal-a', version: 2 },
      { signal_id: 'signal-b', version: 1 },
    ],
    public_source_evidence: [
      { id: 'evidence-a', verification_status: 'verified' },
      { id: 'evidence-b', verification_status: 'verified' },
      { id: 'evidence-c', verification_status: 'pending' },
    ],
    signal_version_evidence: [
      { signal_id: 'signal-a', version: 1, evidence_id: 'evidence-a', relation: 'supports' },
      { signal_id: 'signal-a', version: 1, evidence_id: 'evidence-b', relation: 'supports' },
      { signal_id: 'signal-a', version: 2, evidence_id: 'evidence-a', relation: 'supports' },
      { signal_id: 'signal-b', version: 1, evidence_id: 'evidence-b', relation: 'supports' },
    ],
    signal_event_identities: [],
  };
}

describe('event identity machine contracts', () => {
  it.each(['a', 'product-2-announcement', '1', 'a'.repeat(200)])(
    'accepts explicit ASCII key %s',
    (key) => {
      expect(signalEventKeySchema.parse(key)).toBe(key);
    },
  );

  it.each([
    '',
    ' ',
    '\t\n',
    'Product',
    'product_event',
    '-product',
    'product-',
    'product--event',
    'product.event',
    '产品',
    'évent',
    'product\n',
    'product\r\n',
    'product\u0000',
    'product event',
    'a'.repeat(201),
    null,
    undefined,
    1,
  ])('rejects invalid key %j instead of normalizing it', (key) => {
    expect(signalEventKeySchema.safeParse(key).success).toBe(false);
  });

  it('preserves exact identity text and rejects unknown fields', () => {
    expect(signalEventIdentitySchema.parse(identity())).toEqual(identity());
    expect(signalEventIdentitySchema.safeParse({ ...identity(), published: true }).success).toBe(
      false,
    );
    expect(
      signalEventIdentityProposalSchema.safeParse({
        ...proposal(),
        source_url: 'https://example.com',
      }).success,
    ).toBe(false);
    expect(
      signalEventIdentityProposalSchema.safeParse({ ...proposal(), title: 'Make a key from me' })
        .success,
    ).toBe(false);
  });

  it.each(['signal_id', 'basis_evidence_id', 'identity_basis'] as const)(
    'rejects invalid nonblank %s',
    (field) => {
      for (const value of ['', ' ', '\t\n', null, undefined]) {
        expect(signalEventIdentitySchema.safeParse({ ...identity(), [field]: value }).success).toBe(
          false,
        );
      }
    },
  );

  it.each([0, -1, 1.5, 2_147_483_648, Number.NaN, Number.POSITIVE_INFINITY, '1', null, undefined])(
    'rejects invalid registry version %j',
    (basisVersion) =>
      expect(
        signalEventIdentitySchema.safeParse({ ...identity(), basis_version: basisVersion }).success,
      ).toBe(false),
  );

  it('supports the positive PostgreSQL integer boundary', () => {
    expect(
      signalEventIdentitySchema.parse(identity({ basis_version: 2_147_483_647 })).basis_version,
    ).toBe(2_147_483_647);
  });

  it.each([
    'signal_versions',
    'signal_version_evidence',
    'public_source_evidence',
    'signal_event_identities',
  ] as const)('rejects duplicate rows and unknown projection fields in %s', (field) => {
    const input = catalog();
    input.signal_event_identities.push(identity());
    const rows: unknown[] = input[field];
    rows.push(structuredClone(rows[0]));
    expect(signalEventIdentityCatalogSchema.safeParse(input).success).toBe(false);
    rows.pop();
    Object.assign(rows[0]!, { unexpected: true });
    expect(signalEventIdentityCatalogSchema.safeParse(input).success).toBe(false);
  });

  it('rejects two registered Signals using the same key', () => {
    const input = catalog();
    input.signal_event_identities = [
      identity(),
      identity({ signal_id: 'signal-b', basis_evidence_id: 'evidence-b' }),
    ];
    expect(signalEventIdentityCatalogSchema.safeParse(input).success).toBe(false);
  });

  it('rejects conflicting evidence relations sharing a composite key', () => {
    const input = catalog();
    input.signal_version_evidence.push({
      ...input.signal_version_evidence[0]!,
      relation: 'contradicts',
    });
    expect(signalEventIdentityCatalogSchema.safeParse(input).success).toBe(false);
  });

  it.each<[string, (value: SignalEventIdentityCatalog) => unknown]>([
    ['unknown link Signal', (value) => (value.signal_version_evidence[0]!.signal_id = 'missing')],
    ['unknown link version', (value) => (value.signal_version_evidence[0]!.version = 3)],
    [
      'unknown source evidence',
      (value) => (value.signal_version_evidence[0]!.evidence_id = 'missing'),
    ],
    [
      'unknown registered Signal',
      (value) => (value.signal_event_identities[0]!.signal_id = 'missing'),
    ],
    [
      'wrong registered basis version',
      (value) => (value.signal_event_identities[0]!.basis_version = 3),
    ],
    [
      'cross-version basis',
      (value) => {
        value.signal_event_identities[0]!.basis_version = 2;
        value.signal_event_identities[0]!.basis_evidence_id = 'evidence-b';
      },
    ],
    ['cross-Signal basis', (value) => (value.signal_event_identities[0]!.signal_id = 'signal-b')],
  ])('rejects %s', (_name, mutate) => {
    const input = catalog();
    input.signal_event_identities.push(identity());
    mutate(input);
    expect(() => parseSignalEventIdentityCatalog(input)).toThrow();
  });

  it('requires explicit collections but allows unregistered Signals and later-rejected evidence', () => {
    const input = catalog();
    expect(parseSignalEventIdentityCatalog(input)).toEqual(input);
    expect(signalEventIdentityCatalogSchema.safeParse({}).success).toBe(false);
    expect(
      signalEventIdentityCatalogSchema.safeParse({ ...input, auto_publish: true }).success,
    ).toBe(false);
    input.signal_event_identities.push(identity());
    input.public_source_evidence[0]!.verification_status = 'rejected';
    expect(parseSignalEventIdentityCatalog(input)).toEqual(input);
  });
});

describe('deterministic event identity planning', () => {
  it('plans only an explicit supported confirmed identity without writing or enriching input', () => {
    const input = catalog();
    const proposals = [proposal()];
    const before = structuredClone({ input, proposals });
    const result = planSignalEventIdentities(input, proposals);
    expect(result).toEqual([
      {
        signal_id: 'signal-a',
        event_key: 'product-announcement',
        action: 'register',
        reason: 'confirmed_supported_identity',
        identity: identity(),
      },
    ]);
    expect({ input, proposals }).toEqual(before);
    expect(input.signal_event_identities).toEqual([]);
    expect(result[0]).not.toHaveProperty('published');
    if (result[0]?.action === 'register')
      result[0].identity.identity_basis = 'only the result changed';
    expect({ input, proposals }).toEqual(before);
  });

  it.each(['uncertain', 'legacy_hint'] as const)(
    'never promotes %s even with a complete verified basis',
    (status) => {
      const input = catalog();
      input.signal_event_identities.push(identity());
      const result = planSignalEventIdentities(input, [proposal({ identity_status: status })]);
      expect(result[0]?.action).toBe('deferred');
      expect(result[0]).not.toHaveProperty('identity');
    },
  );

  it.each([null, undefined])(
    'defers a confirmed proposal with missing key %j without inventing it',
    (key) => {
      const input: Record<string, unknown> = { ...proposal(), event_key: key };
      if (key === undefined) delete input.event_key;
      expect(planSignalEventIdentities(catalog(), [input])).toEqual([
        {
          signal_id: 'signal-a',
          event_key: null,
          action: 'deferred',
          reason: 'missing_event_key',
        },
      ]);
    },
  );

  it.each(['basis_version', 'basis_evidence_id', 'identity_basis'] as const)(
    'defers absent or null %s without defaults',
    (field) => {
      const input: Record<string, unknown> = { ...proposal(), [field]: null };
      expect(planSignalEventIdentities(catalog(), [input])[0]?.action).toBe('deferred');
      delete input[field];
      expect(planSignalEventIdentities(catalog(), [input])[0]?.action).toBe('deferred');
    },
  );

  it.each([
    { identity_status: 'published' },
    { identity_status: null },
    { basis_version: 0 },
    { basis_version: 2_147_483_648 },
    { identity_basis: '\t\n' },
    { event_key: 'UPPERCASE' },
  ])('rejects malformed supplied proposal fields %j', (overrides) => {
    expect(() => planSignalEventIdentities(catalog(), [{ ...proposal(), ...overrides }])).toThrow();
  });

  it.each([
    { signal_id: 'missing' },
    { basis_version: 3 },
    { basis_evidence_id: 'missing' },
    { basis_version: 2, basis_evidence_id: 'evidence-b' },
    { signal_id: 'signal-b', basis_evidence_id: 'evidence-a' },
  ])('rejects supplied dangling or cross-version proposal references %j', (overrides) => {
    expect(() => planSignalEventIdentities(catalog(), [proposal(overrides)])).toThrow();
  });

  it('rejects unknown Signal even for uncertainty, requiring a version projection first', () => {
    expect(() =>
      planSignalEventIdentities(catalog(), [
        { signal_id: 'missing', identity_status: 'uncertain' },
      ]),
    ).toThrow('Unknown Signal');
  });

  it.each(['pending', 'rejected'] as const)(
    'defers %s source evidence for new registration and exact retry',
    (status) => {
      const input = catalog();
      input.public_source_evidence[0]!.verification_status = status;
      expect(planSignalEventIdentities(input, [proposal()])[0]).toMatchObject({
        action: 'deferred',
        reason: 'basis_evidence_unverified',
      });
      input.signal_event_identities.push(identity());
      const before = structuredClone(input);
      expect(planSignalEventIdentities(input, [proposal()])[0]?.action).toBe('deferred');
      expect(input).toEqual(before);
    },
  );

  it('requires a supporting anchor, not context', () => {
    const input = catalog();
    input.signal_version_evidence[0]!.relation = 'context';
    expect(planSignalEventIdentities(input, [proposal()])[0]).toMatchObject({
      action: 'deferred',
      reason: 'basis_not_supporting',
    });
  });

  it.each(['pending', 'verified'] as const)(
    'holds unresolved %s contradictions on the basis version',
    (status) => {
      const input = catalog();
      input.public_source_evidence[2]!.verification_status = status;
      input.signal_version_evidence.push({
        signal_id: 'signal-a',
        version: 1,
        evidence_id: 'evidence-c',
        relation: 'contradicts',
      });
      expect(planSignalEventIdentities(input, [proposal()])[0]).toMatchObject({
        action: 'deferred',
        reason: 'unresolved_contradiction',
      });
      input.signal_event_identities.push(identity());
      expect(planSignalEventIdentities(input, [proposal()])[0]?.action).toBe('deferred');
      expect(input.signal_event_identities).toEqual([identity()]);
    },
  );

  it('ignores explicitly rejected contradictions and does not borrow contradiction from another version', () => {
    const input = catalog();
    input.public_source_evidence[2]!.verification_status = 'rejected';
    input.signal_version_evidence.push({
      signal_id: 'signal-a',
      version: 1,
      evidence_id: 'evidence-c',
      relation: 'contradicts',
    });
    expect(planSignalEventIdentities(input, [proposal()])[0]?.action).toBe('register');
    input.signal_version_evidence.at(-1)!.version = 2;
    input.public_source_evidence[2]!.verification_status = 'verified';
    expect(planSignalEventIdentities(input, [proposal()])[0]?.action).toBe('register');
  });

  it('returns no_change for an exact supported existing registry retry', () => {
    const input = catalog();
    input.signal_event_identities.push(identity());
    expect(planSignalEventIdentities(input, [proposal()])).toEqual([
      {
        signal_id: 'signal-a',
        event_key: 'product-announcement',
        action: 'no_change',
        reason: 'exact_existing_identity',
        identity: identity(),
      },
    ]);
  });

  it.each([
    { event_key: 'different-event' },
    { basis_version: 2 },
    { basis_evidence_id: 'evidence-b' },
    { identity_basis: 'Different explanation of identity' },
    { identity_basis: 'Explicitly reviewed identity basis.' },
  ])('never overwrites an existing identity when %j changes', (overrides) => {
    const input = catalog();
    input.signal_event_identities.push(identity());
    // Conflict takes precedence even if original evidence status has since changed.
    input.public_source_evidence[0]!.verification_status = 'rejected';
    expect(planSignalEventIdentities(input, [proposal(overrides)])[0]).toMatchObject({
      action: 'conflict',
      reason: 'existing_signal_conflict',
    });
    expect(input.signal_event_identities).toEqual([identity()]);
  });

  it('rejects a second Signal reporting the same registered event without merging or overwriting', () => {
    const input = catalog();
    input.signal_event_identities.push(identity());
    expect(
      planSignalEventIdentities(input, [
        proposal({ signal_id: 'signal-b', basis_evidence_id: 'evidence-b' }),
      ])[0],
    ).toMatchObject({ action: 'conflict', reason: 'existing_key_conflict' });
  });

  it('detects an explicitly changed basis even when another required basis field is missing', () => {
    const input = catalog();
    input.signal_event_identities.push(identity());
    for (const change of [
      { basis_version: 2, identity_basis: null },
      { basis_evidence_id: 'evidence-b', basis_version: null },
      { identity_basis: 'Different basis', basis_evidence_id: null },
    ]) {
      expect(planSignalEventIdentities(input, [proposal(change)])[0]).toMatchObject({
        action: 'conflict',
        reason: 'existing_signal_conflict',
      });
    }
    expect(planSignalEventIdentities(input, [proposal({ identity_basis: null })])[0]).toMatchObject(
      {
        action: 'deferred',
        reason: 'incomplete_basis',
      },
    );
  });

  it('marks all Signals competing for one event key as conflicts, independent of input order', () => {
    const proposals = [
      proposal(),
      proposal({ signal_id: 'signal-b', basis_evidence_id: 'evidence-b' }),
    ];
    const result = planSignalEventIdentities(catalog(), proposals);
    expect(result.map((row) => row.action)).toEqual(['conflict', 'conflict']);
    expect(result.every((row) => row.reason === 'batch_key_conflict')).toBe(true);
    expect(planSignalEventIdentities(catalog(), [...proposals].reverse())).toEqual(result);
  });

  it.each([
    { event_key: 'different-event' },
    { basis_version: 2 },
    { basis_evidence_id: 'evidence-b' },
    { identity_basis: 'Another basis' },
    { basis_version: null },
  ])('marks every competing proposal for one Signal as conflict for %j', (overrides) => {
    const proposals = [proposal(), proposal(overrides)];
    const result = planSignalEventIdentities(catalog(), proposals);
    expect(result.map((row) => row.action)).toEqual(['conflict', 'conflict']);
    expect(result.every((row) => row.reason === 'batch_signal_conflict')).toBe(true);
    expect(planSignalEventIdentities(catalog(), [...proposals].reverse())).toEqual(result);
  });

  it('treats exact duplicate batch proposals as invalid input, distinct from retrying existing registration', () => {
    expect(() => planSignalEventIdentities(catalog(), [proposal(), proposal()])).toThrow(
      'Duplicate event identity proposal',
    );
    expect(() =>
      planSignalEventIdentities(catalog(), [
        { signal_id: 'signal-a', identity_status: 'uncertain' },
        { signal_id: 'signal-a', identity_status: 'uncertain', event_key: null },
      ]),
    ).toThrow('Duplicate event identity proposal');
  });

  it('allows explicitly distinct event stages and is stable under catalog and proposal reordering', () => {
    const input = catalog();
    const proposals = [
      proposal(),
      proposal({
        signal_id: 'signal-b',
        event_key: 'product-general-availability',
        basis_evidence_id: 'evidence-b',
      }),
    ];
    const result = planSignalEventIdentities(input, proposals);
    expect(result.map((row) => row.action)).toEqual(['register', 'register']);
    for (const rows of Object.values(input)) rows.reverse();
    expect(planSignalEventIdentities(input, [...proposals].reverse())).toEqual(result);
  });

  it.each(['uncertain', 'legacy_hint'] as const)(
    '%s proposals never reserve keys against confirmed candidates',
    (status) => {
      const result = planSignalEventIdentities(catalog(), [
        proposal(),
        proposal({
          signal_id: 'signal-b',
          basis_evidence_id: 'evidence-b',
          identity_status: status,
        }),
      ]);
      expect(result.map((row) => row.action)).toEqual(['register', 'deferred']);
    },
  );

  it('handles an empty proposal batch without generating identity or backfill', () => {
    expect(planSignalEventIdentities(catalog(), [])).toEqual([]);
  });

  it('does not upgrade real Seed keys or mutate legacy Signals', async () => {
    const seed = await loadSeedCatalog(
      fileURLToPath(new URL('../../../data/seed', import.meta.url)),
      fileURLToPath(new URL('../../../data/taxonomy/taxonomy.yaml', import.meta.url)),
    );
    const before = structuredClone(seed);
    const projections: SignalEventIdentityCatalog = {
      signal_versions: seed.signals.map((signal) => ({ signal_id: signal.id, version: 1 })),
      signal_version_evidence: [],
      public_source_evidence: [],
      signal_event_identities: [],
    };
    const hints = seed.signals.map((signal) => ({
      signal_id: signal.id,
      identity_status: 'legacy_hint' as const,
      event_key: signal.event_key ?? null,
    }));
    const result = planSignalEventIdentities(projections, hints);
    expect(result).toHaveLength(seed.signals.length);
    expect(
      result.every((row) => row.action === 'deferred' && row.reason === 'legacy_hint_only'),
    ).toBe(true);
    expect(projections.signal_event_identities).toEqual([]);
    expect(seed).toEqual(before);
  });
});
