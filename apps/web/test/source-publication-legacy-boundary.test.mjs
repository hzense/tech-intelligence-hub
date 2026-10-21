import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { URL } from 'node:url';
import { build } from 'esbuild';
import { prepareCandidateReview } from '../lib/candidate-review-preparation.ts';
import { createCandidateReviewHandler } from '../lib/admin-candidate-review-handler.ts';
import {
  assessGeneratedCandidates,
  GENERATION_SOURCE_PUBLICATION_CONTRACT,
  GENERATION_RESOURCES_CONTRACT,
} from '../../../packages/ingestion/src/signal-generation-contract.mjs';
import { signalGenerationSourceHash } from '../../../packages/database/src/signal-generation-store.mjs';
import {
  candidateReviewMaterialHash,
  normalizeCandidateReviewRequest,
} from '../../../packages/database/src/candidate-review-contract.mjs';
import { saveCandidateReview } from '../../../packages/database/src/candidate-review-store.mjs';

const { Request } = globalThis;
const code = 'source_publication_requires_manual_confirmation';
const id = '11111111-1111-4111-8111-111111111111';
const reviewId = '22222222-2222-4222-8222-222222222222';
const source = {
  classification: 'private',
  fragments: [
    {
      id: 'fragment-1',
      text: 'Published 2026-10-20. Ada at Lab announced AI X.',
      locator: { paragraph: 1 },
    },
  ],
};
const evidence = [{ fragment_id: 'fragment-1', quote: source.fragments[0].text }];
function fixture(publicationDate = true) {
  const raw = {
    title: 'Lab announced AI X',
    summary: 'Ada announced AI X.',
    event_date: '2026-10-20',
    event_date_evidence: evidence,
    persons: [{ name: 'Ada', role: 'researcher', organization: 'Lab', evidence }],
    organizations: ['Lab'],
    claims: [{ text: 'AI X announced', evidence }],
    signal_type: 'product',
    topic_ids: [],
    resources: [
      { type: 'person', name: 'Ada', introduction: null, event_role: null, evidence },
      { type: 'company', name: 'Lab', introduction: null, event_role: null, evidence },
    ],
    ...(publicationDate ? { date_basis: 'source_published' } : {}),
  };
  const contract = publicationDate
    ? GENERATION_SOURCE_PUBLICATION_CONTRACT
    : GENERATION_RESOURCES_CONTRACT;
  const run = {
    id,
    owner_id: 'owner',
    status: 'completed',
    deleted_at: null,
    snapshot: { source, topics: [], output_contract: contract },
    source_hash: signalGenerationSourceHash(source),
    result: assessGeneratedCandidates(
      { candidates: [raw], reason: 'Fixture' },
      source,
      [],
      contract,
    ),
  };
  const materialHash = candidateReviewMaterialHash(run, 0);
  const draft = {
    title: raw.title,
    summary: raw.summary,
    eventDate: raw.event_date,
    sourceUrls: ['https://example.com/article'],
    personIds: ['ada'],
    organizationIds: ['lab'],
    topicIds: ['ai'],
    eventKey: 'event-example',
    publicEvidenceIds: ['evidence'],
    claims: [{ text: 'AI X announced', evidenceId: 'evidence' }],
  };
  const request = {
    requestId: reviewId,
    runId: id,
    candidateIndex: 0,
    materialHash,
    expectedRevision: 0,
    decision: 'submit_verification',
    note: '',
    draft,
  };
  const review = {
    id: reviewId,
    revision: 1,
    decision: 'submit_verification',
    draft,
    material_hash: materialHash,
  };
  const identity = { runId: id, candidateIndex: 0, expectedReviewRevision: 1, materialHash };
  return { run, request, review, identity };
}
function poolFor(f, options = {}) {
  const queries = [];
  return {
    queries,
    async connect() {
      return {
        release() {},
        async query(sql, parameters) {
          queries.push({ sql, parameters });
          if (sql.startsWith('SELECT id,owner_id,status')) return { rows: [f.run] };
          if (sql.includes('SELECT id,revision,decision,draft')) return { rows: [f.review] };
          if (sql.includes('fingerprint FROM public.candidate_reviews'))
            return { rows: options.saved ? [options.saved] : [] };
          if (sql.includes('FROM public.candidate_review_conversions'))
            return { rows: options.conversion ? [options.conversion] : [] };
          if (sql.includes('INSERT INTO public.candidate_reviews'))
            return { rows: [{ ...f.review, decision: parameters[8] }] };
          if (sql.startsWith('SELECT revision FROM public.candidate_reviews')) return { rows: [] };
          if (/^(BEGIN|SET LOCAL|COMMIT|ROLLBACK|SELECT pg_advisory)/.test(sql))
            return { rows: [] };
          throw new Error(`Unexpected query: ${sql}`);
        },
      };
    },
  };
}
const built = await build({
  entryPoints: [
    new URL('../../../packages/database/src/candidate-review-publication.mjs', import.meta.url)
      .pathname,
  ],
  bundle: true,
  write: false,
  format: 'cjs',
  platform: 'node',
  packages: 'external',
  plugins: [
    {
      name: 'isolate-final-publication-side-effects',
      setup(plugin) {
        plugin.onResolve(
          { filter: /^\.\/signal-publication-service-store\.mjs$/ },
          ({ importer }) =>
            importer.endsWith('/candidate-review-publication.mjs')
              ? { path: 'publication', namespace: 'fixture' }
              : undefined,
        );
        plugin.onResolve(
          { filter: /^\.\/signal-publication-control-store\.mjs$/ },
          ({ importer }) =>
            importer.endsWith('/candidate-review-publication.mjs')
              ? { path: 'control', namespace: 'fixture' }
              : undefined,
        );
        plugin.onLoad({ filter: /.*/, namespace: 'fixture' }, ({ path }) => ({
          contents:
            path === 'publication'
              ? 'export const publishVerifiedSignal = async ({request}) => ({outcome:"replay", request}); export const withdrawPublicSignal = async ({request}) => ({outcome:"withdrawn", request});'
              : 'export const createPrivatePublicationRun = async () => { throw Error("No new control run"); }; export const claimPrivatePublicationRun = async () => { throw Error("No claim"); }; export const completePrivatePublicationRun = async () => ({});',
          loader: 'js',
        }));
      },
    },
  ],
});
const mod = { exports: {} };
new Function('require', 'module', 'exports', built.outputFiles[0].text)(
  createRequire(import.meta.url),
  mod,
  mod.exports,
);
const {
  prepareReviewedSignalCandidate,
  publishReviewedSignal,
  withdrawReviewedSignal,
  inspectReviewedCandidate,
} = mod.exports;

test('legacy preparation labels source publication dates and never creates an event-date draft', () => {
  const f = fixture();
  const candidate = f.run.result.candidates[0];
  const catalog = {
    people: [{ id: 'ada', name: 'Ada' }],
    organizations: [{ id: 'lab', name: 'Lab' }],
    topics: [{ id: 'ai', name: 'AI' }],
    evidence: [
      {
        id: 'evidence',
        source_url: 'https://example.com/article',
        excerpt: source.fragments[0].text,
        allowed_hosts: ['example.com'],
      },
    ],
  };
  const result = prepareCandidateReview(candidate, catalog, {
    topicIds: ['ai'],
    planHash: 'a'.repeat(64),
  });
  assert.equal(result.ready, false);
  assert.match(result.blockers.join(' '), /人工确认发布入口/);
  assert.equal(result.draft, undefined);
  assert.equal(result.materials.items[0].label, '原文发布日期');
  const legacy = fixture(false);
  assert.equal(
    prepareCandidateReview(legacy.run.result.candidates[0], catalog, {
      topicIds: ['ai'],
      planHash: 'a'.repeat(64),
    }).ready,
    true,
  );
});

test('DB review store rejects new legacy submission but preserves drafts and committed replays', async () => {
  const f = fixture();
  const blocked = poolFor(f);
  await assert.rejects(
    saveCandidateReview({
      pool: blocked,
      owner: 'owner',
      request: f.request,
      materialHash: f.request.materialHash,
    }),
    { code },
  );
  assert.ok(blocked.queries.every(({ sql }) => !sql.startsWith('INSERT')));
  const request = normalizeCandidateReviewRequest(f.request);
  const saved = {
    ...f.review,
    fingerprint: createHash('sha256')
      .update(JSON.stringify({ owner: 'owner', ...request }))
      .digest('hex'),
  };
  assert.equal(
    (
      await saveCandidateReview({
        pool: poolFor(f, { saved }),
        owner: 'owner',
        request,
        materialHash: request.materialHash,
      })
    ).id,
    reviewId,
  );
  assert.equal(
    (
      await saveCandidateReview({
        pool: poolFor(f),
        owner: 'owner',
        request: { ...f.request, decision: 'draft' },
        materialHash: request.materialHash,
      })
    ).decision,
    'draft',
  );
  const legacy = fixture(false);
  assert.equal(
    (
      await saveCandidateReview({
        pool: poolFor(legacy),
        owner: 'owner',
        request: legacy.request,
        materialHash: legacy.request.materialHash,
      })
    ).decision,
    'submit_verification',
  );
});

test('DB conversion rejects new source-date conversions after authenticating material, but preserves receipts', async () => {
  const f = fixture();
  const request = { ...f.identity, requestKey: 'conversion-one' };
  const blocked = poolFor(f);
  await assert.rejects(prepareReviewedSignalCandidate({ pool: blocked, owner: 'owner', request }), {
    code,
  });
  assert.ok(blocked.queries.every(({ sql }) => !sql.startsWith('INSERT')));
  const conversion = {
    request_key: request.requestKey,
    review_id: reviewId,
    signal_id: 'review-example',
    source_version: 1,
  };
  assert.equal(
    (
      await prepareReviewedSignalCandidate({
        pool: poolFor(f, { conversion }),
        owner: 'owner',
        request,
      })
    ).outcome,
    'replay',
  );
});

test('publication boundary blocks new source-date publication without a control run while replay, reads and withdrawal remain available', async () => {
  const f = fixture();
  const conversion = {
    request_key: 'conversion-one',
    review_id: reviewId,
    signal_id: 'review-example',
    source_version: 1,
  };
  const request = {
    ...f.identity,
    requestKey: 'publish-one',
    expectedPublicationRevision: 0,
    reasonCode: 'initial_publication',
  };
  const trustedControl = { taskId: id, principalId: reviewId };
  const publisher = (previous) => ({
    async connect() {
      return {
        release() {},
        async query() {
          return { rows: previous ? [previous] : [] };
        },
      };
    },
  });
  const controlPool = {
    connect() {
      throw new Error('New control work forbidden');
    },
  };
  await assert.rejects(
    publishReviewedSignal({
      pool: poolFor(f, { conversion }),
      publisherPool: publisher(null),
      controlPool,
      owner: 'owner',
      request,
      trustedControl,
    }),
    { code },
  );
  const previous = {
    request_key: request.requestKey,
    signal_id: conversion.signal_id,
    source_version: 2,
    target_version: 3,
    expected_revision: 0,
    reason_code: 'initial_publication',
    run_id: id,
    lease_owner: reviewId,
    fencing_token: 1,
  };
  assert.equal(
    (
      await publishReviewedSignal({
        pool: poolFor(f, { conversion }),
        publisherPool: publisher(previous),
        controlPool,
        owner: 'owner',
        request,
        trustedControl,
      })
    ).outcome,
    'replay',
  );
  assert.equal(
    (await inspectReviewedCandidate({ pool: poolFor(f), owner: 'owner', request: f.identity }))
      .readiness,
    'conversion_required',
  );
  assert.equal(
    (
      await withdrawReviewedSignal({
        pool: poolFor(f, { conversion }),
        publisherPool: publisher(null),
        owner: 'owner',
        request: { ...request, expectedPublicationRevision: 1, reasonCode: 'operator_request' },
      })
    ).outcome,
    'withdrawn',
  );
});

test('legacy review API returns a safe actionable conflict for the source-publication boundary', async () => {
  const handler = createCandidateReviewHandler({
    session: async () => ({ user: { id: 'owner' } }),
    origin: () => 'https://example.com',
    read: async () => ({}),
    confirm: async () => {
      throw Object.assign(new Error(code), { code });
    },
    enrich: async () => ({}),
    operate: async () => {
      throw Object.assign(new Error(code), { code });
    },
  });
  for (const action of ['confirm', 'prepare', 'publish']) {
    const response = await handler(
      new Request('https://example.com/api/admin/candidate-review', {
        method: 'POST',
        headers: {
          host: 'example.com',
          origin: 'https://example.com',
          'content-type': 'application/json',
        },
        body: JSON.stringify({ action, request: {} }),
      }),
    );
    assert.equal(response.status, 409);
    assert.deepEqual(await response.json(), { error: code });
  }
});
