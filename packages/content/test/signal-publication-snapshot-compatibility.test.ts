import { describe, expect, it } from 'vitest';
import {
  createSignalVersionSnapshot,
  signalVersionSnapshotSchema,
  type SignalVersionContent,
  type SignalVersionSnapshot,
} from '../src/signal-v3.js';

// Deliberate cross-package regression only; database private modules do not
// become content/runtime exports or production dependencies.
const qualificationModule = new URL(
  '../../database/src/signal-publication-qualification.mjs',
  import.meta.url,
).href;
const { cloneSignalSnapshotForPublication } = (await import(qualificationModule)) as {
  cloneSignalSnapshotForPublication: (
    input: unknown,
    targetVersion: number,
  ) => SignalVersionSnapshot;
};

function content(overrides: Partial<SignalVersionContent> = {}): SignalVersionContent {
  return {
    signal_id: 'canonical-event',
    version: 1,
    schema_version: '3.0.0',
    title: ' 中英文 mixed — preserve whitespace ',
    type: 'research',
    occurred_at: '2026-09-13T00:00:00.000Z',
    date_precision: 'day',
    date_basis: 'UTC midnight encodes an event day.',
    captured_at: '2026-09-14T12:34:56.789Z',
    summary: 'Line one.\n第二行。',
    analysis: '  An explicitly authored analysis.  ',
    importance: 5,
    strength: 1,
    confidence: 1,
    novelty: 0,
    revision_reason: 'Keep the original revision meaning.',
    origin: 'manual',
    legacy_status: null,
    ...overrides,
  };
}

describe('private publisher and public Signal 3.0.0 hash compatibility', () => {
  it.each([
    ['UTC day', {}],
    ['offset day', { occurred_at: '2026-09-13T02:00:00+02:00' }],
    ['minute precision', { occurred_at: '2026-09-13T00:00Z', captured_at: '2026-09-14T12:34Z' }],
    ['seconds precision', { captured_at: '2026-09-14T12:34:56Z' }],
    ['tenths', { captured_at: '2026-09-14T12:34:56.1Z' }],
    ['hundredths', { captured_at: '2026-09-14T12:34:56.12Z' }],
    ['offset instant', { occurred_at: '2026-09-13T04:56:07.008+02:00', date_precision: 'instant' }],
    ['year one', { occurred_at: '0001-01-01T00:00:00.000Z' }],
    ['year 9999', { occurred_at: '9999-12-31T00:00:00.000Z' }],
    ['leap day', { occurred_at: '2000-02-29T00:00:00.000Z' }],
    ['pipeline', { origin: 'pipeline', analysis: null }],
    ['accepted legacy', { origin: 'legacy_seed', legacy_status: 'accepted' }],
    ['rejected legacy', { origin: 'legacy_seed', legacy_status: 'rejected' }],
  ] as const)('clones %s with the identical actual content schema/hash', (_label, overrides) => {
    const source = createSignalVersionSnapshot(content(overrides));
    const result = cloneSignalSnapshotForPublication(source, 2);
    const expected = createSignalVersionSnapshot(content({ ...overrides, version: 2 }));
    expect(result).toEqual({
      ...expected,
      occurred_at: new Date(expected.occurred_at).toISOString(),
      captured_at: new Date(expected.captured_at).toISOString(),
    });
    expect(signalVersionSnapshotSchema.parse(result)).toEqual(result);
    expect(result.content_hash).not.toBe(source.content_hash);
    const databaseSource = {
      ...source,
      occurred_at: new Date(source.occurred_at),
      captured_at: new Date(source.captured_at),
    };
    expect(cloneSignalSnapshotForPublication(databaseSource, 2)).toEqual(result);
  });

  it.each([
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
  ] as const)('retains the versioned %s discriminator', (type) => {
    const source = createSignalVersionSnapshot(content({ type }));
    expect(cloneSignalSnapshotForPublication(source, 2)).toEqual(
      createSignalVersionSnapshot(content({ type, version: 2 })),
    );
  });

  it('does not require field insertion order on a valid persisted projection', () => {
    const source = createSignalVersionSnapshot(content());
    const reverseOrder = Object.fromEntries(Object.entries(source).reverse());
    expect(cloneSignalSnapshotForPublication(reverseOrder, 2)).toEqual(
      createSignalVersionSnapshot(content({ version: 2 })),
    );
  });
});
