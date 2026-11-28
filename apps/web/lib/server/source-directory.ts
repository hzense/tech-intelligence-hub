import 'server-only';
import process from 'node:process';
import { getSignalEntries, getSourceRegistryAndTaxonomy } from '../seed-runtime';
import { buildSourceDirectory, type SourceDirectorySignal } from '../source-directory';
import { toUnifiedSignal } from '../unified-signal-core';
import { unifiedSignalEnabled } from '../unified-signal-mode';
import { getUnifiedSourceDirectorySignals } from './unified-signals';

async function readSourceDirectorySignals(): Promise<SourceDirectorySignal[]> {
  if (unifiedSignalEnabled(process.env)) return getUnifiedSourceDirectorySignals();
  return (await getSignalEntries()).map((entry) => {
    const signal = toUnifiedSignal(entry);
    return {
      id: signal.id,
      title: signal.title,
      date: signal.occurredAt.slice(0, 10),
      sources: signal.sources,
      topicIds: signal.topics.map((topic) => topic.id),
    };
  });
}

export async function getAdminSourceDirectory() {
  const [{ sources, taxonomy }, signals] = await Promise.all([
    getSourceRegistryAndTaxonomy(),
    readSourceDirectorySignals(),
  ]);
  return buildSourceDirectory(sources, signals, taxonomy.topics);
}
