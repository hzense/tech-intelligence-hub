import 'server-only';
import pg from 'pg';
import {
  publishVerifiedSignal,
  withdrawPublicSignal,
  PublicPublicationError,
} from '../../../../packages/database/src/signal-publication-service-store.mjs';
import {
  PublisherConfigurationError,
  PublicationOutcomeUnknownError,
  readPublisherConfiguration,
  type PublicationOperation,
} from '../admin-publication-core';

let pool: pg.Pool | undefined;
let configuredUrl: string | undefined;
function publisherPool() {
  const connectionString = readPublisherConfiguration(process.env);
  if (pool && connectionString !== configuredUrl) throw new PublisherConfigurationError();
  if (!pool) {
    configuredUrl = connectionString;
    pool = new pg.Pool({
      connectionString,
      max: 1,
      idleTimeoutMillis: 10_000,
      connectionTimeoutMillis: 3_500,
      query_timeout: 20_000,
      allowExitOnIdle: true,
      enableChannelBinding: true,
      application_name: 'hzense-restricted-publisher',
    });
    pool.on('error', () =>
      console.error(JSON.stringify({ event: 'publisher_pool_error', outcome: 'unavailable' })),
    );
  }
  return pool;
}

// Validate authenticated database identity on every checked-out connection. The
// application cannot silently use an owner/migrator role with wider privileges.
const restrictedPool = {
  async connect() {
    const client = await publisherPool().connect();
    try {
      const result = await client.query(`SELECT current_user,session_user,rolsuper,rolcreaterole,
        rolcreatedb,rolreplication,rolbypassrls,rolinherit
        FROM pg_catalog.pg_roles WHERE rolname=current_user`);
      const role = result.rows[0];
      if (
        !role ||
        role.current_user !== 'hzense_publisher' ||
        role.session_user !== 'hzense_publisher' ||
        [
          role.rolsuper,
          role.rolcreaterole,
          role.rolcreatedb,
          role.rolreplication,
          role.rolbypassrls,
          role.rolinherit,
        ].some((flag) => flag !== false)
      ) {
        throw new PublisherConfigurationError();
      }
      return client;
    } catch {
      client.release(true);
      throw new PublisherConfigurationError();
    }
  },
};

export function isPublisherConfigured() {
  try {
    readPublisherConfiguration(process.env);
    return true;
  } catch {
    return false;
  }
}

export async function executeSignalPublication(
  operation: PublicationOperation,
  request: Record<string, unknown>,
) {
  readPublisherConfiguration(process.env);
  // Avoid accepting a public publication while the website still serves legacy
  // Signals. Emergency withdrawal remains available independently of read mode.
  if (operation === 'publish' && process.env.HZENSE_SIGNAL_READ_MODE !== 'database')
    throw new PublisherConfigurationError();
  try {
    return await (operation === 'publish'
      ? publishVerifiedSignal({ pool: restrictedPool, request })
      : withdrawPublicSignal({ pool: restrictedPool, request }));
  } catch (error) {
    // Includes an ambiguous COMMIT response or a post-commit visibility read.
    // Do not tell the caller the write was rolled back when it may have committed.
    if (error instanceof PublicPublicationError && error.code === 'database_unavailable')
      throw new PublicationOutcomeUnknownError();
    throw error;
  }
}
