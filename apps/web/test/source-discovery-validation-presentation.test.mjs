import assert from 'node:assert/strict';
import test from 'node:test';
import { discoveryValidationItems } from '../lib/source-discovery-diagnostics.ts';

test('validation diagnostics show per-item Chinese reasons and counted rule overlaps', () => {
  const result = discoveryValidationItems({
    version: 1,
    returnedCount: 3,
    validCitationCount: 4,
    rejections: [
      { index: 0, reasons: ['uncited_url', 'date_out_of_window'] },
      { index: 2, reasons: ['date_out_of_window'] },
    ],
    reasonCounts: { uncited_url: 1, date_out_of_window: 2 },
  });
  assert.deepEqual(result, {
    summary: [
      '返回条目：3 条 · 有效引用网址：4 个',
      '来源网址与供应商引用不匹配：1 条',
      '发布日期不在采集时间范围内：2 条',
    ],
    rejections: [
      '第 1 条：来源网址与供应商引用不匹配；发布日期不在采集时间范围内',
      '第 3 条：发布日期不在采集时间范围内',
    ],
  });
});

test('historical, future, malformed and unbounded validation receipt shapes remain unavailable', () => {
  for (const value of [
    undefined,
    null,
    [],
    { version: 2 },
    { version: 1, returnedCount: '8' },
    { version: 1, returnedCount: 9 },
    { version: 1, returnedCount: -1 },
    { version: 1, returnedCount: 1.5 },
  ]) {
    assert.deepEqual(discoveryValidationItems(value), { summary: [], rejections: [] });
  }
  assert.deepEqual(discoveryValidationItems({ version: 1, returnedCount: 0 }), {
    summary: ['返回条目：0 条 · 有效引用网址：未记录'],
    rejections: [],
  });
});

test('validation readback never echoes rejected content, arbitrary reason keys, or invented totals', () => {
  const secret = 'must-not-display-private-data';
  const result = discoveryValidationItems({
    version: 1,
    returnedCount: 8,
    validCitationCount: secret,
    rawOutput: secret,
    rejections: [
      {
        index: 0,
        reasons: ['invalid_url', 'invalid_url', secret, '__proto__', 'constructor'],
        url: secret,
        title: secret,
        publishedAt: secret,
      },
      { index: 0, reasons: ['invalid_title'] },
      { index: 8, reasons: ['invalid_date'] },
      { index: secret, reasons: ['invalid_date'] },
      { index: 1, reasons: [secret] },
      { index: 2, reasons: {} },
      { index: 3, reasons: ['invalid_date_format'] },
      { index: 4, reasons: ['invalid_article'] },
      { index: 5, reasons: ['unexpected_fields'] },
    ],
    reasonCounts: { invalid_title: 8, invalid_url: 1000000, [secret]: 9999 },
  });
  assert.deepEqual(result, {
    summary: [
      '返回条目：8 条 · 有效引用网址：未记录',
      '条目不是有效对象：1 条',
      '来源网址无效或不安全：1 条',
      '发布日期须为 YYYY-MM-DD 格式：1 条',
    ],
    rejections: [
      '第 1 条：来源网址无效或不安全',
      '第 4 条：发布日期须为 YYYY-MM-DD 格式',
      '第 5 条：条目不是有效对象',
    ],
  });
  assert.equal(JSON.stringify(result).includes(secret), false);
});
