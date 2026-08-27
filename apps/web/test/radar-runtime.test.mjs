import assert from 'node:assert/strict';
import test from 'node:test';

import { filterLatestRadarSnapshots, getRadarNodePosition } from '../lib/radar-model.ts';
import { getRadarSnapshots } from '../lib/seed-runtime.ts';

test('builds the current Radar from validated snapshots', async () => {
  const entries = filterLatestRadarSnapshots(await getRadarSnapshots());

  assert.equal(entries.length, 5);
  assert.ok(entries.every((entry) => entry.date === '2026-08-27'));
});

test('filters Radar entries by a shareable dimension', async () => {
  const entries = filterLatestRadarSnapshots(await getRadarSnapshots(), {
    domain: 'security',
  });

  assert.deepEqual(
    entries.map((entry) => entry.topic),
    ['topic-ai-security'],
  );
});

test('keeps Radar nodes inside the visual matrix', async () => {
  const entries = filterLatestRadarSnapshots(await getRadarSnapshots());

  for (const entry of entries) {
    const position = getRadarNodePosition(entry);
    assert.match(position.left, /^(10|28|48|70|90)%$/);
    assert.match(position.bottom, /^\d+%$/);
  }
});
