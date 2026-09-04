import 'server-only';

import process from 'node:process';
import pg from 'pg';
import {
  classifyRuntimeReaderError,
  createLazyRuntimeTopicReader,
  extractPostgresSqlState,
  type RuntimeReaderPoolOptions,
} from '../runtime-reader-core';

const { Pool } = pg;

function writeIdlePoolError(error: unknown): void {
  const errorCode = classifyRuntimeReaderError(error);
  const sqlstate = extractPostgresSqlState(error);
  const record = {
    error_code: errorCode === 'query_failed' ? 'pool_error' : errorCode,
    event: 'runtime_reader_pool_error',
    outcome: 'unavailable',
    ...(sqlstate ? { sqlstate } : {}),
  };
  console.error(JSON.stringify(record));
}

function createPool(options: RuntimeReaderPoolOptions): pg.Pool {
  const pool = new Pool(options);
  pool.on('error', writeIdlePoolError);
  return pool;
}

const runtimeTopicReader = createLazyRuntimeTopicReader({
  createPool,
  environment: () => process.env,
});

export function readRuntimeTopics(limit = 1) {
  return runtimeTopicReader.readTopics(limit);
}

export function runtimeReaderPoolStats() {
  return runtimeTopicReader.poolStats();
}
