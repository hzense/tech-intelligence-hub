import test from 'node:test';
import assert from 'node:assert/strict';
import { readApiCostMicrousd } from '../lib/ai-response-cost.ts';

test('OpenRouter account cost accepts zero and ignores upstream cost and malformed data', async () => {
  for (const [value, expected] of [
    [0, 0],
    [0.001234, 1234],
    [0.0000001, 1],
    [null, null],
    ['0.1', null],
    [-1, null],
    [1e20, null],
  ]) {
    const response = globalThis.Response.json({
      usage: { cost: value, cost_details: { upstream_inference_cost: 9 } },
    });
    assert.equal(await readApiCostMicrousd(response, 'https://openrouter.ai/api/v1'), expected);
    assert.equal(response.bodyUsed, false);
  }
  assert.equal(
    await readApiCostMicrousd(
      globalThis.Response.json({ usage: { cost: 1 } }),
      'https://provider.example/v1',
    ),
    null,
  );
  assert.equal(
    await readApiCostMicrousd(new globalThis.Response('invalid'), 'https://openrouter.ai/api/v1'),
    null,
  );
});
