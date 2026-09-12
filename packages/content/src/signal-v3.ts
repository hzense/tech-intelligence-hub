import { createHash } from 'node:crypto';
import { z } from 'zod';
import { parseSeedCatalog, type SeedCatalog, type SeedSignal } from './seed.js';

export const SIGNAL_VERSION_SCHEMA_VERSION = '3.0.0' as const;

const id = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
// Refine rather than trim: snapshots must preserve the supplied text byte for byte.
const nonblank = z.string().refine((value) => value.trim().length > 0, 'Must not be blank');
const timestamp = z.iso
  .datetime({ offset: true })
  .refine((value) => Number.isFinite(Date.parse(value)), 'Invalid timestamp')
  .refine((value) => {
    const year = new Date(value).getUTCFullYear();
    return year >= 1 && year <= 9999;
  }, 'Timestamp must round-trip within PostgreSQL and four-digit ISO years')
  .refine(
    (value) => !/\.\d{4,}(?:Z|[+-]\d{2}:\d{2})$/.test(value),
    'Timestamp precision must not exceed milliseconds',
  );
const legacyStatus = z.enum(['inbox', 'reviewed', 'accepted', 'rejected', 'archived']);
const contentHash = z.string().regex(/^[a-f0-9]{64}$/);

const snapshotFields = {
  signal_id: id,
  version: z.number().int().positive().max(2_147_483_647),
  schema_version: z.literal(SIGNAL_VERSION_SCHEMA_VERSION),
  title: nonblank,
  type: z.enum([
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
  ]),
  occurred_at: timestamp,
  date_precision: z.enum(['day', 'instant']),
  date_basis: nonblank,
  captured_at: timestamp,
  summary: nonblank,
  analysis: nonblank.nullable(),
  importance: z.number().int().min(1).max(5),
  strength: z.number().int().min(1).max(5),
  confidence: z.number().min(0).max(1),
  novelty: z.number().min(0).max(1),
  revision_reason: nonblank,
  origin: z.enum(['legacy_seed', 'pipeline', 'manual']),
  legacy_status: legacyStatus.nullable(),
};

type SnapshotFields = z.infer<z.ZodObject<typeof snapshotFields>>;

function isUtcMidnight(value: string): boolean {
  const date = new Date(value);
  return (
    date.getUTCHours() === 0 &&
    date.getUTCMinutes() === 0 &&
    date.getUTCSeconds() === 0 &&
    date.getUTCMilliseconds() === 0
  );
}

function validateSnapshotFields(value: SnapshotFields, context: z.RefinementCtx): void {
  if ((value.origin === 'legacy_seed') !== (value.legacy_status !== null)) {
    context.addIssue({
      code: 'custom',
      path: ['legacy_status'],
      message: 'legacy_status must be non-null exactly when origin is legacy_seed',
    });
  }
  if (value.date_precision === 'day' && !isUtcMidnight(value.occurred_at)) {
    context.addIssue({
      code: 'custom',
      path: ['occurred_at'],
      message: 'Day precision requires the midnight UTC storage convention',
    });
  }
}

const signalVersionContentSchema = z
  .strictObject(snapshotFields)
  .superRefine(validateSnapshotFields);

export type SignalVersionContent = z.infer<typeof signalVersionContentSchema>;

/**
 * Canonical UTF-8 JSON, fixed field order, no whitespace. Timestamps are UTC ISO
 * with milliseconds so a Postgres timestamp readback produces the same hash;
 * all other strings are unmodified. Input strings remain in the returned snapshot.
 * content_hash and DB-generated created_at are deliberately outside the preimage.
 * A snapshot hash covers its immutable row; the plan hash also covers legacy references.
 */
function snapshotPreimage(value: SignalVersionContent): string {
  return JSON.stringify({
    signal_id: value.signal_id,
    version: value.version,
    schema_version: value.schema_version,
    title: value.title,
    type: value.type,
    occurred_at: new Date(value.occurred_at).toISOString(),
    date_precision: value.date_precision,
    date_basis: value.date_basis,
    captured_at: new Date(value.captured_at).toISOString(),
    summary: value.summary,
    analysis: value.analysis,
    importance: value.importance,
    strength: value.strength,
    confidence: value.confidence,
    novelty: value.novelty,
    revision_reason: value.revision_reason,
    origin: value.origin,
    legacy_status: value.legacy_status,
  });
}

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

export function hashSignalVersionSnapshot(input: SignalVersionContent): string {
  return sha256(snapshotPreimage(signalVersionContentSchema.parse(input)));
}

/** Structural validation and fingerprint integrity do not verify facts or grant publication. */
export const signalVersionSnapshotSchema = z
  .strictObject({ ...snapshotFields, content_hash: contentHash })
  .superRefine((value, context) => {
    validateSnapshotFields(value, context);
    if (
      timestamp.safeParse(value.occurred_at).success &&
      timestamp.safeParse(value.captured_at).success &&
      value.content_hash !== sha256(snapshotPreimage(value))
    ) {
      context.addIssue({
        code: 'custom',
        path: ['content_hash'],
        message: 'content_hash does not match the canonical snapshot',
      });
    }
  });

export type SignalVersionSnapshot = z.infer<typeof signalVersionSnapshotSchema>;

export function createSignalVersionSnapshot(input: SignalVersionContent): SignalVersionSnapshot {
  const content = signalVersionContentSchema.parse(input);
  return signalVersionSnapshotSchema.parse({
    ...content,
    content_hash: sha256(snapshotPreimage(content)),
  });
}

export interface LegacySignalReference {
  signal_id: string;
  version: 1;
  event_key: string | null;
  source_id: string;
  source_url: string;
  topics: string[];
  entities: string[];
  legacy_display: 'public_candidate' | 'internal';
  publication_status: 'unpublished';
  verification_status: 'pending_verification';
}

export interface LegacySignalImportPlan {
  schema_version: typeof SIGNAL_VERSION_SCHEMA_VERSION;
  mode: 'dry_run';
  versions: SignalVersionSnapshot[];
  legacy_references: LegacySignalReference[];
  /** Retain all validated input rows, including Source/Topic/Entity definitions. */
  legacy_catalog: SeedCatalog;
  counts: {
    total: number;
    legacy_public_candidates: number;
    internal: number;
    unpublished: number;
    pending_verification: number;
  };
  plan_hash: string;
}

function byId<T extends { id: string }>(left: T, right: T): number {
  return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
}

function sortedReferences(values: string[], field: string, signalId: string): string[] {
  if (new Set(values).size !== values.length) {
    throw new Error(`Duplicate ${field} reference in ${signalId}`);
  }
  return [...values].sort();
}

function canonicalCatalog(catalog: SeedCatalog): SeedCatalog {
  return {
    entities: [...catalog.entities].sort(byId),
    // Radar evidence order is persisted as position, so only the catalog rows are unordered.
    radar: [...catalog.radar].sort(byId),
    relations: [...catalog.relations].sort(byId),
    signals: catalog.signals
      .map((signal) => ({
        ...signal,
        topics: sortedReferences(signal.topics, 'Topic', signal.id),
        entities: sortedReferences(signal.entities, 'Entity', signal.id),
      }))
      .sort(byId),
    sources: catalog.sources
      .map((source) => ({ ...source, allowed_hosts: [...source.allowed_hosts].sort() }))
      .sort(byId),
    topics: [...catalog.topics].sort(byId),
  };
}

function legacyVersion(signal: SeedSignal): SignalVersionSnapshot {
  const dayPrecision = isUtcMidnight(signal.occurred_at);
  return createSignalVersionSnapshot({
    signal_id: signal.id,
    version: 1,
    schema_version: SIGNAL_VERSION_SCHEMA_VERSION,
    title: signal.title,
    type: signal.type,
    occurred_at: signal.occurred_at,
    date_precision: dayPrecision ? 'day' : 'instant',
    date_basis: dayPrecision
      ? 'Legacy Seed timestamp is midnight UTC; day precision is inferred from its storage convention and is not independently verified.'
      : 'Legacy Seed timestamp retained as an instant; event time and precision are not independently verified.',
    captured_at: signal.captured_at,
    summary: signal.summary,
    analysis: null,
    importance: signal.importance,
    strength: signal.strength,
    confidence: signal.confidence,
    novelty: signal.novelty,
    revision_reason:
      'Historical Seed import preview; legacy content retained pending verification.',
    origin: 'legacy_seed',
    legacy_status: signal.status,
  });
}

/**
 * Pure, deterministic preview. No clock, network, database, downloads, or writes.
 * This does not create evidence, infer people, compare stored versions, or permit publication.
 * Pass the six SeedCatalog arrays; LoadedSeedCatalog.taxonomy is validated separately by its loader.
 */
export function planLegacySignalImport(input: unknown): LegacySignalImportPlan {
  const catalog = canonicalCatalog(parseSeedCatalog(input));
  const legacyReferences = catalog.signals.map((signal): LegacySignalReference => ({
    signal_id: signal.id,
    version: 1,
    event_key: signal.event_key ?? null,
    source_id: signal.source_id,
    source_url: signal.source_url,
    topics: [...signal.topics],
    entities: [...signal.entities],
    // These statuses described old Seed display rules, not verified V3 publication.
    legacy_display:
      signal.status === 'accepted' || signal.status === 'reviewed'
        ? 'public_candidate'
        : 'internal',
    publication_status: 'unpublished',
    verification_status: 'pending_verification',
  }));
  const total = catalog.signals.length;
  const publicCandidates = legacyReferences.filter(
    (reference) => reference.legacy_display === 'public_candidate',
  ).length;
  const payload = {
    schema_version: SIGNAL_VERSION_SCHEMA_VERSION,
    mode: 'dry_run' as const,
    versions: catalog.signals.map(legacyVersion),
    legacy_references: legacyReferences,
    legacy_catalog: catalog,
    counts: {
      total,
      legacy_public_candidates: publicCandidates,
      internal: total - publicCandidates,
      unpublished: total,
      pending_verification: total,
    },
  };
  return { ...payload, plan_hash: sha256(JSON.stringify(payload)) };
}
