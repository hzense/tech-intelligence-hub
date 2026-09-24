import test from 'node:test';
import assert from 'node:assert/strict';
import { createMaterialEnrichmentDispatcher } from '../lib/material-enrichment-dispatch.ts';

test('rejected dispatch fences pending work; completed replays never start again', async () => {
  let status = 'pending';
  const calls = [];
  const dispatch = createMaterialEnrichmentDispatcher({
    create: async () => ({ id: 'task', status }),
    queue: async () => ({ id: 'task', status }),
    start: async (owner, id) => {
      calls.push(['start', owner, id]);
      throw new Error('scheduler unavailable');
    },
    failQueued: async (owner, id) => {
      calls.push(['fence', owner, id]);
      status = 'failed';
    },
  });
  await assert.rejects(dispatch('owner', {}), /scheduler unavailable/);
  assert.deepEqual(calls, [
    ['start', 'owner', 'task'],
    ['fence', 'owner', 'task'],
  ]);
  assert.equal(status, 'failed');
  status = 'completed';
  assert.equal((await dispatch('owner', {})).status, 'completed');
  assert.equal(calls.length, 2);
});
