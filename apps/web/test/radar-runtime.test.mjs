import assert from 'node:assert/strict';
import test from 'node:test';

import {
  filterLatestRadarSnapshots,
  getRadarAttentionPosition,
  getLatestRadarSnapshotDate,
  getRadarNodePositions,
} from '../lib/radar-model.ts';
import { getRadarSnapshots } from '../lib/seed-runtime.ts';

test('builds the current Radar from validated snapshots', async () => {
  const snapshots = await getRadarSnapshots();
  const entries = filterLatestRadarSnapshots(snapshots);

  assert.ok(entries.length > 0);
  assert.equal(new Set(entries.map((entry) => entry.topic)).size, entries.length);
  for (const entry of entries) {
    const latestDate = snapshots
      .filter((snapshot) => snapshot.topic === entry.topic)
      .reduce((latest, snapshot) => (snapshot.date > latest ? snapshot.date : latest), '');
    assert.equal(entry.date, latestDate);
  }
});

test('selects the newest snapshot for a Topic regardless of input order', async () => {
  const source = (await getRadarSnapshots())[0];
  assert.ok(source);
  const older = { ...source, id: 'radar-older', date: '2026-08-27', attention: 99 };
  const newer = { ...source, id: 'radar-newer', date: '2026-08-29', attention: 40 };

  assert.deepEqual(filterLatestRadarSnapshots([older, newer]), [newer]);
});

test('filters Radar entries by shareable dimensions', async () => {
  const entries = filterLatestRadarSnapshots(await getRadarSnapshots(), {
    domain: 'security',
    maturity: 'emerging',
    trend: 'growth',
  });

  assert.ok(entries.length > 0);
  assert.ok(
    entries.every(
      (entry) =>
        entry.domain === 'security' && entry.maturity === 'emerging' && entry.trend === 'growth',
    ),
  );
});

test('finds the latest Radar date independently of attention order', async () => {
  const [higherAttention, lowerAttention] = await getRadarSnapshots();
  assert.ok(higherAttention && lowerAttention);
  assert.ok(higherAttention.attention > lowerAttention.attention);

  assert.equal(
    getLatestRadarSnapshotDate([
      { ...higherAttention, date: '2026-08-27' },
      { ...lowerAttention, date: '2026-08-29' },
    ]),
    '2026-08-29',
  );
  assert.equal(getLatestRadarSnapshotDate([]), undefined);
});

test('keeps Radar nodes on the attention axis and spreads same-lane points', async () => {
  const entries = filterLatestRadarSnapshots(await getRadarSnapshots());
  const positions = getRadarNodePositions(entries);

  assert.equal(positions.size, entries.length);
  for (const entry of entries) {
    const position = positions.get(entry.id);
    assert.ok(position);
    const bottom = Number.parseFloat(position.bottom);
    assert.ok(bottom >= 12 && bottom <= 88);
    assert.equal(bottom, getRadarAttentionPosition(entry.attention));
    const left = Number.parseFloat(position.left);
    assert.ok(left >= 4 && left <= 96);
  }

  const sameLaneSource = entries[0];
  assert.ok(sameLaneSource);
  const sameLanePositions = getRadarNodePositions([
    { ...sameLaneSource, id: 'radar-same-lane-left', attention: 95 },
    { ...sameLaneSource, id: 'radar-same-lane-right', attention: 95 },
  ]);
  const leftPosition = sameLanePositions.get('radar-same-lane-left');
  const rightPosition = sameLanePositions.get('radar-same-lane-right');
  assert.ok(leftPosition && rightPosition);
  assert.equal(leftPosition.bottom, rightPosition.bottom);
  assert.notEqual(leftPosition.left, rightPosition.left);
});
