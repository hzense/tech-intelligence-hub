import assert from 'node:assert/strict';
import test from 'node:test';
import { withGenerationPublications } from '../lib/generation-publication.ts';

const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const publicId = `editorial-${'a'.repeat(32)}`;
const run = (n, indexes = [0]) => ({
  id: id(n),
  status: 'completed',
  result: {
    classification: 'private',
    candidates: indexes.map((index) => ({
      index,
      classification: 'private',
      status: 'needs_review',
    })),
  },
});
const receipt = (candidate_index, action, revision = 1) => ({
  candidate_index,
  action,
  revision,
  public_id: action === 'publish' ? publicId : null,
});
const unknown = { state: 'unavailable', candidates: [] };

test('latest per-candidate publication states are merged in one read without changing AI output', async () => {
  const runs = [run(1, [4, 0, 3, 2]), run(2), { ...run(3), status: 'running' }];
  const original = globalThis.structuredClone(runs);
  const calls = [];
  const result = await withGenerationPublications(runs, async (ids) => {
    calls.push(ids);
    return [
      {
        run_id: id(1),
        candidates: [receipt(0, 'publish', 3), receipt(2, 'withdraw', 2), receipt(4, 'draft')],
      },
      { run_id: id(2), candidates: [] },
    ];
  });
  assert.deepEqual(calls, [[id(1), id(2)]]);
  assert.deepEqual(result[0].publication, {
    state: 'available',
    candidates: [
      { index: 4, status: 'draft', publicId: null },
      { index: 0, status: 'published', publicId },
      { index: 3, status: 'unpublished', publicId: null },
      { index: 2, status: 'withdrawn', publicId: null },
    ],
  });
  assert.equal(result[1].publication.candidates[0].status, 'unpublished');
  assert.equal(Object.hasOwn(result[2], 'publication'), false);
  assert.deepEqual(runs, original);
  assert.equal(result[0].result, runs[0].result);
});

test('read failures, missing owner-scoped runs, duplicate or malformed receipts never mean unpublished', async () => {
  for (const read of [
    async () => {
      throw new Error('not configured');
    },
    async () => [],
    async () => null,
    async () => [{ run_id: id(2), candidates: [] }],
    async () => [
      { run_id: id(1), candidates: [] },
      { run_id: id(1), candidates: [] },
    ],
    ...[
      [receipt(0, 'publish'), receipt(0, 'withdraw')],
      [receipt(4, 'publish')],
      [{ ...receipt(0, 'publish'), public_id: 'javascript:alert(1)' }],
      [{ ...receipt(0, 'draft'), public_id: publicId }],
      [{ ...receipt(0, 'publish'), revision: 0 }],
      [{ ...receipt(0, 'publish'), action: 'approved' }],
    ].map((candidates) => async () => [{ run_id: id(1), candidates }]),
  ]) {
    const result = await withGenerationPublications([run(1)], read);
    assert.deepEqual(result[0].publication, unknown);
  }
});

test('only accepted bounded unique indexes are eligible, never rejected or malformed output', async () => {
  const malformed = [
    { ...run(1), id: 'bad' },
    { ...run(1), result: null },
    { ...run(1), result: { classification: 'public', candidates: [] } },
    run(1, [0, 0]),
    run(1, [5]),
    run(1, [-1]),
    run(1, ['0']),
    run(1, [0, 1, 2, 3, 4, 5]),
    {
      ...run(1),
      result: {
        classification: 'private',
        candidates: [{ index: 0, classification: 'private', status: 'rejected' }],
      },
    },
  ];
  for (const input of malformed) {
    let reads = 0;
    const result = await withGenerationPublications([input], async () => {
      reads++;
      return [];
    });
    assert.equal(reads, 0);
    assert.deepEqual(result[0].publication, unknown);
  }
  for (const status of ['pending', 'failed', 'unknown', 'cancelled', 'running']) {
    const result = await withGenerationPublications([{ ...run(1), status }], async () => {
      throw new Error('must not read');
    });
    assert.equal(Object.hasOwn(result[0], 'publication'), false);
  }
});

test('a completed task with no accepted candidates has an empty available projection after a successful read', async () => {
  const result = await withGenerationPublications([run(1, [])], async () => [
    { run_id: id(1), candidates: [] },
  ]);
  assert.deepEqual(result[0].publication, { state: 'available', candidates: [] });
});
