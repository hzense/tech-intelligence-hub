import 'server-only';
import pg from 'pg';
import {
  listSignalWorkbench,
  getSignalWorkbenchDetail,
} from '../../../../packages/database/src/signal-workbench-store.mjs';
import {
  parseSignalWorkbenchListRequest,
  parseSignalWorkbenchDetailRequest,
} from '../../../../packages/database/src/signal-workbench-contract.mjs';
import {
  SignalWorkbenchConfigurationError,
  readSignalWorkbenchConfiguration,
  type SignalWorkbenchOperation,
} from '../admin-signal-workbench-core';

let pool: pg.Pool | undefined;
let configuredUrl: string | undefined;
const restrictedPool = {
  async connect() {
    const { connectionString } = readSignalWorkbenchConfiguration(process.env);
    if (pool && connectionString !== configuredUrl) throw new SignalWorkbenchConfigurationError();
    if (!pool) {
      configuredUrl = connectionString;
      pool = new pg.Pool({
        connectionString,
        max: 1,
        idleTimeoutMillis: 10_000,
        connectionTimeoutMillis: 3_500,
        query_timeout: 5_000,
        allowExitOnIdle: true,
        enableChannelBinding: true,
        application_name: 'hzense-signal-workbench',
      });
      pool.on('error', () =>
        console.error(
          JSON.stringify({ event: 'signal_workbench_pool_error', outcome: 'unavailable' }),
        ),
      );
    }
    // The store verifies identity and effective column/function ACL inside its
    // READ ONLY REPEATABLE READ transaction before fetching any private rows.
    return pool.connect();
  },
};

/** Call only after administrator API authorization. No Seed fallback or side effects. */
export async function executeSignalWorkbench(
  operation: SignalWorkbenchOperation,
  command: Record<string, unknown>,
) {
  readSignalWorkbenchConfiguration(process.env);
  if (operation === 'list')
    return listSignalWorkbench({
      pool: restrictedPool,
      request: parseSignalWorkbenchListRequest(command),
    });
  return getSignalWorkbenchDetail({
    pool: restrictedPool,
    request: parseSignalWorkbenchDetailRequest(command),
  });
}
