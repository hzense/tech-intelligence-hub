import assert from 'node:assert/strict';
import test from 'node:test';
import { aiProbePresentation } from '../lib/admin-ai-probe-summary.ts';

const failed = {
  status: 'failed',
  error_code: 'provider_rejected',
  charged_microusd: '143360',
  input_tokens: null,
  output_tokens: null,
  result: {},
};
const diagnostics = {
  version: 1,
  stage: 'model_request',
  reason: 'invalid_request',
  http_status: 400,
  rejection_confirmed: true,
};

test('legacy failed probe admits missing diagnostic and accounting evidence', () => {
  const view = aiProbePresentation(failed);
  assert.equal(view.costLabel, '费用来源未记录');
  assert.match(view.failureDetail, /未保存 HTTP 状态/);
  assert.match(view.accountingDetail, /预算仍按预留或估算保留/);
  assert.equal(view.httpStatus, null);
  assert.equal(view.stageLabel, null);
});

test('confirmed refusal displays HTTP stage and released reservation', () => {
  const view = aiProbePresentation({
    ...failed,
    charged_microusd: '0',
    result: {
      diagnostics,
      accounting: { version: 1, source: 'request_rejected' },
    },
  });
  assert.equal(view.costLabel, '明确拒绝，不计费');
  assert.equal(view.httpStatus, 400);
  assert.equal(view.stageLabel, '请求模型');
  assert.match(view.failureDetail, /请求参数或格式无效/);
  assert.match(view.accountingDetail, /预留额度已释放/);
});

test('API charge remains labeled as API evidence even when capability validation fails', () => {
  for (const status of ['succeeded', 'failed', 'stale']) {
    const view = aiProbePresentation({
      ...failed,
      status,
      result: {
        accounting: { version: 1, source: 'provider' },
      },
    });
    assert.equal(view.costLabel, 'API 返回费用');
    assert.match(view.accountingDetail, /尚未与最终账单对账/);
  }
});

test('unknown, in-flight and inconsistent receipts never promise a released budget', () => {
  const result = { diagnostics, accounting: { version: 1, source: 'request_rejected' } };
  for (const probe of [
    { ...failed, result },
    { ...failed, charged_microusd: '0', input_tokens: 1, result },
    { ...failed, charged_microusd: '0', output_tokens: 1, result },
    { ...failed, charged_microusd: '0', error_code: 'timeout', result },
    ...['pending', 'running', 'unknown', 'succeeded'].map((status) => ({
      ...failed,
      status,
      charged_microusd: '0',
      result,
    })),
    {
      ...failed,
      charged_microusd: '0',
      result: { ...result, diagnostics: { ...diagnostics, rejection_confirmed: 'true' } },
    },
    { ...failed, charged_microusd: '0', result: { accounting: result.accounting } },
  ]) {
    const view = aiProbePresentation(probe);
    assert.equal(view.costLabel, '费用来源未记录');
    assert.doesNotMatch(view.accountingDetail, /已释放/);
  }
});

test('a stale test retains its validated fee receipt without being a current capability proof', () => {
  const view = aiProbePresentation({
    ...failed,
    status: 'stale',
    error_code: 'connection_unavailable',
    charged_microusd: '0',
    result: { diagnostics, accounting: { version: 1, source: 'request_rejected' } },
  });
  assert.equal(view.costLabel, '明确拒绝，不计费');
});

test('new unknown-cost server failure shows an estimate and safe HTTP diagnostic', () => {
  const view = aiProbePresentation({
    ...failed,
    result: {
      diagnostics: {
        version: 1,
        stage: 'model_catalog',
        reason: 'provider_unavailable',
        http_status: 503,
        rejection_confirmed: false,
      },
      accounting: { version: 1, source: 'estimate' },
    },
  });
  assert.equal(view.costLabel, '估算');
  assert.equal(view.stageLabel, '读取模型目录');
  assert.equal(view.httpStatus, 503);
  assert.match(view.failureDetail, /实际执行及费用需核对/);
});
