import test from 'node:test';
import assert from 'node:assert/strict';
import {
  appendAutomationSourceFailure,
  automationSourceFailureCode,
  automationSourceFailureItems,
  readAutomationSourceFailures,
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

test('source failure append keeps at most eight unique item receipts without mutating history', () => {
  const original = [{ ...receipt, message: 'private' }];
  let failures = appendAutomationSourceFailure(original, itemId, 'profile_not_ready');
  assert.deepEqual(failures, [{ ...receipt, code: 'profile_not_ready' }]);
  assert.equal(original[0].code, 'invalid_request');
  for (let index = 2; index <= 12; index++) {
    failures = appendAutomationSourceFailure(
      failures,
      `11111111-1111-4111-8111-${String(index).padStart(12, '0')}`,
      'budget_exceeded',
    );
  }
  assert.equal(failures.length, 8);
  assert.equal(new Set(failures.map((entry) => entry.itemId)).size, 8);
  assert.equal(readAutomationSourceFailures([...failures, ...failures]).length, 8);
  assert.deepEqual(
    appendAutomationSourceFailure(failures, 'private-item', 'invalid_request'),
    failures,
  );
  assert.deepEqual(appendAutomationSourceFailure(failures, itemId, 'commit_unknown'), failures);
  assert.equal(JSON.stringify(failures).includes('private'), false);
});
