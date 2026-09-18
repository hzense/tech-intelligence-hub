import test from 'node:test';
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import {
  inspectGenerationSource,
  buildGenerationSource,
} from '../../../packages/ingestion/src/signal-generation-contract.mjs';
import { parseImportOutput } from '../../../packages/ingestion/src/import-task-contract.mjs';
import { createGenerationSourceInspector } from '../lib/signal-generation-source-inspection.ts';
import { createGenerationHandler } from '../lib/admin-signal-generation-handler.ts';
const { Request } = globalThis;
const batchId = '11111111-1111-4111-8111-111111111111';
const itemId = '22222222-2222-4222-8222-222222222222';
const output = (text) => parseImportOutput({ fragments: [{ text, locator: { paragraph: 1 } }] });

test('source inspection measures exact generation JSON UTF-8 bytes without leaking text', () => {
  const input = output('中文资料🔎');
  const result = inspectGenerationSource(input);
  assert.equal(result.sourceBytes, Buffer.byteLength(JSON.stringify(buildGenerationSource(input))));
  assert.equal(result.ready, true);
  assert.equal(result.fragmentCount, 1);
  assert.equal(JSON.stringify(result).includes('中文资料'), false);
  assert.deepEqual(result.locators, [{ id: 'fragment-1', locator: { paragraph: 1 } }]);
});

test('inspection reports oversized sources without relaxing the actual generation limit', () => {
  const input = output('中'.repeat(17000));
  const result = inspectGenerationSource(input);
  assert.equal(result.ready, false);
  assert.ok(result.sourceBytes > result.limitBytes);
  assert.throws(() => buildGenerationSource(input), { code: 'generation_source_too_large' });
  for (const bad of [
    { ...input, classification: 'public' },
    { ...input, fragments: [] },
  ])
    assert.throws(() => inspectGenerationSource(bad), { code: 'invalid_generation_source' });
});

test('inspection boundary is inclusive and previews at most three locators', () => {
  const base = parseImportOutput({
    fragments: Array.from({ length: 4 }, (_, i) => ({ text: 'x', locator: { paragraph: i + 1 } })),
  });
  const overhead = inspectGenerationSource(base).sourceBytes - 4;
  const lengths = [12000, 12000, 12000, 48000 - overhead - 36000];
  const boundary = parseImportOutput({
    fragments: lengths.map((n, i) => ({ text: 'x'.repeat(n), locator: { paragraph: i + 1 } })),
  });
  assert.equal(inspectGenerationSource(boundary).sourceBytes, 48000);
  assert.equal(inspectGenerationSource(boundary).ready, true);
  assert.equal(inspectGenerationSource(boundary).locators.length, 3);
  boundary.fragments[3].text += 'x';
  assert.equal(inspectGenerationSource(boundary).ready, false);
});

test('source inspector accepts identifiers only and propagates owning-admin access failures', async () => {
  let reads = 0;
  const inspect = createGenerationSourceInspector(async (owner, batch, item) => {
    reads++;
    assert.equal(owner, 'trusted-admin');
    assert.equal(batch, batchId);
    assert.equal(item, itemId);
    return { fence: 3, output: output('Private content') };
  });
  const body = { action: 'inspect_source', batchId, itemId };
  assert.equal((await inspect('trusted-admin', body)).fence, 3);
  for (const extra of [
    { owner: 'intruder' },
    { text: 'injected' },
    { consent: true },
    { profileId: batchId },
  ])
    await assert.rejects(inspect('trusted-admin', { ...body, ...extra }), {
      code: 'invalid_request',
    });
  assert.equal(reads, 1);
  const denied = createGenerationSourceInspector(async () => {
    throw new Error('private backend diagnostic');
  });
  await assert.rejects(denied('intruder', body));
});

test('inspection HTTP path authenticates, is no-store, and never dispatches generation', async () => {
  let reads = 0;
  const deps = {
    session: async () => ({ user: { id: 'trusted-admin' } }),
    origin: () => 'https://hzense.com',
    dashboard: async () => assert.fail('no dashboard'),
    execute: async () => assert.fail('no generation'),
    inspectSource: createGenerationSourceInspector(async () => {
      reads++;
      return { fence: 1, output: output('Private content') };
    }),
  };
  const request = (headers = {}) =>
    new Request('https://hzense.com/api/admin/signal-generation', {
      method: 'POST',
      headers: {
        host: 'hzense.com',
        origin: 'https://hzense.com',
        'content-type': 'application/json',
        ...headers,
      },
      body: JSON.stringify({ action: 'inspect_source', batchId, itemId }),
    });
  assert.equal(
    (await createGenerationHandler({ ...deps, session: async () => null })(request())).status,
    401,
  );
  const handler = createGenerationHandler(deps);
  assert.equal((await handler(request({ origin: 'https://evil.example' }))).status, 403);
  assert.equal(reads, 0);
  const response = await handler(request());
  assert.equal(response.status, 200);
  assert.match(response.headers.get('cache-control'), /no-store/);
  assert.equal((await response.json()).inspection.ready, true);
  assert.equal(reads, 1);
  const failure = await createGenerationHandler({
    ...deps,
    inspectSource: async () => {
      throw new Error('PRIVATE_SECRET');
    },
  })(request());
  assert.equal(failure.status, 503);
  assert.equal((await failure.text()).includes('PRIVATE_SECRET'), false);
});
