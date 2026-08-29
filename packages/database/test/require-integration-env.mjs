import console from 'node:console';
import process from 'node:process';
import { validateConnectionTarget } from '../src/connection-policy.mjs';

if (!process.env.MIGRATION_TEST_ADMIN_URL) {
  console.error(
    'MIGRATION_TEST_ADMIN_URL is required for the PostgreSQL migration integration suite',
  );
  process.exitCode = 1;
} else {
  try {
    validateConnectionTarget({
      connectionString: process.env.MIGRATION_TEST_ADMIN_URL,
      profile: 'local-test',
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'invalid URL';
    console.error(`Unsafe MIGRATION_TEST_ADMIN_URL: ${message}`);
    process.exitCode = 1;
  }
}
