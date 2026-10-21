import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import test from 'node:test';
import { URL } from 'node:url';
import { build } from 'esbuild';
import {
  assessGeneratedCandidates,
  GENERATION_RESOURCES_CONTRACT,
  normalizeGeneratedCandidates,
} from '../../../packages/ingestion/src/signal-generation-contract.mjs';
import { candidateReviewMaterialHash } from '../../../packages/database/src/candidate-review-contract.mjs';
import {
  contentReadiness,
  normalizeEditorialRequest,
} from '../../../packages/database/src/editorial-signal-contract.mjs';
import { signalGenerationSourceHash } from '../../../packages/database/src/signal-generation-store.mjs';
import { buildCandidateReview } from '../lib/candidate-review.ts';
import { editorialMissing } from '../lib/editorial-review.ts';

const { structuredClone } = globalThis;
const runId = '11111111-1111-4111-8111-111111111111';
const sourceUrl = 'https://example.com/announcement';
const topics = [{ id: 'topic-ai', title: '人工智能' }];
const dateReference = { fragment_id: 'fragment-2', quote: 'today' };
const source = {
  classification: 'private',
  fragments: [
    { id: 'fragment-1', text: 'Lab announced X.', locator: { paragraph: 1 } },
    {
      id: 'fragment-2',
      text: 'The announcement was made today; its calendar date is not supplied.',
      locator: { paragraph: 2 },
    },
  ],
};
const raw = {
  title: 'Lab 发布 X',
  summary: 'Lab 发布 X，原文没有明确事件日期。',
  event_date: null,
  event_date_evidence: [dateReference],
  persons: [],
  organizations: ['Lab'],
  claims: [
    { text: 'Lab 发布 X。', evidence: [{ fragment_id: 'fragment-1', quote: 'Lab announced X.' }] },
  ],
  signal_type: 'product',
  topic_ids: ['topic-ai'],
  resources: [
    {
      type: 'company',
      name: 'Lab',
      introduction: null,
      event_role: null,
      evidence: [{ fragment_id: 'fragment-1', quote: 'Lab' }],
    },
  ],
};
function fixture() {
  return {
    id: runId,
    owner_id: 'owner',
    status: 'completed',
    deleted_at: null,
    source_hash: signalGenerationSourceHash(source),
    snapshot: {
      source: structuredClone(source),
      topics: structuredClone(topics),
      output_contract: GENERATION_RESOURCES_CONTRACT,
    },
    result: assessGeneratedCandidates(
      { candidates: [structuredClone(raw)], reason: '私有候选' },
      source,
      topics,
      GENERATION_RESOURCES_CONTRACT,
    ),
  };
}

test('unknown-date drafts remain reviewable with exact clues, immutable evidence and a stable cross-layer material hash', () => {
  const run = fixture();
  const before = JSON.stringify(run);
  const packet = buildCandidateReview(run, 0);
  assert.equal(packet.candidate.event_date, null);
  assert.deepEqual(packet.candidate.event_date_evidence, [dateReference]);
  assert.ok(packet.candidate.issues.includes('needs_event_time'));
  assert.ok(packet.checks.some(({ code }) => code === 'event_time'));
  assert.deepEqual(packet.fragments, source.fragments);
  assert.equal(packet.canPublish, false);
  assert.equal(packet.materialHash, candidateReviewMaterialHash(run, 0));
  assert.equal(JSON.stringify(run), before);

  // Stored/model flags are never trusted as readiness or identity inputs.
  run.result.candidates[0].issues = [];
  const rechecked = buildCandidateReview(run, 0);
  assert.ok(rechecked.candidate.issues.includes('needs_event_time'));
  assert.equal(rechecked.materialHash, packet.materialHash);
  assert.equal(candidateReviewMaterialHash(run, 0), packet.materialHash);
  assert.throws(() =>
    normalizeGeneratedCandidates(
      { candidates: [raw], reason: '严格校验' },
      source,
      topics,
      GENERATION_RESOURCES_CONTRACT,
    ),
  );
});

test('read-only review rejects forged date clues instead of making invalid historical records reviewable', () => {
  for (const reference of [
    { ...dateReference, fragment_id: 'fragment-missing' },
    { ...dateReference, quote: '2026-10-21' },
  ]) {
    const run = fixture();
    run.result.candidates[0].event_date_evidence = [reference];
    assert.throws(() => buildCandidateReview(run, 0), { message: 'candidate_review_unavailable' });
    assert.throws(() => candidateReviewMaterialHash(run, 0), { code: 'material_changed' });
  }
});

async function actualEditorialService() {
  const modules = {
    'server-only': 'export {};',
    '../unified-signal-mode': 'export const unifiedSignalEnabled = () => false;',
    '../../../../packages/database/src/editorial-signal-store.mjs': `
      export const saveEditorialSignal = async (args) => globalThis.__unknownDateTest.save(args);
      export const readEditorialSignal = async () => null;
      export const previewEditorialResources = async () => [];
    `,
    './signal-generation':
      'export const generationRecord = async () => globalThis.__unknownDateTest.run;',
    './candidate-enrichment': 'export const listCandidateEnrichmentDtos = async () => [];',
    './material-registration': 'export const materialPublicationPreview = async () => null;',
    './editorial-database': `
      export const editorialPool = {};
      export const editorialPublicationEnabled = () => true;
      export const editorialResourcePublicationReady = async () => true;
    `,
    './candidate-review-database': 'export const candidateReviewPool = {};',
    './editorial-topics':
      'export const editorialTopicOptions = async () => globalThis.__unknownDateTest.topics;',
    './generation-import-reader': 'export const importPool = {};',
    '../material-source-reader': 'export const readMaterialSupplement = async () => null;',
    '../editorial-source-options':
      'export const readEditorialSourceOptions = async () => [globalThis.__unknownDateTest.sourceUrl];',
    '../seed-runtime': 'export const getResourceEntries = async () => [];',
    '../local-generation': 'export const localFixtureSourceOptions = () => [];',
  };
  const bundled = await build({
    entryPoints: [new URL('../lib/server/editorial-review.ts', import.meta.url).pathname],
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'node',
    plugins: [
      {
        name: 'isolate-unknown-date-editorial-io',
        setup(plugin) {
          plugin.onResolve({ filter: /.*/ }, (args) =>
            modules[args.path] === undefined
              ? undefined
              : { path: args.path, namespace: 'fixture' },
          );
          plugin.onLoad({ filter: /.*/, namespace: 'fixture' }, (args) => ({
            contents: modules[args.path],
            loader: 'js',
          }));
        },
      },
    ],
  });
  return import(
    `data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`
  );
}

test('actual editorial review allows saving a draft but blocks publication until a date is explicitly supplied', async () => {
  const run = fixture();
  const saved = [];
  globalThis.__unknownDateTest = {
    run,
    topics,
    sourceUrl,
    async save(args) {
      // Exercise the same publication guard the database store invokes.
      const checked = normalizeEditorialRequest(args.request, args.material);
      saved.push(checked);
      return {
        request_id: checked.requestId,
        revision: 1,
        action: checked.action,
        content: checked.content,
      };
    },
  };
  try {
    const { editorialDashboard, writeEditorialReview } = await actualEditorialService();
    const dashboard = await editorialDashboard('owner', runId, 0);
    const content = { ...dashboard.content, sourceUrls: [sourceUrl] };
    assert.equal(content.eventDate, null);
    assert.deepEqual(dashboard.missingResourceDetails, []);
    assert.deepEqual(contentReadiness(content), { ready: false, missing: ['eventDate'] });
    assert.deepEqual(editorialMissing(content, [], dashboard.resourceSourceOptions), ['事件日期']);
    const request = {
      requestId: '22222222-2222-4222-8222-222222222222',
      runId,
      candidateIndex: 0,
      materialHash: dashboard.materialHash,
      expectedRevision: 0,
      action: 'publish',
      consent: true,
      content,
    };
    await assert.rejects(writeEditorialReview('owner', request), { code: 'confirmation_required' });
    assert.deepEqual(saved, []);
    const draft = await writeEditorialReview('owner', {
      ...request,
      action: 'draft',
      consent: false,
    });
    assert.equal(draft.action, 'draft');
    assert.equal(draft.content.eventDate, null);
    assert.equal(draft.publicId, null);

    // A human-supplied date is separate from immutable AI evidence and does not
    // silently rewrite the original candidate or its review identity.
    const before = JSON.stringify(run);
    const complete = { ...content, eventDate: '2026-10-20' };
    assert.deepEqual(contentReadiness(complete), { ready: true, missing: [] });
    const published = await writeEditorialReview('owner', { ...request, content: complete });
    assert.equal(published.action, 'publish');
    assert.ok(published.publicId);
    assert.equal(JSON.stringify(run), before);
    assert.equal(buildCandidateReview(run, 0).materialHash, dashboard.materialHash);
    assert.deepEqual(run.result.candidates[0].event_date_evidence, [dateReference]);
  } finally {
    delete globalThis.__unknownDateTest;
  }
});
