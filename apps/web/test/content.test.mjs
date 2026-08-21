import assert from 'node:assert/strict';
import test from 'node:test';

import { dailySignals, intelligenceCards, radarItems } from '../lib/content.ts';

test('keeps the homepage and Daily routes populated', () => {
  assert.equal(intelligenceCards.length, 3);
  assert.equal(radarItems.length, 4);
  assert.equal(dailySignals.length, 3);
  assert.ok(dailySignals.every((signal) => signal.whyItMatters.length > 0));
});
