import 'server-only';

import process from 'node:process';
import pg from 'pg';
import { connection } from 'next/server';
import { assertEditorialRole } from '../../../../packages/database/src/editorial-signal-role.mjs';
import {
  createEditorialSignalReader,
  editorialReaderConnectionString,
} from '../editorial-signal-reader-core';
import {
  PublicSignalReaderError,
  type PublicSignalQueryClient,
  type SignalEntry,
} from '../public-signal-reader-core';

let pool: pg.Pool | undefined;
let poolConnectionString: string | undefined;
function readerPool() {
  const connectionString = editorialReaderConnectionString(process.env);
  if (pool && poolConnectionString !== connectionString) throw new PublicSignalReaderError();
  if (!pool) {
    pool = new pg.Pool({
      connectionString,
      max: 2,
      connectionTimeoutMillis: 3_500,
      idleTimeoutMillis: 10_000,
      query_timeout: 3_000,
      allowExitOnIdle: true,
      application_name: 'hzense-editorial-reader',
      enableChannelBinding: true,
    });
    pool.on('error', () => console.error('Editorial public reader is unavailable'));
    poolConnectionString = connectionString;
  }
  return pool;
}

/** Validate one checked-out connection for a single public read operation. */
export async function withEditorialPublicReader<T>(
  read: (client: PublicSignalQueryClient) => Promise<T>,
): Promise<T> {
  const client = await readerPool().connect();
  let discard = false;
  try {
    await assertEditorialRole(client, 'reader');
    return await read(client);
  } catch (error) {
    // query_timeout can reject before PostgreSQL is ready for another query.
    discard = true;
    throw error;
  } finally {
    client.release(discard);
  }
}

/** Share the bounded public-reader pool between current and archived Signals. */
export async function queryEditorialPublicData(sql: string, parameters: unknown[]) {
  return withEditorialPublicReader((client) => client.query(sql, parameters));
}

async function read<T>(
  operation: (reader: ReturnType<typeof createEditorialSignalReader>) => Promise<T>,
) {
  try {
    return await withEditorialPublicReader((client) =>
      operation(createEditorialSignalReader(client)),
    );
  } catch {
    throw new PublicSignalReaderError();
  }
}

// Only the connection pool is reused. Never cache published content or failures.
export async function getEditorialSignals(): Promise<SignalEntry[]> {
  if (process.env.HZENSE_EDITORIAL_PUBLICATION_ENABLED !== '1') return [];
  await connection();
  return read((reader) => reader.list());
}
/** Background workers have no Next request context; same public view and ACL. */
export async function readEditorialSignalsForTask(): Promise<SignalEntry[]> {
  if (process.env.HZENSE_EDITORIAL_PUBLICATION_ENABLED !== '1') return [];
  return read((reader) => reader.list());
}
export async function getEditorialSignalById(id: string): Promise<SignalEntry | undefined> {
  if (process.env.HZENSE_EDITORIAL_PUBLICATION_ENABLED !== '1') return undefined;
  await connection();
  return read((reader) => reader.byId(id));
}
