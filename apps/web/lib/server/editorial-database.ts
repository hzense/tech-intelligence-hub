import 'server-only';
import pg from 'pg';
import { assertEditorialRole } from '../../../../packages/database/src/editorial-signal-role.mjs';
import { readCandidateRoleConfiguration } from '../candidate-review-config';

let pool: pg.Pool | undefined;
let poolUrl: string | undefined;
function writerUrl() {
  return readCandidateRoleConfiguration(
    process.env,
    'HZENSE_EDITORIAL_DATABASE_URL',
    'hzense_editorial_writer',
  );
}
export function editorialPublicationEnabled() {
  if (process.env.HZENSE_EDITORIAL_PUBLICATION_ENABLED !== '1') return false;
  try {
    writerUrl();
    readCandidateRoleConfiguration(
      process.env,
      'HZENSE_EDITORIAL_READER_DATABASE_URL',
      'hzense_editorial_reader',
    );
    return true;
  } catch {
    return false;
  }
}
export const editorialPool = {
  async connect() {
    const url = writerUrl();
    if (poolUrl && poolUrl !== url)
      throw Object.assign(new Error('not_configured'), { code: 'not_configured' });
    if (!pool) {
      poolUrl = url;
      pool = new pg.Pool({
        connectionString: url,
        max: 2,
        idleTimeoutMillis: 10000,
        connectionTimeoutMillis: 3500,
        query_timeout: 20000,
        allowExitOnIdle: true,
        enableChannelBinding: true,
        application_name: 'hzense-editorial-writer',
      });
      pool.on('error', () => console.error('editorial_database_unavailable'));
    }
    const client = await pool.connect();
    try {
      await assertEditorialRole(client, 'writer');
      return client;
    } catch (error) {
      client.release(true);
      throw error;
    }
  },
};

export async function editorialResourcePublicationReady() {
  // connect() accepts only the exact legacy or upgraded writer ACL. This
  // discriminates those audited states; it never grants access or substitutes
  // for the store's checks when a later publication transaction actually runs.
  const client = await editorialPool.connect();
  let discard = false;
  try {
    const row = (
      await client.query(
        "SELECT pg_catalog.has_column_privilege('public.entities','name','SELECT') AS available",
      )
    ).rows[0];
    if (typeof row?.available !== 'boolean')
      throw Object.assign(new Error('database_unavailable'), { code: 'database_unavailable' });
    return row.available;
  } catch (error) {
    discard = true;
    throw error;
  } finally {
    client.release(discard);
  }
}
