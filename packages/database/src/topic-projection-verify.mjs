import console from 'node:console';
import { resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL, URL } from 'node:url';
import pg from 'pg';
import { topicSyncProductionOptions, validateConnectionTarget } from './connection-policy.mjs';
import {
  assertDirectTopicSyncEndpoint,
  inspectTopicSyncPreflight,
} from './topic-sync-preflight.mjs';
import { normalizeDesiredTopics, topicProjectionFingerprint } from './topic-sync.mjs';

const { Client } = pg;
const repositoryRoot = fileURLToPath(new URL('../../../', import.meta.url));
export const authoritativeTopicCount = 62;

function requireFingerprint(value) {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) {
    throw new Error('HZENSE_TOPIC_SYNC_EXPECTED_FINGERPRINT must be a lowercase SHA-256 digest');
  }
  return value;
}

function rawTopicIds(rows, label) {
  if (!Array.isArray(rows)) throw new Error(`${label} must be an array`);
  const ids = new Set();
  for (const [index, row] of rows.entries()) {
    if (!row || typeof row !== 'object' || Array.isArray(row) || typeof row.id !== 'string') {
      throw new Error(`${label}[${index}] must contain a Topic ID`);
    }
    if (ids.has(row.id)) throw new Error(`${label} contains duplicate Topic ID ${row.id}`);
    ids.add(row.id);
  }
  return ids;
}

function mismatchedFields(expected, actual) {
  const fields = [];
  if (expected.title !== actual.title) fields.push('title');
  if (expected.parentId !== actual.parentId) fields.push('parent_id');
  if (expected.status !== actual.status) fields.push('status');
  if (expected.runtimeEnabled !== actual.runtimeEnabled) fields.push('runtime_enabled');
  return fields;
}

export function verifyTopicProjectionRows(
  expectedRows,
  databaseRows,
  { expectedFingerprint, expectedCount = authoritativeTopicCount } = {},
) {
  if (!Number.isSafeInteger(expectedCount) || expectedCount < 1) {
    throw new Error('expectedCount must be a positive integer');
  }
  const reviewedFingerprint = requireFingerprint(expectedFingerprint);
  const expected = normalizeDesiredTopics(expectedRows);
  if (expected.length !== expectedCount) {
    throw new Error(
      `Authoritative Topic projection must contain exactly ${expectedCount} Topics; found ${expected.length}`,
    );
  }

  const sourceFingerprint = topicProjectionFingerprint(expected);
  if (sourceFingerprint !== reviewedFingerprint) {
    throw new Error(
      `Authoritative Topic projection fingerprint mismatch; reviewed ${reviewedFingerprint}, generated ${sourceFingerprint}`,
    );
  }

  const expectedIds = new Set(expected.map((topic) => topic.id));
  const databaseIds = rawTopicIds(databaseRows, 'databaseTopics');
  const unknownIds = [...databaseIds].filter((id) => !expectedIds.has(id)).sort();
  if (unknownIds.length > 0) {
    throw new Error(
      `Database contains ${unknownIds.length} Topic ID(s) outside authoritative Taxonomy: ${unknownIds.join(', ')}`,
    );
  }

  const missingIds = [...expectedIds].filter((id) => !databaseIds.has(id)).sort();
  if (missingIds.length > 0) {
    throw new Error(
      `Database is missing ${missingIds.length} authoritative Topic ID(s): ${missingIds.join(', ')}`,
    );
  }

  const database = normalizeDesiredTopics(databaseRows);
  if (database.length !== expectedCount) {
    throw new Error(
      `Database Topic projection must contain exactly ${expectedCount} Topics; found ${database.length}`,
    );
  }
  const databaseById = new Map(database.map((topic) => [topic.id, topic]));
  const drift = [];
  for (const expectedTopic of expected) {
    const fields = mismatchedFields(expectedTopic, databaseById.get(expectedTopic.id));
    if (fields.length > 0) drift.push(`${expectedTopic.id}:${fields.join(',')}`);
  }
  if (drift.length > 0) {
    throw new Error(`Database Topic projection drift: ${drift.join('; ')}`);
  }

  const databaseFingerprint = topicProjectionFingerprint(database);
  if (databaseFingerprint !== reviewedFingerprint) {
    throw new Error(
      `Database Topic projection fingerprint mismatch; expected ${reviewedFingerprint}, found ${databaseFingerprint}`,
    );
  }

  return {
    verified: true,
    topicCount: database.length,
    unknownTopicCount: 0,
    fingerprint: databaseFingerprint,
  };
}

export async function verifyTopicProjectionReadOnly(
  client,
  expectedRows,
  { expectedFingerprint, expectedCount = authoritativeTopicCount, beforeRead } = {},
) {
  if (!client || typeof client.query !== 'function') {
    throw new Error('Topic projection verification requires a connected PostgreSQL client');
  }

  let transactionOpen = false;
  try {
    await client.query('BEGIN READ ONLY');
    transactionOpen = true;
    await client.query("SET LOCAL statement_timeout = '30s'");
    await client.query("SET LOCAL lock_timeout = '10s'");
    await client.query("SET LOCAL idle_in_transaction_session_timeout = '30s'");
    if (beforeRead) await beforeRead(client);

    const databaseRows = (
      await client.query(
        `SELECT id,
                title,
                parent_id AS "parentId",
                status::text AS status,
                runtime_enabled AS "runtimeEnabled"
         FROM public.topics
         ORDER BY id`,
      )
    ).rows;
    const result = verifyTopicProjectionRows(expectedRows, databaseRows, {
      expectedFingerprint,
      expectedCount,
    });
    await client.query('COMMIT');
    transactionOpen = false;
    return result;
  } catch (error) {
    if (transactionOpen) await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  }
}

export async function runTopicProjectionVerification({
  connectionString,
  expectedTopics,
  expectedFingerprint,
  expectedCount = authoritativeTopicCount,
  connectionTimeoutMillis = 10_000,
  beforeRead,
  createClient = (options) => new Client(options),
} = {}) {
  if (typeof connectionString !== 'string' || connectionString.length === 0) {
    throw new Error('Topic projection verification database connection string is required');
  }
  const client = createClient({
    connectionString,
    application_name: 'hzense-topic-projection-verify',
    connectionTimeoutMillis,
  });
  await client.connect();
  try {
    return await verifyTopicProjectionReadOnly(client, expectedTopics, {
      expectedFingerprint,
      expectedCount,
      beforeRead,
    });
  } finally {
    await client.end();
  }
}

export async function runTopicProjectionVerifyCommand({
  arguments: arguments_ = process.argv.slice(2),
  environment = process.env,
  dependencies,
} = {}) {
  if (arguments_.length > 0) {
    throw new Error('Topic projection verification does not accept command-line arguments');
  }

  const content = dependencies?.content ?? (await import('../../content/dist/src/index.js'));
  const executeVerification =
    dependencies?.runTopicProjectionVerification ?? runTopicProjectionVerification;
  const inspectTarget = dependencies?.inspectTopicSyncPreflight ?? inspectTopicSyncPreflight;
  const contentRoot = resolve(repositoryRoot, 'content');
  const seedRoot = resolve(repositoryRoot, 'data/seed');
  const taxonomyFile = resolve(repositoryRoot, 'data/taxonomy/taxonomy.yaml');

  await content.loadContent({ contentRoot, seedRoot, taxonomyFile });
  const seed = await content.loadSeedCatalog(seedRoot, taxonomyFile);
  const expectedTopics = content.buildTopicDatabaseProjection(seed.taxonomy, seed.topics);
  const sourceFingerprint = topicProjectionFingerprint(expectedTopics);
  const expectedFingerprint = requireFingerprint(
    environment.HZENSE_TOPIC_SYNC_EXPECTED_FINGERPRINT,
  );
  if (sourceFingerprint !== expectedFingerprint) {
    throw new Error(
      `Authoritative Topic projection fingerprint mismatch; reviewed ${expectedFingerprint}, generated ${sourceFingerprint}`,
    );
  }

  const options = topicSyncProductionOptions(environment);
  const policy = validateConnectionTarget(options);
  assertDirectTopicSyncEndpoint(policy.host);
  const result = await executeVerification({
    connectionString: options.connectionString,
    expectedTopics,
    expectedFingerprint,
    expectedCount: authoritativeTopicCount,
    beforeRead: (client) =>
      inspectTarget(client, {
        expectedHost: policy.host,
        expectedDatabase: policy.database,
        expectedUser: policy.user,
        expectedPostgresMajor: options.expectedPostgresMajor,
        expectedConnectionLimit: options.expectedConnectionLimit,
        expectedTransactionReadOnly: true,
        profile: 'production',
      }),
  });

  console.log(`[topic-projection-verify] ${JSON.stringify({ profile: 'production', ...result })}`);
  return result;
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : undefined;
if (invokedPath === import.meta.url) {
  runTopicProjectionVerifyCommand().catch((error) => {
    const message = error instanceof Error ? error.message : 'unknown error';
    console.error(`[topic-projection-verify] ${message}`);
    process.exitCode = 1;
  });
}
