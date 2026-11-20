import assert from 'node:assert/strict';
import test from 'node:test';
import { neonComputeProjection } from '../lib/neon-usage-pricing.ts';

const costs = {
  status: 'estimated',
  plan: 'launch',
  from: '2026-11-01T00:00:00Z',
  through: '2026-11-02T00:00:00Z',
  computeUnitSeconds: 21600,
};
test('compute projection uses measured CU seconds across elapsed hours, including idle time', () => {
  assert.deepEqual(neonComputeProjection(costs), { averageCu: 0.25, monthlyMicrousd: 19080000 });
  assert.equal(
    neonComputeProjection({ ...costs, computeUnitSeconds: 10800 }).monthlyMicrousd,
    9540000,
  );
  assert.equal(neonComputeProjection({ ...costs, computeUnitSeconds: 0 }).monthlyMicrousd, 0);
});
test('short, unknown, stale-contract or invalid compute coverage never fabricates a monthly cost', () => {
  for (const value of [
    null,
    { ...costs, plan: 'free' },
    { ...costs, status: 'unavailable' },
    { ...costs, computeUnitSeconds: undefined },
    { ...costs, computeUnitSeconds: Infinity },
    { ...costs, through: '2026-11-01T23:00:00Z' },
    { ...costs, from: 'bad' },
  ])
    assert.equal(neonComputeProjection(value), null);
});
