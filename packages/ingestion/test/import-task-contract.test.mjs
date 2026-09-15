import assert from 'node:assert/strict';
import test from 'node:test';
import {
  parseImportOutput,
  parseImportCreate,
  importBatchStatus,
} from '../src/import-task-contract.mjs';

test('task preflight does not turn a publication intent into published state', () => {
  const value = parseImportCreate(
    {
      id: '11111111-1111-4111-8111-111111111111',
      intent: 'generate_publish',
      manifest: { files: [{ clientItemId: 'one', name: 'n.txt', size: 5 }] },
    },
    { parsers: ['text'] },
  );
  assert.equal(value.intent, 'generate_publish');
  assert.equal(value.items.length, 1);
  assert.equal(
    importBatchStatus({ cancelled: false }, [{ status: 'awaiting_upload' }]),
    'awaiting_upload',
  );
});
test('output only accepts bounded private text with precise locations', () => {
  assert.equal(
    parseImportOutput({
      fragments: [{ text: 'A', locator: { sheet: 'Sheet1', row: 1, column: 2 } }],
    }).classification,
    'private',
  );
  for (const value of [
    null,
    {},
    { fragments: [] },
    { fragments: [{ text: 'a', locator: {} }] },
    { fragments: [{ text: 'a', locator: { page: 301 } }] },
    { fragments: [{ text: 'a', locator: { url: 'https://secret.example' } }] },
    { fragments: [{ text: 'a', locator: { page: 1 }, html: '<script>' }] },
  ])
    assert.throws(() => parseImportOutput(value));
});
test('batch outcome distinguishes partially completed and uncertain work', () => {
  assert.equal(
    importBatchStatus({ cancelled: false }, [{ status: 'completed' }, { status: 'failed' }]),
    'partial_success',
  );
  assert.equal(importBatchStatus({ cancelled: false }, [{ status: 'unknown' }]), 'unknown');
  assert.equal(importBatchStatus({ cancelled: true }, [{ status: 'completed' }]), 'cancelled');
});
test('output text and locator strings count Unicode code points consistently', () => {
  const make = (text, sheet) => ({ fragments: [{ text, locator: { sheet, row: 1 } }] });
  assert.equal(
    parseImportOutput(make('😀'.repeat(20000), '😀'.repeat(150))).classification,
    'private',
  );
  assert.throws(() => parseImportOutput(make('😀'.repeat(20001), 'sheet')));
  assert.throws(() => parseImportOutput(make('ok', '😀'.repeat(151))));
});
