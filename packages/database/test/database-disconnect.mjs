import { performance } from 'node:perf_hooks';
import { setTimeout as delay } from 'node:timers/promises';

// Test-only teardown barrier. pg-pool can resolve end() after removing clients
// from its bookkeeping but before their asynchronous socket close completes.
// Observe every connection to this exact fixture database, including clients
// discarded earlier or owned by a secondary pool. Never kill a closing client.
// The administrator must query in autocommit so each observation is fresh.
export async function waitForDatabaseDisconnects(
  administrator,
  databaseName,
  { timeoutMs = 5000 } = {},
) {
  if (!Number.isFinite(timeoutMs) || timeoutMs < 0)
    throw new Error('Invalid database disconnect timeout');
  const deadline = performance.now() + timeoutMs;
  for (;;) {
    const result = await administrator.query(
      `SELECT NOT EXISTS (
         SELECT 1 FROM pg_catalog.pg_stat_activity
         WHERE datname=$1 AND pid<>pg_catalog.pg_backend_pid()
       ) AS disconnected`,
      [databaseName],
    );
    const disconnected = result.rows[0]?.disconnected;
    if (disconnected === true) return;
    if (disconnected !== false) throw new Error('Invalid database connection observation');
    if (performance.now() >= deadline)
      throw new Error('Isolated test database still has open connections');
    await delay(Math.min(10, Math.max(0, deadline - performance.now())));
  }
}
