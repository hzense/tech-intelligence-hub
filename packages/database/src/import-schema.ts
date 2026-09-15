import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

export const importBatches = pgTable(
  'import_batches',
  {
    id: uuid('id').primaryKey(),
    ownerId: text('owner_id').notNull(),
    fingerprint: text('fingerprint').notNull(),
    intent: text('intent').notNull(),
    configuration: jsonb('configuration').notNull(),
    cancelled: boolean('cancelled').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('import_batches_fingerprint_ck', sql`${t.fingerprint} ~ '^[a-f0-9]{64}$'`),
    check('import_batches_intent_ck', sql`${t.intent} IN ('preview', 'generate_publish')`),
    check('import_batches_configuration_ck', sql`jsonb_typeof(${t.configuration}) = 'object'`),
    index('import_batches_owner_created_idx').on(t.ownerId, t.createdAt),
  ],
);
export const importItems = pgTable(
  'import_items',
  {
    id: uuid('id').primaryKey(),
    batchId: uuid('batch_id')
      .notNull()
      .references(() => importBatches.id),
    position: integer('position').notNull(),
    kind: text('kind').notNull(),
    declaration: jsonb('declaration').notNull(),
    status: text('status').notNull(),
    fence: integer('fence').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('import_items_position_ck', sql`${t.position} >= 0`),
    check('import_items_kind_ck', sql`${t.kind} IN ('file', 'url')`),
    check('import_items_declaration_ck', sql`jsonb_typeof(${t.declaration}) = 'object'`),
    check(
      'import_items_status_ck',
      sql`${t.status} IN ('awaiting_upload', 'queued', 'running', 'completed', 'failed', 'unknown', 'cancelled')`,
    ),
    check('import_items_fence_ck', sql`${t.fence} >= 0`),
    uniqueIndex('import_items_batch_position_idx').on(t.batchId, t.position),
    index('import_items_status_created_idx').on(t.status, t.createdAt),
  ],
);
export const importDocuments = pgTable(
  'import_documents',
  {
    itemId: uuid('item_id')
      .primaryKey()
      .references(() => importItems.id),
    objectKey: text('object_key').notNull(),
    objectVersion: text('object_version').notNull(),
    sha256: text('sha256').notNull(),
    byteSize: integer('byte_size').notNull(),
    format: text('format').notNull(),
    metadata: jsonb('metadata').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('import_documents_sha256_ck', sql`${t.sha256} ~ '^[a-f0-9]{64}$'`),
    check('import_documents_size_ck', sql`${t.byteSize} > 0 AND ${t.byteSize} <= 26214400`),
    check(
      'import_documents_format_ck',
      sql`${t.format} IN ('pdf', 'docx', 'markdown', 'text', 'html', 'csv', 'xlsx', 'png', 'jpeg')`,
    ),
    check('import_documents_metadata_ck', sql`jsonb_typeof(${t.metadata}) = 'object'`),
  ],
);
export const importAttempts = pgTable(
  'import_attempts',
  {
    itemId: uuid('item_id')
      .notNull()
      .references(() => importItems.id),
    fence: integer('fence').notNull(),
    parserVersion: text('parser_version').notNull(),
    status: text('status').notNull(),
    leaseUntil: timestamp('lease_until', { withTimezone: true }).notNull(),
    budgetDay: date('budget_day').notNull(),
    reservedMicrousd: bigint('reserved_microusd', { mode: 'bigint' }).notNull(),
    chargedMicrousd: bigint('charged_microusd', { mode: 'bigint' }).notNull().default(0n),
    errorCode: text('error_code'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
  },
  (t) => [
    primaryKey({ columns: [t.itemId, t.fence] }),
    check('import_attempts_fence_ck', sql`${t.fence} > 0`),
    check(
      'import_attempts_status_ck',
      sql`${t.status} IN ('running', 'completed', 'failed', 'unknown', 'cancelled')`,
    ),
    check('import_attempts_reserved_ck', sql`${t.reservedMicrousd} >= 0`),
    check('import_attempts_charged_ck', sql`${t.chargedMicrousd} >= 0`),
  ],
);
export const importOutputs = pgTable(
  'import_outputs',
  {
    itemId: uuid('item_id')
      .notNull()
      .references(() => importDocuments.itemId),
    fence: integer('fence').notNull(),
    content: jsonb('content').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.itemId, t.fence] }),
    foreignKey({
      columns: [t.itemId, t.fence],
      foreignColumns: [importAttempts.itemId, importAttempts.fence],
    }),
    check('import_outputs_content_ck', sql`jsonb_typeof(${t.content}) = 'object'`),
  ],
);
export const importAudit = pgTable(
  'import_audit',
  {
    id: uuid('id').primaryKey(),
    batchId: uuid('batch_id')
      .notNull()
      .references(() => importBatches.id),
    itemId: uuid('item_id').references(() => importItems.id),
    event: text('event').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check(
      'import_audit_event_ck',
      sql`${t.event} IN ('created', 'received', 'claimed', 'completed', 'failed', 'unknown', 'cancelled', 'retried')`,
    ),
    index('import_audit_batch_created_idx').on(t.batchId, t.createdAt),
  ],
);
export const importDailyUsage = pgTable(
  'import_daily_usage',
  {
    day: date('day').primaryKey(),
    reservedMicrousd: bigint('reserved_microusd', { mode: 'bigint' }).notNull().default(0n),
    chargedMicrousd: bigint('charged_microusd', { mode: 'bigint' }).notNull().default(0n),
  },
  (t) => [
    check('import_daily_usage_reserved_ck', sql`${t.reservedMicrousd} >= 0`),
    check('import_daily_usage_charged_ck', sql`${t.chargedMicrousd} >= 0`),
  ],
);
