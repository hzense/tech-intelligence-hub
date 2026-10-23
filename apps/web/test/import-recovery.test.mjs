import test from 'node:test';
import assert from 'node:assert/strict';
import { importFetchFailureMessage, parseImportRecoveryBatchId } from '../lib/import-recovery.ts';

test('recovery links accept only one UUID-shaped identifier, including scheduler stable IDs', () => {
  const id = '3d6f8ed7-022c-9dcf-b52b-eea13542a727';
  assert.equal(parseImportRecoveryBatchId(id), id);
  assert.equal(parseImportRecoveryBatchId(id.toUpperCase()), id);
  for (const invalid of [
    undefined,
    null,
    '',
    [id],
    `${id}\n`,
    `${id}?secret=1`,
    '../admin',
    '<script>',
  ])
    assert.equal(parseImportRecoveryBatchId(invalid), undefined);
});

test('fetch guidance presents only safe diagnostics and never invents a historical HTTP cause', () => {
  const forbidden = importFetchFailureMessage({ reason: 'http_status', status: 403 });
  assert.match(forbidden, /拒绝程序访问（HTTP 403）/);
  assert.match(forbidden, /不要反复重跑整轮付费检索/);
  assert.match(importFetchFailureMessage({ reason: 'http_status', status: 429 }), /限制请求频率/);
  assert.match(importFetchFailureMessage({ reason: 'http_status', status: 404 }), /不存在或已移除/);
  assert.match(importFetchFailureMessage({ reason: 'http_status', status: 503 }), /HTTP 503/);
  for (const reason of ['dns', 'timeout', 'encoding', 'network'])
    assert.doesNotMatch(importFetchFailureMessage({ reason }), /未保存|undefined/);
  for (const value of [
    undefined,
    null,
    { reason: 'http_status', status: '403' },
    { reason: 'secret' },
  ])
    assert.equal(
      importFetchFailureMessage(value),
      '原文抓取失败；该记录未保存具体 HTTP 或网络原因，不能据此判断为 403。',
    );
  assert.equal(
    importFetchFailureMessage({
      reason: 'http_status',
      status: 403,
      message: 'secret',
      url: 'secret',
    }),
    forbidden,
  );
});
