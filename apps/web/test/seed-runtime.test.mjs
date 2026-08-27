import assert from 'node:assert/strict';
import test from 'node:test';

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


test('only exposes active Resources and resolves their stable ids', async () => {
  const resources = await getResourceEntries();
  const firstResource = resources[0];

  assert.ok(firstResource);
  assert.ok(resources.every((resource) => resource.status === 'active'));
  assert.equal((await getResourceEntryById(firstResource.id))?.id, firstResource.id);
});

test('loads validated Radar snapshots in reverse date and attention order', async () => {
  const snapshots = await getRadarSnapshots();

  assert.equal(snapshots.length, 5);
  assert.ok(snapshots.every((snapshot) => snapshot.attention >= 0 && snapshot.attention <= 100));
  assert.deepEqual(
    snapshots.map((snapshot) => snapshot.attention),
    [...snapshots].map((snapshot) => snapshot.attention).sort((left, right) => right - left),
  );
});
