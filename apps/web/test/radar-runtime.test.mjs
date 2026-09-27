import assert from 'node:assert/strict';
import test from 'node:test';

import {
  filterLatestRadarSnapshots,
  getRadarAttentionPosition,
  getLatestRadarSnapshotDate,
  getRadarNodePositions,
} from '../lib/radar-model.ts';
import { getRadarSnapshots } from '../lib/seed-runtime.ts';

const sampleSnapshot = {
  id: 'radar-synthetic-ai-security',
  topic: 'topic-ai-security',
  date: '2026-09-01',
  domain: 'security',
  attention: 55,
  trend: 'growth',
  maturity: 'emerging',
  strategic_value: 'medium',
  confidence: 0.5,
  evidence_signals: ['signal-synthetic'],
  reasoning: 'Synthetic test fixture',
};

test('does not expose retired Seed Radar snapshots', async () => {
  const snapshots = await getRadarSnapshots();
  const entries = filterLatestRadarSnapshots(snapshots);

  assert.deepEqual(snapshots, []);
  assert.deepEqual(entries, []);
});

test('selects the newest snapshot for a Topic regardless of input order', () => {
  const source = sampleSnapshot;
  const older = { ...source, id: 'radar-older', date: '2026-08-27', attention: 99 };
  const newer = { ...source, id: 'radar-newer', date: '2026-08-29', attention: 40 };

  assert.deepEqual(filterLatestRadarSnapshots([older, newer]), [newer]);
});

test('filters Radar entries by shareable dimensions', () => {
  const entries = filterLatestRadarSnapshots([sampleSnapshot], {
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

test('finds the latest Radar date independently of attention order', () => {
  const higherAttention = { ...sampleSnapshot, attention: 95 };
  const lowerAttention = { ...sampleSnapshot, id: 'radar-lower', attention: 55 };

  assert.equal(
    getLatestRadarSnapshotDate([
      { ...higherAttention, date: '2026-08-27' },
      { ...lowerAttention, date: '2026-08-29' },
    ]),
    '2026-08-29',
  );
  assert.equal(getLatestRadarSnapshotDate([]), undefined);
});

test('keeps Radar nodes on the attention axis and spreads same-lane points', () => {
  const entries = filterLatestRadarSnapshots([sampleSnapshot]);
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
