import test from 'node:test';
import assert from 'node:assert/strict';
import { readMaterialSupplement } from '../lib/material-source-reader.ts';
import { signalGenerationSourceHash } from '../../../packages/database/src/signal-generation-store.mjs';

const batchId = '11111111-1111-4111-8111-111111111111';
const itemId = '22222222-2222-4222-8222-222222222222';
const fixture = () => ({
  batch_id: batchId,
  item_id: itemId,
  fence: 1,
  kind: 'url',
  url: 'https://example.com/article',
  content: {
    classification: 'private',
    fragments: [{ index: 0, text: 'Parsed evidence.', locator: { paragraph: 1 } }],
    warnings: [],
  },
});
function pool(row, error) {
  const queries = [],
    releases = [];
  return {
    queries,
    releases,
    connect: async () => ({
      query: async (sql, values) => {
        queries.push({ sql, values });
        if (sql.startsWith('SELECT')) {
          if (error) throw error;
          return { rows: row ? [row] : [] };
        }
        return { rows: [] };
      },
      release: (...args) => releases.push(args),
    }),
  };
}
test('reads URL declaration and parsed output in one owner/fence-scoped read-only transaction', async () => {
  const db = pool(fixture());
  const result = await readMaterialSupplement(db, 'owner', batchId, itemId);
  assert.equal(result.source.fragments[0].id, 'fragment-1');
  assert.equal(result.source.classification, 'private');
  assert.equal(result.contentHash, signalGenerationSourceHash(result.source));
  assert.equal(result.sourceUrl, 'https://example.com/article');
  assert.equal(db.queries[0].sql, 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  const select = db.queries.find((q) => q.sql.startsWith('SELECT'));
  assert.deepEqual(select.values, ['owner', batchId, itemId]);
  for (const pattern of [
    /b.owner_id=\$1/,
    /b.id=\$2/,
    /i.id=\$3/,
    /NOT b.cancelled/,
    /b.deleted_at IS NULL/,
    /i.status='completed'/,
    /i.kind='url'/,
    /o.fence=i.fence/,
    /i.declaration->>'url'/,
  ])
    assert.match(select.sql, pattern);
  assert.equal(db.queries.at(-1).sql, 'COMMIT');
  assert.equal(db.releases.length, 1);
});
test('missing, file, invalid URL, malformed output and failed reads roll back and release', async () => {
  for (const row of [
    null,
    { ...fixture(), kind: 'file' },
    ...[
      'http://example.com/',
      'https://localhost/',
      'https://127.0.0.1/',
      'https://user:pass@example.com/',
      'https://example.com/#x',
    ].map((url) => ({ ...fixture(), url })),
    { ...fixture(), fence: 0 },
    { ...fixture(), content: { classification: 'private', fragments: [] } },
  ]) {
    const db = pool(row);
    await assert.rejects(readMaterialSupplement(db, 'owner', batchId, itemId));
    assert.equal(db.queries.at(-1).sql, 'ROLLBACK');
    assert.equal(db.releases.length, 1);
  }
  const db = pool(null, new Error('db unavailable'));
  await assert.rejects(readMaterialSupplement(db, 'owner', batchId, itemId));
  assert.equal(db.queries.at(-1).sql, 'ROLLBACK');
  assert.equal(db.releases.length, 1);
});
test('rejects invalid owner and identifiers before opening a connection', async () => {
  for (const args of [
    ['', batchId, itemId],
    ['owner', 'bad', itemId],
    ['owner', batchId, 'bad'],
  ]) {
    const db = pool(fixture());
    await assert.rejects(readMaterialSupplement(db, ...args));
    assert.equal(db.queries.length, 0);
  }
});
