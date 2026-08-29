import console from 'node:console';
import { resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL, URL } from 'node:url';
import pg from 'pg';
import { productionDatabaseOptions, validateConnectionTarget } from './connection-policy.mjs';
import { loadMigrations, planPendingMigrations, verifyMigrationManifest } from './migrate.mjs';

const { Client } = pg;
const migrationDirectory = fileURLToPath(new URL('../../../db/migrations/', import.meta.url));
const migrationManifest = fileURLToPath(
  new URL('../../../db/migrations/checksums.json', import.meta.url),
);

const expectedColumns = {
  topics: {
    id: ['text', true],
    title: ['text', true],
    parent_id: ['text', false],
    status: ['topic_status', true],
    metadata: ['jsonb', true],
  },
  entities: {
    id: ['text', true],
    type: ['entity_type', true],
    name: ['text', true],
    status: ['text', true],
    aliases: ['text[]', true],
    metadata: ['jsonb', true],
    created_at: ['timestamp with time zone', true],
    updated_at: ['timestamp with time zone', true],
  },
  sources: {
    id: ['text', true],
    name: ['text', true],
    type: ['source_type', true],
    url: ['text', false],
    trust_score: ['integer', true],
    active: ['boolean', true],
    allowed_hosts: ['text[]', true],
  },
  signals: {
    id: ['text', true],
    title: ['text', true],
    type: ['signal_type', true],
    status: ['signal_status', true],
    occurred_at: ['timestamp with time zone', true],
    captured_at: ['timestamp with time zone', true],
    source_id: ['text', true],
    source_url: ['text', true],
    summary: ['text', true],
    importance: ['integer', true],
    strength: ['integer', true],
    confidence: ['double precision', true],
    novelty: ['double precision', true],
    metadata: ['jsonb', true],
  },
  entity_topics: {
    entity_id: ['text', true],
    topic_id: ['text', true],
  },
  signal_topics: {
    signal_id: ['text', true],
    topic_id: ['text', true],
  },
  signal_entities: {
    signal_id: ['text', true],
    entity_id: ['text', true],
  },
  relations: {
    id: ['text', true],
    source_id: ['text', true],
    relation_type: ['text', true],
    target_id: ['text', true],
    confidence: ['double precision', true],
    valid_from: ['date', false],
    valid_to: ['date', false],
    source_refs: ['text[]', true],
    metadata: ['jsonb', true],
  },
  radar_snapshots: {
    id: ['text', true],
    topic_id: ['text', true],
    snapshot_date: ['date', true],
    attention: ['integer', true],
    trend: ['trend', true],
    maturity: ['maturity', true],
    strategic_value: ['strategic_value', true],
    confidence: ['double precision', true],
    domain: ['radar_domain', true],
    reasoning: ['text', true],
  },
  radar_snapshot_signals: {
    snapshot_id: ['text', true],
    signal_id: ['text', true],
    position: ['integer', true],
  },
  content_registry: {
    id: ['text', true],
    content_type: ['text', true],
    path: ['text', true],
    status: ['text', true],
    published_at: ['timestamp with time zone', false],
    updated_at: ['timestamp with time zone', true],
  },
  search_documents: {
    id: ['text', true],
    source_id: ['text', true],
    source_type: ['text', true],
    title: ['text', true],
    body: ['text', true],
    importance: ['integer', true],
    document_date: ['date', false],
    topics: ['jsonb', true],
    entities: ['jsonb', true],
    embedding: ['vector(1536)', false],
  },
  hzense_schema_migrations: {
    name: ['text', true],
    checksum: ['text', true],
    applied_at: ['timestamp with time zone', true],
  },
};

const expectedEnums = {
  entity_type: [
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
  ],
  signal_type: [
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
  ],
  signal_status: ['inbox', 'reviewed', 'accepted', 'rejected', 'archived'],
  source_type: [
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
  ],
  topic_status: ['watching', 'active', 'strategic', 'archived'],
  trend: ['rapid_growth', 'growth', 'stable', 'decline', 'rapid_decline'],
  maturity: ['research', 'early', 'emerging', 'growth', 'mature'],
  strategic_value: ['low', 'medium', 'high', 'critical'],
  radar_domain: ['artificial_intelligence', 'infrastructure', 'security', 'robotics'],
};

const expectedPrimaryKeys = new Set([
  'topics|id',
  'entities|id',
  'sources|id',
  'signals|id',
  'entity_topics|entity_id,topic_id',
  'signal_topics|signal_id,topic_id',
  'signal_entities|signal_id,entity_id',
  'relations|id',
  'radar_snapshots|id',
  'radar_snapshot_signals|snapshot_id,signal_id',
  'content_registry|id',
  'search_documents|id',
  'hzense_schema_migrations|name',
]);

const expectedForeignKeys = new Set([
  'signals|source_id|sources|id|a|a|false',
  'entity_topics|entity_id|entities|id|c|a|false',
  'entity_topics|topic_id|topics|id|c|a|false',
  'signal_topics|signal_id|signals|id|c|a|false',
  'signal_topics|topic_id|topics|id|c|a|false',
  'signal_entities|signal_id|signals|id|c|a|false',
  'signal_entities|entity_id|entities|id|c|a|false',
  'relations|source_id|entities|id|a|a|false',
  'relations|target_id|entities|id|a|a|false',
  'radar_snapshots|topic_id|topics|id|a|a|false',
  'radar_snapshot_signals|snapshot_id|radar_snapshots|id|c|a|false',
  'radar_snapshot_signals|signal_id|signals|id|a|a|false',
]);

const expectedCheckExpressions = {
  sources: [
    ['trust_score>=0andtrust_score<=100', 'trust_scorebetween0and100'],
    ['cardinalityallowed_hosts>0'],
  ],
  signals: [
    ["source_url~'^https://'"],
    ['importance>=1andimportance<=5', 'importancebetween1and5'],
    ['strength>=1andstrength<=5', 'strengthbetween1and5'],
    [
      'confidence>=0andconfidence<=1',
      "confidence>='0'andconfidence<='1'",
      'confidencebetween0and1',
    ],
    ['novelty>=0andnovelty<=1', "novelty>='0'andnovelty<='1'", 'noveltybetween0and1'],
  ],
  relations: [
    [
      'confidence>=0andconfidence<=1',
      "confidence>='0'andconfidence<='1'",
      'confidencebetween0and1',
    ],
  ],
  radar_snapshots: [
    ['attention>=0andattention<=100', 'attentionbetween0and100'],
    [
      'confidence>=0andconfidence<=1',
      "confidence>='0'andconfidence<='1'",
      'confidencebetween0and1',
    ],
    ['lengthbtrimreasoning>0'],
  ],
  radar_snapshot_signals: [['position>=0', '"position">=0']],
  hzense_schema_migrations: [['lengthchecksum=64']],
};

const expectedDefaults = new Map([
  ['topics.status', new Set(["'watching'"])],
  ['topics.metadata', new Set(["'{}'"])],
  ['entities.status', new Set(["'active'"])],
  ['entities.aliases', new Set(["'{}'", 'array[]'])],
  ['entities.metadata', new Set(["'{}'"])],
  ['entities.created_at', new Set(['now'])],
  ['entities.updated_at', new Set(['now'])],
  ['sources.active', new Set(['true'])],
  ['signals.status', new Set(["'inbox'"])],
  ['signals.captured_at', new Set(['now'])],
  ['signals.metadata', new Set(["'{}'"])],
  ['relations.confidence', new Set(['1', "'1'"])],
  ['relations.source_refs', new Set(["'{}'", 'array[]'])],
  ['relations.metadata', new Set(["'{}'"])],
  ['content_registry.updated_at', new Set(['now'])],
  ['search_documents.importance', new Set(['1', "'1'"])],
  ['search_documents.topics', new Set(["'[]'"])],
  ['search_documents.entities', new Set(["'[]'"])],
  ['hzense_schema_migrations.applied_at', new Set(['now'])],
]);

const expectedUniqueIndexes = new Set([
  'radar_snapshots|topic_id,snapshot_date',
  'radar_snapshot_signals|snapshot_id,position',
  'content_registry|path',
]);

const requiredNonUniqueIndexes = new Set([
  'entities|type',
  'entities|name',
  'signals|occurred_at',
  'signals|status',
  'relations|source_id',
  'relations|target_id',
  'radar_snapshot_signals|signal_id',
  'search_documents|source_id',
]);

export const expectedTableNames = new Set(Object.keys(expectedColumns));

function addSetDifferences(problems, label, expected, actual) {
  for (const value of expected) {
    if (!actual.has(value)) problems.push(`missing ${label}: ${value}`);
  }
  for (const value of actual) {
    if (!expected.has(value)) problems.push(`unexpected ${label}: ${value}`);
  }
}

function requireString(value, label) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${label} is required`);
  }
  return value.trim();
}

export function canonicalCatalogExpression(value) {
  return value
    .toLowerCase()
    .replace(
      /('(?:''|[^'])*')::(?:double\s+precision|timestamp\s+(?:with|without)\s+time\s+zone|[a-z_][a-z0-9_.]*(?:\[\])?)/g,
      '$1',
    )
    .replace(/(array\[\])::(?:double\s+precision|[a-z_][a-z0-9_.]*(?:\[\])?)/g, '$1')
    .replace(
      /(\(?[-+]?\d+(?:\.\d+)?\)?)::(?:double\s+precision|integer|bigint|numeric|real)/g,
      '$1',
    )
    .replace(/\s+/g, '')
    .replace(/[()]/g, '')
    .replace(/^check/, '');
}

async function collectSchemaProblems(client, migrations, expectedPgvectorVersion, expectedOwner) {
  const problems = [];
  const tables = await client.query(
    `SELECT table_info.relname AS name,
            table_info.relkind,
            table_info.relpersistence,
            table_info.relrowsecurity,
            table_info.relforcerowsecurity,
            pg_get_userbyid(table_info.relowner) AS owner,
            (SELECT count(*)::integer
             FROM pg_policy AS policy_info
             WHERE policy_info.polrelid = table_info.oid) AS policy_count,
            (SELECT count(*)::integer
             FROM pg_trigger AS trigger_info
             WHERE trigger_info.tgrelid = table_info.oid
               AND NOT trigger_info.tgisinternal) AS user_trigger_count
     FROM pg_class AS table_info
     JOIN pg_namespace AS namespace_info ON namespace_info.oid = table_info.relnamespace
     WHERE namespace_info.nspname = 'public'
       AND table_info.relkind IN ('r', 'p')
     ORDER BY table_info.relname`,
  );
  addSetDifferences(
    problems,
    'public table',
    expectedTableNames,
    new Set(tables.rows.map((row) => row.name)),
  );
  for (const table of tables.rows.filter((row) => expectedTableNames.has(row.name))) {
    if (table.relkind !== 'r') {
      problems.push(`table kind mismatch: ${table.name}`);
    }
    if (table.relpersistence !== 'p') {
      problems.push(`table persistence mismatch: ${table.name}`);
    }
    if (table.relrowsecurity || table.relforcerowsecurity) {
      problems.push(`unexpected row-level security: ${table.name}`);
    }
    if (table.owner !== expectedOwner) {
      problems.push(`table owner mismatch: ${table.name}`);
    }
    if (table.policy_count !== 0) {
      problems.push(`unexpected row-level security policy: ${table.name}`);
    }
    if (table.user_trigger_count !== 0) {
      problems.push(`unexpected user trigger: ${table.name}`);
    }
  }

  const history = await client.query(
    'SELECT name, checksum FROM hzense_schema_migrations ORDER BY name',
  );
  try {
    const pending = planPendingMigrations(migrations, history.rows);
    if (pending.length > 0) {
      problems.push(`pending migrations: ${pending.map((migration) => migration.name).join(', ')}`);
    }
  } catch (error) {
    problems.push(error instanceof Error ? error.message : 'invalid migration history');
  }

  const columns = await client.query(
    `SELECT table_info.relname AS table_name,
            column_info.attname AS column_name,
            format_type(column_info.atttypid, column_info.atttypmod) AS data_type,
            column_info.attnotnull AS not_null,
            pg_get_expr(default_info.adbin, default_info.adrelid, true) AS default_expression
     FROM pg_class AS table_info
     JOIN pg_namespace AS namespace_info ON namespace_info.oid = table_info.relnamespace
     JOIN pg_attribute AS column_info ON column_info.attrelid = table_info.oid
     LEFT JOIN pg_attrdef AS default_info
       ON default_info.adrelid = table_info.oid AND default_info.adnum = column_info.attnum
     WHERE namespace_info.nspname = 'public'
       AND table_info.relkind = 'r'
       AND column_info.attnum > 0
       AND NOT column_info.attisdropped
     ORDER BY table_info.relname, column_info.attnum`,
  );
  const actualColumns = new Map(
    columns.rows.map((row) => [
      `${row.table_name}.${row.column_name}`,
      `${row.data_type}|${row.not_null}`,
    ]),
  );
  const expectedColumnEntries = new Map();
  for (const [tableName, tableColumns] of Object.entries(expectedColumns)) {
    for (const [columnName, [dataType, notNull]] of Object.entries(tableColumns)) {
      expectedColumnEntries.set(`${tableName}.${columnName}`, `${dataType}|${notNull}`);
    }
  }
  for (const [name, signature] of expectedColumnEntries) {
    if (!actualColumns.has(name)) {
      problems.push(`missing column: ${name}`);
    } else if (actualColumns.get(name) !== signature) {
      problems.push(
        `column contract mismatch: ${name} expected ${signature}, found ${actualColumns.get(name)}`,
      );
    }
  }
  for (const name of actualColumns.keys()) {
    if (!expectedColumnEntries.has(name)) problems.push(`unexpected column: ${name}`);
  }
  const actualDefaults = new Map(
    columns.rows
      .filter((row) => row.default_expression !== null)
      .map((row) => [
        `${row.table_name}.${row.column_name}`,
        canonicalCatalogExpression(row.default_expression),
      ]),
  );
  for (const [name, acceptedExpressions] of expectedDefaults) {
    const expression = actualDefaults.get(name);
    if (!expression || !acceptedExpressions.has(expression)) {
      problems.push(`default expression mismatch: ${name}`);
    }
  }
  for (const name of actualDefaults.keys()) {
    if (!expectedDefaults.has(name)) problems.push(`unexpected default expression: ${name}`);
  }

  const enums = await client.query(
    `SELECT type_info.typname AS name,
            array_agg(enum_info.enumlabel::text ORDER BY enum_info.enumsortorder) AS labels
     FROM pg_type AS type_info
     JOIN pg_enum AS enum_info ON enum_info.enumtypid = type_info.oid
     JOIN pg_namespace AS namespace_info ON namespace_info.oid = type_info.typnamespace
     WHERE namespace_info.nspname = 'public'
     GROUP BY type_info.typname
     ORDER BY type_info.typname`,
  );
  const actualEnums = new Map(enums.rows.map((row) => [row.name, row.labels]));
  for (const [name, labels] of Object.entries(expectedEnums)) {
    if (actualEnums.get(name)?.join(',') !== labels.join(',')) {
      problems.push(`enum contract mismatch: ${name}`);
    }
  }
  for (const name of actualEnums.keys()) {
    if (!(name in expectedEnums)) problems.push(`unexpected enum: ${name}`);
  }

  const primaryKeys = await client.query(
    `SELECT table_info.relname AS table_name,
            array_agg(column_info.attname::text ORDER BY key_info.ordinality) AS columns,
            bool_and(constraint_info.convalidated) AS validated,
            bool_or(constraint_info.condeferrable) AS deferrable,
            bool_or(constraint_info.condeferred) AS initially_deferred
     FROM pg_constraint AS constraint_info
     JOIN pg_class AS table_info ON table_info.oid = constraint_info.conrelid
     JOIN pg_namespace AS namespace_info ON namespace_info.oid = table_info.relnamespace
     JOIN LATERAL unnest(constraint_info.conkey) WITH ORDINALITY
       AS key_info(attnum, ordinality) ON true
     JOIN pg_attribute AS column_info
       ON column_info.attrelid = table_info.oid AND column_info.attnum = key_info.attnum
     WHERE namespace_info.nspname = 'public' AND constraint_info.contype = 'p'
     GROUP BY table_info.relname
     ORDER BY table_info.relname`,
  );
  const actualPrimaryKeys = new Set(
    primaryKeys.rows.map((row) => `${row.table_name}|${row.columns.join(',')}`),
  );
  addSetDifferences(problems, 'primary key', expectedPrimaryKeys, actualPrimaryKeys);
  if (primaryKeys.rows.some((row) => row.validated !== true)) {
    problems.push('one or more primary keys are not validated');
  }
  if (primaryKeys.rows.some((row) => row.deferrable === true || row.initially_deferred === true)) {
    problems.push('one or more primary keys are deferrable');
  }

  const foreignKeys = await client.query(
    `SELECT source_table.relname AS table_name,
            array_agg(source_column.attname::text ORDER BY source_key.ordinality) AS columns,
            target_table.relname AS target_table,
            target_namespace.nspname AS target_schema,
            array_agg(target_column.attname::text ORDER BY target_key.ordinality) AS target_columns,
            constraint_info.confdeltype AS delete_action,
            constraint_info.confupdtype AS update_action,
            constraint_info.condeferrable AS deferrable,
            constraint_info.condeferred AS initially_deferred,
            constraint_info.convalidated AS validated
     FROM pg_constraint AS constraint_info
     JOIN pg_class AS source_table ON source_table.oid = constraint_info.conrelid
     JOIN pg_namespace AS namespace_info ON namespace_info.oid = source_table.relnamespace
     JOIN pg_class AS target_table ON target_table.oid = constraint_info.confrelid
     JOIN pg_namespace AS target_namespace ON target_namespace.oid = target_table.relnamespace
     JOIN LATERAL unnest(constraint_info.conkey) WITH ORDINALITY
       AS source_key(attnum, ordinality) ON true
     JOIN LATERAL unnest(constraint_info.confkey) WITH ORDINALITY
       AS target_key(attnum, ordinality) ON target_key.ordinality = source_key.ordinality
     JOIN pg_attribute AS source_column
       ON source_column.attrelid = source_table.oid AND source_column.attnum = source_key.attnum
     JOIN pg_attribute AS target_column
       ON target_column.attrelid = target_table.oid AND target_column.attnum = target_key.attnum
     WHERE namespace_info.nspname = 'public' AND constraint_info.contype = 'f'
     GROUP BY source_table.relname, target_table.relname, target_namespace.nspname,
              constraint_info.oid
     ORDER BY source_table.relname, columns`,
  );
  const actualForeignKeys = new Set(
    foreignKeys.rows.map(
      (row) =>
        `${row.table_name}|${row.columns.join(',')}|${row.target_table}|${row.target_columns.join(',')}|${row.delete_action}|${row.update_action}|${row.deferrable}`,
    ),
  );
  addSetDifferences(problems, 'foreign key', expectedForeignKeys, actualForeignKeys);
  if (foreignKeys.rows.some((row) => row.validated !== true)) {
    problems.push('one or more foreign keys are not validated');
  }
  if (foreignKeys.rows.some((row) => row.initially_deferred === true)) {
    problems.push('one or more foreign keys are initially deferred');
  }
  if (foreignKeys.rows.some((row) => row.target_schema !== 'public')) {
    problems.push('one or more foreign keys target a relation outside the public schema');
  }

  const checks = await client.query(
    `SELECT table_info.relname AS table_name,
            count(*)::integer AS count,
            bool_and(constraint_info.convalidated) AS validated,
            array_agg(
              pg_get_constraintdef(constraint_info.oid, true)::text
              ORDER BY constraint_info.oid
            ) AS definitions
     FROM pg_constraint AS constraint_info
     JOIN pg_class AS table_info ON table_info.oid = constraint_info.conrelid
     JOIN pg_namespace AS namespace_info ON namespace_info.oid = table_info.relnamespace
     WHERE namespace_info.nspname = 'public' AND constraint_info.contype = 'c'
     GROUP BY table_info.relname
     ORDER BY table_info.relname`,
  );
  const actualCheckCounts = new Map(checks.rows.map((row) => [row.table_name, row.count]));
  const expectedCheckCounts = new Map(
    Object.entries(expectedCheckExpressions).map(([tableName, expressions]) => [
      tableName,
      expressions.length,
    ]),
  );
  for (const [tableName, count] of expectedCheckCounts) {
    if (actualCheckCounts.get(tableName) !== count) {
      problems.push(
        `check constraint count mismatch: ${tableName} expected ${count}, found ${actualCheckCounts.get(tableName) ?? 0}`,
      );
    }
  }
  for (const tableName of actualCheckCounts.keys()) {
    if (!expectedCheckCounts.has(tableName)) {
      problems.push(`unexpected check constraints on ${tableName}`);
    }
  }
  if (checks.rows.some((row) => row.validated !== true)) {
    problems.push('one or more check constraints are not validated');
  }
  for (const [tableName, expressionAlternatives] of Object.entries(expectedCheckExpressions)) {
    const definitions =
      checks.rows
        .find((row) => row.table_name === tableName)
        ?.definitions.map(canonicalCatalogExpression) ?? [];
    for (const acceptedExpressions of expressionAlternatives) {
      if (!definitions.some((definition) => acceptedExpressions.includes(definition))) {
        problems.push(`check constraint expression mismatch: ${tableName}`);
      }
    }
  }

  const indexes = await client.query(
    `SELECT table_info.relname AS table_name,
            index_info.indisunique AS is_unique,
            index_info.indimmediate AS immediate,
            access_method.amname AS access_method,
            COALESCE(
              array_agg(column_info.attname::text ORDER BY key_info.ordinality)
                FILTER (WHERE key_info.ordinality <= index_info.indnkeyatts),
              ARRAY[]::text[]
            ) AS columns,
            index_info.indpred IS NULL AS predicate_free,
            index_info.indexprs IS NULL AS expression_free,
            index_info.indisvalid AS valid,
            index_info.indisready AS ready
     FROM pg_index AS index_info
     JOIN pg_class AS table_info ON table_info.oid = index_info.indrelid
     JOIN pg_namespace AS namespace_info ON namespace_info.oid = table_info.relnamespace
     JOIN pg_class AS index_class ON index_class.oid = index_info.indexrelid
     JOIN pg_am AS access_method ON access_method.oid = index_class.relam
     JOIN LATERAL unnest(index_info.indkey) WITH ORDINALITY
       AS key_info(attnum, ordinality) ON true
     LEFT JOIN pg_attribute AS column_info
       ON column_info.attrelid = table_info.oid AND column_info.attnum = key_info.attnum
     WHERE namespace_info.nspname = 'public'
       AND NOT index_info.indisprimary
     GROUP BY table_info.relname, index_info.indexrelid, index_info.indisunique,
              index_info.indimmediate,
              access_method.amname, (index_info.indpred IS NULL),
              (index_info.indexprs IS NULL), index_info.indnkeyatts,
              index_info.indisvalid, index_info.indisready
     ORDER BY table_info.relname, index_info.indexrelid`,
  );
  const indexSignature = (row) => `${row.table_name}|${row.columns.join(',')}`;
  const isHealthyRequiredIndex = (row, requireImmediate) =>
    row.access_method === 'btree' &&
    row.predicate_free === true &&
    row.expression_free === true &&
    row.valid === true &&
    row.ready === true &&
    (!requireImmediate || row.immediate === true);
  const actualUniqueIndexes = new Set(
    indexes.rows.filter((row) => row.is_unique === true).map(indexSignature),
  );
  addSetDifferences(problems, 'unique index', expectedUniqueIndexes, actualUniqueIndexes);
  for (const index of expectedUniqueIndexes) {
    if (
      !indexes.rows.some(
        (row) =>
          row.is_unique === true &&
          indexSignature(row) === index &&
          isHealthyRequiredIndex(row, true),
      )
    ) {
      problems.push(`unique index is not a valid plain btree: ${index}`);
    }
  }
  for (const index of requiredNonUniqueIndexes) {
    if (
      !indexes.rows.some(
        (row) =>
          row.is_unique === false &&
          indexSignature(row) === index &&
          isHealthyRequiredIndex(row, false),
      )
    ) {
      problems.push(`missing valid non-unique btree index: ${index}`);
    }
  }

  const vector = await client.query(
    `SELECT extension_info.extversion AS version,
            type_info.oid AS type_oid,
            embedding_info.atttypid AS embedding_type_oid,
            format_type(embedding_info.atttypid, embedding_info.atttypmod) AS embedding_type
     FROM pg_extension AS extension_info
     JOIN pg_depend AS dependency_info
       ON dependency_info.refobjid = extension_info.oid
      AND dependency_info.classid = 'pg_type'::regclass
      AND dependency_info.deptype = 'e'
     JOIN pg_type AS type_info
       ON type_info.oid = dependency_info.objid AND type_info.typname = 'vector'
     JOIN pg_attribute AS embedding_info
       ON embedding_info.attrelid = 'public.search_documents'::regclass
      AND embedding_info.attname = 'embedding'
     WHERE extension_info.extname = 'vector'`,
  );
  const vectorRow = vector.rows[0];
  if (!vectorRow) {
    problems.push('vector extension/type ownership could not be verified');
  } else {
    if (vectorRow.type_oid !== vectorRow.embedding_type_oid) {
      problems.push('search_documents.embedding does not use the vector extension base type');
    }
    if (vectorRow.embedding_type !== 'vector(1536)') {
      problems.push(`embedding type mismatch: ${vectorRow.embedding_type}`);
    }
    if (expectedPgvectorVersion && vectorRow.version !== expectedPgvectorVersion) {
      problems.push(
        `pgvector version mismatch: expected ${expectedPgvectorVersion}, found ${vectorRow.version}`,
      );
    }
  }

  const dataIntegrity = await client.query(
    `SELECT
       (SELECT count(*)::integer
        FROM radar_snapshots AS snapshot
        WHERE NOT EXISTS (
          SELECT 1 FROM radar_snapshot_signals AS evidence
          WHERE evidence.snapshot_id = snapshot.id
        )) AS snapshots_without_evidence,
       (SELECT count(*)::integer
        FROM radar_snapshot_signals AS evidence
        JOIN radar_snapshots AS snapshot ON snapshot.id = evidence.snapshot_id
        JOIN signals AS signal ON signal.id = evidence.signal_id
        WHERE signal.status NOT IN ('reviewed', 'accepted')
           OR (signal.occurred_at AT TIME ZONE 'UTC')::date > snapshot.snapshot_date
           OR (signal.captured_at AT TIME ZONE 'UTC')::date > snapshot.snapshot_date
           OR NOT EXISTS (
             SELECT 1 FROM signal_topics
             WHERE signal_topics.signal_id = signal.id
               AND signal_topics.topic_id = snapshot.topic_id
           )) AS ineligible_evidence`,
  );
  if (dataIntegrity.rows[0]?.snapshots_without_evidence !== 0) {
    problems.push(
      `${dataIntegrity.rows[0].snapshots_without_evidence} Radar snapshots have no evidence`,
    );
  }
  if (dataIntegrity.rows[0]?.ineligible_evidence !== 0) {
    problems.push(
      `${dataIntegrity.rows[0].ineligible_evidence} Radar evidence edges are ineligible`,
    );
  }

  return { problems, pgvectorVersion: vectorRow?.version };
}

export async function verifyDatabaseContract({
  connectionString,
  profile,
  expectedHost,
  expectedPort,
  expectedDatabase = process.env.HZENSE_DATABASE_EXPECTED_NAME,
  expectedUser = process.env.HZENSE_DATABASE_EXPECTED_USER,
  nodeTlsRejectUnauthorized,
  expectedPgvectorVersion = process.env.HZENSE_DATABASE_EXPECTED_PGVECTOR_VERSION,
  connectionTimeoutMillis = 10_000,
} = {}) {
  const policy = validateConnectionTarget({
    connectionString,
    profile,
    expectedHost,
    expectedPort,
    expectedDatabase,
    expectedUser,
    nodeTlsRejectUnauthorized,
  });
  const databaseName = requireString(
    expectedDatabase ?? policy.database,
    'HZENSE_DATABASE_EXPECTED_NAME',
  );
  const userName = requireString(expectedUser ?? policy.user, 'HZENSE_DATABASE_EXPECTED_USER');
  const vectorVersion =
    profile === 'production'
      ? requireString(expectedPgvectorVersion, 'HZENSE_DATABASE_EXPECTED_PGVECTOR_VERSION')
      : expectedPgvectorVersion;

  const migrations = await loadMigrations(migrationDirectory);
  await verifyMigrationManifest(migrations, migrationManifest);
  const client = new Client({
    connectionString,
    application_name: 'hzense-schema-verification',
    connectionTimeoutMillis,
  });
  await client.connect();
  try {
    await client.query("SET statement_timeout = '30s'");
    const identity = await client.query(
      `SELECT current_database() AS database_name,
              session_user AS authenticated_role,
              current_user AS effective_role`,
    );
    const row = identity.rows[0];
    if (
      row?.database_name !== databaseName ||
      row?.authenticated_role !== userName ||
      row?.effective_role !== userName
    ) {
      throw new Error(
        `Database target mismatch; expected ${databaseName}/${userName}, found ${row?.database_name}/${row?.authenticated_role}/${row?.effective_role}`,
      );
    }

    await client.query('BEGIN READ ONLY');
    const result = await collectSchemaProblems(client, migrations, vectorVersion, userName);
    await client.query('ROLLBACK');
    if (result.problems.length > 0) {
      throw new Error(
        `Database contract verification failed: ${result.problems.slice(0, 20).join('; ')}`,
      );
    }

    console.log(
      `[db:verify] verified ${migrations.length} migrations, ${expectedTableNames.size} tables and pgvector ${result.pgvectorVersion}`,
    );
    return {
      database: databaseName,
      user: userName,
      migrationCount: migrations.length,
      tableCount: expectedTableNames.size,
      pgvectorVersion: result.pgvectorVersion,
    };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    await client.end();
  }
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : undefined;

if (invokedPath === import.meta.url) {
  verifyDatabaseContract(productionDatabaseOptions()).catch((error) => {
    const message = error instanceof Error ? error.message : 'unknown error';
    console.error(`[db:verify] ${message}`);
    process.exitCode = 1;
  });
}
