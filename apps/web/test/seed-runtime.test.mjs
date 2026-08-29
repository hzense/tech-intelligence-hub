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

test('only exposes active Resources and resolves their stable ids', async () => {
  const resources = await getResourceEntries();
  const firstResource = resources[0];

  assert.ok(firstResource);
  assert.ok(resources.every((resource) => resource.status === 'active'));
  assert.equal((await getResourceEntryById(firstResource.id))?.id, firstResource.id);
});

test('loads validated Radar snapshots in reverse date and attention order', async () => {
  const [snapshots, signals] = await Promise.all([getRadarSnapshots(), getSignalEntries()]);
  const signalById = new Map(signals.map((signal) => [signal.id, signal]));

  assert.ok(snapshots.length > 0);
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
