import 'server-only';
import { connection } from 'next/server';
import { withEditorialPublicReader } from './editorial-signals';
import { createUnifiedSignalReader } from '../unified-signal-reader-core';
import { PublicSignalReaderError } from '../public-signal-reader-core';

async function read<T>(
  operation: (reader: ReturnType<typeof createUnifiedSignalReader>) => Promise<T>,
) {
  try {
    // Readiness and content share one connection and one fresh ACL check. Nothing
    // is retained after this operation, including successful role validation.
    return await withEditorialPublicReader((client) =>
      operation(createUnifiedSignalReader(client)),
    );
  } catch {
    throw new PublicSignalReaderError();
  }
}
export async function readUnifiedSignalsForTask() {
  return read((reader) => reader.list());
}
export async function getUnifiedSignals() {
  await connection();
  return readUnifiedSignalsForTask();
}
export async function getUnifiedSignalById(id: string) {
  await connection();
  return read((reader) => reader.byId(id));
}
export async function probeUnifiedSignals() {
  return read((reader) => reader.probe());
}
