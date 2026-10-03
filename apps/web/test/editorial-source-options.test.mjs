import { buildCandidateSourceBundle } from '../../../packages/ingestion/src/candidate-source-bundle.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  editorialSourceUrl,
  readEditorialSourceOptions,
  readEditorialResourceSourceOptions,
} from '../lib/editorial-source-options.ts';
import { readMaterialSupplement } from '../lib/material-source-reader.ts';
import { buildGenerationSource } from '../../../packages/ingestion/src/signal-generation-contract.mjs';
import { signalGenerationSourceHash } from '../../../packages/database/src/signal-generation-store.mjs';

const owner = 'owner';
const batchId = '11111111-1111-4111-8111-111111111111';
const itemId = '22222222-2222-4222-8222-222222222222';
const content = {
  classification: 'private',
  fragments: [{ index: 0, text: 'Original article evidence.', locator: { paragraph: 1 } }],
  warnings: [],
};
const run = {
  owner_id: owner,
  batch_id: batchId,
  item_id: itemId,
  source_fence: 3,
  source_hash: signalGenerationSourceHash(buildGenerationSource(content)),
};
const receipt = {
  batchId,
  itemId,
  fence: run.source_fence,
  contentHash: run.source_hash,
  sourceUrl: 'https://www.techrepublic.com/article/news-example/',
};

test('offers the original article URL only after the owner and pinned source match', async () => {
  const calls = [];
  const result = await readEditorialSourceOptions(owner, run, async (...args) => {
    calls.push(args);
    return { ...receipt, source: content, privateMetadata: 'must not escape' };
  });
  assert.deepEqual(calls, [[owner, batchId, itemId]]);
  assert.deepEqual(result, [receipt.sourceUrl]);
});

test('refuses another owner or invalid source identity without reading private imports', async () => {
  for (const patch of [
    { owner_id: 'someone-else' },
    { source_fence: 0 },
    { source_fence: 1.5 },
    { source_hash: 'not-a-hash' },
  ]) {
    let reads = 0;
    assert.deepEqual(
      await readEditorialSourceOptions(owner, { ...run, ...patch }, async () => {
        reads++;
        return receipt;
      }),
      [],
    );
    assert.equal(reads, 0);
  }
});

test('refuses a different batch, item, processing attempt or original content', async () => {
  for (const patch of [
    { batchId: itemId },
    { itemId: batchId },
    { fence: run.source_fence + 1 },
    { contentHash: 'b'.repeat(64) },
  ])
    assert.deepEqual(
      await readEditorialSourceOptions(owner, run, async () => ({ ...receipt, ...patch })),
      [],
    );
});

test('filters credentials, signed links, storage, private hosts and private paths without rewriting', () => {
  for (const url of [
    'http://example.com/article',
    'https://user:password@example.com/article',
    'https://localhost/article',
    'https://127.0.0.1/article',
    'https://[::1]/article',
    'https://news.internal/article',
    'https://news.example.com:8443/article',
    'https://example.com/article#token',
    'https://example.com/article?X-Amz-Signature=secret',
    'https://example.com/article?access_token=secret',
    'https://example.com/article?custom_capability=secret',
    'https://example.com/article?utm_token=secret',
    'https://example.com/article?id=123&%74oken=secret',
    'https://bucket.private.blob.vercel-storage.com/article',
    'https://bucket.s3.eu-west-1.amazonaws.com/article',
    'https://storage.googleapis.com/private-bucket/article',
    'https://account.blob.core.windows.net/private/article',
    'https://example.supabase.co/storage/v1/object/article',
    'https://drive.google.com/file/d/secret/view',
    'https://docs.google.com/document/d/secret/edit',
    'https://www.dropbox.com/s/secret/article',
    'https://example.com/private/article',
    'https://example.com/%70rivate/article',
    'https://example.com/uploads/private-file.pdf',
    'https://example.com/auth/token',
    'https://example.com/download/signature=secret',
    'https://example.com/article;access_token=secret',
    'https://example.com/%E0%A4%A',
    ' https://example.com/article',
    'https://example.com/article\nhttps://other.example/article',
    '',
    null,
  ])
    assert.equal(editorialSourceUrl(url), null, String(url));
  assert.equal(editorialSourceUrl(receipt.sourceUrl), receipt.sourceUrl);
  assert.equal(
    editorialSourceUrl('https://example.com/news/private-ai-research'),
    'https://example.com/news/private-ai-research',
  );
});

test('keeps recognized article and tracking parameters exactly without broad query allowance', () => {
  for (const url of [
    'https://example.com/article?id=123',
    'https://example.com/?p=123',
    'https://example.com/news?article=123&page=2',
    'https://example.com/news?article_id=123&utm_source=newsletter&utm_medium=email',
    'https://example.com/news?utm_campaign=Launch%20Day&utm_content=top&utm_term=ai&utm_id=4',
    'https://example.com/news?id=2&id=1&utm_source=a%2Fb',
  ])
    assert.equal(editorialSourceUrl(url), url);
});

test('unavailable source options do not turn a saved review into an error', async () => {
  for (const code of ['source_unavailable', 'not_configured', 'database_unavailable'])
    assert.deepEqual(
      await readEditorialSourceOptions(owner, run, async () => {
        throw Object.assign(new Error(code), { code });
      }),
      [],
    );
  assert.deepEqual(
    await readEditorialSourceOptions(owner, run, async () => ({
      ...receipt,
      sourceUrl: 'https://example.com/article?token=secret',
    })),
    [],
  );
});

test('composes with the real read-only import reader and never exposes file imports', async () => {
  const row = {
    batch_id: batchId,
    item_id: itemId,
    fence: run.source_fence,
    kind: 'url',
    url: receipt.sourceUrl,
    content,
  };
  const queries = [];
  let selected = row;
  const pool = {
    connect: async () => ({
      query: async (sql, values) => {
        queries.push({ sql, values });
        return { rows: sql.startsWith('SELECT') && selected ? [selected] : [] };
      },
      release: () => {},
    }),
  };
  const read = (...args) => readMaterialSupplement(pool, ...args);
  assert.deepEqual(await readEditorialSourceOptions(owner, run, read), [receipt.sourceUrl]);
  const select = queries.find(({ sql }) => sql.startsWith('SELECT'));
  assert.deepEqual(select.values, [owner, batchId, itemId]);
  assert.match(select.sql, /b\.owner_id=\$1/);
  assert.match(select.sql, /b\.deleted_at IS NULL/);
  assert.match(select.sql, /NOT b\.cancelled/);
  assert.match(select.sql, /i\.kind='url'/);
  for (const unavailable of [null, { ...row, kind: 'file' }]) {
    selected = unavailable;
    assert.deepEqual(await readEditorialSourceOptions(owner, run, read), []);
  }
  assert.equal(
    queries.some(({ sql }) => /^(?:INSERT|UPDATE|DELETE)/.test(sql)),
    false,
  );
});

test('resource source options follow bound fragment provenance and never label supplementary evidence with the original URL', async () => {
  const source = buildGenerationSource(content);
  const supplemental = {
    classification: 'private',
    fragments: [{ id: 'fragment-1', text: 'Ada works at Example.', locator: { paragraph: 1 } }],
  };
  const extraReceipt = {
    batchId: '33333333-3333-4333-8333-333333333333',
    itemId: '44444444-4444-4444-8444-444444444444',
    fence: 2,
    contentHash: signalGenerationSourceHash(supplemental),
    sourceUrl: 'https://example.com/supplement',
  };
  const bundle = buildCandidateSourceBundle({
    baseMaterialHash: 'a'.repeat(64),
    source,
    supplements: [{ ...extraReceipt, source: supplemental }],
  });
  const resources = [
    {
      type: 'company',
      name: 'Original',
      introduction: null,
      event_role: null,
      evidence: [{ fragment_id: 'fragment-1', quote: 'Original article evidence.' }],
    },
    {
      type: 'person',
      name: 'Ada',
      introduction: null,
      event_role: null,
      evidence: [{ fragment_id: 'fragment-2', quote: 'Ada works at Example.' }],
    },
  ];
  const calls = [];
  const read = async (...args) => {
    calls.push(args);
    return args[1] === batchId ? receipt : extraReceipt;
  };
  assert.deepEqual(await readEditorialResourceSourceOptions(owner, run, bundle, resources, read), [
    { name: 'Original', type: 'company', sourceUrls: [receipt.sourceUrl] },
    { name: 'Ada', type: 'person', sourceUrls: [extraReceipt.sourceUrl] },
  ]);
  assert.deepEqual(calls, [
    [owner, batchId, itemId],
    [owner, extraReceipt.batchId, extraReceipt.itemId],
  ]);
  for (const patch of [
    { fence: 3 },
    { contentHash: 'c'.repeat(64) },
    { sourceUrl: 'https://example.com/changed' },
    { batchId },
    { itemId },
  ]) {
    const value = await readEditorialResourceSourceOptions(
      owner,
      run,
      bundle,
      resources,
      async (_o, b) => (b === batchId ? receipt : { ...extraReceipt, ...patch }),
    );
    assert.deepEqual(value[1].sourceUrls, []);
    assert.deepEqual(value[0].sourceUrls, [receipt.sourceUrl]);
  }
  const missing = await readEditorialResourceSourceOptions(
    owner,
    run,
    bundle,
    resources,
    async (_o, b) => {
      if (b === batchId) return receipt;
      throw new Error('deleted source');
    },
  );
  assert.deepEqual(missing[1].sourceUrls, []);
  assert.deepEqual(
    (await readEditorialResourceSourceOptions('someone-else', run, bundle, resources, read)).map(
      (row) => row.sourceUrls,
    ),
    [[], []],
  );
  for (const unsafe of [
    'https://example.com/supplement?token=private',
    'https://example.com/private/report',
    'https://bucket.blob.vercel-storage.com/report',
  ]) {
    const privateReceipt = { ...extraReceipt, sourceUrl: unsafe };
    const privateBundle = buildCandidateSourceBundle({
      baseMaterialHash: 'a'.repeat(64),
      source,
      supplements: [{ ...privateReceipt, source: supplemental }],
    });
    const value = await readEditorialResourceSourceOptions(
      owner,
      run,
      privateBundle,
      resources,
      async (_o, b) => (b === batchId ? receipt : privateReceipt),
    );
    assert.deepEqual(value[1].sourceUrls, []);
  }
});
