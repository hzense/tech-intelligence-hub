import 'server-only';
import { connection } from 'next/server';
import { queryEditorialPublicData } from './editorial-signals';
import { createUnifiedSignalReader } from '../unified-signal-reader-core';
export async function readUnifiedSignalsForTask() {
  return createUnifiedSignalReader({ query: queryEditorialPublicData }).list();
}
export async function getUnifiedSignals() {
  await connection();
  return readUnifiedSignalsForTask();
}
