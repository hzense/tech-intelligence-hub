import assert from 'node:assert/strict';
import test from 'node:test';
import {
  countTopicSignals,
  trackedTopicIds,
  trackingSignalMinimum,
} from '../lib/tracking-topics.ts';

test('tracking counts unique direct signals and applies the same threshold per eligible topic', () => {
  const eligible = new Set(['topic-language', 'topic-inference', 'topic-agent']);
  const signals = Array.from({ length: 10 }, (_, index) => ({
    id: `signal-${index}`,
    topics: [
      'topic-language',
      'topic-language',
      'topic-parent',
      ...(index < 9 ? ['topic-inference'] : []),
    ],
  }));
  signals.push(signals[0], ...signals.slice(0, 9));
  assert.equal(trackingSignalMinimum, 10);
  assert.deepEqual(
    [...countTopicSignals(signals)],
    [
      ['topic-language', 10],
      ['topic-parent', 10],
      ['topic-inference', 9],
    ],
  );
  assert.deepEqual([...trackedTopicIds(eligible, signals)], ['topic-language']);
  // A fresh tenth signal qualifies inference; parent-only tags do not qualify another leaf.
  signals.push({ id: 'inference-ten', topics: ['topic-inference'] });
  assert.deepEqual([...trackedTopicIds(eligible, signals)], ['topic-language', 'topic-inference']);
  assert.deepEqual([...trackedTopicIds(eligible, [])], []);
});
