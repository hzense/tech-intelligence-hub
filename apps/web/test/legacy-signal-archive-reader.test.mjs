import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { fileURLToPath, URL } from 'node:url';
import process from 'node:process';
import { Buffer } from 'node:buffer';
import { loadSeedCatalog } from '@hzense/content';
import { build } from 'esbuild';
import { canonicalLegacyArchiveJson } from '../../../packages/database/src/legacy-signal-archive.mjs';
import { projectLegacySignalEntries } from '../lib/legacy-signal-projection.ts';
import { toUnifiedSignal } from '../lib/unified-signal-core.ts';
import {
  createLegacySignalArchiveReader,
  legacySignalArchiveQuery,
  mapLegacySignalArchiveRows,
  readLegacySignalArchiveMode,
} from '../lib/legacy-signal-archive-reader-core.ts';

const catalog = await loadSeedCatalog(
  fileURLToPath(new URL('../../../data/seed/', import.meta.url)),
  fileURLToPath(new URL('../../../data/taxonomy/taxonomy.yaml', import.meta.url)),
);
const projected = projectLegacySignalEntries(catalog);
const rows = projected.map((content) => ({
  signal_id: content.id,
  content,
  content_hash: createHash('sha256').update(canonicalLegacyArchiveJson(content)).digest('hex'),
}));

test('the frozen database archive preserves every current historical URL and all public fields', () => {
  const actual = mapLegacySignalArchiveRows(JSON.parse(JSON.stringify(rows)));
  assert.equal(actual.length, 110);
  assert.deepEqual(actual, projected);
  assert.deepEqual(actual.map(toUnifiedSignal), projected.map(toUnifiedSignal));
  assert.ok(actual.every((entry) => toUnifiedSignal(entry).publication.basis === 'legacy_seed'));
});

test('missing, duplicated, foreign or changed rows cannot silently produce a partial archive', () => {
  assert.throws(() => mapLegacySignalArchiveRows([]));
  assert.throws(() => mapLegacySignalArchiveRows(rows.slice(1)));
  assert.throws(() => mapLegacySignalArchiveRows([...rows.slice(1), rows[1]]));
  for (const patch of [
    { signal_id: 'signal-foreign' },
    { content_hash: 'a'.repeat(64) },
    { content: { ...rows[0].content, public_version: 1 } },
    { content: { ...rows[0].content, source_url: 'https://wrong.example/' } },
    { content: { ...rows[0].content, entities: [] } },
  ])
    assert.throws(() => mapLegacySignalArchiveRows([{ ...rows[0], ...patch }, ...rows.slice(1)]));
});

test('database reads remain current and fail closed without falling back to YAML', async () => {
  let reads = 0;
  const reader = createLegacySignalArchiveReader({
    async query(sql, parameters) {
      reads++;
      assert.equal(sql, legacySignalArchiveQuery);
      assert.deepEqual(parameters, [111]);
      if (reads === 2) throw new Error('database unavailable');
      return { rows };
    },
  });
  assert.equal((await reader.list()).length, 110);
  await assert.rejects(reader.list(), /public Signal/i);
  assert.equal((await reader.list()).length, 110);
  assert.equal(reads, 3);
});

test('archive switch is explicit, reversible and cannot enable a different publication path', () => {
  assert.equal(readLegacySignalArchiveMode({}), 'seed');
  assert.equal(readLegacySignalArchiveMode({ HZENSE_LEGACY_SIGNAL_ARCHIVE_MODE: 'seed' }), 'seed');
  assert.equal(
    readLegacySignalArchiveMode({ HZENSE_LEGACY_SIGNAL_ARCHIVE_MODE: 'database' }),
    'database',
  );
  for (const mode of ['', 'on', 'auto'])
    assert.throws(() => readLegacySignalArchiveMode({ HZENSE_LEGACY_SIGNAL_ARCHIVE_MODE: mode }));
  assert.throws(() =>
    readLegacySignalArchiveMode({
      HZENSE_LEGACY_SIGNAL_ARCHIVE_MODE: 'database',
      HZENSE_SIGNAL_READ_MODE: 'database',
    }),
  );
});

test('actual list, detail and resource reverse lookup switch together and never fall back on archive failure', async () => {
  const state = {
    catalog: globalThis.structuredClone(catalog),
    entries: projected,
    fail: false,
    reads: 0,
  };
  globalThis.__legacyArchiveRuntime = state;
  const oldArchive = process.env.HZENSE_LEGACY_SIGNAL_ARCHIVE_MODE;
  const oldMode = process.env.HZENSE_SIGNAL_READ_MODE;
  const oldEditorial = process.env.HZENSE_EDITORIAL_PUBLICATION_ENABLED;
  try {
    const bundled = await build({
      entryPoints: [new URL('../lib/seed-runtime.ts', import.meta.url).pathname],
      bundle: true,
      write: false,
      format: 'esm',
      platform: 'node',
      plugins: [
        {
          name: 'archive-providers',
          setup(plugin) {
            const modules = {
              '@hzense/content':
                'export async function loadSeedCatalog() { return globalThis.__legacyArchiveRuntime.catalog; }',
              './server/legacy-signal-archive.ts':
                'export async function getLegacyArchivedSignals() { const s=globalThis.__legacyArchiveRuntime; s.reads++; if(s.fail)throw new Error("archive unavailable"); return s.entries; }',
              './server/editorial-signals.ts':
                'export async function getEditorialSignals() { return []; }',
              './server/public-signals.ts':
                'export async function getPublicSignals() { return []; }',
            };
            plugin.onResolve(
              {
                filter:
                  /^(@hzense\/content|\.\/server\/(legacy-signal-archive|editorial-signals|public-signals)\.ts)$/,
              },
              (args) => ({ path: args.path, namespace: 'archive-providers' }),
            );
            plugin.onLoad({ filter: /.*/, namespace: 'archive-providers' }, (args) => ({
              contents: modules[args.path],
              loader: 'js',
            }));
          },
        },
      ],
    });
    const api = await import(
      `data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`
    );
    process.env.HZENSE_SIGNAL_READ_MODE = 'legacy';
    process.env.HZENSE_EDITORIAL_PUBLICATION_ENABLED = '0';
    process.env.HZENSE_LEGACY_SIGNAL_ARCHIVE_MODE = 'database';
    state.catalog.signals = [];
    assert.deepEqual(await api.getSignalEntries(), projected);
    const entry = projected.find((row) => row.entities.length);
    assert.deepEqual(await api.getSignalEntryById(entry.id), entry);
    assert.ok(
      (await api.getSignalsForEntity(entry.entities[0])).some((row) => row.id === entry.id),
    );
    assert.equal(state.reads, 3);
    state.catalog.signals = catalog.signals;
    state.fail = true;
    await assert.rejects(api.getSignalEntries(), /archive unavailable/);
    await assert.rejects(api.getSignalEntryById(entry.id), /archive unavailable/);
    process.env.HZENSE_LEGACY_SIGNAL_ARCHIVE_MODE = 'seed';
    assert.deepEqual(await api.getSignalEntries(), projected);
  } finally {
    for (const [key, value] of Object.entries({
      HZENSE_LEGACY_SIGNAL_ARCHIVE_MODE: oldArchive,
      HZENSE_SIGNAL_READ_MODE: oldMode,
      HZENSE_EDITORIAL_PUBLICATION_ENABLED: oldEditorial,
    })) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    delete globalThis.__legacyArchiveRuntime;
  }
});
