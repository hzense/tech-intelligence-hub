import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import process from 'node:process';
import test from 'node:test';
import { URL } from 'node:url';
import { build } from 'esbuild';

import {
  getResourceEntries,
  getResourceEntryById,
  getRadarSnapshots,
  getSignalEntries,
  getSignalEntryById,
} from '../lib/seed-runtime.ts';

test('only exposes reviewed or accepted Signals in reverse chronological order', async () => {
  const signals = await getSignalEntries();

  assert.ok(signals.length > 0);
  assert.ok(
    signals.every((signal) => signal.status === 'accepted' || signal.status === 'reviewed'),
  );
  assert.ok(signals.every((signal) => signal.source_url.startsWith('https://')));
  assert.deepEqual(
    signals.map((signal) => signal.occurred_at),
    [...signals]
      .map((signal) => signal.occurred_at)
      .sort((left, right) => right.localeCompare(left)),
  );
});

test('resolves a public Signal by its stable id', async () => {
  const firstSignal = (await getSignalEntries())[0];
  assert.ok(firstSignal);

  assert.equal((await getSignalEntryById(firstSignal.id))?.id, firstSignal.id);
});

test('legacy Seed projects named public relations without changing archive eligibility', async () => {
  const signal = (await getSignalEntries()).find(
    (entry) => entry.id === 'signal-20260901-claude-fable-mythos-51',
  );
  assert.ok(signal);
  assert.equal(signal.public_version, undefined);
  assert.deepEqual(
    signal.public_organizations?.map((entry) => [entry.id, entry.name]),
    [['company-anthropic', 'Anthropic']],
  );
  assert.equal(signal.public_sources?.[0]?.url, signal.source_url);
  assert.equal(signal.public_topics?.[0]?.id, 'topic-foundation-models');
});

test('only exposes active Resources and resolves their stable ids', async () => {
  const resources = await getResourceEntries();
  const firstResource = resources[0];

  assert.ok(firstResource);
  assert.ok(resources.every((resource) => resource.status === 'active'));
  assert.equal((await getResourceEntryById(firstResource.id))?.id, firstResource.id);
});

test('does not reuse Radar scores whose historical Signal evidence was removed', async () => {
  const [snapshots, signals] = await Promise.all([getRadarSnapshots(), getSignalEntries()]);
  const signalById = new Map(signals.map((signal) => [signal.id, signal]));

  assert.deepEqual(snapshots, []);
  assert.ok(signals.every((signal) => signal.occurred_at >= '2026-01-01T00:00:00Z'));
  assert.equal(await getSignalEntryById('signal-20221130-chatgpt'), undefined);
  assert.ok(snapshots.every((snapshot) => snapshot.attention >= 0 && snapshot.attention <= 100));
  for (const snapshot of snapshots) {
    assert.ok(snapshot.reasoning.trim().length > 0);
    assert.ok(snapshot.evidence_signals.length > 0);
    assert.equal(new Set(snapshot.evidence_signals).size, snapshot.evidence_signals.length);
    for (const signalId of snapshot.evidence_signals) {
      const signal = signalById.get(signalId);
      assert.ok(signal);
      assert.ok(signal.status === 'accepted' || signal.status === 'reviewed');
      assert.ok(signal.topics.includes(snapshot.topic));
      assert.ok(new Date(signal.occurred_at).toISOString().slice(0, 10) <= snapshot.date);
      assert.ok(new Date(signal.captured_at).toISOString().slice(0, 10) <= snapshot.date);
      assert.ok(signal.source_url.startsWith('https://'));
    }
  }
  for (let index = 1; index < snapshots.length; index += 1) {
    const previous = snapshots[index - 1];
    const current = snapshots[index];
    assert.ok(previous && current);
    assert.ok(
      previous.date > current.date ||
        (previous.date === current.date && previous.attention >= current.attention),
    );
  }
});

test('unified mode suppresses non-empty legacy Radar snapshots even if the old read mode is legacy', async () => {
  const snapshot = {
    id: 'radar-fixture',
    topic: 'topic-fixture',
    date: '2026-10-08',
    attention: 88,
  };
  globalThis.__unifiedRadarGuardTest = { radar: [snapshot] };
  const previousUnified = process.env.HZENSE_UNIFIED_SIGNAL_ENABLED;
  const previousReadMode = process.env.HZENSE_SIGNAL_READ_MODE;
  try {
    const bundled = await build({
      entryPoints: [new URL('../lib/seed-runtime.ts', import.meta.url).pathname],
      bundle: true,
      write: false,
      format: 'esm',
      platform: 'node',
      plugins: [
        {
          name: 'isolate-unified-radar-guard',
          setup(plugin) {
            const modules = {
              '@hzense/content': `
                export async function loadSeedCatalog() {
                  return { ...globalThis.__unifiedRadarGuardTest, entities: [], relations: [], signals: [], sources: [] };
                }
              `,
              '@hzense/ingestion/person-resource-policy': `
                export function isExcludedPublicPerson() { return false; }
              `,
              './unified-signal-mode.ts': `
                export function unifiedSignalEnabled(env) { return env.HZENSE_UNIFIED_SIGNAL_ENABLED === '1'; }
              `,
              './public-signal-reader-core.ts': `
                export function readSignalReadMode() { return 'legacy'; }
              `,
              './legacy-signal-projection.ts': `
                export function projectLegacySignalEntries() { return []; }
              `,
              './legacy-signal-archive-reader-core.ts': `
                export function readLegacySignalArchiveMode() { return 'seed'; }
              `,
              './editorial-entity-links.ts': `
                export function projectEditorialEntityLinks(signals) { return signals; }
              `,
              './editorial-signal-reader-core.ts': `
                export const editorialSignalIdPattern = /^editorial-/;
              `,
              './server/public-signals.ts': `
                export async function waitForPublicSignalRequest() {}
                export async function getPublicSignals() { return []; }
                export async function getPublicSignalById() {}
              `,
              './server/unified-signals.ts': `
                export async function getUnifiedSignals() { return []; }
              `,
              './server/editorial-signals.ts': `
                export async function getEditorialSignals() { return []; }
              `,
              './server/legacy-signal-archive.ts': `
                export async function getLegacyArchivedSignals() { return []; }
              `,
            };
            plugin.onResolve(
              {
                filter:
                  /^(?:@hzense\/(?:content|ingestion\/person-resource-policy)|\.\/(?:unified-signal-mode|public-signal-reader-core|legacy-signal-projection|legacy-signal-archive-reader-core|editorial-entity-links|editorial-signal-reader-core)\.ts|\.\/server\/(?:public-signals|unified-signals|editorial-signals|legacy-signal-archive)\.ts)$/,
              },
              (args) => ({ path: args.path, namespace: 'radar-fixture' }),
            );
            plugin.onLoad({ filter: /.*/, namespace: 'radar-fixture' }, (args) => ({
              contents: modules[args.path],
              loader: 'js',
            }));
          },
        },
      ],
    });
    const isolated = await import(
      `data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`
    );
    process.env.HZENSE_UNIFIED_SIGNAL_ENABLED = '1';
    process.env.HZENSE_SIGNAL_READ_MODE = 'legacy';
    assert.deepEqual(await isolated.getRadarSnapshots(), []);
    process.env.HZENSE_UNIFIED_SIGNAL_ENABLED = '0';
    assert.deepEqual(await isolated.getRadarSnapshots(), [snapshot]);
  } finally {
    delete globalThis.__unifiedRadarGuardTest;
    if (previousUnified === undefined) delete process.env.HZENSE_UNIFIED_SIGNAL_ENABLED;
    else process.env.HZENSE_UNIFIED_SIGNAL_ENABLED = previousUnified;
    if (previousReadMode === undefined) delete process.env.HZENSE_SIGNAL_READ_MODE;
    else process.env.HZENSE_SIGNAL_READ_MODE = previousReadMode;
  }
});
