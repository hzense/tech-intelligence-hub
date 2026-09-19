import 'server-only';
import pg from 'pg';
import { assertImportRole } from '../../../../packages/database/src/import-role.mjs';
import { readRuntimeReaderConfig } from '../runtime-reader-core';

// Generation consumes parsed private data only; it needs neither Blob credentials
// nor the parser snapshot, upload switch or an original-file retention policy.
export function generationImportConfiguration(env = process.env) {
  const connectionString = env.HZENSE_IMPORT_DATABASE_URL;
  if (!connectionString || /\s/.test(connectionString)) throw new Error('not_configured');
  const url = new URL(connectionString);
  if (decodeURIComponent(url.username) !== 'hzense_import_admin') throw new Error('not_configured');
  url.username = 'hzense_runtime';
  readRuntimeReaderConfig({ ...env, HZENSE_RUNTIME_DATABASE_URL: url.toString() });
  return { connectionString };
}
export function importsConfigured() {
  try {
    generationImportConfiguration();
    return true;
  } catch {
    return false;
  }
}
let pool: pg.Pool | undefined;
let poolUrl: string | undefined;
export const importPool = {
  async connect() {
    const { connectionString } = generationImportConfiguration();
    if (poolUrl && poolUrl !== connectionString) throw new Error('not_configured');
    if (!pool) {
      poolUrl = connectionString;
      pool = new pg.Pool({
        connectionString,
        max: 1,
        idleTimeoutMillis: 10000,
        connectionTimeoutMillis: 3500,
        query_timeout: 15000,
        allowExitOnIdle: true,
        enableChannelBinding: true,
        application_name: 'hzense-generation-source',
      });
      pool.on('error', () => console.error('generation_source_unavailable'));
    }
    const client = await pool.connect();
    try {
      await assertImportRole(client);
      return client;
    } catch (error) {
      client.release(true);
      throw error;
    }
  },
};
