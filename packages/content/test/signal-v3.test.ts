import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { loadSeedCatalog, type SeedCatalog, type SeedSignal } from '../src/seed.js';
import {
  createSignalVersionSnapshot,
  hashSignalVersionSnapshot,
  planLegacySignalImport,
  signalVersionSnapshotSchema,
  type SignalVersionContent,
} from '../src/signal-v3.js';

function content(overrides: Partial<SignalVersionContent> = {}): SignalVersionContent {
  return {
    signal_id: 'signal-example',
    version: 1,
    schema_version: '3.0.0',
    title: ' Example title ',
    type: 'technology',
    occurred_at: '2026-09-01T00:00:00Z',
    date_precision: 'day',
    date_basis: 'Legacy Seed midnight UTC storage convention; inferred and unverified.',
    captured_at: '2026-09-02T10:00:00+02:00',
    summary: ' Original summary.\n',
    analysis: null,
    importance: 3,
    strength: 4,
    confidence: 0.8,
    novelty: 0.7,
    revision_reason: 'Historical import preview.',
    origin: 'legacy_seed',
    legacy_status: 'accepted',
    ...overrides,
  };
}

function catalog(): SeedCatalog {
  const signal: SeedSignal = {
    id: 'signal-example',
    event_key: 'event-example',
    title: ' Example title ',
    type: 'technology',
    occurred_at: '2026-09-01T00:00:00Z',
    captured_at: '2026-09-02T10:00:00+02:00',
    status: 'accepted',
    source_id: 'source-example',
    source_url: 'https://example.com/a%2Fb?b=2&a=1&a=3#original-fragment',
    summary: ' Original summary.\n',
    importance: 3,
    strength: 4,
    confidence: 0.8,
    novelty: 0.7,
    topics: ['topic-zeta', 'topic-alpha'],
    entities: ['entity-person', 'entity-model'],
  };
  return {
    entities: [
      { id: 'entity-person', type: 'person', name: 'A person', status: 'active' },
      { id: 'entity-model', type: 'model', name: 'A model', status: 'active' },
    ],
    radar: [
      {
        id: 'radar-example',
        topic: 'topic-alpha',
        date: '2026-09-03',
        domain: 'artificial_intelligence',
        attention: 70,
        trend: 'growth',
        maturity: 'emerging',
        strategic_value: 'high',
        confidence: 0.8,
        evidence_signals: ['signal-example'],
        reasoning: 'Historical Radar evidence.',
      },
    ],
    relations: [
      {
        id: 'relation-example',
        source: 'entity-person',
        relation_type: 'discusses',
        target: 'entity-model',
        confidence: 0.5,
      },
    ],
    signals: [signal, { ...signal, id: 'signal-internal', status: 'inbox' }],
    sources: [
      {
        id: 'source-example',
        name: 'Example source',
        type: 'website',
        trust_score: 80,
        active: true,
        allowed_hosts: ['example.com', 'other.example'],
      },
    ],
    topics: [
      { id: 'topic-zeta', title: 'Zeta', status: 'watching' },
      { id: 'topic-alpha', title: 'Alpha', status: 'active' },
    ],
  };
}

describe('Signal 3.0.0 snapshot contract', () => {
  it('preserves original text and dates, computes a hash, and parses its complete result', () => {
    const input = content();
    const snapshot = createSignalVersionSnapshot(input);
    expect(snapshot).toEqual({ ...input, content_hash: hashSignalVersionSnapshot(input) });
    expect(snapshot.content_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(signalVersionSnapshotSchema.parse(snapshot)).toEqual(snapshot);
    expect(snapshot).not.toHaveProperty('created_at');
    expect(snapshot).not.toHaveProperty('status');
  });

  it('uses fixed canonical fields independently of caller property order and rejects tampering', () => {
    const original = content();
    const reordered = Object.fromEntries(
      Object.entries(original).reverse(),
    ) as SignalVersionContent;
    expect(hashSignalVersionSnapshot(reordered)).toBe(hashSignalVersionSnapshot(original));
    const snapshot = createSignalVersionSnapshot(original);
    expect(() => signalVersionSnapshotSchema.parse({ ...snapshot, title: 'Changed' })).toThrow(
      'content_hash does not match',
    );
    expect(createSignalVersionSnapshot({ ...original, title: 'Changed' }).content_hash).not.toBe(
      snapshot.content_hash,
    );
    expect(() => hashSignalVersionSnapshot(snapshot)).toThrow();
  });

  it('hashes equivalent timestamp representations identically across DB readback normalization', () => {
    const original = content();
    const normalized = content({
      occurred_at: '2026-09-01T00:00:00.000Z',
      captured_at: '2026-09-02T08:00:00.000Z',
    });
    const offset = content({ occurred_at: '2026-09-01T02:00:00+02:00' });
    expect(hashSignalVersionSnapshot(normalized)).toBe(hashSignalVersionSnapshot(original));
    expect(hashSignalVersionSnapshot(offset)).toBe(hashSignalVersionSnapshot(original));
    expect(
      signalVersionSnapshotSchema.safeParse({
        ...normalized,
        content_hash: hashSignalVersionSnapshot(original),
      }).success,
    ).toBe(true);
    expect(createSignalVersionSnapshot(original).occurred_at).toBe(original.occurred_at);
    for (const occurred_at of [
      '0000-01-01T00:00:00Z',
      '0001-01-01T00:00:00+02:00',
      '9999-12-31T23:59:59-02:00',
    ]) {
      expect(() =>
        createSignalVersionSnapshot(content({ occurred_at, date_precision: 'instant' })),
      ).toThrow('Timestamp must round-trip');
    }
  });

  it.each([
    ['unexpected property', { unexpected: true }],
    ['DB created_at', { created_at: '2026-09-03T00:00:00Z' }],
    ['publication status', { status: 'published' }],
    ['blank title', { title: ' \t\n' }],
    ['blank summary', { summary: '\t' }],
    ['blank analysis', { analysis: ' ' }],
    ['blank date basis', { date_basis: ' ' }],
    ['blank revision reason', { revision_reason: ' ' }],
    ['version zero', { version: 0 }],
    ['negative version', { version: -1 }],
    ['fractional version', { version: 1.5 }],
    ['version above DB integer range', { version: 2_147_483_648 }],
    ['wrong schema version', { schema_version: '2.0.0' }],
    ['unknown Signal type', { type: 'unknown' }],
    ['impossible date', { occurred_at: '2026-02-30T00:00:00Z' }],
    ['timezone missing', { captured_at: '2026-09-03T12:00:00' }],
    ['invalid capture', { captured_at: 'infinity' }],
    ['day with nonzero UTC time', { occurred_at: '2026-09-01T12:00:00Z' }],
    ['day with sub-millisecond fraction', { occurred_at: '2026-09-01T00:00:00.000001Z' }],
    ['capture with microsecond precision', { captured_at: '2026-09-01T00:00:00.123456Z' }],
    ['zero fraction exceeding milliseconds', { occurred_at: '2026-09-01T00:00:00.0000Z' }],
    ['importance below range', { importance: 0 }],
    ['strength above range', { strength: 6 }],
    ['fractional importance', { importance: 2.1 }],
    ['confidence above range', { confidence: 1.01 }],
    ['novelty below range', { novelty: -0.1 }],
    ['invalid digest', { content_hash: 'a'.repeat(63) }],
    ['wrong digest', { content_hash: 'a'.repeat(64) }],
  ])('rejects %s', (_label, override) => {
    expect(() =>
      signalVersionSnapshotSchema.parse({ ...createSignalVersionSnapshot(content()), ...override }),
    ).toThrow();
  });

  it.each(['importance', 'strength', 'confidence', 'novelty'] as const)(
    'rejects every non-finite %s',
    (field) => {
      for (const value of [NaN, Infinity, -Infinity]) {
        expect(() => createSignalVersionSnapshot(content({ [field]: value }))).toThrow();
      }
    },
  );

  it('requires legacy status exactly for legacy origin, without promoting any status', () => {
    expect(() => createSignalVersionSnapshot(content({ legacy_status: null }))).toThrow();
    for (const origin of ['manual', 'pipeline'] as const) {
      expect(() => createSignalVersionSnapshot(content({ origin }))).toThrow();
      expect(createSignalVersionSnapshot(content({ origin, legacy_status: null })).origin).toBe(
        origin,
      );
    }
    for (const legacy_status of [
      'inbox',
      'reviewed',
      'accepted',
      'rejected',
      'archived',
    ] as const) {
      const snapshot = createSignalVersionSnapshot(content({ legacy_status }));
      expect(snapshot.legacy_status).toBe(legacy_status);
      expect(snapshot).not.toHaveProperty('publication_status');
    }
  });
});

describe('pure legacy Signal import preview', () => {
  it('preserves source, event key, original timestamps, body, scores, and reference definitions', () => {
    const input = catalog();
    const before = structuredClone(input);
    const plan = planLegacySignalImport(input);
    expect(input).toEqual(before);
    expect(plan.mode).toBe('dry_run');
    expect(plan.versions[0]).toMatchObject({
      signal_id: input.signals[0]!.id,
      title: input.signals[0]!.title,
      type: input.signals[0]!.type,
      occurred_at: input.signals[0]!.occurred_at,
      captured_at: input.signals[0]!.captured_at,
      summary: input.signals[0]!.summary,
      importance: input.signals[0]!.importance,
      strength: input.signals[0]!.strength,
      confidence: input.signals[0]!.confidence,
      novelty: input.signals[0]!.novelty,
      legacy_status: 'accepted',
      analysis: null,
    });
    expect(plan.legacy_references[0]).toMatchObject({
      signal_id: 'signal-example',
      event_key: 'event-example',
      source_id: 'source-example',
      source_url: input.signals[0]!.source_url,
      topics: ['topic-alpha', 'topic-zeta'],
      entities: ['entity-model', 'entity-person'],
      legacy_display: 'public_candidate',
      publication_status: 'unpublished',
      verification_status: 'pending_verification',
    });
    expect(plan.legacy_catalog.sources).toEqual(input.sources);
    expect(plan.legacy_catalog.relations).toEqual(input.relations);
    expect(plan.legacy_catalog.radar).toEqual(input.radar);
    expect(plan.counts).toEqual({
      total: 2,
      legacy_public_candidates: 1,
      internal: 1,
      unpublished: 2,
      pending_verification: 2,
    });
  });

  it('keeps accepted/reviewed as old display candidates and never synthesizes evidence or people', () => {
    const input = catalog();
    input.radar = [];
    input.signals = ['inbox', 'reviewed', 'accepted', 'rejected', 'archived'].map((status) => ({
      ...input.signals[0]!,
      id: `signal-${status}`,
      status: status as SeedSignal['status'],
      entities: [],
    }));
    const plan = planLegacySignalImport(input);
    expect(plan.counts).toEqual({
      total: 5,
      legacy_public_candidates: 2,
      internal: 3,
      unpublished: 5,
      pending_verification: 5,
    });
    for (const reference of plan.legacy_references) {
      expect(reference.publication_status).toBe('unpublished');
      expect(reference.verification_status).toBe('pending_verification');
      expect(reference.entities).toEqual([]);
    }
    const serialized = JSON.stringify(plan);
    for (const fabricated of [
      'public_source_evidence',
      'signal_version_people',
      'source_published_at',
      'excerpt',
      'verified_at',
      'verified_by',
      'eligible_for_publication',
    ]) {
      expect(serialized).not.toContain(`"${fabricated}"`);
    }
  });

  it('retains a legacy person reference without assigning verified event roles or publication', () => {
    const input = catalog();
    input.signals[0]!.summary = 'A person is described as CEO in this unverified legacy summary.';
    const plan = planLegacySignalImport(input);
    expect(plan.legacy_references[0]!.entities).toContain('entity-person');
    expect(plan.legacy_references[0]!.verification_status).toBe('pending_verification');
    expect(plan.legacy_references[0]!.publication_status).toBe('unpublished');
    for (const field of ['person_profiles', 'signal_version_people', 'public_source_evidence']) {
      expect(JSON.stringify(plan)).not.toContain(`"${field}"`);
    }
  });

  it.each([
    ['2026-09-01T00:00:00Z', 'day'],
    ['2026-09-01T00:00:00.000Z', 'day'],
    ['2026-09-01T02:00:00+02:00', 'day'],
    ['2026-09-01T00:00:00+02:00', 'instant'],
    ['2026-09-01T00:00:01Z', 'instant'],
    ['2026-09-01T00:00:00.001Z', 'instant'],
    ['2026-09-01T08:34:00+02:00', 'instant'],
  ])('infers only UTC midnight as a storage convention for %s', (occurred_at, precision) => {
    const input = catalog();
    input.signals[0]!.occurred_at = occurred_at;
    const snapshot = planLegacySignalImport(input).versions[0]!;
    expect(snapshot.occurred_at).toBe(occurred_at);
    expect(snapshot.date_precision).toBe(precision);
    expect(snapshot.date_basis).toContain('not independently verified');
    if (precision === 'day') expect(snapshot.date_basis).toContain('inferred');
  });

  it('returns byte-identical plans for reordered catalog arrays, nested references, and object keys', () => {
    const input = catalog();
    const reordered = structuredClone(input);
    for (const values of Object.values(reordered)) values.reverse();
    for (const signal of reordered.signals) {
      signal.topics.reverse();
      signal.entities.reverse();
    }
    for (const source of reordered.sources) source.allowed_hosts.reverse();
    const reversedKeys = Object.fromEntries(Object.entries(reordered).reverse());
    expect(JSON.stringify(planLegacySignalImport(reversedKeys))).toBe(
      JSON.stringify(planLegacySignalImport(input)),
    );
  });

  it('preserves ordered Radar evidence positions and detects reordered evidence in the plan hash', () => {
    const input = catalog();
    input.signals[1]!.status = 'reviewed';
    input.radar[0]!.evidence_signals = ['signal-internal', 'signal-example'];
    const plan = planLegacySignalImport(input);
    expect(plan.legacy_catalog.radar[0]!.evidence_signals).toEqual([
      'signal-internal',
      'signal-example',
    ]);
    input.radar[0]!.evidence_signals.reverse();
    expect(planLegacySignalImport(input).plan_hash).not.toBe(plan.plan_hash);
  });

  it('hashes all retained data, including reference changes outside the snapshot row', () => {
    const input = catalog();
    const plan = planLegacySignalImport(input);
    const mutations = [
      (value: SeedCatalog) => (value.signals[0]!.source_url = 'https://example.com/other'),
      (value: SeedCatalog) => (value.signals[0]!.event_key = 'event-other'),
      (value: SeedCatalog) => (value.signals[0]!.entities = []),
      (value: SeedCatalog) => (value.signals[0]!.topics = ['topic-alpha']),
      (value: SeedCatalog) => (value.sources[0]!.trust_score = 79),
      (value: SeedCatalog) => (value.entities[0]!.name = 'Changed person'),
      (value: SeedCatalog) => (value.topics[0]!.title = 'Changed Topic'),
      (value: SeedCatalog) => (value.relations[0]!.confidence = 0.4),
      (value: SeedCatalog) => (value.radar[0]!.attention = 69),
    ];
    for (const mutate of mutations) {
      const changed = structuredClone(input);
      mutate(changed);
      const changedPlan = planLegacySignalImport(changed);
      expect(changedPlan.versions).toEqual(plan.versions);
      expect(changedPlan.plan_hash).not.toBe(plan.plan_hash);
    }
  });

  it('retains and fingerprints original timestamp strings although equivalent snapshot hashes match', () => {
    const input = catalog();
    const plan = planLegacySignalImport(input);
    input.signals[0]!.occurred_at = '2026-09-01T02:00:00.000+02:00';
    input.signals[0]!.captured_at = '2026-09-02T08:00:00.000Z';
    const normalized = planLegacySignalImport(input);
    expect(normalized.versions[0]!.content_hash).toBe(plan.versions[0]!.content_hash);
    expect(normalized.plan_hash).not.toBe(plan.plan_hash);
    expect(normalized.versions[0]!.occurred_at).toBe(input.signals[0]!.occurred_at);
    expect(normalized.legacy_catalog.signals[0]!.captured_at).toBe(input.signals[0]!.captured_at);
  });

  it('accepts an empty catalog with a deterministic fingerprint and no inferred records', () => {
    const input: SeedCatalog = {
      entities: [],
      radar: [],
      relations: [],
      signals: [],
      sources: [],
      topics: [],
    };
    const plan = planLegacySignalImport(input);
    expect(plan).toEqual(planLegacySignalImport(structuredClone(input)));
    expect(plan.versions).toEqual([]);
    expect(plan.legacy_references).toEqual([]);
    expect(Object.values(plan.counts)).toEqual([0, 0, 0, 0, 0]);
    expect(plan.plan_hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it.each([
    'http://example.com/signal',
    'https://other.invalid/signal',
    'https://user:secret@example.com/signal',
    'https://user@example.com/signal',
    'https://:secret@example.com/signal',
    ' https://example.com/signal ',
    'not a URL',
  ])('rejects unsafe legacy URL %s', (sourceUrl) => {
    const input = catalog();
    input.signals[0]!.source_url = sourceUrl;
    expect(() => planLegacySignalImport(input)).toThrow();
  });

  it.each<[string, (value: SeedCatalog) => unknown]>([
    ['missing source', (value: SeedCatalog) => (value.sources = [])],
    ['missing topic', (value: SeedCatalog) => (value.topics = [])],
    ['missing entity', (value: SeedCatalog) => (value.entities = [])],
    ['broken relation', (value: SeedCatalog) => (value.relations[0]!.target = 'entity-missing')],
    [
      'broken Radar',
      (value: SeedCatalog) => (value.radar[0]!.evidence_signals = ['signal-missing']),
    ],
    ['duplicate Signal', (value: SeedCatalog) => value.signals.push({ ...value.signals[0]! })],
    ['duplicate cross-catalog ID', (value: SeedCatalog) => (value.sources[0]!.id = 'entity-model')],
    ['duplicate Topic ref', (value: SeedCatalog) => value.signals[0]!.topics.push('topic-alpha')],
    [
      'duplicate Entity ref',
      (value: SeedCatalog) => value.signals[0]!.entities.push('entity-person'),
    ],
    [
      'invalid date',
      (value: SeedCatalog) => (value.signals[0]!.occurred_at = '2026-02-30T00:00:00Z'),
    ],
    ['invalid capture', (value: SeedCatalog) => (value.signals[0]!.captured_at = 'yesterday')],
    [
      'microsecond timestamp',
      (value: SeedCatalog) => (value.signals[0]!.occurred_at = '2026-09-01T00:00:00.000001Z'),
    ],
    ['non-finite score', (value: SeedCatalog) => (value.signals[0]!.confidence = Infinity)],
    ['invalid Source shape', (value: SeedCatalog) => (value.sources[0]!.trust_score = -1)],
    ['invalid relation shape', (value: SeedCatalog) => (value.relations[0]!.confidence = NaN)],
    ['invalid Radar shape', (value: SeedCatalog) => (value.radar[0]!.attention = 101)],
  ])('rejects %s before planning', (_label, mutate) => {
    const input = catalog();
    mutate(input);
    expect(() => planLegacySignalImport(input)).toThrow();
  });

  it('rejects unknown catalog and row fields instead of silently discarding legacy data', () => {
    const input = catalog();
    expect(() => planLegacySignalImport({ ...input, extra: 'must not disappear' })).toThrow();
    for (const key of ['signals', 'entities', 'sources', 'topics', 'relations', 'radar'] as const) {
      const changed = structuredClone(input);
      Object.assign(changed[key][0]!, { extra: 'must not disappear' });
      expect(() => planLegacySignalImport(changed)).toThrow();
    }
  });

  it('previews every real Seed Signal without writing, downloading, or fabricating evidence', async () => {
    const loaded = await loadSeedCatalog(
      fileURLToPath(new URL('../../../data/seed', import.meta.url)),
      fileURLToPath(new URL('../../../data/taxonomy/taxonomy.yaml', import.meta.url)),
    );
    const input: SeedCatalog = {
      entities: loaded.entities,
      radar: loaded.radar,
      relations: loaded.relations,
      signals: loaded.signals,
      sources: loaded.sources,
      topics: loaded.topics,
    };
    const plan = planLegacySignalImport(input);
    expect(input.signals.length).toBeGreaterThan(0);
    expect(plan.versions).toHaveLength(input.signals.length);
    expect(plan.counts.unpublished).toBe(input.signals.length);
    expect(plan.counts.pending_verification).toBe(input.signals.length);
    expect(plan.counts.legacy_public_candidates).toBe(
      input.signals.filter((signal) => signal.status === 'accepted' || signal.status === 'reviewed')
        .length,
    );
    for (const signal of input.signals) {
      const version = plan.versions.find((entry) => entry.signal_id === signal.id)!;
      const reference = plan.legacy_references.find((entry) => entry.signal_id === signal.id)!;
      expect(signalVersionSnapshotSchema.safeParse(version).success).toBe(true);
      expect(version).toMatchObject({
        title: signal.title,
        occurred_at: signal.occurred_at,
        captured_at: signal.captured_at,
        summary: signal.summary,
        legacy_status: signal.status,
      });
      expect(reference.source_url).toBe(signal.source_url);
      expect(reference.source_id).toBe(signal.source_id);
      expect(reference.topics).toEqual([...signal.topics].sort());
      expect(reference.entities).toEqual([...signal.entities].sort());
    }
    expect(JSON.stringify(plan)).not.toContain('"public_source_evidence"');
    expect(JSON.stringify(plan)).not.toContain('"signal_version_people"');
  });
});
