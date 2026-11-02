import assert from 'node:assert/strict';
import test from 'node:test';
import {
  SIGNAL_TYPES,
  LEGACY_SIGNAL_TYPES,
  SIGNAL_EVENT_TYPES,
  SIGNAL_EVENT_TYPE_LABELS,
  isSignalEventType,
} from '../src/signal-types.mjs';

test('event types exclude domain and openness attributes without losing historical readability', () => {
  for (const value of ['technology', 'security', 'market', 'open_source', 'supply_chain']) {
    assert.equal(isSignalEventType(value), false);
    assert.ok(LEGACY_SIGNAL_TYPES.includes(value));
    assert.ok(SIGNAL_TYPES.includes(value));
  }
  for (const value of ['disclosure', 'operations', 'incident']) {
    assert.equal(isSignalEventType(value), true);
    assert.ok(SIGNAL_TYPES.includes(value));
    assert.equal(LEGACY_SIGNAL_TYPES.includes(value), false);
  }
  for (const value of [null, undefined, [], ['research'], 'editorial', 'private', 'topic-ai']) {
    assert.equal(isSignalEventType(value), false);
  }
  assert.equal(new Set(SIGNAL_EVENT_TYPES).size, SIGNAL_EVENT_TYPES.length);
  assert.equal(new Set(SIGNAL_TYPES).size, SIGNAL_TYPES.length);
  assert.ok(SIGNAL_EVENT_TYPES.every((value) => SIGNAL_EVENT_TYPE_LABELS[value]));
});
