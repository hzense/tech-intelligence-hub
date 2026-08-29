import console from 'node:console';
import process from 'node:process';
import { productionDatabaseOptions, validateConnectionTarget } from './connection-policy.mjs';
import { runMigrations } from './migrate.mjs';
import { inspectDatabasePreflight } from './preflight.mjs';
import { verifyDatabaseContract } from './verify.mjs';

async function runProductionMigration() {
  if (process.env.HZENSE_DATABASE_BASELINE_CHECKSUM) {
    throw new Error(
      'Production migration does not adopt an untracked baseline; use the documented break-glass review path',
    );
  }

  const options = productionDatabaseOptions();
  const policy = validateConnectionTarget(options);
  await runMigrations({
    connectionString: options.connectionString,
    beforeMigrate: (client) =>
      inspectDatabasePreflight(client, { ...options, expectedHost: policy.host }),
  });
  await verifyDatabaseContract(options);
}

runProductionMigration().catch((error) => {
  const message = error instanceof Error ? error.message : 'unknown error';
  console.error(`[db:migrate:production] ${message}`);
  process.exitCode = 1;
});
