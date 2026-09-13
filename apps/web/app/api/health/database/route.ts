import {
  createRuntimeReaderHealthHandler,
  type RuntimeReaderHealthLog,
} from '@/lib/runtime-reader-core';
import process from 'node:process';
import { readSearchMode } from '@/lib/search-mode';
import { readSignalReadMode } from '@/lib/public-signal-reader-core';
import {
  readRuntimeTopics,
  runtimeReaderPoolStats,
  probeRuntimeSearch,
  probeRuntimePublicSignals,
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
  signalReadMode: () => readSignalReadMode(process.env),
  probePublicSignals: probeRuntimePublicSignals,
});

export async function GET(request: Request): Promise<Response> {
  return handleHealthRequest(request);
}
