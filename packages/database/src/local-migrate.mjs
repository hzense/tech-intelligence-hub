import console from 'node:console';
import process from 'node:process';
import { validateConnectionTarget } from './connection-policy.mjs';
import { runMigrations } from './migrate.mjs';

const connectionString = process.env.DATABASE_URL;

try {
  validateConnectionTarget({ connectionString, profile: 'local-test' });
  await runMigrations({ connectionString });
} catch (error) {
  const message = error instanceof Error ? error.message : 'unknown error';
  console.error(`[db:migrate:local] ${message}`);
  process.exitCode = 1;
}
