import assert from 'node:assert/strict';
import test from 'node:test';
import { discoveryBudgetItems } from '../lib/source-discovery-budget-presentation.ts';

const snapshot = {
  version: 1,
  estimatedMicrousd: 1_871_000,
  batchLimitMicrousd: 5_000_000,
  dailyLimitMicrousd: 10_000_000,
  dailyUsedMicrousd: 8_500_000,
  dailyRemainingMicrousd: 1_500_000,
};

test('discovery budget displays the estimate, limits and historical remaining balance precisely', () => {
  assert.deepEqual(discoveryBudgetItems(snapshot), [
    '本次采集预估：$1.871000',
    '单次预算上限：$5.000000',
    '当日预算上限：$10.000000',
    '当时已记账或占用：$8.500000',
    '当时可用余额：$1.500000',
  ]);
  assert.equal(
    discoveryBudgetItems({ ...snapshot, estimatedMicrousd: 5_000_001 })[0],
    '本次采集预估：$5.000001',
  );
  assert.equal(
    discoveryBudgetItems({
      ...snapshot,
      dailyUsedMicrousd: 10_500_000,
      dailyRemainingMicrousd: 0,
    }).at(-1),
    '当时可用余额：$0.000000',
  );
});

test('missing, future or malformed budget receipts are not treated as a zero-dollar estimate', () => {
  for (const value of [
    undefined,
    null,
    [],
    {},
    { ...snapshot, version: 2 },
    { ...snapshot, estimatedMicrousd: 0 },
    { ...snapshot, batchLimitMicrousd: 0 },
    { ...snapshot, batchLimitMicrousd: 11_000_000 },
    { ...snapshot, dailyLimitMicrousd: 50_000_001 },
    { ...snapshot, dailyRemainingMicrousd: 1_500_001 },
    Object.create(snapshot),
  ])
    assert.deepEqual(discoveryBudgetItems(value), []);
  for (const key of Object.keys(snapshot).filter((key) => key !== 'version')) {
    for (const value of [undefined, '100', -1, 0.1, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])
      assert.deepEqual(discoveryBudgetItems({ ...snapshot, [key]: value }), []);
  }
});

test('budget rendering does not expose additional diagnostic fields or evaluate getters', () => {
  const privateValue = 'must-not-display-private-data';
  assert.equal(
    discoveryBudgetItems({ ...snapshot, rawOutput: privateValue })
      .join()
      .includes(privateValue),
    false,
  );
  const receipt = { ...snapshot };
  Object.defineProperty(receipt, 'estimatedMicrousd', {
    get() {
      throw new Error('must not read accessor');
    },
  });
  assert.deepEqual(discoveryBudgetItems(receipt), []);
});
