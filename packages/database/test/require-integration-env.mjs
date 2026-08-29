import console from 'node:console';
import process from 'node:process';

if (!process.env.MIGRATION_TEST_ADMIN_URL) {
  console.error(
    'MIGRATION_TEST_ADMIN_URL is required for the PostgreSQL migration integration suite',
  );
  process.exitCode = 1;
}
