import { sql } from 'drizzle-orm';
import {
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
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  vector,
} from 'drizzle-orm/pg-core';

const tsvector = customType<{ data: string }>({
  dataType() {
    return 'tsvector';
  },
});

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

// Private 3.0.0 storage foundation. Publication and database-enforced snapshot
// immutability require later services and are not supplied by these tables.
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
    index('relations_source_idx').on(t.sourceId),
    index('relations_target_idx').on(t.targetId),
    check('relations_confidence_ck', sql`${t.confidence} between 0 and 1`),
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
