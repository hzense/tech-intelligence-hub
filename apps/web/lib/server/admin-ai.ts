import 'server-only';
import pg from 'pg';
import {
  listAiConnections,
  listAiProfiles,
  listAiProbes,
  resolveAiGenerationAccess,
  resolveAiStageAccess,
  type AiConnection,
  type AiProfile,
  type AiProbe,
} from '../../../../packages/database/src/ai-config-store.mjs';
import {
  AiBackendConfigurationError,
  readAiBackendConfiguration,
  readAiAllowedHosts,
  type AiAdminOperation,
} from '../admin-ai-core';
import { invokeAiProbe } from '../ai-provider';
import { createAiAdminExecutor } from '../admin-ai-service';

let pool: pg.Pool | undefined;
let poolUrl: string | undefined;
const restrictedPool = {
  async connect() {
    const config = readAiBackendConfiguration(process.env);
    if (pool && poolUrl !== config.connectionString) throw new AiBackendConfigurationError();
    if (!pool) {
      poolUrl = config.connectionString;
      pool = new pg.Pool({
        connectionString: poolUrl,
        max: 1,
        idleTimeoutMillis: 10_000,
        connectionTimeoutMillis: 3_500,
        query_timeout: 5_000,
        allowExitOnIdle: true,
        enableChannelBinding: true,
        application_name: 'hzense-ai-config',
      });
      pool.on('error', () =>
        console.error(JSON.stringify({ event: 'ai_config_pool_error', outcome: 'unavailable' })),
      );
    }
    const client = await pool.connect();
    try {
      const result = await client.query(`SELECT current_user,session_user,rolsuper,rolcreaterole,
        rolcreatedb,rolreplication,rolbypassrls,rolinherit,
        EXISTS(SELECT 1 FROM pg_catalog.pg_auth_members WHERE member=r.oid) AS memberships
        FROM pg_catalog.pg_roles r WHERE rolname=current_user`);
      const role = result.rows[0];
      if (
        !role ||
        role.current_user !== 'hzense_ai_admin' ||
        role.session_user !== 'hzense_ai_admin' ||
        [
          'rolsuper',
          'rolcreaterole',
          'rolcreatedb',
          'rolreplication',
          'rolbypassrls',
          'rolinherit',
          'memberships',
        ].some((flag) => role[flag] !== false)
      )
        throw new AiBackendConfigurationError();
      return client;
    } catch {
      client.release(true);
      throw new AiBackendConfigurationError();
    }
  },
};

export interface AiDashboard {
  configured: boolean;
  available: boolean;
  allowedHosts: string[];
  connections: AiConnection[];
  profiles: AiProfile[];
  probes: AiProbe[];
}
/** Call only after page/session authorization. No provider request happens here. */
export async function getAiDashboard(): Promise<AiDashboard> {
  let allowedHosts: string[] = [];
  try {
    allowedHosts = readAiAllowedHosts(process.env.HZENSE_AI_ALLOWED_HOSTS);
  } catch {
    /* fail closed */
  }
  const empty: AiDashboard = {
    configured: false,
    available: false,
    allowedHosts,
    connections: [],
    profiles: [],
    probes: [],
  };
  try {
    readAiBackendConfiguration(process.env);
  } catch {
    return empty;
  }
  try {
    const [connections, profiles, probes] = await Promise.all([
      listAiConnections({ pool: restrictedPool }),
      listAiProfiles({ pool: restrictedPool }),
      listAiProbes({ pool: restrictedPool }),
    ]);
    return { ...empty, configured: true, available: true, connections, profiles, probes };
  } catch {
    return { ...empty, configured: true };
  }
}

export async function executeAiAdmin(
  operation: AiAdminOperation,
  command: Record<string, unknown>,
): Promise<unknown> {
  const config = readAiBackendConfiguration(process.env);
  const execute = createAiAdminExecutor({
    pool: restrictedPool,
    keyring: config.keyring,
    allowedHosts: config.allowedHosts,
    invoke: invokeAiProbe,
  });
  return execute(operation, command);
}

/** Server-only capability resolution; credentials are returned only for an admitted run. */
export async function generationAiAccess(id: string, revision: number, credentials = false) {
  const config = readAiBackendConfiguration(process.env);
  return resolveAiGenerationAccess({
    pool: restrictedPool,
    id,
    revision,
    allowedHosts: config.allowedHosts,
    ...(credentials ? { keyring: config.keyring } : {}),
  });
}

/** Resolve a pinned non-extract stage without exposing its credential to HTTP callers. */
export async function aiStageAccess(
  id: string,
  revision: number,
  stageName: 'verify' | 'analyze',
  credentials = false,
) {
  const config = readAiBackendConfiguration(process.env);
  return resolveAiStageAccess({
    pool: restrictedPool,
    id,
    revision,
    stageName,
    allowedHosts: config.allowedHosts,
    ...(credentials ? { keyring: config.keyring } : {}),
  });
}
