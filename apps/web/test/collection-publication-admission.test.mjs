import assert from 'node:assert/strict';
import test from 'node:test';
import { bindCollectionPublicationWindow } from '../lib/collection-publication-admission.ts';
import { automationStableId } from '../../../packages/database/src/automation-contract.mjs';

const owner = 'synthetic-admin';
const runId = '11111111-1111-0111-7111-111111111111';
const batchId = '22222222-2222-4222-8222-222222222222';
const itemId = '33333333-3333-4333-8333-333333333333';
const fallbackBatch = '44444444-4444-4444-8444-444444444444';
const fallbackItem = '55555555-5555-4555-8555-555555555555';
const sourceUrl = 'https://example.com/main-article';
const fallbackUrl = 'https://partner.example.com/original';
const window = {
  windowStart: '2026-10-24T00:00:37.200Z',
  windowEnd: '2026-10-26T00:00:37.200Z',
};
const run = () => ({
  id: runId,
  owner_id: owner,
  created_at: '2026-10-26T00:00:37.200Z',
  snapshot: {
    kind: 'source_collection',
    publicationMode: 'automatic',
    discovery: { lookbackDays: 2, maxSources: 8, keywords: [] },
  },
  result: {
    batchId,
    discovery: {
      ...window,
      articles: [
        {
          url: sourceUrl,
          publishedAt: '2026-10-24',
          alternatives: [{ url: fallbackUrl, publishedAt: '2026-10-25' }],
        },
      ],
    },
    sourceFallbacks: [
      {
        primaryItemId: itemId,
        originalUrl: sourceUrl,
        batchId: fallbackBatch,
        itemId: fallbackItem,
        url: fallbackUrl,
      },
    ],
  },
});
const request = (batch = batchId, item = itemId) => ({
  id: automationStableId({ runId, itemId: item, kind: 'generation' }),
  batchId: batch,
  itemId: item,
});

test('collection admission uses the saved task date, never the current clock or config', () => {
  const original = run();
  original.created_at = new Date(original.created_at);
  assert.deepEqual(bindCollectionPublicationWindow(original, owner, request(), [sourceUrl]), {
    runId,
    ...window,
    sourceUrl,
    discoveredPublishedAt: '2026-10-24',
  });
  // A newly edited config cannot alter this immutable run; tampered run data
  // cannot widen an already-saved discovery window either.
  original.snapshot.discovery.lookbackDays = 30;
  assert.equal(bindCollectionPublicationWindow(original, owner, request(), [sourceUrl]), null);
});

test('fallback pins the selected alternative date and URL rather than the primary source', () => {
  assert.deepEqual(
    bindCollectionPublicationWindow(run(), owner, request(fallbackBatch, fallbackItem), [
      fallbackUrl,
    ]),
    { runId, ...window, sourceUrl: fallbackUrl, discoveredPublishedAt: '2026-10-25' },
  );
  assert.equal(
    bindCollectionPublicationWindow(run(), owner, request(fallbackBatch, fallbackItem), [
      sourceUrl,
    ]),
    null,
  );
  assert.equal(bindCollectionPublicationWindow(run(), owner, request(), [fallbackUrl]), null);
  const missingReceipt = run();
  missingReceipt.result.sourceFallbacks = [];
  assert.equal(
    bindCollectionPublicationWindow(missingReceipt, owner, request(fallbackBatch, fallbackItem), [
      fallbackUrl,
    ]),
    null,
  );
});

test('a wrong task, owner, URL, duplicate article or invalid receipt cannot gain automatic authority', () => {
  assert.equal(bindCollectionPublicationWindow(run(), 'other', request(), [sourceUrl]), null);
  assert.equal(
    bindCollectionPublicationWindow(run(), owner, { ...request(), id: itemId }, [sourceUrl]),
    null,
  );
  assert.equal(bindCollectionPublicationWindow(run(), owner, request(), []), null);
  assert.equal(
    bindCollectionPublicationWindow(run(), owner, request(), [sourceUrl, fallbackUrl]),
    null,
  );
  const duplicate = run();
  duplicate.result.discovery.articles.push(duplicate.result.discovery.articles[0]);
  assert.equal(bindCollectionPublicationWindow(duplicate, owner, request(), [sourceUrl]), null);
  for (const publicationMode of ['manual', undefined]) {
    const original = run();
    original.snapshot.publicationMode = publicationMode;
    assert.equal(bindCollectionPublicationWindow(original, owner, request(), [sourceUrl]), null);
  }
});
