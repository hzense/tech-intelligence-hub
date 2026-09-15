import test from 'node:test';
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { runImportProcessing } from '../lib/import-worker-core.ts';
import { ImportIOError } from '../lib/import-io.ts';
const path = 'imports/batch/item',
  bytes = Buffer.from('hello'),
  sha256 = createHash('sha256').update(bytes).digest('hex');
function fixture(overrides = {}) {
  const events = [];
  const deps = {
    expire: async () => events.push('expire'),
    claim: async () => {
      events.push('claim');
      return {
        item: { kind: 'url', declaration: { url: 'https://example.com' } },
        attempt: { fence: 3 },
        document: null,
      };
    },
    fetch: async () => {
      events.push('fetch');
      return { bytes, format: 'text' };
    },
    put: async () => events.push('put'),
    read: async () => ({ bytes, sha256, version: 'v1' }),
    confirm: async (_d, f) => events.push(`confirm:${f}`),
    parse: async () => {
      events.push('parse');
      return { fragments: [{ text: 'hello', locator: { paragraph: 1 } }] };
    },
    finish: async (value) => {
      events.push('finish');
      return value;
    },
    ...overrides,
  };
  return { events, deps };
}
test('worker persists original before parsing and finishes with the claimed fence', async () => {
  const { events, deps } = fixture();
  const result = await runImportProcessing(path, 100, deps);
  assert.equal(result.fence, 3);
  assert.equal(result.outcome, 'completed');
  assert.equal(result.chargedMicrousd, 100);
  assert.deepEqual(events, ['expire', 'claim', 'fetch', 'put', 'confirm:3', 'parse', 'finish']);
});
test('failed budget claim performs no external work', async () => {
  const { events, deps } = fixture({
    claim: async () => {
      throw new Error('budget_exceeded');
    },
  });
  await assert.rejects(runImportProcessing(path, 100, deps));
  assert.deepEqual(events, ['expire']);
});
test('immutable receipt mismatch prevents parse; unknown external errors require reconciliation', async () => {
  const { events, deps } = fixture({
    read: async () => ({ bytes, sha256: 'incorrect', version: 'v1' }),
  });
  assert.equal((await runImportProcessing(path, 100, deps)).outcome, 'unknown');
  assert.ok(!events.includes('parse'));
});
test('known OCR refusal is a private failure, not a published or empty success', async () => {
  const { deps } = fixture({
    parse: async () => {
      throw new ImportIOError('ocr_required');
    },
  });
  const result = await runImportProcessing(path, 100, deps);
  assert.equal(result.outcome, 'failed');
  assert.equal(result.errorCode, 'ocr_required');
  assert.equal(result.output, undefined);
});
test('ambiguous completion is never replayed as a second completion', async () => {
  let calls = 0;
  const { deps } = fixture({
    finish: async () => {
      calls++;
      throw new Error('commit_unknown');
    },
  });
  await assert.rejects(runImportProcessing(path, 100, deps));
  assert.equal(calls, 1);
});
test('invalid parser output durably fails exactly once despite a positive reservation', async () => {
  for (const output of [
    { fragments: [{ text: 'cell', locator: { row: 1000001, column: 1 } }] },
    { fragments: [] },
    { fragments: [{ text: 'x'.repeat(20001), locator: { paragraph: 1 } }] },
  ]) {
    const { deps, events } = fixture({ parse: async () => output });
    const result = await runImportProcessing(path, 100, deps);
    assert.equal(result.outcome, 'failed');
    assert.equal(result.errorCode, 'parse_failed');
    assert.equal(result.chargedMicrousd, 100);
    assert.equal(result.output, undefined);
    assert.equal(events.filter((e) => e === 'finish').length, 1);
  }
});
