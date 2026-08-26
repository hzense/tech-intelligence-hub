import assert from 'node:assert/strict';
import test from 'node:test';

import { getSignalEntries, getSignalEntryById } from '../lib/seed-runtime.ts';

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
