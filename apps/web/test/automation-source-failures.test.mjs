import test from 'node:test';
import assert from 'node:assert/strict';
import {
  appendAutomationSourceFailure,
  appendAutomationImportFailure,
  automationSourceFailureCode,
  automationSourceFailureItems,
  readAutomationSourceFailures,
  automationSourceFailureLimit,
  automationSourceOutcomeCounts,
  automationSourceOutcomeItems,
} from '../lib/automation-source-failures.ts';

const itemId = '11111111-1111-4111-8111-111111111111';
const receipt = { itemId, phase: 'create_candidate', code: 'invalid_request' };

test('source failure receipts expose only bounded allowlisted fields and confirmed codes', () => {
  const values = [
    { ...receipt, message: 'private-message', stack: 'private-stack', raw: { secret: 'private' } },
    { ...receipt, code: 'commit_unknown' },
    { ...receipt, code: 'outcome_unknown' },
    {
      ...receipt,
      code: {
        toString() {
          throw new Error('must not coerce');
        },
      },
    },
    { ...receipt, phase: 'private-phase' },
    { ...receipt, itemId: 'private-item' },
    null,
    [],
  ];
  assert.deepEqual(readAutomationSourceFailures(values), [receipt]);
  assert.equal(automationSourceFailureCode('commit_unknown'), null);
  assert.equal(automationSourceFailureCode('invalid_request'), 'invalid_request');
  assert.deepEqual(readAutomationSourceFailures({ sourceFailures: values }), []);
  const labels = automationSourceFailureItems(values);
  assert.equal(labels.length, 1);
  assert.match(labels[0], /创建候选任务：候选任务参数无效（invalid_request）/);
  assert.equal(JSON.stringify(labels).includes('private'), false);
  assert.deepEqual(automationSourceFailureItems(undefined), []);
  assert.deepEqual(readAutomationSourceFailures([{ ...receipt, itemId: `${itemId}\n` }]), []);
});

test('confirmed import failures carry only sanitized diagnostics and retain candidate refusals', () => {
  const otherId = '22222222-2222-4222-8222-222222222222';
  const failures = appendAutomationImportFailure([receipt], otherId, {
    status: 'failed',
    error_code: 'fetch_failed',
    fetch_diagnostic: {
      reason: 'http_status',
      status: 403,
      body: 'private-body',
      url: 'private-url',
    },
  });
  assert.deepEqual(failures, [
    receipt,
    {
      itemId: otherId,
      phase: 'import_source',
      code: 'fetch_failed',
      fetchDiagnostic: { reason: 'http_status', status: 403 },
    },
  ]);
  const labels = automationSourceFailureItems(failures);
  assert.match(labels[1], /403/);
  assert.equal(JSON.stringify(failures).includes('private'), false);
  assert.equal(JSON.stringify(labels).includes('private'), false);
  for (const status of ['running', 'queued']) {
    assert.deepEqual(appendAutomationImportFailure(failures, otherId, { status }), failures);
  }
  const legacy = appendAutomationImportFailure([], otherId, {
    status: 'failed',
    error_code: 'fetch_failed',
  });
  assert.deepEqual(legacy, [{ itemId: otherId, phase: 'import_source', code: 'fetch_failed' }]);
  assert.match(automationSourceFailureItems(legacy)[0], /未.*记录|未.*保存/);
  assert.deepEqual(
    readAutomationSourceFailures([
      {
        itemId: otherId,
        phase: 'import_source',
        code: 'parse_failed',
        fetchDiagnostic: { reason: 'http_status', status: 403 },
      },
    ]),
    [{ itemId: otherId, phase: 'import_source', code: 'parse_failed' }],
  );
  assert.deepEqual(
    readAutomationSourceFailures([
      {
        itemId: otherId,
        phase: 'import_source',
        code: 'outcome_unknown',
      },
    ]),
    [{ itemId: otherId, phase: 'import_source', code: 'outcome_unknown' }],
  );
});

test('source failure append bounds all primary and fallback receipts without mutating history', () => {
  const original = [{ ...receipt, message: 'private' }];
  let failures = appendAutomationSourceFailure(original, itemId, 'profile_not_ready');
  assert.deepEqual(failures, [{ ...receipt, code: 'profile_not_ready' }]);
  assert.equal(original[0].code, 'invalid_request');
  assert.equal(automationSourceFailureLimit, 24);
  for (let index = 2; index <= automationSourceFailureLimit + 4; index++) {
    failures = appendAutomationSourceFailure(
      failures,
      `11111111-1111-4111-8111-${String(index).padStart(12, '0')}`,
      'budget_exceeded',
    );
  }
  assert.equal(failures.length, automationSourceFailureLimit);
  assert.equal(new Set(failures.map((entry) => entry.itemId)).size, automationSourceFailureLimit);
  assert.equal(
    readAutomationSourceFailures([...failures, ...failures]).length,
    automationSourceFailureLimit,
  );
  assert.deepEqual(
    appendAutomationSourceFailure(failures, 'private-item', 'invalid_request'),
    failures,
  );
  assert.deepEqual(appendAutomationSourceFailure(failures, itemId, 'commit_unknown'), failures);
  assert.equal(JSON.stringify(failures).includes('private'), false);
});

test('confirmed import admission refusals explain unprocessed sources without changing item state', () => {
  for (const [code, message] of [
    ['worker_busy', '导入执行槽忙，排队等待已达上限，资料尚未处理'],
    ['budget_exceeded', '导入预算不足，资料尚未处理'],
    ['configuration_conflict', '导入解析配置已变更，资料尚未处理'],
  ]) {
    const storedItem = { id: itemId, status: 'queued', fence: 0 };
    const blocked = {
      status: 'blocked',
      error_code: code,
      fetch_diagnostic: { reason: 'http_status', status: 403, body: 'private' },
    };
    const failures = appendAutomationImportFailure([], storedItem.id, blocked);
    assert.deepEqual(failures, [{ itemId, phase: 'import_source', code }]);
    const items = automationSourceOutcomeItems(failures);
    assert.deepEqual(items, {
      failed: [`资料 ${itemId} · 导入原文：${message}（${code}）`],
      skipped: [],
      unknown: [],
    });
    assert.deepEqual(automationSourceOutcomeCounts({ failed: 1, sourceFailures: failures }), {
      failed: 1,
      skipped: 0,
      unknown: 0,
    });
    assert.deepEqual(storedItem, { id: itemId, status: 'queued', fence: 0 });
    assert.equal(blocked.status, 'blocked');
    assert.equal(JSON.stringify(failures).includes('private'), false);
  }
  assert.deepEqual(
    appendAutomationImportFailure([], itemId, { status: 'blocked', error_code: 'cancelled' }),
    [{ itemId, phase: 'import_source', code: 'cancelled' }],
  );
});

test('blocked receipts cannot reclassify unknown execution or unrelated failures as admission refusals', () => {
  const previous = [{ itemId, phase: 'import_source', code: 'outcome_unknown' }];
  for (const code of [undefined, 'outcome_unknown', 'commit_unknown', 'fetch_failed', 'private']) {
    assert.deepEqual(
      appendAutomationImportFailure(previous, itemId, { status: 'blocked', error_code: code }),
      previous,
    );
  }
  assert.deepEqual(
    appendAutomationImportFailure([], itemId, { status: 'unknown', error_code: 'worker_busy' }),
    previous,
  );
});

test('confirmed failure, duplicate skip and unknown import have separate presentation', () => {
  const receipts = [
    receipt,
    {
      itemId: '22222222-2222-4222-8222-222222222222',
      phase: 'create_candidate',
      code: 'duplicate_source',
    },
    {
      itemId: '33333333-3333-4333-8333-333333333333',
      phase: 'import_source',
      code: 'outcome_unknown',
    },
  ];
  const before = globalThis.structuredClone(receipts);
  const items = automationSourceOutcomeItems(receipts);
  assert.equal(items.failed.length, 1);
  assert.equal(items.skipped.length, 1);
  assert.equal(items.unknown.length, 1);
  assert.match(items.skipped[0], /已跳过重复来源/);
  assert.match(items.unknown[0], /待核对/);
  assert.deepEqual(automationSourceOutcomeCounts({ failed: 2, sourceFailures: receipts }), {
    failed: 1,
    skipped: 1,
    unknown: 1,
  });
  assert.deepEqual(
    automationSourceOutcomeCounts({ failed: 1, skipped: 1, unknown: 1, sourceFailures: receipts }),
    {
      failed: 1,
      skipped: 1,
      unknown: 1,
    },
  );
  assert.deepEqual(
    automationSourceOutcomeCounts({
      failed: 2,
      skipped: null,
      unknown: 1,
      duplicateSourceCount: 1,
    }),
    {
      failed: 1,
      skipped: 1,
      unknown: 1,
    },
  );
  assert.deepEqual(receipts, before);
});
test('missing or invalid counts are not reclassified as confirmed zero failures', () => {
  for (const value of [
    undefined,
    null,
    {},
    { failed: '2' },
    { failed: -1, skipped: 999 },
    { failed: 1.5 },
  ]) {
    assert.deepEqual(automationSourceOutcomeCounts(value), {
      failed: null,
      skipped: null,
      unknown: null,
    });
  }
  assert.deepEqual(automationSourceOutcomeCounts({ failed: 2 }), {
    failed: 2,
    skipped: null,
    unknown: null,
  });
});
