import {
  createRuntimeReaderHealthHandler,
  type RuntimeReaderHealthLog,
} from '@/lib/runtime-reader-core';
import process from 'node:process';
import { readSearchMode } from '@/lib/search-mode';
import {
  readRuntimeTopics,
  runtimeReaderPoolStats,
  probeRuntimeSearch,
} from '@/lib/server/runtime-reader';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 10;

function writeHealthLog(record: RuntimeReaderHealthLog): void {
  const serialized = JSON.stringify(record);
  if (record.outcome === 'unavailable') {
    console.error(serialized);
    return;
  }
  console.info(serialized);
}

const handleHealthRequest = createRuntimeReaderHealthHandler({
  log: writeHealthLog,
  poolStats: runtimeReaderPoolStats,
  readTopics: readRuntimeTopics,
  searchMode: () => readSearchMode(process.env),
  probeSearch: probeRuntimeSearch,
});

export async function GET(request: Request): Promise<Response> {
  return handleHealthRequest(request);
}
