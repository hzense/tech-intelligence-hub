import console from 'node:console';
import process from 'node:process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { requireProtectedBackupIdentifier } from '../packages/database/src/backup-declaration.mjs';
import { validateConnectionTarget } from '../packages/database/src/connection-policy.mjs';
import { inspectDatabasePreflight } from '../packages/database/src/preflight.mjs';
import {
  runSearchDocumentSync,
  searchDocumentsFingerprint,
} from '../packages/database/src/search-sync.mjs';

export function parseSearchSyncArguments(arguments_) {
  let profile;
  let apply = false;
  for (const argument of arguments_) {
    if (argument.startsWith('--profile=')) {
      if (profile) throw new Error('Search sync profile may be specified only once');
      profile = argument.slice('--profile='.length);
    } else if (argument === '--apply' && !apply) {
      apply = true;
    } else {
      throw new Error(`Unknown Search sync argument: ${argument}`);
    }
  }
  if (profile !== 'local-test' && profile !== 'production') {
    throw new Error('Search sync requires --profile=local-test or --profile=production');
  }
  return { profile, apply };
}

function requireDigest(value, name) {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) {
    throw new Error(`${name} must be a lowercase SHA-256 digest`);
  }
  return value;
}

export async function runSearchSyncCommand({
  arguments: arguments_ = process.argv.slice(2),
  environment = process.env,
  dependencies,
} = {}) {
  const { profile, apply } = parseSearchSyncArguments(arguments_);
  const connectionString =
    environment.HZENSE_SEARCH_SYNC_DATABASE_URL ??
    (profile === 'production' ? environment.DATABASE_DIRECT_URL : environment.DATABASE_URL);
  const policy = validateConnectionTarget({
    connectionString,
    profile,
    expectedHost: environment.HZENSE_DATABASE_EXPECTED_HOST,
    expectedPort: environment.HZENSE_DATABASE_EXPECTED_PORT,
    expectedDatabase: environment.HZENSE_DATABASE_EXPECTED_NAME,
    expectedUser: environment.HZENSE_DATABASE_EXPECTED_USER,
    nodeTlsRejectUnauthorized: environment.NODE_TLS_REJECT_UNAUTHORIZED,
  });
  const loadProjections =
    dependencies?.getSearchDocumentProjections ??
    (await import('../apps/web/lib/search-runtime.ts')).getSearchDocumentProjections;
  const toDatabaseDocuments =
    dependencies?.toDatabaseSearchDocuments ??
    (await import('../packages/search/dist/src/projection.js')).toDatabaseSearchDocuments;
  const desiredDocuments = toDatabaseDocuments(await loadProjections());
  const fingerprint = searchDocumentsFingerprint(desiredDocuments);
  let expectedPlanFingerprint;
  let backupDeclared = false;
  if (profile === 'production' && apply) {
    const expectedFingerprint = requireDigest(
      environment.HZENSE_SEARCH_SYNC_EXPECTED_FINGERPRINT,
      'HZENSE_SEARCH_SYNC_EXPECTED_FINGERPRINT',
    );
    if (expectedFingerprint !== fingerprint) {
      throw new Error('Search projection fingerprint differs from the reviewed value');
    }
    expectedPlanFingerprint = requireDigest(
      environment.HZENSE_SEARCH_SYNC_EXPECTED_PLAN_FINGERPRINT,
      'HZENSE_SEARCH_SYNC_EXPECTED_PLAN_FINGERPRINT',
    );
    requireProtectedBackupIdentifier(environment.HZENSE_SEARCH_SYNC_BACKUP_ID, {
      environmentName: 'HZENSE_SEARCH_SYNC_BACKUP_ID',
      purpose: 'the new recoverable pre-sync backup',
    });
    backupDeclared = true;
  }
  const execute = dependencies?.runSearchDocumentSync ?? runSearchDocumentSync;
  const inspect = dependencies?.inspectDatabasePreflight ?? inspectDatabasePreflight;
  const result = await execute({
    connectionString,
    desiredDocuments,
    dryRun: !apply,
    expectedProjectionFingerprint: profile === 'production' && apply ? fingerprint : undefined,
    expectedPlanFingerprint,
    beforeSync: async (client) => {
      const inspection = await inspect(client, {
        connectionString,
        profile,
        expectedHost: policy.host,
        expectedPort: policy.port,
        expectedDatabase: policy.database,
        expectedUser: policy.user,
        expectedPgvectorVersion: environment.HZENSE_DATABASE_EXPECTED_PGVECTOR_VERSION,
        expectedPostgresMajor: Number(environment.HZENSE_DATABASE_EXPECTED_POSTGRES_MAJOR ?? '18'),
      });
      if (!Array.isArray(inspection.pendingMigrations) || inspection.pendingMigrations.length > 0) {
        throw new Error('Search sync requires a fully migrated and verified database');
      }
      return inspection;
    },
  });
  console.log(
    `[search-sync] ${JSON.stringify({ profile, ...result, productionBackupDeclarationProvided: backupDeclared })}`,
  );
  return result;
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : undefined;
if (invokedPath === import.meta.url) {
  runSearchSyncCommand().catch((error) => {
    console.error(`[search-sync] ${error instanceof Error ? error.message : 'unknown error'}`);
    process.exitCode = 1;
  });
}
