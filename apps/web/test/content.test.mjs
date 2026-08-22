import assert from 'node:assert/strict';
import test from 'node:test';

import { radarItems } from '../lib/content.ts';

test('keeps the static technology radar populated', () => {
  assert.equal(radarItems.length, 4);
  assert.ok(radarItems.every((item) => item.score > 0 && item.score <= 100));
});
