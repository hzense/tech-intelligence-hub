import console from 'node:console';
import { resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL, URL } from 'node:url';
import {
  topicSyncProductionOptions,
  validateConnectionTarget,
} from '../packages/database/src/connection-policy.mjs';
import {
  assertDirectTopicSyncEndpoint,
  inspectTopicSyncPreflight,
} from '../packages/database/src/topic-sync-preflight.mjs';
import { runTopicSync, topicProjectionFingerprint } from '../packages/database/src/topic-sync.mjs';

const repositoryRoot = fileURLToPath(new URL('../', import.meta.url));

function requireString(value, label) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${label} is required`);
  }
  return value.trim();
}

function positiveInteger(value, label) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new Error(`${label} must be a positive integer`);
  }
  return parsed;
}

export function parseTopicSyncArguments(arguments_) {
  const allowed = new Set(['--apply']);
  let profile;
  let apply = false;
  for (const argument of arguments_) {
    if (argument.startsWith('--profile=')) {
      if (profile !== undefined) throw new Error('Topic sync profile may be specified only once');
      profile = argument.slice('--profile='.length);
      continue;
    }
    if (allowed.has(argument)) {
      if (apply) throw new Error('--apply may be specified only once');
      apply = true;
      continue;
    }
    throw new Error(`Unknown Topic sync argument: ${argument}`);
  }
  if (profile !== 'local-test' && profile !== 'production') {
    throw new Error('Topic sync requires --profile=local-test or --profile=production');
  }
  return { profile, apply };
}

function localTopicSyncOptions(environment) {
  const connectionString = environment.HZENSE_TOPIC_SYNC_DATABASE_URL ?? environment.DATABASE_URL;
  const policy = validateConnectionTarget({ connectionString, profile: 'local-test' });
  return {
    connectionString,
    profile: 'local-test',
    expectedHost: policy.host,
    expectedPort: policy.port,
    expectedDatabase: policy.database,
    expectedUser: policy.user,
    expectedPostgresMajor: positiveInteger(
      environment.HZENSE_TOPIC_SYNC_EXPECTED_POSTGRES_MAJOR ?? '18',
      'HZENSE_TOPIC_SYNC_EXPECTED_POSTGRES_MAJOR',
    ),
    expectedConnectionLimit: positiveInteger(
      environment.HZENSE_TOPIC_SYNC_EXPECTED_CONNECTION_LIMIT ?? '2',
      'HZENSE_TOPIC_SYNC_EXPECTED_CONNECTION_LIMIT',
    ),
  };
}

export function assertProductionApplyGuards(environment, fingerprint) {
  const expectedFingerprint = requireString(
    environment.HZENSE_TOPIC_SYNC_EXPECTED_FINGERPRINT,
    'HZENSE_TOPIC_SYNC_EXPECTED_FINGERPRINT',
  );
  if (!/^[a-f0-9]{64}$/.test(expectedFingerprint)) {
    throw new Error('HZENSE_TOPIC_SYNC_EXPECTED_FINGERPRINT must be a lowercase SHA-256 digest');
  }
  if (expectedFingerprint !== fingerprint) {
    throw new Error(
      `Topic projection fingerprint mismatch; reviewed ${expectedFingerprint}, generated ${fingerprint}`,
    );
  }
  const expectedPlanFingerprint = requireString(
    environment.HZENSE_TOPIC_SYNC_EXPECTED_PLAN_FINGERPRINT,
    'HZENSE_TOPIC_SYNC_EXPECTED_PLAN_FINGERPRINT',
  );
  if (!/^[a-f0-9]{64}$/.test(expectedPlanFingerprint)) {
    throw new Error(
      'HZENSE_TOPIC_SYNC_EXPECTED_PLAN_FINGERPRINT must be a lowercase SHA-256 digest',
    );
  }
  const backupId = requireString(
    environment.HZENSE_TOPIC_SYNC_BACKUP_ID,
    'HZENSE_TOPIC_SYNC_BACKUP_ID',
  );
  if (
    !/^[A-Za-z0-9][A-Za-z0-9._:/-]{7,255}$/.test(backupId) ||
    /^(?:none|null|todo|pending|placeholder)$/i.test(backupId)
  ) {
    throw new Error(
      'HZENSE_TOPIC_SYNC_BACKUP_ID must identify the new recoverable pre-sync backup',
    );
  }
  return { expectedProjectionFingerprint: expectedFingerprint, expectedPlanFingerprint, backupId };
}

export async function runTopicSyncCommand({
  arguments: arguments_ = process.argv.slice(2),
  environment = process.env,
  dependencies,
} = {}) {
  const { profile, apply } = parseTopicSyncArguments(arguments_);
  const content = dependencies ?? (await import('../packages/content/dist/src/index.js'));
  const executeTopicSync = dependencies?.runTopicSync ?? runTopicSync;
  const inspectSyncTarget = dependencies?.inspectTopicSyncPreflight ?? inspectTopicSyncPreflight;
  const contentRoot = resolve(repositoryRoot, 'content');
  const seedRoot = resolve(repositoryRoot, 'data/seed');
  const taxonomyFile = resolve(repositoryRoot, 'data/taxonomy/taxonomy.yaml');

  await content.loadContent({ contentRoot, seedRoot, taxonomyFile });
  const seed = await content.loadSeedCatalog(seedRoot, taxonomyFile);
  const desiredTopics = content.buildTopicDatabaseProjection(seed.taxonomy, seed.topics);
  const fingerprint = topicProjectionFingerprint(desiredTopics);

  const options =
    profile === 'production'
      ? topicSyncProductionOptions(environment)
      : localTopicSyncOptions(environment);
  const policy = validateConnectionTarget(options);
  if (profile === 'production') assertDirectTopicSyncEndpoint(policy.host);
  const productionGuards =
    profile === 'production' && apply
      ? assertProductionApplyGuards(environment, fingerprint)
      : undefined;

  const result = await executeTopicSync({
    connectionString: options.connectionString,
    desiredTopics,
    dryRun: !apply,
    expectedProjectionFingerprint: productionGuards?.expectedProjectionFingerprint,
    expectedPlanFingerprint: productionGuards?.expectedPlanFingerprint,
    beforeSync: async (client) => {
      await client.query("SET statement_timeout = '30s'");
      let inspection;
      try {
        inspection = await inspectSyncTarget(client, {
          expectedHost: policy.host,
          expectedDatabase: policy.database,
          expectedUser: policy.user,
          expectedPostgresMajor: options.expectedPostgresMajor,
          expectedConnectionLimit: options.expectedConnectionLimit,
          profile,
        });
      } catch (error) {
        await client.query('RESET statement_timeout').catch(() => undefined);
        throw error;
      }
      await client.query('RESET statement_timeout');
      return inspection;
    },
  });

  console.log(
    `[topic-sync] ${JSON.stringify({
      profile,
      ...result,
      productionBackupDeclarationProvided: productionGuards !== undefined,
    })}`,
  );
  return result;
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : undefined;
if (invokedPath === import.meta.url) {
  runTopicSyncCommand().catch((error) => {
    const message = error instanceof Error ? error.message : 'unknown error';
    console.error(`[topic-sync] ${message}`);
    process.exitCode = 1;
  });
}
