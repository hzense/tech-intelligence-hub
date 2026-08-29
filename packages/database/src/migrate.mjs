import { createHash } from 'node:crypto';
import console from 'node:console';
import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL, URL } from 'node:url';
import pg from 'pg';

const { Client } = pg;

const migrationDirectory = fileURLToPath(new URL('../../../db/migrations/', import.meta.url));
const migrationManifestPath = fileURLToPath(
  new URL('../../../db/migrations/checksums.json', import.meta.url),
);
const migrationNamePattern = /^\d{4}_[a-z0-9_]+\.sql$/;
const foundationMigrationName = '0000_foundation.sql';
export const migrationLockKeys = [1_215_921_955, 1_298_498_925];

const foundationColumns = {
  topics: ['id', 'title', 'parent_id', 'status', 'metadata'],
  entities: ['id', 'type', 'name', 'status', 'aliases', 'metadata', 'created_at', 'updated_at'],
  sources: ['id', 'name', 'type', 'url', 'trust_score', 'active'],
  signals: [
    'id',
    'title',
    'type',
    'status',
    'occurred_at',
    'captured_at',
    'source_id',
    'summary',
    'importance',
    'strength',
    'confidence',
    'novelty',
    'metadata',
  ],
  entity_topics: ['entity_id', 'topic_id'],
  signal_topics: ['signal_id', 'topic_id'],
  signal_entities: ['signal_id', 'entity_id'],
  relations: [
    'id',
    'source_id',
    'relation_type',
    'target_id',
    'confidence',
    'valid_from',
    'valid_to',
    'source_refs',
    'metadata',
  ],
  radar_snapshots: [
    'id',
    'topic_id',
    'snapshot_date',
    'attention',
    'trend',
    'maturity',
    'strategic_value',
    'confidence',
  ],
  content_registry: ['id', 'content_type', 'path', 'status', 'published_at', 'updated_at'],
  search_documents: [
    'id',
    'source_id',
    'source_type',
    'title',
    'body',
    'importance',
    'document_date',
    'topics',
    'entities',
    'embedding',
  ],
};

const foundationEnums = {
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
};

export function migrationChecksum(sql) {
  return createHash('sha256').update(sql).digest('hex');
}

export async function verifyMigrationManifest(migrations, manifestPath = migrationManifestPath) {
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  const expectedNames = Object.keys(manifest).sort();
  const actualNames = migrations.map((migration) => migration.name);

  if (expectedNames.join(',') !== actualNames.join(',')) {
    throw new Error(
      `Migration checksum manifest does not match SQL files; expected ${expectedNames.join(', ')}, found ${actualNames.join(', ')}`,
    );
  }

  for (const migration of migrations) {
    if (manifest[migration.name] !== migration.checksum) {
      throw new Error(
        `Migration checksum manifest mismatch for ${migration.name}; applied migrations are append-only`,
      );
    }
  }
}

export async function loadMigrations(directory = migrationDirectory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const invalidSqlNames = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.sql'))
    .map((entry) => entry.name)
    .filter((name) => !migrationNamePattern.test(name));

  if (invalidSqlNames.length > 0) {
    throw new Error(
      `Migration filenames must match NNNN_name.sql: ${invalidSqlNames.sort().join(', ')}`,
    );
  }

  const names = entries
    .filter((entry) => entry.isFile() && migrationNamePattern.test(entry.name))
    .map((entry) => entry.name)
    .sort();

  if (names.length === 0) {
    throw new Error(`No SQL migrations found in ${directory}`);
  }

  const prefixes = new Map();
  for (const name of names) {
    const prefix = name.slice(0, 4);
    const existing = prefixes.get(prefix);
    if (existing) {
      throw new Error(`Duplicate migration prefix ${prefix}: ${existing}, ${name}`);
    }
    prefixes.set(prefix, name);
  }

  return Promise.all(
    names.map(async (name) => {
      const sql = await readFile(resolve(directory, name), 'utf8');
      return { name, sql, checksum: migrationChecksum(sql) };
    }),
  );
}

export function planPendingMigrations(migrations, appliedRows) {
  const migrationByName = new Map(migrations.map((migration) => [migration.name, migration]));
  const appliedByName = new Map(appliedRows.map((migration) => [migration.name, migration]));

  for (const applied of appliedRows) {
    const local = migrationByName.get(applied.name);
    if (!local) {
      throw new Error(
        `Database contains migration ${applied.name}, but the SQL file is missing locally`,
      );
    }
    if (local.checksum !== applied.checksum) {
      throw new Error(
        `Checksum mismatch for applied migration ${applied.name}; never edit an applied migration`,
      );
    }
  }

  let pendingSeen = false;
  for (const migration of migrations) {
    if (!appliedByName.has(migration.name)) {
      pendingSeen = true;
      continue;
    }
    if (pendingSeen) {
      throw new Error(
        `Applied migration ${migration.name} appears after an unapplied migration; repair migration history before continuing`,
      );
    }
  }

  return migrations.filter((migration) => !appliedByName.has(migration.name));
}

async function inspectFoundationSchema(client) {
  const schemaResult = await client.query('SELECT current_schema() AS name');
  const schemaName = schemaResult.rows[0]?.name;
  if (typeof schemaName !== 'string' || schemaName.length === 0) {
    throw new Error('PostgreSQL did not return a current schema');
  }

  const tableNames = Object.keys(foundationColumns);
  const columnResult = await client.query(
    `SELECT table_name, column_name
     FROM information_schema.columns
     WHERE table_schema = $1 AND table_name = ANY($2::text[])`,
    [schemaName, tableNames],
  );
  const presentColumns = new Set(
    columnResult.rows.map((row) => `${row.table_name}.${row.column_name}`),
  );

  const enumNames = Object.keys(foundationEnums);
  const enumResult = await client.query(
    `SELECT type_info.typname AS name,
            array_agg(enum_value.enumlabel::text ORDER BY enum_value.enumsortorder) AS labels
     FROM pg_type AS type_info
     JOIN pg_enum AS enum_value ON enum_value.enumtypid = type_info.oid
     JOIN pg_namespace AS namespace_info ON namespace_info.oid = type_info.typnamespace
     WHERE namespace_info.nspname = $1 AND type_info.typname = ANY($2::text[])
     GROUP BY type_info.typname`,
    [schemaName, enumNames],
  );
  const presentEnums = new Map(enumResult.rows.map((row) => [row.name, row.labels]));

  if (presentColumns.size === 0 && presentEnums.size === 0) {
    return { state: 'absent', problems: [] };
  }

  const problems = [];
  for (const [tableName, columns] of Object.entries(foundationColumns)) {
    for (const column of columns) {
      if (!presentColumns.has(`${tableName}.${column}`)) {
        problems.push(`missing ${tableName}.${column}`);
      }
    }
  }

  for (const [enumName, expectedLabels] of Object.entries(foundationEnums)) {
    const labels = presentEnums.get(enumName);
    if (!Array.isArray(labels)) {
      problems.push(`missing enum ${enumName}`);
      continue;
    }
    if (labels.join(',') !== expectedLabels.join(',')) {
      problems.push(`enum ${enumName} has unexpected labels`);
    }
  }

  const extensionResult = await client.query(
    "SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'vector') AS present",
  );
  if (extensionResult.rows[0]?.present !== true) {
    problems.push('missing vector extension');
  }

  return {
    state: problems.length === 0 ? 'complete' : 'partial',
    problems,
  };
}

export function shouldAdoptFoundation(inspection, baselineChecksum, foundation) {
  if (inspection.state === 'absent') {
    if (baselineChecksum) {
      throw new Error(
        'HZENSE_DATABASE_BASELINE_CHECKSUM was provided, but no foundation schema exists',
      );
    }
    return false;
  }
  if (inspection.state === 'partial') {
    const details = inspection.problems.slice(0, 12).join('; ');
    throw new Error(
      `Found an untracked partial foundation schema (${details}). Repair it before migrating`,
    );
  }
  if (baselineChecksum !== foundation.checksum) {
    throw new Error(
      `An untracked foundation schema already exists. Set HZENSE_DATABASE_BASELINE_CHECKSUM to the SHA-256 of the exact ${foundation.name} that created it before adopting the baseline`,
    );
  }
  return true;
}

async function adoptFoundationIfNeeded(client, migrations, appliedRows, baselineChecksum) {
  if (appliedRows.length > 0) return appliedRows;

  const foundation = migrations.find((migration) => migration.name === foundationMigrationName);
  if (!foundation) {
    throw new Error(`Required migration ${foundationMigrationName} is missing`);
  }

  const inspection = await inspectFoundationSchema(client);
  if (!shouldAdoptFoundation(inspection, baselineChecksum, foundation)) {
    return appliedRows;
  }

  await client.query('BEGIN');
  try {
    await client.query(
      `INSERT INTO hzense_schema_migrations (name, checksum)
       VALUES ($1, $2)`,
      [foundation.name, foundation.checksum],
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }

  console.log(`[db:migrate] adopted explicitly declared schema as ${foundation.name}`);
  return [{ name: foundation.name, checksum: foundation.checksum }];
}

export async function runMigrations({
  connectionString = process.env.DATABASE_URL,
  directory = migrationDirectory,
  baselineChecksum = process.env.HZENSE_DATABASE_BASELINE_CHECKSUM,
  connectionTimeoutMillis = 10_000,
  manifestPath = directory === migrationDirectory ? migrationManifestPath : undefined,
  beforeMigrate,
} = {}) {
  if (!connectionString) {
    throw new Error('DATABASE_URL is required');
  }

  const migrations = await loadMigrations(directory);
  if (manifestPath) {
    await verifyMigrationManifest(migrations, manifestPath);
  }
  const client = new Client({
    connectionString,
    application_name: 'hzense-schema-migrations',
    connectionTimeoutMillis,
  });
  let locked = false;

  await client.connect();
  try {
    if (beforeMigrate) {
      await beforeMigrate(client);
    }
    await client.query('SET search_path TO public');
    const lockResult = await client.query(
      'SELECT pg_try_advisory_lock($1, $2) AS locked',
      migrationLockKeys,
    );
    locked = lockResult.rows[0]?.locked === true;
    if (!locked) {
      throw new Error('Another database migration process currently holds the lock');
    }

    await client.query(`
      CREATE TABLE IF NOT EXISTS hzense_schema_migrations (
        name text PRIMARY KEY,
        checksum text NOT NULL CHECK (length(checksum) = 64),
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `);

    let appliedRows = (
      await client.query('SELECT name, checksum FROM hzense_schema_migrations ORDER BY name')
    ).rows;
    appliedRows = await adoptFoundationIfNeeded(client, migrations, appliedRows, baselineChecksum);

    const pending = planPendingMigrations(migrations, appliedRows);
    for (const migration of pending) {
      console.log(`[db:migrate] applying ${migration.name}`);
      await client.query('BEGIN');
      try {
        await client.query("SET LOCAL lock_timeout = '10s'");
        await client.query("SET LOCAL statement_timeout = '5min'");
        await client.query("SET LOCAL idle_in_transaction_session_timeout = '5min'");
        await client.query(migration.sql);
        await client.query(
          `INSERT INTO hzense_schema_migrations (name, checksum)
           VALUES ($1, $2)`,
          [migration.name, migration.checksum],
        );
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        const message = error instanceof Error ? error.message : 'unknown PostgreSQL error';
        throw new Error(`Migration ${migration.name} failed: ${message}`, {
          cause: error,
        });
      }
      console.log(`[db:migrate] applied ${migration.name}`);
    }

    if (pending.length === 0) {
      console.log('[db:migrate] database is already up to date');
    }
  } finally {
    if (locked) {
      await client
        .query('SELECT pg_advisory_unlock($1, $2)', migrationLockKeys)
        .catch(() => undefined);
    }
    await client.end();
  }
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : undefined;

if (invokedPath === import.meta.url) {
  runMigrations().catch((error) => {
    const message = error instanceof Error ? error.message : 'unknown error';
    console.error(`[db:migrate] ${message}`);
    process.exitCode = 1;
  });
}
