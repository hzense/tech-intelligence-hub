import 'server-only';
import pg from 'pg';
import {
  assertGenerationRole,
  assertGenerationHistoryRole,
  assertCandidateEnrichmentRole,
} from '../../../../packages/database/src/signal-generation-role.mjs';
import { readGenerationDatabaseConfiguration } from '../signal-generation-config';
import { GenerationError } from '../signal-generation-core';

type PoolState = { connectionString: string; pool: pg.Pool };
const cacheKey = Symbol.for('hzense.generation-database.pools.v1');
const shared = globalThis as typeof globalThis & {
  [cacheKey]?: WeakMap<typeof pg.Pool, PoolState>;
};

function sharedPool() {
  const { connectionString } = readGenerationDatabaseConfiguration(process.env);
  // Next route bundles and development HMR can evaluate this module repeatedly.
  // Cache at process scope, not module scope. The driver key also isolates test
  // drivers without allowing URL changes to silently redirect an existing pool.
  const pools = (shared[cacheKey] ??= new WeakMap());
  let state = pools.get(pg.Pool);
  if (state && state.connectionString !== connectionString)
    throw new GenerationError('not_configured');
  if (!state) {
    const pool = new pg.Pool({
      connectionString,
      max: 1,
      idleTimeoutMillis: 10000,
      connectionTimeoutMillis: 3500,
      query_timeout: 15000,
      allowExitOnIdle: true,
      enableChannelBinding: true,
      application_name: 'hzense-private-generation',
    });
    pool.on('error', () => console.error('generation_pool_unavailable'));
    state = { connectionString, pool };
    pools.set(pg.Pool, state);
  }
  return state.pool;
}

function guardedPool(assertRole: (client: pg.PoolClient) => Promise<void>) {
  return {
    async connect() {
      const client = await sharedPool().connect();
      try {
        // Sharing connections does not share authorization decisions. Recheck
        // each operation's original role contract on every acquired client.
        await assertRole(client);
        return client;
      } catch (error) {
        client.release(true);
        throw error;
      }
    },
  };
}

export const generationPool = guardedPool(assertGenerationRole);
export const generationHistoryPool = guardedPool(assertGenerationHistoryRole);
export const candidateEnrichmentPool = guardedPool(assertCandidateEnrichmentRole);
