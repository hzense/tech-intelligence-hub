import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL, URL } from 'node:url';
import { expect, it, vi } from 'vitest';

it('explicit local init resyncs Topics after cutover without reimporting Signals', async () => {
  const root = '/synthetic-local-project';
  const script = await readFile(
    new URL('../../../scripts/local-database-bootstrap.mjs', import.meta.url),
    'utf8',
  );
  // Isolate the real orchestration function, replacing only its I/O dependencies.
  const body = script
    .slice(
      script.indexOf('export async function initializeLocalDatabase('),
      script.indexOf('export async function verifyLocalDatabase('),
    )
    .replace(/^export /, '')
    .replace(/\bimport\(/g, 'loadModule(');
  const client = {
    query: vi.fn(async () => ({ rows: [{ ready: true, plan_hash: 'already-initialized' }] })),
    end: vi.fn(async () => {}),
  };
  const sync = vi.fn(async () => {});
  const archive = vi.fn(() => {
    throw new Error('must not reimport existing Signals');
  });
  let topics = [{ id: 'topic-quantum' }];
  const dependencies = {
    localDatabaseRoot: root,
    connect: async () => client,
    localDatabaseUrl: () => 'synthetic-local-only',
    createLocalDatabase: async () => {},
    localMigrationOptions: () => ({ connectionString: 'synthetic-local-only' }),
    runMigrations: async () => {},
    resumeLocalBackendReader: async () => {},
    verifyDatabaseContract: async () => {},
    database: 'hzense_local',
    owner: 'hzense_local_owner',
    prepareServiceRoles: async () => {},
    prepareLocalBackendRoles: async () => {},
    assertMinimumRoles: async () => {},
    pathToFileURL,
    resolve,
    syncTopics: sync,
    buildLegacySignalArchivePlan: archive,
    verifyLocalDatabase: async () => ({ ready: true }),
    loadModule: async () => ({
      loadSeedCatalog: async () => ({ taxonomy: {}, topics }),
      buildTopicDatabaseProjection: (_taxonomy, selected) => selected,
    }),
  };
  const initialize = new Function(
    ...Object.keys(dependencies),
    `${body};return initializeLocalDatabase`,
  )(...Object.values(dependencies));
  await initialize({ credentials: {}, root });
  expect(sync).toHaveBeenLastCalledWith(client, [{ id: 'topic-quantum' }], { dryRun: false });
  topics = [...topics, { id: 'topic-biotechnology' }];
  await initialize({ credentials: {}, root });
  expect(sync).toHaveBeenCalledTimes(2);
  expect(sync).toHaveBeenLastCalledWith(client, topics, { dryRun: false });
  expect(archive).not.toHaveBeenCalled();
});
