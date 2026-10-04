import 'server-only';

import process from 'node:process';
import { connection } from 'next/server';
import {
  createLegacySignalArchiveReader,
  readLegacySignalArchiveMode,
} from '../legacy-signal-archive-reader-core';
import { queryEditorialPublicData } from './editorial-signals';

export async function getLegacyArchivedSignals() {
  await connection();
  return createLegacySignalArchiveReader({ query: queryEditorialPublicData }).list();
}

export async function probeLegacySignalArchive() {
  if (readLegacySignalArchiveMode(process.env) === 'database')
    await createLegacySignalArchiveReader({ query: queryEditorialPublicData }).list();
}
