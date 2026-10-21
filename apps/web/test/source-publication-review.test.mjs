import test from 'node:test';
import assert from 'node:assert/strict';
import { createEditorialReviewService } from '../lib/editorial-review-service.ts';
import { editorialCandidateDate, editorialMissing } from '../lib/editorial-review.ts';
import { normalizeEditorialRequest } from '../../../packages/database/src/editorial-signal-contract.mjs';
import { editorialUnifiedContent } from '../../../packages/database/src/unified-signal-plan.mjs';
import { mapEditorialSignalRows } from '../lib/editorial-signal-reader-core.ts';
import {
  mapUnifiedSignalRows,
  unifiedPublicListQuery,
  unifiedPublicByIdQuery,
  unifiedPublicProbeQuery,
} from '../lib/unified-signal-reader-core.ts';
import { toUnifiedSignal } from '../lib/unified-signal-core.ts';

const runId = '11111111-1111-4111-8111-111111111111';
const requestId = '22222222-2222-4222-8222-222222222222';
const content = {
  title: 'Source-date example',
  summary: 'The article describes an earlier event.',
  eventDate: '2026-10-20',
  dateBasis: 'source_published',
  signalType: 'product',
  organizations: ['Example organization'],
  persons: ['Example person'],
  topics: [{ id: 'ai', title: 'AI' }],
  sourceUrls: ['https://example.com/article'],
};

test('historical event-date supplementation never substitutes for original source publication dates', () => {
  assert.deepEqual(editorialCandidateDate('source_published', '2026-10-20', '2026-10-18'), {
    eventDate: '2026-10-20',
    dateBasis: 'source_published',
  });
  assert.deepEqual(editorialCandidateDate('source_published', null, '2026-10-18'), {
    eventDate: null,
    dateBasis: 'source_published',
  });
  assert.deepEqual(editorialCandidateDate(undefined, '2026-10-20', '2026-10-18'), {
    eventDate: '2026-10-18',
  });
  assert.deepEqual(
    editorialCandidateDate('source_published', null, '2026-10-20', 'source_published'),
    {
      eventDate: '2026-10-20',
      dateBasis: 'source_published',
    },
  );
  assert.deepEqual(
    editorialCandidateDate('source_published', '2026-10-20', '2026-10-21', 'source_published'),
    {
      eventDate: '2026-10-20',
      dateBasis: 'source_published',
    },
  );
});

test('review binds the date policy to server material and allows a manual publication-date correction', async () => {
  const service = createEditorialReviewService({
    enabled: () => true,
    material: async () => ({ materialHash: 'a'.repeat(64), content, warnings: [] }),
    topics: async () => content.topics,
    read: async () => null,
    save: async (_owner, request, material) => {
      normalizeEditorialRequest(request, material);
      assert.equal(material.dateBasis, 'source_published');
      return {
        request_id: request.requestId,
        revision: 1,
        action: request.action,
        content: request.content,
      };
    },
  });
  assert.equal((await service.read('owner', runId, 0)).content.dateBasis, 'source_published');
  assert.deepEqual(editorialMissing({ ...content, eventDate: null }), ['原文发布日期']);
  const request = {
    requestId,
    runId,
    candidateIndex: 0,
    expectedRevision: 0,
    materialHash: 'a'.repeat(64),
    action: 'publish',
    consent: true,
    content: { ...content, eventDate: '2026-10-19' },
  };
  assert.equal((await service.write('owner', request)).content.eventDate, '2026-10-19');
  const { dateBasis, ...withoutPolicy } = request.content;
  void dateBasis;
  await assert.rejects(service.write('owner', { ...request, content: withoutPolicy }), {
    code: 'material_changed',
  });
});

test('source publication dates flow to public sorting while site publication time remains independent', () => {
  const id = `editorial-${'a'.repeat(32)}`;
  const siteTime = '2026-10-21T12:00:00.000Z';
  const unifiedContent = editorialUnifiedContent(content);
  assert.equal(Object.keys(unifiedContent).length, 13, 'no physical storage-envelope change');
  assert.equal(unifiedContent.occurred_at, '2026-10-20');
  assert.equal(unifiedContent.captured_at, null);
  const row = {
    signal_id: id,
    version: 1,
    origin: 'ai_generation',
    publication_basis: 'manual_confirmation',
    content: unifiedContent,
    recorded_at: siteTime,
    date_basis: 'source_published',
  };
  const legacy = {
    ...row,
    signal_id: `editorial-${'b'.repeat(32)}`,
    date_basis: null,
    content: { ...unifiedContent, occurred_at: '2026-10-18' },
    recorded_at: '2026-10-22T12:00:00.000Z',
  };
  const [first, second] = mapUnifiedSignalRows([legacy, row]);
  assert.equal(first.id, id, 'sorts the article date, not HZense publication time');
  assert.equal(first.occurred_at, '2026-10-20T00:00:00.000Z');
  assert.equal(first.captured_at, siteTime);
  assert.equal(toUnifiedSignal(first).dateBasis, 'source_published');
  assert.equal(Object.hasOwn(second, 'date_basis'), false, 'legacy date is not relabeled');
  const direct = mapEditorialSignalRows([
    { signal_id: id, revision: 1, content, published_at: siteTime },
  ])[0];
  assert.deepEqual(toUnifiedSignal(first), toUnifiedSignal(direct));
  assert.throws(() => mapUnifiedSignalRows([{ ...row, date_basis: 'site_published' }]));
  for (const query of [unifiedPublicListQuery, unifiedPublicByIdQuery, unifiedPublicProbeQuery]) {
    assert.match(query, /e\.content->>'dateBasis' AS date_basis/);
    assert.match(
      query,
      /LEFT JOIN public\.editorial_public_signals e ON u\.origin='ai_generation'/,
    );
    assert.match(query, /e\.signal_id=u\.signal_id AND e\.revision=u\.version/);
    assert.doesNotMatch(query, /editorial_signal_revisions|signal_generation_runs/);
  }
});
