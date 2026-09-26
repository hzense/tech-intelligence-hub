import 'server-only';
import pg from 'pg';
import { readRuntimeReaderConfig } from '../runtime-reader-core';
import { assertAutomationRole } from '../../../../packages/database/src/automation-role.mjs';
import {
  AutomationError,
  freezeAutomationInputs as freeze,
} from '../../../../packages/database/src/automation-store.mjs';

export function automationDatabaseConfiguration(reader = false) {
  if (process.env[reader ? 'HZENSE_TOPIC_INSIGHTS_ENABLED' : 'HZENSE_AUTOMATION_ENABLED'] !== '1')
    throw new AutomationError('not_configured');
  const raw =
    process.env[reader ? 'HZENSE_INSIGHT_READER_DATABASE_URL' : 'HZENSE_AUTOMATION_DATABASE_URL'];
  try {
    if (!raw || raw !== raw.trim()) throw new Error();
    const url = new URL(raw);
    if (
      decodeURIComponent(url.username) !==
      (reader ? 'hzense_insight_reader' : 'hzense_automation_admin')
    )
      throw new Error();
    url.username = 'hzense_runtime';
    readRuntimeReaderConfig({
      ...process.env,
      HZENSE_RUNTIME_DATABASE_URL: url.href,
      HZENSE_RUNTIME_EXPECTED_USER: 'hzense_runtime',
    });
    return raw;
  } catch {
    throw new AutomationError('not_configured');
  }
}
function makePool(reader = false) {
  let pool: pg.Pool | undefined, url: string | undefined;
  return {
    async connect() {
      const next = automationDatabaseConfiguration(reader);
      if (url && next !== url) throw new AutomationError('not_configured');
      if (!pool) {
        url = next;
        pool = new pg.Pool({
          connectionString: url,
          max: 1,
          connectionTimeoutMillis: 3500,
          query_timeout: 15000,
          idleTimeoutMillis: 10000,
          allowExitOnIdle: true,
          enableChannelBinding: true,
          application_name: reader ? 'hzense-public-insights' : 'hzense-private-automation',
        });
        pool.on('error', () => console.error('automation_pool_unavailable'));
      }
      const client = await pool.connect();
      try {
        await assertAutomationRole(client, reader ? 'reader' : 'admin');
        return client;
      } catch (error) {
        client.release(true);
        throw error;
      }
    },
  };
}
export const automationPool = makePool();
export const insightReaderPool = makePool(true);
export async function freezeAutomationInputs(
  owner: string,
  id: string,
  leaseToken: string,
  snapshot: { inputs: unknown[]; [key: string]: unknown },
): Promise<void> {
  await freeze({ pool: automationPool, owner, id, token: leaseToken, snapshot });
}
