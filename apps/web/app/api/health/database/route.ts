import {
  createRuntimeReaderHealthHandler,
  type RuntimeReaderHealthLog,
} from '@/lib/runtime-reader-core';
import process from 'node:process';
import { readSearchMode } from '@/lib/search-mode';
import { readSignalReadMode } from '@/lib/public-signal-reader-core';
import { unifiedSignalEnabled } from '@/lib/unified-signal-mode';
import { readUnifiedSignalsForTask } from '@/lib/server/unified-signals';
import { probeLegacySignalArchive } from '@/lib/server/legacy-signal-archive';
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
  signalReadMode: () =>
    unifiedSignalEnabled(process.env) ? 'database' : readSignalReadMode(process.env),
  probePublicSignals: async () => {
    if (unifiedSignalEnabled(process.env)) await readUnifiedSignalsForTask();
    else await probeRuntimePublicSignals();
  },
  probeLegacySignals: async () => {
    if (!unifiedSignalEnabled(process.env)) await probeLegacySignalArchive();
  },
});

export async function GET(request: Request): Promise<Response> {
  return handleHealthRequest(request);
}
