import 'server-only';
import pg from 'pg';
import {
  listSignalWorkbench,
  getSignalWorkbenchDetail,
} from '../../../../packages/database/src/signal-workbench-store.mjs';
import {
  SignalWorkbenchError,
  parseSignalWorkbenchListRequest,
  parseSignalWorkbenchDetailRequest,
} from '../../../../packages/database/src/signal-workbench-contract.mjs';
import {
  SignalWorkbenchConfigurationError,
  SignalWorkbenchQueryError,
  parseSignalWorkbenchQuery,
  readSignalWorkbenchConfiguration,
  type SignalWorkbenchOperation,
} from '../admin-signal-workbench-core';
import type {
  SignalWorkbenchListState,
  SignalWorkbenchDetailState,
} from '../../components/admin-signal-workbench';

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

/** Call only after page/session authorization. No Seed fallback or side effects. */
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

function failureState(
  error: unknown,
): 'invalid_request' | 'not_configured' | 'unavailable' | 'not_found' | 'incompatible_data' {
  if (error instanceof SignalWorkbenchConfigurationError) return 'not_configured';
  if (error instanceof SignalWorkbenchQueryError) return 'invalid_request';
  if (error instanceof SignalWorkbenchError) {
    if (error.code === 'not_found') return 'not_found';
    if (error.code === 'invalid_request') return 'invalid_request';
    if (error.code === 'incompatible_data') return 'incompatible_data';
  }
  return 'unavailable';
}

export async function getSignalWorkbenchList(
  params: URLSearchParams,
): Promise<SignalWorkbenchListState> {
  try {
    const request = parseSignalWorkbenchListRequest(parseSignalWorkbenchQuery(params, 'list'));
    readSignalWorkbenchConfiguration(process.env);
    return { status: 'ready', data: await listSignalWorkbench({ pool: restrictedPool, request }) };
  } catch (error) {
    const status = failureState(error);
    return { status: status === 'not_found' ? 'unavailable' : status };
  }
}

export async function getSignalWorkbenchDetailState(
  id: string,
  params: URLSearchParams,
): Promise<SignalWorkbenchDetailState> {
  try {
    const request = parseSignalWorkbenchDetailRequest(
      parseSignalWorkbenchQuery(params, 'detail', id),
    );
    readSignalWorkbenchConfiguration(process.env);
    return {
      status: 'ready',
      data: await getSignalWorkbenchDetail({ pool: restrictedPool, request }),
    };
  } catch (error) {
    return { status: failureState(error) };
  }
}
