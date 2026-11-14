import assert from 'node:assert/strict';
import test from 'node:test';
import { discoveryRequestFailureMessage } from '../lib/source-discovery-request-failure.ts';

const receipt = (httpStatus) => ({ version: 1, accounting: 'request_rejected', httpStatus });

test('historical refusals distinguish supplier credit, authentication and rate limits from site budget', () => {
  assert.match(discoveryRequestFailureMessage(receipt(402)), /HTTP 402.*不是本站每日预算不足/);
  assert.match(discoveryRequestFailureMessage(receipt(402)), /不代表当前余额/);
  assert.match(discoveryRequestFailureMessage(receipt(401)), /身份验证失败/);
  assert.match(discoveryRequestFailureMessage(receipt(403)), /仅凭状态码不能确定/);
  assert.match(discoveryRequestFailureMessage(receipt(429)), /供应商限流/);
  for (const code of [400, 401, 402, 403, 404, 405, 413, 415, 422, 429])
    assert.ok(discoveryRequestFailureMessage(receipt(code)).startsWith(`供应商 HTTP ${code}：`));
});

test('missing or malformed receipts are not guessed, and arbitrary provider data never renders', () => {
  for (const value of [
    null,
    {},
    [],
    receipt('402'),
    receipt(500),
    receipt(200),
    { ...receipt(402), version: 2 },
    { ...receipt(402), accounting: 'estimate' },
    Object.create(receipt(402)),
  ])
    assert.equal(discoveryRequestFailureMessage(value), null);
  const safe = receipt(402);
  const before = globalThis.structuredClone(safe);
  const message = discoveryRequestFailureMessage(safe);
  assert.deepEqual(safe, before);
  assert.equal(discoveryRequestFailureMessage({ ...safe, raw: 'private error api-key' }), message);
  Object.defineProperty(safe, 'httpStatus', {
    get() {
      return assert.fail('must not read getters');
    },
  });
  assert.equal(discoveryRequestFailureMessage(safe), null);
});
