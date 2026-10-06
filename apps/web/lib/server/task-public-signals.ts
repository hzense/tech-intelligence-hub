import 'server-only';
import { readSignalReadMode } from '../public-signal-reader-core';
import { readEditorialSignalsForTask } from './editorial-signals';
import { readRuntimePublicSignals } from './runtime-reader';
import { unifiedSignalEnabled } from '../unified-signal-mode';
import { readUnifiedSignalsForTask } from './unified-signals';

/** Public-only worker input, no Seed filesystem or private candidate access. */
export async function readTaskPublicSignals() {
  if (unifiedSignalEnabled(process.env)) return readUnifiedSignalsForTask();
  const [current, editorial] = await Promise.all([
    readSignalReadMode(process.env) === 'database' ? readRuntimePublicSignals() : [],
    readEditorialSignalsForTask(),
  ]);
  return [...current.filter((s) => !s.id.startsWith('editorial-')), ...editorial];
}
