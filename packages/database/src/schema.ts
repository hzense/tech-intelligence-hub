import { sql } from 'drizzle-orm';
import { signalGenerationRuns } from './signal-generation-schema.js';
export {
  importBatches,
  importItems,
  importDocuments,
  importAttempts,
  importOutputs,
  importAudit,
  importDailyUsage,
} from './import-schema.js';
import {
  bigint,
  boolean,
  check,
  customType,
  date,
  doublePrecision,
  foreignKey,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  pgView,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  vector,
} from 'drizzle-orm/pg-core';

const tsvector = customType<{ data: string }>({
  dataType() {
    return 'tsvector';
  },
});

// Full transaction IDs are database metadata, not JavaScript numbers or part
// of the Signal 3.0.0 content hash. Keep their 64-bit value losslessly as text.
const xid8 = customType<{ data: string; driverData: string }>({
  dataType() {
    return 'xid8';
  },
});

export const aiConnections = pgTable(
  'ai_connections',
  {
    id: uuid('id').primaryKey(),
    revision: integer('revision').notNull().default(1),
    name: text('name').notNull(),
    protocol: text('protocol').notNull(),
    baseUrl: text('base_url').notNull(),
    enabled: boolean('enabled').notNull().default(false),
    settings: jsonb('settings').notNull(),
    encryptedKey: jsonb('encrypted_key'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('ai_connections_revision_ck', sql`${t.revision} >= 1`),
    check('ai_connections_protocol_ck', sql`${t.protocol} = 'openai-compatible'`),
    check('ai_connections_settings_ck', sql`jsonb_typeof(${t.settings}) = 'object'`),
    check(
      'ai_connections_encrypted_key_ck',
      sql`${t.encryptedKey} IS NULL OR jsonb_typeof(${t.encryptedKey}) = 'object'`,
    ),
  ],
);
export const aiConnectionVersions = pgTable(
  'ai_connection_versions',
  {
    connectionId: uuid('connection_id')
      .notNull()
      .references(() => aiConnections.id),
    revision: integer('revision').notNull(),
    snapshot: jsonb('snapshot').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.connectionId, t.revision] }),
    check('ai_connection_versions_revision_ck', sql`${t.revision} >= 1`),
    check('ai_connection_versions_snapshot_ck', sql`jsonb_typeof(${t.snapshot}) = 'object'`),
  ],
);
export const aiProfiles = pgTable(
  'ai_profiles',
  {
    id: uuid('id').primaryKey(),
    revision: integer('revision').notNull().default(1),
    name: text('name').notNull(),
    stages: jsonb('stages').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('ai_profiles_revision_ck', sql`${t.revision} >= 1`),
    check('ai_profiles_stages_ck', sql`jsonb_typeof(${t.stages}) = 'object'`),
  ],
);
export const aiProfileVersions = pgTable(
  'ai_profile_versions',
  {
    profileId: uuid('profile_id')
      .notNull()
      .references(() => aiProfiles.id),
    revision: integer('revision').notNull(),
    snapshot: jsonb('snapshot').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.profileId, t.revision] }),
    check('ai_profile_versions_revision_ck', sql`${t.revision} >= 1`),
    check('ai_profile_versions_snapshot_ck', sql`jsonb_typeof(${t.snapshot}) = 'object'`),
  ],
);
export const aiProbeRuns = pgTable(
  'ai_probe_runs',
  {
    id: uuid('id').primaryKey(),
    connectionId: uuid('connection_id').notNull(),
    connectionRevision: integer('connection_revision').notNull(),
    kind: text('kind').notNull(),
    modelId: text('model_id'),
    fingerprint: text('fingerprint').notNull(),
    status: text('status').notNull(),
    configuration: jsonb('configuration').notNull(),
    reservedMicrousd: bigint('reserved_microusd', { mode: 'bigint' })
      .notNull()
      .default(sql`0`),
    chargedMicrousd: bigint('charged_microusd', { mode: 'bigint' })
      .notNull()
      .default(sql`0`),
    inputTokens: integer('input_tokens'),
    outputTokens: integer('output_tokens'),
    result: jsonb('result').notNull().default({}),
    errorCode: text('error_code'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
  },
  (t) => [
    foreignKey({
      columns: [t.connectionId, t.connectionRevision],
      foreignColumns: [aiConnectionVersions.connectionId, aiConnectionVersions.revision],
    }),
    index('ai_probe_runs_connection_created_idx').on(t.connectionId, t.createdAt),
    check(
      'ai_probe_runs_kind_ck',
      sql`${t.kind} IN ('models', 'connection', 'structured_output', 'tool_calling')`,
    ),
    check('ai_probe_runs_fingerprint_ck', sql`${t.fingerprint} ~ '^[a-f0-9]{64}$'`),
    check(
      'ai_probe_runs_status_ck',
      sql`${t.status} IN ('pending', 'running', 'succeeded', 'failed', 'unknown', 'stale')`,
    ),
    check('ai_probe_runs_configuration_ck', sql`jsonb_typeof(${t.configuration}) = 'object'`),
    check('ai_probe_runs_reserved_microusd_ck', sql`${t.reservedMicrousd} >= 0`),
    check('ai_probe_runs_charged_microusd_ck', sql`${t.chargedMicrousd} >= 0`),
    check('ai_probe_runs_input_tokens_ck', sql`${t.inputTokens} IS NULL OR ${t.inputTokens} >= 0`),
    check(
      'ai_probe_runs_output_tokens_ck',
      sql`${t.outputTokens} IS NULL OR ${t.outputTokens} >= 0`,
    ),
    check('ai_probe_runs_result_ck', sql`jsonb_typeof(${t.result}) = 'object'`),
  ],
);

export const entityType = pgEnum('entity_type', [
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
]);
export const signalType = pgEnum('signal_type', [
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
]);
export const signalStatus = pgEnum('signal_status', [
  'inbox',
  'reviewed',
  'accepted',
  'rejected',
  'archived',
]);
export const sourceType = pgEnum('source_type', [
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
]);
export const topicStatus = pgEnum('topic_status', ['watching', 'active', 'strategic', 'archived']);
export const trend = pgEnum('trend', [
  'rapid_growth',
  'growth',
  'stable',
  'decline',
  'rapid_decline',
]);
export const maturity = pgEnum('maturity', ['research', 'early', 'emerging', 'growth', 'mature']);
export const strategicValue = pgEnum('strategic_value', ['low', 'medium', 'high', 'critical']);
export const radarDomain = pgEnum('radar_domain', [
  'artificial_intelligence',
  'infrastructure',
  'security',
  'robotics',
]);

export const topics = pgTable(
  'topics',
  {
    id: text('id').primaryKey(),
    title: text('title').notNull(),
    parentId: text('parent_id'),
    status: topicStatus('status').notNull().default('watching'),
    metadata: jsonb('metadata').notNull().default({}),
    runtimeEnabled: boolean('runtime_enabled').notNull().default(false),
  },
  (t) => [
    check(
      'topics_runtime_enabled_status_ck',
      sql`NOT ${t.runtimeEnabled} OR ${t.status} <> 'archived'`,
    ),
  ],
);
export const entities = pgTable(
  'entities',
  {
    id: text('id').primaryKey(),
    type: entityType('type').notNull(),
    name: text('name').notNull(),
    status: text('status').notNull().default('active'),
    aliases: text('aliases')
      .array()
      .notNull()
      .default(sql`ARRAY[]::text[]`),
    metadata: jsonb('metadata').notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('entities_type_idx').on(t.type),
    index('entities_name_idx').on(t.name),
    uniqueIndex('entities_id_type_uq').on(t.id, t.type),
  ],
);
export const sources = pgTable(
  'sources',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    type: sourceType('type').notNull(),
    url: text('url'),
    trustScore: integer('trust_score').notNull(),
    active: boolean('active').notNull().default(true),
    allowedHosts: text('allowed_hosts').array().notNull(),
  },
  (t) => [
    check('sources_trust_score_ck', sql`${t.trustScore} between 0 and 100`),
    check('sources_allowed_hosts_ck', sql`cardinality(${t.allowedHosts}) > 0`),
  ],
);
export const signals = pgTable(
  'signals',
  {
    id: text('id').primaryKey(),
    title: text('title').notNull(),
    type: signalType('type').notNull(),
    status: signalStatus('status').notNull().default('inbox'),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
    capturedAt: timestamp('captured_at', { withTimezone: true }).notNull().defaultNow(),
    sourceId: text('source_id')
      .notNull()
      .references(() => sources.id),
    sourceUrl: text('source_url').notNull(),
    summary: text('summary').notNull(),
    importance: integer('importance').notNull(),
    strength: integer('strength').notNull(),
    confidence: doublePrecision('confidence').notNull(),
    novelty: doublePrecision('novelty').notNull(),
    metadata: jsonb('metadata').notNull().default({}),
  },
  (t) => [
    index('signals_occurred_idx').on(t.occurredAt),
    index('signals_status_idx').on(t.status),
    check('signals_source_url_https_ck', sql`${t.sourceUrl} ~ '^https://'`),
    check('signals_importance_ck', sql`${t.importance} between 1 and 5`),
    check('signals_strength_ck', sql`${t.strength} between 1 and 5`),
    check('signals_confidence_ck', sql`${t.confidence} between 0 and 1`),
    check('signals_novelty_ck', sql`${t.novelty} between 0 and 1`),
  ],
);

// Private 3.0.0 storage foundation. Migration 0007 seals snapshots after their
// creation transaction; publication eligibility still requires later services.
export const personProfiles = pgTable(
  'person_profiles',
  {
    entityId: text('entity_id').primaryKey(),
    entityType: entityType('entity_type').$type<'person'>().notNull().default('person'),
  },
  (t) => [
    check('person_profiles_entity_type_ck', sql`${t.entityType} = 'person'`),
    foreignKey({
      name: 'person_profiles_entity_fk',
      columns: [t.entityId, t.entityType],
      foreignColumns: [entities.id, entities.type],
    })
      .onUpdate('no action')
      .onDelete('no action'),
  ],
);
export const organizationProfiles = pgTable(
  'organization_profiles',
  {
    entityId: text('entity_id').primaryKey(),
    entityType: entityType('entity_type').$type<'company' | 'institution'>().notNull(),
  },
  (t) => [
    check(
      'organization_profiles_entity_type_ck',
      sql`${t.entityType} IN ('company', 'institution')`,
    ),
    foreignKey({
      name: 'organization_profiles_entity_fk',
      columns: [t.entityId, t.entityType],
      foreignColumns: [entities.id, entities.type],
    })
      .onUpdate('no action')
      .onDelete('no action'),
  ],
);
export const publicSourceEvidence = pgTable(
  'public_source_evidence',
  {
    id: text('id').primaryKey(),
    sourceId: text('source_id').notNull(),
    sourceUrl: text('source_url').notNull(),
    locator: text('locator').notNull(),
    excerpt: text('excerpt').notNull(),
    contentHash: text('content_hash').notNull(),
    capturedAt: timestamp('captured_at', { withTimezone: true }).notNull(),
    sourcePublishedAt: timestamp('source_published_at', { withTimezone: true }),
    verificationStatus: text('verification_status')
      .$type<'pending' | 'verified' | 'rejected'>()
      .notNull()
      .default('pending'),
    createdXid: xid8('created_xid')
      .notNull()
      .default(sql`pg_catalog.pg_current_xact_id()`),
  },
  (t) => [
    foreignKey({
      name: 'public_source_evidence_source_fk',
      columns: [t.sourceId],
      foreignColumns: [sources.id],
    })
      .onUpdate('no action')
      .onDelete('no action'),
    index('public_source_evidence_source_idx').on(t.sourceId),
    check('public_source_evidence_id_ck', sql`${t.id} ~ '[^[:space:]]'`),
    check('public_source_evidence_source_url_ck', sql`${t.sourceUrl} ~ '^https://[^[:space:]]+$'`),
    check('public_source_evidence_locator_ck', sql`${t.locator} ~ '[^[:space:]]'`),
    check('public_source_evidence_excerpt_ck', sql`${t.excerpt} ~ '[^[:space:]]'`),
    check('public_source_evidence_content_hash_ck', sql`${t.contentHash} ~ '^[a-f0-9]{64}$'`),
    check('public_source_evidence_captured_at_ck', sql`isfinite(${t.capturedAt})`),
    check(
      'public_source_evidence_source_published_at_ck',
      sql`${t.sourcePublishedAt} IS NULL OR isfinite(${t.sourcePublishedAt})`,
    ),
    check(
      'public_source_evidence_verification_status_ck',
      sql`${t.verificationStatus} IN ('pending', 'verified', 'rejected')`,
    ),
  ],
);
export const signalVersions = pgTable(
  'signal_versions',
  {
    signalId: text('signal_id').notNull(),
    version: integer('version').notNull(),
    schemaVersion: text('schema_version').$type<'3.0.0'>().notNull().default('3.0.0'),
    title: text('title').notNull(),
    type: signalType('type').notNull(),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
    datePrecision: text('date_precision').$type<'day' | 'instant'>().notNull(),
    dateBasis: text('date_basis').notNull(),
    capturedAt: timestamp('captured_at', { withTimezone: true }).notNull(),
    summary: text('summary').notNull(),
    analysis: text('analysis'),
    importance: integer('importance').notNull(),
    strength: integer('strength').notNull(),
    confidence: doublePrecision('confidence').notNull(),
    novelty: doublePrecision('novelty').notNull(),
    revisionReason: text('revision_reason').notNull(),
    origin: text('origin').$type<'legacy_seed' | 'pipeline' | 'manual'>().notNull(),
    legacyStatus: signalStatus('legacy_status'),
    contentHash: text('content_hash').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    createdXid: xid8('created_xid')
      .notNull()
      .default(sql`pg_catalog.pg_current_xact_id()`),
  },
  (t) => [
    primaryKey({ name: 'signal_versions_pkey', columns: [t.signalId, t.version] }),
    foreignKey({
      name: 'signal_versions_signal_fk',
      columns: [t.signalId],
      foreignColumns: [signals.id],
    })
      .onUpdate('no action')
      .onDelete('no action'),
    index('signal_versions_occurred_idx').on(t.occurredAt),
    check('signal_versions_version_ck', sql`${t.version} > 0`),
    check('signal_versions_schema_version_ck', sql`${t.schemaVersion} = '3.0.0'`),
    check('signal_versions_title_ck', sql`${t.title} ~ '[^[:space:]]'`),
    check('signal_versions_occurred_at_ck', sql`isfinite(${t.occurredAt})`),
    check('signal_versions_date_precision_ck', sql`${t.datePrecision} IN ('day', 'instant')`),
    check(
      'signal_versions_day_precision_ck',
      sql`${t.datePrecision} <> 'day' OR date_trunc('day', ${t.occurredAt} AT TIME ZONE 'UTC') = ${t.occurredAt} AT TIME ZONE 'UTC'`,
    ),
    check('signal_versions_date_basis_ck', sql`${t.dateBasis} ~ '[^[:space:]]'`),
    check('signal_versions_captured_at_ck', sql`isfinite(${t.capturedAt})`),
    check('signal_versions_summary_ck', sql`${t.summary} ~ '[^[:space:]]'`),
    check(
      'signal_versions_analysis_ck',
      sql`${t.analysis} IS NULL OR ${t.analysis} ~ '[^[:space:]]'`,
    ),
    check('signal_versions_importance_ck', sql`${t.importance} BETWEEN 1 AND 5`),
    check('signal_versions_strength_ck', sql`${t.strength} BETWEEN 1 AND 5`),
    check('signal_versions_confidence_ck', sql`${t.confidence} BETWEEN 0 AND 1`),
    check('signal_versions_novelty_ck', sql`${t.novelty} BETWEEN 0 AND 1`),
    check('signal_versions_revision_reason_ck', sql`${t.revisionReason} ~ '[^[:space:]]'`),
    check('signal_versions_origin_ck', sql`${t.origin} IN ('legacy_seed', 'pipeline', 'manual')`),
    check(
      'signal_versions_legacy_status_ck',
      sql`(${t.origin} = 'legacy_seed') = (${t.legacyStatus} IS NOT NULL)`,
    ),
    check('signal_versions_content_hash_ck', sql`${t.contentHash} ~ '^[a-f0-9]{64}$'`),
    check('signal_versions_created_at_ck', sql`isfinite(${t.createdAt})`),
  ],
);
export const signalVersionEvidence = pgTable(
  'signal_version_evidence',
  {
    signalId: text('signal_id').notNull(),
    version: integer('version').notNull(),
    evidenceId: text('evidence_id').notNull(),
    claim: text('claim').notNull(),
    relation: text('relation').$type<'supports' | 'contradicts' | 'context'>().notNull(),
  },
  (t) => [
    primaryKey({
      name: 'signal_version_evidence_pkey',
      columns: [t.signalId, t.version, t.evidenceId],
    }),
    foreignKey({
      name: 'signal_version_evidence_version_fk',
      columns: [t.signalId, t.version],
      foreignColumns: [signalVersions.signalId, signalVersions.version],
    })
      .onUpdate('no action')
      .onDelete('no action'),
    foreignKey({
      name: 'signal_version_evidence_evidence_fk',
      columns: [t.evidenceId],
      foreignColumns: [publicSourceEvidence.id],
    })
      .onUpdate('no action')
      .onDelete('no action'),
    index('signal_version_evidence_evidence_idx').on(t.evidenceId),
    check('signal_version_evidence_claim_ck', sql`${t.claim} ~ '[^[:space:]]'`),
    check(
      'signal_version_evidence_relation_ck',
      sql`${t.relation} IN ('supports', 'contradicts', 'context')`,
    ),
  ],
);
// Reserves one canonical key per stable Signal; this does not publish it.
export const signalEventIdentities = pgTable(
  'signal_event_identities',
  {
    signalId: text('signal_id').primaryKey(),
    eventKey: text('event_key').notNull(),
    basisVersion: integer('basis_version').notNull(),
    basisEvidenceId: text('basis_evidence_id').notNull(),
    identityBasis: text('identity_basis').notNull(),
    createdXid: xid8('created_xid')
      .notNull()
      .default(sql`pg_catalog.pg_current_xact_id()`),
  },
  (t) => [
    foreignKey({
      name: 'signal_event_identities_evidence_fk',
      columns: [t.signalId, t.basisVersion, t.basisEvidenceId],
      foreignColumns: [
        signalVersionEvidence.signalId,
        signalVersionEvidence.version,
        signalVersionEvidence.evidenceId,
      ],
    })
      .onUpdate('no action')
      .onDelete('no action'),
    check('signal_event_identities_signal_id_ck', sql`${t.signalId} ~ '[^[:space:]]'`),
    check(
      'signal_event_identities_event_key_ck',
      sql`${t.eventKey} COLLATE "C" ~ '^[a-z0-9]+(-[a-z0-9]+)*$'`,
    ),
    check(
      'signal_event_identities_event_key_length_ck',
      sql`length(${t.eventKey}) BETWEEN 1 AND 200`,
    ),
    check('signal_event_identities_basis_version_ck', sql`${t.basisVersion} > 0`),
    check(
      'signal_event_identities_basis_evidence_id_ck',
      sql`${t.basisEvidenceId} ~ '[^[:space:]]'`,
    ),
    check('signal_event_identities_identity_basis_ck', sql`${t.identityBasis} ~ '[^[:space:]]'`),
    uniqueIndex('signal_event_identities_event_key_uq').on(t.eventKey),
  ],
);

// Private transition ledger. Eligibility and authorization are not provided by
// this table. Receipts are permanent; consumer delivery state belongs elsewhere.
export const signalPublicationOutbox = pgTable(
  'signal_publication_outbox',
  {
    eventId: uuid('event_id').primaryKey(),
    requestKey: text('request_key').notNull(),
    requestFingerprint: text('request_fingerprint').notNull(),
    signalId: text('signal_id').notNull(),
    expectedRevision: integer('expected_revision').notNull(),
    publicationRevision: integer('publication_revision').notNull(),
    contentVersion: integer('content_version').notNull(),
    status: text('status').$type<'published' | 'withdrawn'>().notNull(),
    reasonCode: text('reason_code')
      .$type<
        | 'initial_publication'
        | 'content_correction'
        | 'republication'
        | 'factual_error'
        | 'privacy'
        | 'evidence_revoked'
        | 'operator_request'
      >()
      .notNull(),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
  },
  (t) => [
    foreignKey({
      name: 'signal_publication_outbox_version_fk',
      columns: [t.signalId, t.contentVersion],
      foreignColumns: [signalVersions.signalId, signalVersions.version],
    })
      .onUpdate('no action')
      .onDelete('no action'),
    foreignKey({
      name: 'signal_publication_outbox_identity_fk',
      columns: [t.signalId],
      foreignColumns: [signalEventIdentities.signalId],
    })
      .onUpdate('no action')
      .onDelete('no action'),
    check(
      'signal_publication_outbox_request_key_ck',
      sql`${t.requestKey} COLLATE "C" ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$'`,
    ),
    check(
      'signal_publication_outbox_request_key_length_ck',
      sql`length(${t.requestKey}) BETWEEN 1 AND 200`,
    ),
    check(
      'signal_publication_outbox_request_fingerprint_ck',
      sql`${t.requestFingerprint} COLLATE "C" ~ '^[a-f0-9]{64}$'`,
    ),
    check('signal_publication_outbox_signal_id_ck', sql`${t.signalId} ~ '[^[:space:]]'`),
    check('signal_publication_outbox_expected_revision_ck', sql`${t.expectedRevision} >= 0`),
    check('signal_publication_outbox_publication_revision_ck', sql`${t.publicationRevision} > 0`),
    check(
      'signal_publication_outbox_revision_step_ck',
      sql`${t.publicationRevision}::bigint = ${t.expectedRevision}::bigint + 1`,
    ),
    check('signal_publication_outbox_content_version_ck', sql`${t.contentVersion} > 0`),
    check('signal_publication_outbox_status_ck', sql`${t.status} IN ('published', 'withdrawn')`),
    check(
      'signal_publication_outbox_reason_code_ck',
      sql`(${t.status} || ':' || ${t.reasonCode}) IN ('published:initial_publication', 'published:content_correction', 'published:republication', 'withdrawn:factual_error', 'withdrawn:privacy', 'withdrawn:evidence_revoked', 'withdrawn:operator_request')`,
    ),
    check('signal_publication_outbox_occurred_at_ck', sql`isfinite(${t.occurredAt})`),
    check(
      'signal_publication_outbox_occurred_at_year_ck',
      sql`extract(year FROM ${t.occurredAt} AT TIME ZONE 'UTC') BETWEEN 1 AND 9999`,
    ),
    check(
      'signal_publication_outbox_occurred_at_precision_ck',
      sql`date_trunc('milliseconds', ${t.occurredAt}) = ${t.occurredAt}`,
    ),
    uniqueIndex('signal_publication_outbox_request_key_uq').on(t.requestKey),
    uniqueIndex('signal_publication_outbox_revision_uq').on(t.signalId, t.publicationRevision),
    uniqueIndex('signal_publication_outbox_qualified_receipt_uq').on(
      t.requestKey,
      t.signalId,
      t.contentVersion,
    ),
    uniqueIndex('signal_publication_outbox_state_uq').on(
      t.signalId,
      t.publicationRevision,
      t.contentVersion,
      t.status,
      t.eventId,
      t.occurredAt,
    ),
  ],
);

export const signalPublicationState = pgTable(
  'signal_publication_state',
  {
    signalId: text('signal_id').primaryKey(),
    publicationRevision: integer('publication_revision').notNull(),
    contentVersion: integer('content_version').notNull(),
    status: text('status').$type<'published' | 'withdrawn'>().notNull(),
    eventId: uuid('event_id').notNull(),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
  },
  (t) => [
    foreignKey({
      name: 'signal_publication_state_outbox_fk',
      columns: [
        t.signalId,
        t.publicationRevision,
        t.contentVersion,
        t.status,
        t.eventId,
        t.occurredAt,
      ],
      foreignColumns: [
        signalPublicationOutbox.signalId,
        signalPublicationOutbox.publicationRevision,
        signalPublicationOutbox.contentVersion,
        signalPublicationOutbox.status,
        signalPublicationOutbox.eventId,
        signalPublicationOutbox.occurredAt,
      ],
    })
      .onUpdate('no action')
      .onDelete('no action'),
    check('signal_publication_state_signal_id_ck', sql`${t.signalId} ~ '[^[:space:]]'`),
    check('signal_publication_state_publication_revision_ck', sql`${t.publicationRevision} > 0`),
    check('signal_publication_state_content_version_ck', sql`${t.contentVersion} > 0`),
    check('signal_publication_state_status_ck', sql`${t.status} IN ('published', 'withdrawn')`),
    check('signal_publication_state_occurred_at_ck', sql`isfinite(${t.occurredAt})`),
    check(
      'signal_publication_state_occurred_at_year_ck',
      sql`extract(year FROM ${t.occurredAt} AT TIME ZONE 'UTC') BETWEEN 1 AND 9999`,
    ),
    check(
      'signal_publication_state_occurred_at_precision_ck',
      sql`date_trunc('milliseconds', ${t.occurredAt}) = ${t.occurredAt}`,
    ),
  ],
);

// Private coordination fixtures. Creating these rows does not itself authorize
// publication; control evaluation belongs to the locked execution transaction.
export const signalPublicationControl = pgTable(
  'signal_publication_control',
  {
    singleton: boolean('singleton').primaryKey(),
    publicationEnabled: boolean('publication_enabled').notNull().default(false),
  },
  (t) => [check('signal_publication_control_singleton_ck', sql`${t.singleton}`)],
);

export const signalPublicationTasks = pgTable(
  'signal_publication_tasks',
  {
    taskId: uuid('task_id').primaryKey(),
    policy: text('policy')
      .$type<'auto_publish' | 'review_required' | 'preview_only'>()
      .notNull()
      .default('preview_only'),
    publicationEnabled: boolean('publication_enabled').notNull().default(false),
  },
  (t) => [
    check(
      'signal_publication_tasks_policy_ck',
      sql`${t.policy} IN ('auto_publish', 'review_required', 'preview_only')`,
    ),
  ],
);

export const signalPublicationAuthorizations = pgTable(
  'signal_publication_authorizations',
  {
    taskId: uuid('task_id').notNull(),
    principalId: uuid('principal_id').notNull(),
    canPublish: boolean('can_publish').notNull().default(false),
  },
  (t) => [
    primaryKey({ columns: [t.taskId, t.principalId] }),
    foreignKey({
      name: 'signal_publication_authorizations_task_fk',
      columns: [t.taskId],
      foreignColumns: [signalPublicationTasks.taskId],
    })
      .onUpdate('no action')
      .onDelete('no action'),
  ],
);

export const signalPublicationRuns = pgTable(
  'signal_publication_runs',
  {
    runId: uuid('run_id').primaryKey(),
    taskId: uuid('task_id').notNull(),
    principalId: uuid('principal_id').notNull(),
    originalIntent: text('original_intent')
      .$type<'auto_publish' | 'review_required' | 'preview_only'>()
      .notNull(),
    status: text('status')
      .$type<'pending' | 'running' | 'cancelled' | 'completed'>()
      .notNull()
      .default('pending'),
    fencingToken: integer('fencing_token').notNull().default(0),
    leaseOwner: uuid('lease_owner'),
    leaseExpiresAt: timestamp('lease_expires_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .default(sql`date_trunc('milliseconds', clock_timestamp())`),
  },
  (t) => [
    foreignKey({
      name: 'signal_publication_runs_authorization_fk',
      columns: [t.taskId, t.principalId],
      foreignColumns: [
        signalPublicationAuthorizations.taskId,
        signalPublicationAuthorizations.principalId,
      ],
    })
      .onUpdate('no action')
      .onDelete('no action'),
    check(
      'signal_publication_runs_intent_ck',
      sql`${t.originalIntent} IN ('auto_publish', 'review_required', 'preview_only')`,
    ),
    check(
      'signal_publication_runs_status_ck',
      sql`${t.status} IN ('pending', 'running', 'cancelled', 'completed')`,
    ),
    check('signal_publication_runs_token_ck', sql`${t.fencingToken} >= 0`),
    check(
      'signal_publication_runs_state_ck',
      sql`(${t.status} = 'pending' AND ${t.fencingToken} = 0 AND ${t.leaseOwner} IS NULL AND ${t.leaseExpiresAt} IS NULL) OR (${t.status} = 'running' AND ${t.fencingToken} > 0 AND ${t.leaseOwner} IS NOT NULL AND ${t.leaseExpiresAt} IS NOT NULL) OR (${t.status} = 'cancelled' AND ${t.leaseOwner} IS NULL AND ${t.leaseExpiresAt} IS NULL) OR (${t.status} = 'completed' AND ${t.fencingToken} > 0 AND ${t.leaseOwner} IS NULL AND ${t.leaseExpiresAt} IS NULL)`,
    ),
    check('signal_publication_runs_created_at_ck', sql`isfinite(${t.createdAt})`),
    check(
      'signal_publication_runs_created_at_year_ck',
      sql`extract(year FROM ${t.createdAt} AT TIME ZONE 'UTC') BETWEEN 1 AND 9999`,
    ),
    check(
      'signal_publication_runs_created_at_precision_ck',
      sql`date_trunc('milliseconds', ${t.createdAt}) = ${t.createdAt}`,
    ),
    check(
      'signal_publication_runs_lease_expires_at_ck',
      sql`${t.leaseExpiresAt} IS NULL OR isfinite(${t.leaseExpiresAt})`,
    ),
    check(
      'signal_publication_runs_lease_expires_at_year_ck',
      sql`${t.leaseExpiresAt} IS NULL OR extract(year FROM ${t.leaseExpiresAt} AT TIME ZONE 'UTC') BETWEEN 1 AND 9999`,
    ),
    check(
      'signal_publication_runs_lease_expires_at_precision_ck',
      sql`${t.leaseExpiresAt} IS NULL OR date_trunc('milliseconds', ${t.leaseExpiresAt}) = ${t.leaseExpiresAt}`,
    ),
    index('signal_publication_runs_task_lease_idx').on(t.taskId, t.status, t.leaseExpiresAt),
  ],
);

// Private append-only binding. The migration additionally installs exact
// transaction-seal and deferred control guards; this is not a public API.
export const signalQualifiedPublicationReceipts = pgTable(
  'signal_qualified_publication_receipts',
  {
    requestKey: text('request_key').primaryKey(),
    requestFingerprint: text('request_fingerprint').notNull(),
    signalId: text('signal_id').notNull(),
    sourceVersion: integer('source_version').notNull(),
    targetVersion: integer('target_version').notNull(),
    runId: uuid('run_id').notNull(),
    leaseOwner: uuid('lease_owner').notNull(),
    fencingToken: integer('fencing_token').notNull(),
  },
  (t) => [
    foreignKey({
      name: 'signal_qualified_publication_receipts_outbox_fk',
      columns: [t.requestKey, t.signalId, t.targetVersion],
      foreignColumns: [
        signalPublicationOutbox.requestKey,
        signalPublicationOutbox.signalId,
        signalPublicationOutbox.contentVersion,
      ],
    })
      .onUpdate('no action')
      .onDelete('no action'),
    foreignKey({
      name: 'signal_qualified_publication_receipts_source_fk',
      columns: [t.signalId, t.sourceVersion],
      foreignColumns: [signalVersions.signalId, signalVersions.version],
    })
      .onUpdate('no action')
      .onDelete('no action'),
    foreignKey({
      name: 'signal_qualified_publication_receipts_run_fk',
      columns: [t.runId],
      foreignColumns: [signalPublicationRuns.runId],
    })
      .onUpdate('no action')
      .onDelete('no action'),
    check(
      'signal_qualified_publication_receipts_request_key_ck',
      sql`${t.requestKey} COLLATE "C" ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$'`,
    ),
    check(
      'signal_qualified_publication_receipts_request_key_length_ck',
      sql`length(${t.requestKey}) BETWEEN 1 AND 200`,
    ),
    check(
      'signal_qualified_publication_receipts_fingerprint_ck',
      sql`${t.requestFingerprint} COLLATE "C" ~ '^[a-f0-9]{64}$'`,
    ),
    check(
      'signal_qualified_publication_receipts_signal_id_ck',
      sql`${t.signalId} ~ '[^[:space:]]'`,
    ),
    check('signal_qualified_publication_receipts_source_version_ck', sql`${t.sourceVersion} > 0`),
    check(
      'signal_qualified_publication_receipts_target_version_ck',
      sql`${t.targetVersion} > ${t.sourceVersion}`,
    ),
    check('signal_qualified_publication_receipts_token_ck', sql`${t.fencingToken} > 0`),
  ],
);

// Private append-only verification reports; created_xid is not part of a report
// fingerprint. SQL guards enforce database statement time and transaction sealing.
export const signalCandidateVerifications = pgTable(
  'signal_candidate_verifications',
  {
    verificationId: uuid('verification_id').primaryKey(),
    signalId: text('signal_id').notNull(),
    sourceVersion: integer('source_version').notNull(),
    sourceContentHash: text('source_content_hash').notNull(),
    bundleFingerprint: text('bundle_fingerprint').notNull(),
    verifierId: uuid('verifier_id').notNull(),
    policyVersion: text('policy_version').notNull(),
    reportHash: text('report_hash').notNull(),
    decision: text('decision').notNull(),
    checks: jsonb('checks').notNull(),
    verifiedAt: timestamp('verified_at', { withTimezone: true })
      .notNull()
      .default(sql`date_trunc('milliseconds', statement_timestamp())`),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdXid: xid8('created_xid')
      .notNull()
      .default(sql`pg_catalog.pg_current_xact_id()`),
  },
  (t) => [
    foreignKey({
      name: 'signal_candidate_verifications_source_fk',
      columns: [t.signalId, t.sourceVersion],
      foreignColumns: [signalVersions.signalId, signalVersions.version],
    })
      .onUpdate('no action')
      .onDelete('no action'),
    check('signal_candidate_verifications_signal_id_ck', sql`${t.signalId} ~ '[^[:space:]]'`),
    check('signal_candidate_verifications_version_ck', sql`${t.sourceVersion} > 0`),
    check(
      'signal_candidate_verifications_source_hash_ck',
      sql`${t.sourceContentHash} COLLATE "C" ~ '^[a-f0-9]{64}$'`,
    ),
    check(
      'signal_candidate_verifications_bundle_hash_ck',
      sql`${t.bundleFingerprint} COLLATE "C" ~ '^[a-f0-9]{64}$'`,
    ),
    check(
      'signal_candidate_verifications_policy_ck',
      sql`${t.policyVersion} = 'candidate-verification-v1'`,
    ),
    check(
      'signal_candidate_verifications_report_hash_ck',
      sql`${t.reportHash} COLLATE "C" ~ '^[a-f0-9]{64}$'`,
    ),
    check(
      'signal_candidate_verifications_decision_ck',
      sql`${t.decision} IN ('approved', 'rejected')`,
    ),
    check('signal_candidate_verifications_checks_ck', sql`jsonb_typeof(${t.checks}) = 'object'`),
    check('signal_candidate_verifications_verified_at_ck', sql`isfinite(${t.verifiedAt})`),
    check(
      'signal_candidate_verifications_verified_at_year_ck',
      sql`extract(year FROM ${t.verifiedAt} AT TIME ZONE 'UTC') BETWEEN 1 AND 9999`,
    ),
    check(
      'signal_candidate_verifications_verified_at_precision_ck',
      sql`date_trunc('milliseconds', ${t.verifiedAt}) = ${t.verifiedAt}`,
    ),
    check('signal_candidate_verifications_expires_at_ck', sql`isfinite(${t.expiresAt})`),
    check(
      'signal_candidate_verifications_expires_at_year_ck',
      sql`extract(year FROM ${t.expiresAt} AT TIME ZONE 'UTC') BETWEEN 1 AND 9999`,
    ),
    check(
      'signal_candidate_verifications_expires_at_precision_ck',
      sql`date_trunc('milliseconds', ${t.expiresAt}) = ${t.expiresAt}`,
    ),
    check('signal_candidate_verifications_expiry_order_ck', sql`${t.expiresAt} > ${t.verifiedAt}`),
    check(
      'signal_candidate_verifications_expiry_window_ck',
      sql`${t.expiresAt} <= ${t.verifiedAt} + interval '24 hours'`,
    ),
    uniqueIndex('signal_candidate_verifications_identity_uq').on(
      t.verificationId,
      t.signalId,
      t.sourceVersion,
    ),
  ],
);

export const signalCandidateAssemblyReceipts = pgTable(
  'signal_candidate_assembly_receipts',
  {
    requestKey: text('request_key').primaryKey(),
    requestFingerprint: text('request_fingerprint').notNull(),
    verificationId: uuid('verification_id').notNull(),
    signalId: text('signal_id').notNull(),
    sourceVersion: integer('source_version').notNull(),
    targetVersion: integer('target_version').notNull(),
    contentHash: text('content_hash').notNull(),
  },
  (t) => [
    foreignKey({
      name: 'signal_candidate_assembly_receipts_verification_fk',
      columns: [t.verificationId, t.signalId, t.sourceVersion],
      foreignColumns: [
        signalCandidateVerifications.verificationId,
        signalCandidateVerifications.signalId,
        signalCandidateVerifications.sourceVersion,
      ],
    })
      .onUpdate('no action')
      .onDelete('no action'),
    foreignKey({
      name: 'signal_candidate_assembly_receipts_target_fk',
      columns: [t.signalId, t.targetVersion],
      foreignColumns: [signalVersions.signalId, signalVersions.version],
    })
      .onUpdate('no action')
      .onDelete('no action'),
    check(
      'signal_candidate_assembly_receipts_request_key_ck',
      sql`${t.requestKey} COLLATE "C" ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$'`,
    ),
    check(
      'signal_candidate_assembly_receipts_key_length_ck',
      sql`length(${t.requestKey}) BETWEEN 1 AND 200`,
    ),
    check(
      'signal_candidate_assembly_receipts_fingerprint_ck',
      sql`${t.requestFingerprint} COLLATE "C" ~ '^[a-f0-9]{64}$'`,
    ),
    check('signal_candidate_assembly_receipts_signal_id_ck', sql`${t.signalId} ~ '[^[:space:]]'`),
    check('signal_candidate_assembly_receipts_source_version_ck', sql`${t.sourceVersion} > 0`),
    check(
      'signal_candidate_assembly_receipts_target_version_ck',
      sql`${t.targetVersion} > ${t.sourceVersion}`,
    ),
    check(
      'signal_candidate_assembly_receipts_content_hash_ck',
      sql`${t.contentHash} COLLATE "C" ~ '^[a-f0-9]{64}$'`,
    ),
    uniqueIndex('signal_candidate_assembly_receipts_verification_uq').on(t.verificationId),
  ],
);

export const signalVerificationDependencySeals = pgTable(
  'signal_verification_dependency_seals',
  {
    verificationId: uuid('verification_id')
      .primaryKey()
      .references(() => signalCandidateVerifications.verificationId, {
        onUpdate: 'no action',
        onDelete: 'no action',
      }),
    dependencySeal: jsonb('dependency_seal').notNull(),
    invalidated: boolean('invalidated').notNull().default(false),
  },
  (t) => [
    check(
      'signal_verification_dependency_seals_object_ck',
      sql`jsonb_typeof(${t.dependencySeal}) = 'object'`,
    ),
  ],
);

export const signalPublicationPermits = pgTable(
  'signal_publication_permits',
  {
    eventId: uuid('event_id')
      .primaryKey()
      .references(() => signalPublicationOutbox.eventId, {
        onUpdate: 'no action',
        onDelete: 'no action',
      }),
    verificationId: uuid('verification_id')
      .notNull()
      .references(() => signalCandidateVerifications.verificationId, {
        onUpdate: 'no action',
        onDelete: 'no action',
      }),
    dependencySeal: jsonb('dependency_seal').notNull(),
  },
  (t) => [
    check(
      'signal_publication_permits_object_ck',
      sql`jsonb_typeof(${t.dependencySeal}) = 'object'`,
    ),
  ],
);

// SQL migration owns the security-barrier definition; this maps only public DTOs.
export const currentPublicSignals = pgView('current_public_signals', {
  signalId: text('signal_id'),
  version: integer('version'),
  publicationRevision: integer('publication_revision'),
  title: text('title'),
  type: signalType('type'),
  occurredAt: timestamp('occurred_at', { withTimezone: true }),
  capturedAt: timestamp('captured_at', { withTimezone: true }),
  summary: text('summary'),
  analysis: text('analysis'),
  importance: integer('importance'),
  strength: integer('strength'),
  confidence: doublePrecision('confidence'),
  novelty: doublePrecision('novelty'),
  topics: jsonb('topics'),
  people: jsonb('people'),
  organizations: jsonb('organizations'),
  sources: jsonb('sources'),
}).existing();

export const signalVersionPeople = pgTable(
  'signal_version_people',
  {
    signalId: text('signal_id').notNull(),
    version: integer('version').notNull(),
    personId: text('person_id').notNull(),
    evidenceId: text('evidence_id').notNull(),
    eventRole: text('event_role').notNull(),
    verificationStatus: text('verification_status')
      .$type<'pending' | 'verified' | 'rejected'>()
      .notNull()
      .default('pending'),
  },
  (t) => [
    primaryKey({
      name: 'signal_version_people_pkey',
      columns: [t.signalId, t.version, t.personId, t.evidenceId],
    }),
    foreignKey({
      name: 'signal_version_people_person_fk',
      columns: [t.personId],
      foreignColumns: [personProfiles.entityId],
    })
      .onUpdate('no action')
      .onDelete('no action'),
    foreignKey({
      name: 'signal_version_people_evidence_fk',
      columns: [t.signalId, t.version, t.evidenceId],
      foreignColumns: [
        signalVersionEvidence.signalId,
        signalVersionEvidence.version,
        signalVersionEvidence.evidenceId,
      ],
    })
      .onUpdate('no action')
      .onDelete('no action'),
    index('signal_version_people_person_idx').on(t.personId),
    check('signal_version_people_event_role_ck', sql`${t.eventRole} ~ '[^[:space:]]'`),
    check(
      'signal_version_people_verification_status_ck',
      sql`${t.verificationStatus} IN ('pending', 'verified', 'rejected')`,
    ),
  ],
);
export const signalVersionOrganizations = pgTable(
  'signal_version_organizations',
  {
    signalId: text('signal_id').notNull(),
    version: integer('version').notNull(),
    organizationId: text('organization_id').notNull(),
    evidenceId: text('evidence_id').notNull(),
    eventRole: text('event_role').$type<'subject' | 'participant' | 'background'>().notNull(),
    verificationStatus: text('verification_status')
      .$type<'pending' | 'verified' | 'rejected'>()
      .notNull()
      .default('pending'),
  },
  (t) => [
    primaryKey({
      name: 'signal_version_organizations_pkey',
      columns: [t.signalId, t.version, t.organizationId, t.evidenceId],
    }),
    foreignKey({
      name: 'signal_version_organizations_organization_fk',
      columns: [t.organizationId],
      foreignColumns: [organizationProfiles.entityId],
    })
      .onUpdate('no action')
      .onDelete('no action'),
    foreignKey({
      name: 'signal_version_organizations_evidence_fk',
      columns: [t.signalId, t.version, t.evidenceId],
      foreignColumns: [
        signalVersionEvidence.signalId,
        signalVersionEvidence.version,
        signalVersionEvidence.evidenceId,
      ],
    })
      .onUpdate('no action')
      .onDelete('no action'),
    index('signal_version_organizations_organization_idx').on(t.organizationId),
    check(
      'signal_version_organizations_event_role_ck',
      sql`${t.eventRole} IN ('subject', 'participant', 'background')`,
    ),
    check(
      'signal_version_organizations_verification_status_ck',
      sql`${t.verificationStatus} IN ('pending', 'verified', 'rejected')`,
    ),
  ],
);
export const signalVersionTopics = pgTable(
  'signal_version_topics',
  {
    signalId: text('signal_id').notNull(),
    version: integer('version').notNull(),
    topicId: text('topic_id').notNull(),
  },
  (t) => [
    primaryKey({
      name: 'signal_version_topics_pkey',
      columns: [t.signalId, t.version, t.topicId],
    }),
    foreignKey({
      name: 'signal_version_topics_version_fk',
      columns: [t.signalId, t.version],
      foreignColumns: [signalVersions.signalId, signalVersions.version],
    })
      .onUpdate('no action')
      .onDelete('no action'),
    foreignKey({
      name: 'signal_version_topics_topic_fk',
      columns: [t.topicId],
      foreignColumns: [topics.id],
    })
      .onUpdate('no action')
      .onDelete('no action'),
    index('signal_version_topics_topic_idx').on(t.topicId),
  ],
);

export const entityTopics = pgTable(
  'entity_topics',
  {
    entityId: text('entity_id')
      .notNull()
      .references(() => entities.id, { onDelete: 'cascade' }),
    topicId: text('topic_id')
      .notNull()
      .references(() => topics.id, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.entityId, t.topicId] })],
);
export const signalTopics = pgTable(
  'signal_topics',
  {
    signalId: text('signal_id')
      .notNull()
      .references(() => signals.id, { onDelete: 'cascade' }),
    topicId: text('topic_id')
      .notNull()
      .references(() => topics.id, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.signalId, t.topicId] })],
);
export const signalEntities = pgTable(
  'signal_entities',
  {
    signalId: text('signal_id')
      .notNull()
      .references(() => signals.id, { onDelete: 'cascade' }),
    entityId: text('entity_id')
      .notNull()
      .references(() => entities.id, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.signalId, t.entityId] })],
);
export const relations = pgTable(
  'relations',
  {
    id: text('id').primaryKey(),
    sourceId: text('source_id')
      .notNull()
      .references(() => entities.id),
    relationType: text('relation_type').notNull(),
    targetId: text('target_id')
      .notNull()
      .references(() => entities.id),
    confidence: doublePrecision('confidence').notNull().default(1),
    validFrom: date('valid_from'),
    validTo: date('valid_to'),
    sourceRefs: text('source_refs')
      .array()
      .notNull()
      .default(sql`ARRAY[]::text[]`),
    metadata: jsonb('metadata').notNull().default({}),
  },
  (t) => [
    uniqueIndex('relations_identity_uq').on(t.id, t.sourceId, t.targetId, t.relationType),
    index('relations_source_idx').on(t.sourceId),
    index('relations_target_idx').on(t.targetId),
    check('relations_confidence_ck', sql`${t.confidence} between 0 and 1`),
    check(
      'relations_valid_from_ck',
      sql`${t.validFrom} IS NULL OR (isfinite(${t.validFrom}) AND ${t.validFrom} >= DATE '0001-01-01' AND ${t.validFrom} <= DATE '9999-12-31')`,
    ),
    check(
      'relations_valid_to_ck',
      sql`${t.validTo} IS NULL OR (isfinite(${t.validTo}) AND ${t.validTo} >= DATE '0001-01-01' AND ${t.validTo} <= DATE '9999-12-31')`,
    ),
    check(
      'relations_valid_interval_ck',
      sql`${t.validFrom} IS NULL OR ${t.validTo} IS NULL OR ${t.validFrom} <= ${t.validTo}`,
    ),
  ],
);

// Dates live only in relations. A pending edge does not establish employment.
export const personOrganizationAffiliations = pgTable(
  'person_organization_affiliations',
  {
    relationId: text('relation_id').primaryKey(),
    personId: text('person_id').notNull(),
    organizationId: text('organization_id').notNull(),
    relationType: text('relation_type').notNull(),
    roleTitle: text('role_title').notNull(),
    dateBasis: text('date_basis').notNull(),
    verificationStatus: text('verification_status').notNull().default('pending'),
  },
  (t) => [
    foreignKey({
      name: 'person_organization_affiliations_identity_fk',
      columns: [t.relationId, t.personId, t.organizationId, t.relationType],
      foreignColumns: [
        relations.id,
        relations.sourceId,
        relations.targetId,
        relations.relationType,
      ],
    })
      .onUpdate('no action')
      .onDelete('no action'),
    foreignKey({
      name: 'person_organization_affiliations_person_fk',
      columns: [t.personId],
      foreignColumns: [personProfiles.entityId],
    })
      .onUpdate('no action')
      .onDelete('no action'),
    foreignKey({
      name: 'person_organization_affiliations_organization_fk',
      columns: [t.organizationId],
      foreignColumns: [organizationProfiles.entityId],
    })
      .onUpdate('no action')
      .onDelete('no action'),
    check(
      'person_organization_affiliations_relation_type_ck',
      sql`${t.relationType} IN ('works_at', 'leads', 'advises')`,
    ),
    check('person_organization_affiliations_role_title_ck', sql`${t.roleTitle} ~ '[^[:space:]]'`),
    check('person_organization_affiliations_date_basis_ck', sql`${t.dateBasis} ~ '[^[:space:]]'`),
    check(
      'person_organization_affiliations_verification_status_ck',
      sql`${t.verificationStatus} IN ('pending', 'verified', 'rejected')`,
    ),
    index('person_organization_affiliations_person_idx').on(t.personId),
    index('person_organization_affiliations_organization_idx').on(t.organizationId),
  ],
);

export const affiliationEvidence = pgTable(
  'affiliation_evidence',
  {
    relationId: text('relation_id').notNull(),
    evidenceId: text('evidence_id').notNull(),
    claim: text('claim').notNull(),
    relation: text('relation').notNull(),
    verificationStatus: text('verification_status').notNull().default('pending'),
  },
  (t) => [
    primaryKey({ name: 'affiliation_evidence_pkey', columns: [t.relationId, t.evidenceId] }),
    foreignKey({
      name: 'affiliation_evidence_affiliation_fk',
      columns: [t.relationId],
      foreignColumns: [personOrganizationAffiliations.relationId],
    })
      .onUpdate('no action')
      .onDelete('no action'),
    foreignKey({
      name: 'affiliation_evidence_evidence_fk',
      columns: [t.evidenceId],
      foreignColumns: [publicSourceEvidence.id],
    })
      .onUpdate('no action')
      .onDelete('no action'),
    check('affiliation_evidence_claim_ck', sql`${t.claim} ~ '[^[:space:]]'`),
    check(
      'affiliation_evidence_relation_ck',
      sql`${t.relation} IN ('supports', 'contradicts', 'context')`,
    ),
    check(
      'affiliation_evidence_verification_status_ck',
      sql`${t.verificationStatus} IN ('pending', 'verified', 'rejected')`,
    ),
    index('affiliation_evidence_evidence_idx').on(t.evidenceId),
  ],
);
export const radarSnapshots = pgTable(
  'radar_snapshots',
  {
    id: text('id').primaryKey(),
    topicId: text('topic_id')
      .notNull()
      .references(() => topics.id),
    snapshotDate: date('snapshot_date').notNull(),
    domain: radarDomain('domain').notNull(),
    attention: integer('attention').notNull(),
    trend: trend('trend').notNull(),
    maturity: maturity('maturity').notNull(),
    strategicValue: strategicValue('strategic_value').notNull(),
    confidence: doublePrecision('confidence').notNull(),
    reasoning: text('reasoning').notNull(),
  },
  (t) => [
    uniqueIndex('radar_topic_date_uq').on(t.topicId, t.snapshotDate),
    check('radar_attention_ck', sql`${t.attention} between 0 and 100`),
    check('radar_confidence_ck', sql`${t.confidence} between 0 and 1`),
    check('radar_reasoning_ck', sql`length(trim(${t.reasoning})) > 0`),
  ],
);
export const radarSnapshotSignals = pgTable(
  'radar_snapshot_signals',
  {
    snapshotId: text('snapshot_id')
      .notNull()
      .references(() => radarSnapshots.id, { onDelete: 'cascade' }),
    signalId: text('signal_id')
      .notNull()
      .references(() => signals.id),
    position: integer('position').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.snapshotId, t.signalId] }),
    uniqueIndex('radar_snapshot_signal_position_uq').on(t.snapshotId, t.position),
    index('radar_snapshot_signals_signal_idx').on(t.signalId),
    check('radar_snapshot_signal_position_ck', sql`${t.position} >= 0`),
  ],
);
export const contentRegistry = pgTable(
  'content_registry',
  {
    id: text('id').primaryKey(),
    contentType: text('content_type').notNull(),
    path: text('path').notNull(),
    status: text('status').notNull(),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('content_path_uq').on(t.path)],
);
export const candidateReviews = pgTable(
  'candidate_reviews',
  {
    id: uuid('id').primaryKey(),
    requestId: uuid('request_id').notNull(),
    ownerId: text('owner_id').notNull(),
    runId: uuid('run_id')
      .notNull()
      .references(() => signalGenerationRuns.id),
    candidateIndex: integer('candidate_index').notNull(),
    revision: integer('revision').notNull(),
    materialHash: text('material_hash').notNull(),
    fingerprint: text('fingerprint').notNull(),
    decision: text('decision').notNull(),
    note: text('note').notNull(),
    draft: jsonb('draft').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('candidate_reviews_request_uq').on(t.requestId),
    uniqueIndex('candidate_reviews_revision_uq').on(t.runId, t.candidateIndex, t.revision),
    check('candidate_reviews_index_ck', sql`${t.candidateIndex} BETWEEN 0 AND 4`),
    check('candidate_reviews_revision_ck', sql`${t.revision} > 0`),
    check('candidate_reviews_hash_ck', sql`${t.materialHash} ~ '^[a-f0-9]{64}$'`),
    check('candidate_reviews_fingerprint_ck', sql`${t.fingerprint} ~ '^[a-f0-9]{64}$'`),
    check(
      'candidate_reviews_decision_ck',
      sql`${t.decision} IN ('draft','needs_evidence','rejected','submit_verification')`,
    ),
    check('candidate_reviews_draft_ck', sql`jsonb_typeof(${t.draft}) = 'object'`),
  ],
);
export const candidateEnrichmentRuns = pgTable(
  'candidate_enrichment_runs',
  {
    id: uuid('id').primaryKey(),
    ownerId: text('owner_id').notNull(),
    runId: uuid('run_id')
      .notNull()
      .references(() => signalGenerationRuns.id),
    candidateIndex: integer('candidate_index').notNull(),
    materialHash: text('material_hash').notNull(),
    profileId: uuid('profile_id').notNull(),
    profileRevision: integer('profile_revision').notNull(),
    fingerprint: text('fingerprint').notNull(),
    snapshot: jsonb('snapshot').notNull(),
    configuration: jsonb('configuration').notNull(),
    status: text('status').notNull().default('pending'),
    leaseToken: uuid('lease_token'),
    leaseUntil: timestamp('lease_until', { withTimezone: true }),
    budgetDay: date('budget_day'),
    reservedMicrousd: bigint('reserved_microusd', { mode: 'number' }).notNull().default(0),
    chargedMicrousd: bigint('charged_microusd', { mode: 'number' }).notNull().default(0),
    result: jsonb('result'),
    errorCode: text('error_code'),
    progressPhase: text('progress_phase'),
    progressAt: timestamp('progress_at', { withTimezone: true }),
    startedAt: timestamp('started_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('candidate_enrichment_identity_uq')
      .on(t.ownerId, t.runId, t.candidateIndex, t.materialHash, t.profileId, t.profileRevision)
      .where(sql`${t.status} <> 'failed'`),
    index('candidate_enrichment_owner_created_idx').on(t.ownerId, t.createdAt),
    index('candidate_enrichment_budget_day_idx').on(t.budgetDay),
    check('candidate_enrichment_index_ck', sql`${t.candidateIndex} BETWEEN 0 AND 4`),
    check('candidate_enrichment_profile_revision_ck', sql`${t.profileRevision} > 0`),
    check('candidate_enrichment_material_hash_ck', sql`${t.materialHash} ~ '^[a-f0-9]{64}$'`),
    check('candidate_enrichment_fingerprint_ck', sql`${t.fingerprint} ~ '^[a-f0-9]{64}$'`),
    check('candidate_enrichment_snapshot_ck', sql`jsonb_typeof(${t.snapshot}) = 'object'`),
    check(
      'candidate_enrichment_configuration_ck',
      sql`jsonb_typeof(${t.configuration}) = 'object'`,
    ),
    check(
      'candidate_enrichment_status_ck',
      sql`${t.status} IN ('pending','running','completed','failed','unknown')`,
    ),
    check(
      'candidate_enrichment_progress_ck',
      sql`${t.progressPhase} IS NULL OR ${t.progressPhase} IN ('queued','preparing','generating','validating','saving')`,
    ),
    check('candidate_enrichment_reserved_ck', sql`${t.reservedMicrousd} >= 0`),
    check('candidate_enrichment_charged_ck', sql`${t.chargedMicrousd} >= 0`),
    check(
      'candidate_enrichment_result_ck',
      sql`${t.result} IS NULL OR (jsonb_typeof(${t.result}) = 'object' AND ${t.result}->>'classification' IS NOT DISTINCT FROM 'private')`,
    ),
  ],
);
export const candidateReviewConversions = pgTable(
  'candidate_review_conversions',
  {
    requestKey: text('request_key').primaryKey(),
    reviewId: uuid('review_id')
      .notNull()
      .references(() => candidateReviews.id),
    ownerId: text('owner_id').notNull(),
    signalId: text('signal_id')
      .notNull()
      .references(() => signals.id),
    sourceVersion: integer('source_version').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('candidate_review_conversions_review_uq').on(t.reviewId),
    foreignKey({
      columns: [t.signalId, t.sourceVersion],
      foreignColumns: [signalVersions.signalId, signalVersions.version],
    }),
    check('candidate_review_conversions_version_ck', sql`${t.sourceVersion} > 0`),
    check(
      'candidate_review_conversions_request_ck',
      sql`${t.requestKey} ~ '^[A-Za-z0-9._:-]{1,200}$'`,
    ),
  ],
);

export const candidateReviewAttestations = pgTable(
  'candidate_review_attestations',
  {
    verificationId: uuid('verification_id').primaryKey(),
    reviewId: uuid('review_id')
      .notNull()
      .references(() => candidateReviews.id),
    ownerId: text('owner_id').notNull(),
    keyId: text('key_id').notNull(),
    payload: text('payload').notNull(),
    signature: text('signature').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('candidate_review_attestations_key_ck', sql`length(${t.keyId}) BETWEEN 1 AND 200`),
    check(
      'candidate_review_attestations_payload_ck',
      sql`length(${t.payload}) BETWEEN 1 AND 262144`,
    ),
    check(
      'candidate_review_attestations_signature_ck',
      sql`length(${t.signature}) BETWEEN 1 AND 1024`,
    ),
  ],
);

export const candidateMaterialRequests = pgTable(
  'candidate_material_requests',
  {
    id: uuid('id').primaryKey(),
    ownerId: text('owner_id').notNull(),
    runId: uuid('run_id')
      .notNull()
      .references(() => signalGenerationRuns.id),
    candidateIndex: integer('candidate_index').notNull(),
    baseMaterialHash: text('base_material_hash').notNull(),
    bundleHash: text('bundle_hash').notNull(),
    fingerprint: text('fingerprint').notNull(),
    bundle: jsonb('bundle').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('candidate_material_requests_identity_uq').on(
      t.ownerId,
      t.runId,
      t.candidateIndex,
      t.baseMaterialHash,
      t.bundleHash,
    ),
    uniqueIndex('candidate_material_requests_owner_uq').on(t.id, t.ownerId),
    check('candidate_material_requests_owner_ck', sql`length(${t.ownerId}) BETWEEN 1 AND 200`),
    check('candidate_material_requests_index_ck', sql`${t.candidateIndex} BETWEEN 0 AND 4`),
    check(
      'candidate_material_requests_base_hash_ck',
      sql`${t.baseMaterialHash} COLLATE "C" ~ '^[a-f0-9]{64}$'`,
    ),
    check(
      'candidate_material_requests_bundle_hash_ck',
      sql`${t.bundleHash} COLLATE "C" ~ '^[a-f0-9]{64}$'`,
    ),
    check(
      'candidate_material_requests_fingerprint_ck',
      sql`${t.fingerprint} COLLATE "C" ~ '^[a-f0-9]{64}$'`,
    ),
    check('candidate_material_requests_bundle_ck', sql`jsonb_typeof(${t.bundle}) = 'object'`),
  ],
);

export const candidateMaterialReports = pgTable(
  'candidate_material_reports',
  {
    id: uuid('id').primaryKey(),
    requestId: uuid('request_id').notNull(),
    ownerId: text('owner_id').notNull(),
    planHash: text('plan_hash').notNull(),
    plan: jsonb('plan').notNull(),
    attestation: jsonb('attestation').notNull(),
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      columns: [t.requestId, t.ownerId],
      foreignColumns: [candidateMaterialRequests.id, candidateMaterialRequests.ownerId],
    }),
    uniqueIndex('candidate_material_reports_plan_uq').on(t.requestId, t.planHash),
    uniqueIndex('candidate_material_reports_owner_plan_uq').on(
      t.id,
      t.requestId,
      t.ownerId,
      t.planHash,
    ),
    check('candidate_material_reports_owner_ck', sql`length(${t.ownerId}) BETWEEN 1 AND 200`),
    check(
      'candidate_material_reports_plan_hash_ck',
      sql`${t.planHash} COLLATE "C" ~ '^[a-f0-9]{64}$'`,
    ),
    check('candidate_material_reports_plan_ck', sql`jsonb_typeof(${t.plan}) = 'object'`),
    check(
      'candidate_material_reports_attestation_ck',
      sql`jsonb_typeof(${t.attestation}) = 'object'`,
    ),
  ],
);

export const candidateMaterialReceipts = pgTable(
  'candidate_material_receipts',
  {
    id: uuid('id').primaryKey(),
    requestId: uuid('request_id').notNull(),
    reportId: uuid('report_id').notNull(),
    ownerId: text('owner_id').notNull(),
    planHash: text('plan_hash').notNull(),
    stage: text('stage').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      columns: [t.requestId, t.ownerId],
      foreignColumns: [candidateMaterialRequests.id, candidateMaterialRequests.ownerId],
    }),
    foreignKey({
      columns: [t.reportId, t.requestId, t.ownerId, t.planHash],
      foreignColumns: [
        candidateMaterialReports.id,
        candidateMaterialReports.requestId,
        candidateMaterialReports.ownerId,
        candidateMaterialReports.planHash,
      ],
    }),
    uniqueIndex('candidate_material_receipts_stage_uq').on(t.reportId, t.stage),
    check('candidate_material_receipts_owner_ck', sql`length(${t.ownerId}) BETWEEN 1 AND 200`),
    check(
      'candidate_material_receipts_plan_hash_ck',
      sql`${t.planHash} COLLATE "C" ~ '^[a-f0-9]{64}$'`,
    ),
    check('candidate_material_receipts_stage_ck', sql`${t.stage} IN ('registered', 'verified')`),
  ],
);

export const candidateMaterialProposals = pgTable(
  'candidate_material_proposals',
  {
    id: uuid('id').primaryKey(),
    requestId: uuid('request_id').notNull(),
    ownerId: text('owner_id').notNull(),
    planHash: text('plan_hash').notNull(),
    proposalHash: text('proposal_hash').notNull(),
    payload: jsonb('payload').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      columns: [t.requestId, t.ownerId],
      foreignColumns: [candidateMaterialRequests.id, candidateMaterialRequests.ownerId],
    }),
    uniqueIndex('candidate_material_proposals_content_uq').on(t.requestId, t.proposalHash),
    uniqueIndex('candidate_material_proposals_owner_hash_uq').on(
      t.id,
      t.requestId,
      t.ownerId,
      t.proposalHash,
    ),
    check('candidate_material_proposals_owner_ck', sql`length(${t.ownerId}) BETWEEN 1 AND 200`),
    check(
      'candidate_material_proposals_plan_hash_ck',
      sql`${t.planHash} COLLATE "C" ~ '^[a-f0-9]{64}$'`,
    ),
    check(
      'candidate_material_proposals_proposal_hash_ck',
      sql`${t.proposalHash} COLLATE "C" ~ '^[a-f0-9]{64}$'`,
    ),
    check('candidate_material_proposals_payload_ck', sql`jsonb_typeof(${t.payload}) = 'object'`),
  ],
);

export const candidateMaterialApprovals = pgTable(
  'candidate_material_approvals',
  {
    id: uuid('id').primaryKey(),
    proposalId: uuid('proposal_id').notNull(),
    requestId: uuid('request_id').notNull(),
    ownerId: text('owner_id').notNull(),
    proposalHash: text('proposal_hash').notNull(),
    approvedBy: text('approved_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      columns: [t.requestId, t.ownerId],
      foreignColumns: [candidateMaterialRequests.id, candidateMaterialRequests.ownerId],
    }),
    foreignKey({
      columns: [t.proposalId, t.requestId, t.ownerId, t.proposalHash],
      foreignColumns: [
        candidateMaterialProposals.id,
        candidateMaterialProposals.requestId,
        candidateMaterialProposals.ownerId,
        candidateMaterialProposals.proposalHash,
      ],
    }),
    uniqueIndex('candidate_material_approvals_proposal_uq').on(t.proposalId),
    check('candidate_material_approvals_owner_ck', sql`length(${t.ownerId}) BETWEEN 1 AND 200`),
    check(
      'candidate_material_approvals_hash_ck',
      sql`${t.proposalHash} COLLATE "C" ~ '^[a-f0-9]{64}$'`,
    ),
    check('candidate_material_approvals_actor_ck', sql`${t.approvedBy} = ${t.ownerId}`),
  ],
);

export const editorialSignalRevisions = pgTable(
  'editorial_signal_revisions',
  {
    requestId: uuid('request_id').primaryKey(),
    runId: uuid('run_id').notNull(),
    ownerId: text('owner_id').notNull(),
    candidateIndex: integer('candidate_index').notNull(),
    revision: integer('revision').notNull(),
    materialHash: text('material_hash').notNull(),
    action: text('action').notNull(),
    content: jsonb('content').notNull(),
    requestHash: text('request_hash').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      columns: [t.runId, t.ownerId],
      foreignColumns: [signalGenerationRuns.id, signalGenerationRuns.ownerId],
    }),
    uniqueIndex('editorial_signal_revisions_run_id_candidate_index_revision_key').on(
      t.runId,
      t.candidateIndex,
      t.revision,
    ),
    check('editorial_signal_revisions_owner_id_check', sql`length(${t.ownerId}) BETWEEN 1 AND 200`),
    check(
      'editorial_signal_revisions_candidate_index_check',
      sql`${t.candidateIndex} BETWEEN 0 AND 4`,
    ),
    check('editorial_signal_revisions_revision_check', sql`${t.revision} > 0`),
    check(
      'editorial_signal_revisions_material_hash_check',
      sql`${t.materialHash} COLLATE "C" ~ '^[a-f0-9]{64}$'`,
    ),
    check(
      'editorial_signal_revisions_request_hash_check',
      sql`${t.requestHash} COLLATE "C" ~ '^[a-f0-9]{64}$'`,
    ),
    check(
      'editorial_signal_revisions_action_check',
      sql`${t.action} IN ('draft','publish','withdraw')`,
    ),
    check('editorial_signal_revisions_content_check', sql`jsonb_typeof(${t.content}) = 'object'`),
  ],
);
export const editorialPublicSignals = pgView('editorial_public_signals', {
  signalId: text('signal_id'),
  revision: integer('revision'),
  content: jsonb('content'),
  publishedAt: timestamp('published_at', { withTimezone: true }),
}).existing();

export const searchDocuments = pgTable(
  'search_documents',
  {
    id: text('id').primaryKey(),
    sourceId: text('source_id').notNull(),
    sourceType: text('source_type').notNull(),
    title: text('title').notNull(),
    summary: text('summary').notNull(),
    href: text('href').notNull(),
    keywords: text('keywords').notNull(),
    body: text('body').notNull(),
    importance: integer('importance').notNull().default(1),
    documentDate: date('document_date'),
    topics: jsonb('topics').notNull().default([]),
    entities: jsonb('entities').notNull().default([]),
    embedding: vector('embedding', { dimensions: 1536 }),
    normalizedTitle: text('normalized_title').notNull(),
    normalizedSummary: text('normalized_summary').notNull(),
    normalizedKeywords: text('normalized_keywords').notNull(),
    normalizedBody: text('normalized_body').notNull(),
    searchVector: tsvector('search_vector')
      .generatedAlwaysAs(
        sql`setweight(to_tsvector('pg_catalog.simple'::regconfig, ${sql.raw('normalized_title')}), 'A') || setweight(to_tsvector('pg_catalog.simple'::regconfig, ${sql.raw('normalized_summary')}), 'B') || setweight(to_tsvector('pg_catalog.simple'::regconfig, ${sql.raw('normalized_keywords')}), 'C') || setweight(to_tsvector('pg_catalog.simple'::regconfig, ${sql.raw('normalized_body')}), 'D')`,
      )
      .notNull(),
  },
  (t) => [
    index('search_source_idx').on(t.sourceId),
    uniqueIndex('search_documents_source_identity_uq').on(t.sourceType, t.sourceId),
    index('search_documents_date_idx').on(t.documentDate),
    index('search_documents_fts_idx').using('gin', t.searchVector),
    check(
      'search_documents_source_type_ck',
      sql`${t.sourceType} IN ('daily', 'weekly', 'insight', 'topic', 'signal', 'resource')`,
    ),
    check('search_documents_title_ck', sql`length(btrim(${t.title})) > 0`),
    check('search_documents_summary_ck', sql`length(btrim(${t.summary})) > 0`),
    check('search_documents_href_ck', sql`${t.href} ~ '^/'`),
    check('search_documents_importance_ck', sql`${t.importance} between 1 and 5`),
    check('search_documents_topics_array_ck', sql`jsonb_typeof(${t.topics}) = 'array'`),
    check('search_documents_entities_array_ck', sql`jsonb_typeof(${t.entities}) = 'array'`),
    check(
      'search_documents_normalized_title_ck',
      sql`length(${t.normalizedTitle}) > 0 AND ${t.normalizedTitle} = btrim(${t.normalizedTitle})`,
    ),
    check(
      'search_documents_normalized_summary_ck',
      sql`length(${t.normalizedSummary}) > 0 AND ${t.normalizedSummary} = btrim(${t.normalizedSummary})`,
    ),
    check(
      'search_documents_normalized_keywords_ck',
      sql`${t.normalizedKeywords} = btrim(${t.normalizedKeywords})`,
    ),
    check(
      'search_documents_normalized_body_ck',
      sql`${t.normalizedBody} = btrim(${t.normalizedBody})`,
    ),
  ],
);
