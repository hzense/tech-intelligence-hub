import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import process from 'node:process';
import test from 'node:test';
import { fileURLToPath, URL } from 'node:url';
import { build } from 'esbuild';
import {
  assessGeneratedCandidates,
  GENERATION_SOURCE_PUBLICATION_CONTRACT,
} from '../../../packages/ingestion/src/signal-generation-contract.mjs';
import { signalGenerationSourceHash } from '../../../packages/database/src/signal-generation-store.mjs';
import { normalizeEditorialRequest } from '../../../packages/database/src/editorial-signal-contract.mjs';
import { previewEditorialResources } from '../../../packages/database/src/editorial-resource-store.mjs';

const owner = 'synthetic-admin';
const runId = '11111111-1111-4111-8111-111111111111';
const sourceUrl = 'https://news.example.com/articles/research';
const topics = [{ id: 'topic-language-models', title: '语言模型' }];
const { structuredClone } = globalThis;

function fixture() {
  const source = {
    classification: 'private',
    fragments: [
      {
        id: 'fragment-1',
        text: 'Published October 20, 2026. Example Lab released a new model.',
        locator: { paragraph: 1 },
      },
    ],
  };
  const evidence = [{ fragment_id: 'fragment-1', quote: 'Example Lab released a new model.' }];
  const result = assessGeneratedCandidates(
    {
      candidates: [
        {
          title: 'Example Lab 发布模型',
          summary: 'Example Lab 发布新模型。',
          event_date: '2026-10-20',
          date_basis: 'source_published',
          event_date_evidence: [
            { fragment_id: 'fragment-1', quote: 'Published October 20, 2026.' },
          ],
          signal_type: 'product',
          topic_ids: ['topic-language-models'],
          organizations: ['Example Lab'],
          persons: [],
          resources: [
            {
              name: 'Example Lab',
              type: 'institution',
              introduction: null,
              event_role: '模型发布者',
              evidence,
            },
          ],
          claims: [{ text: 'Example Lab 发布新模型。', evidence }],
        },
      ],
      reason: 'Synthetic private result',
    },
    source,
    topics,
    GENERATION_SOURCE_PUBLICATION_CONTRACT,
  );
  assert.equal(result.candidates.length, 1);
  const state = {
    run: {
      id: runId,
      owner_id: owner,
      batch_id: runId,
      item_id: runId,
      source_fence: 1,
      source_hash: signalGenerationSourceHash(source),
      generation_version: 'private-candidate-v1',
      status: 'completed',
      deleted_at: null,
      snapshot: {
        source,
        topics,
        output_contract: GENERATION_SOURCE_PUBLICATION_CONTRACT,
        publication: { mode: 'automatic', policy: 'auto-publication-v1', sourceUrls: [sourceUrl] },
      },
      result,
    },
    saved: null,
    writes: [],
    enrichmentReads: 0,
    enrichmentFailAfter: Infinity,
    race: null,
    previewEditorialResources,
    pool: {
      async connect() {
        return {
          async query(sql) {
            assert.equal(
              sql,
              'SELECT id,name,type,status,aliases FROM public.entities ORDER BY id LIMIT 10001',
            );
            return { rows: [] };
          },
          release() {},
        };
      },
    },
    save(args) {
      // The transactional store's revision locking is covered by real PostgreSQL
      // integration tests. Preserve its preconditions at this service boundary.
      const request = normalizeEditorialRequest(args.request, args.material, {
        automatic: args.automatic,
      });
      if (state.race) {
        state.saved = {
          request_id: '22222222-2222-4222-8222-222222222222',
          revision: 1,
          action: state.race,
          content: { ...structuredClone(request.content), title: 'Manual revision must survive' },
          publication_basis: 'manual_confirmation',
        };
        state.race = null;
      }
      if (request.expectedRevision !== (state.saved?.revision ?? 0))
        throw Object.assign(new Error('revision_conflict'), { code: 'revision_conflict' });
      state.writes.push(args);
      state.saved = {
        request_id: request.requestId,
        revision: request.expectedRevision + 1,
        action: request.action,
        content: structuredClone(request.content),
        publication_basis: args.automatic ? 'automatic_checks' : 'manual_confirmation',
      };
      return structuredClone(state.saved);
    },
  };
  return state;
}

async function compile() {
  const modules = {
    'server-only': '',
    './signal-generation': `
      export async function generationRecord(owner,id){
        const f=globalThis.__automaticEditorialAdapter;
        if(owner!==f.run.owner_id || id!==f.run.id)throw Error('not_found');
        return structuredClone(f.run);
      }
    `,
    './candidate-enrichment': `
      export async function listCandidateEnrichmentDtos(){
        const f=globalThis.__automaticEditorialAdapter;
        if(++f.enrichmentReads>f.enrichmentFailAfter)throw Error('Supplement read unavailable');
        return [];
      }
    `,
    './material-registration': 'export const materialPublicationPreview=async()=>({});',
    './editorial-database': `
      export const editorialPool={};
      export const editorialPublicationEnabled=()=>true;
      export const editorialResourcePublicationReady=async()=>true;
    `,
    './candidate-review-database':
      'export const candidateReviewPool={connect:()=>globalThis.__automaticEditorialAdapter.pool.connect()};',
    './generation-import-reader': 'export const importPool={};',
    './editorial-topics': `export const editorialTopicOptions=async()=>${JSON.stringify(topics)};`,
    '../material-source-reader': `
      export async function readMaterialSupplement(_pool,owner,batchId,itemId){
        const f=globalThis.__automaticEditorialAdapter;
        if(owner!==f.run.owner_id)throw Error('not_found');
        return {batchId,itemId,fence:f.run.source_fence,contentHash:f.run.source_hash,sourceUrl:${JSON.stringify(sourceUrl)}};
      }
    `,
    '../seed-runtime': 'export const getResourceEntries=async()=>[];',
    '../../../../packages/database/src/editorial-signal-store.mjs': `
      export const readEditorialSignal=async()=>structuredClone(globalThis.__automaticEditorialAdapter.saved);
      export const saveEditorialSignal=async(args)=>globalThis.__automaticEditorialAdapter.save(args);
      export const previewEditorialResources=(args)=>globalThis.__automaticEditorialAdapter.previewEditorialResources(args);
    `,
  };
  const compiled = await build({
    stdin: {
      contents:
        "export {editorialDashboard,publishGeneratedSignals,writeEditorialReview} from './lib/server/editorial-review';",
      resolveDir: fileURLToPath(new URL('..', import.meta.url)),
      loader: 'ts',
    },
    bundle: true,
    write: false,
    platform: 'node',
    format: 'cjs',
    packages: 'external',
    plugins: [
      {
        name: 'isolate-editorial-storage-not-dashboard',
        setup(builder) {
          builder.onResolve({ filter: /.*/ }, ({ path }) =>
            Object.hasOwn(modules, path) ? { path, namespace: 'fixture' } : undefined,
          );
          builder.onLoad({ filter: /.*/, namespace: 'fixture' }, ({ path }) => ({
            contents: modules[path],
            loader: 'js',
          }));
        },
      },
    ],
  });
  const module = { exports: {} };
  new Function('require', 'module', 'exports', compiled.outputFiles[0].text)(
    createRequire(import.meta.url),
    module,
    module.exports,
  );
  return module.exports;
}
const compiled = compile();
async function setup(t) {
  const previous = process.env;
  process.env = {
    HZENSE_AUTOMATIC_PUBLICATION_ENABLED: '1',
    HZENSE_EDITORIAL_PUBLICATION_ENABLED: '1',
    HZENSE_UNIFIED_SIGNAL_ENABLED: '1',
  };
  const state = (globalThis.__automaticEditorialAdapter = fixture());
  t.after(() => {
    process.env = previous;
    delete globalThis.__automaticEditorialAdapter;
  });
  return { state, ...(await compiled) };
}

test('real server candidate material becomes automatically published and reports committed state', async (t) => {
  const { state, editorialDashboard, publishGeneratedSignals } = await setup(t);
  const ready = await editorialDashboard(owner, runId, 0);
  assert.deepEqual(ready.warnings, []);
  assert.equal(ready.automaticPublication.status, 'pending');
  assert.equal(ready.content.dateBasis, 'source_published');
  assert.deepEqual(ready.content.topics, topics);
  assert.deepEqual(ready.sourceOptions, [sourceUrl]);
  assert.equal(ready.resourceOptions[0].status, 'new');
  const result = await publishGeneratedSignals(owner, runId);
  assert.equal(result.candidates[0].status, 'published');
  assert.equal(state.writes.length, 1);
  assert.equal(state.writes[0].automatic, true);
  assert.equal(state.writes[0].unified, true);
  assert.equal(state.writes[0].request.expectedRevision, 0);
  assert.equal(state.writes[0].request.consent, false);
  const saved = await editorialDashboard(owner, runId, 0);
  assert.equal(saved.action, 'publish');
  assert.equal(saved.publicationBasis, 'automatic_checks');
  assert.equal(saved.automaticPublication.status, 'published');
  assert.match(saved.publicId, /^editorial-[a-f0-9]{32}$/);
  await publishGeneratedSignals(owner, runId);
  assert.equal(state.writes.length, 1, 'Retry reads the current revision without another write');
});

test('real server preserves manual drafts, edits and withdrawals that win after automatic preview', async (t) => {
  const { state, editorialDashboard, publishGeneratedSignals } = await setup(t);
  for (const action of ['draft', 'publish', 'withdraw']) {
    state.saved = null;
    state.race = action;
    const result = await publishGeneratedSignals(owner, runId);
    assert.equal(result.candidates[0].status, 'needs_attention');
    assert.equal(state.saved.action, action);
    assert.equal(state.saved.content.title, 'Manual revision must survive');
    const dashboard = await editorialDashboard(owner, runId, 0);
    assert.equal(
      dashboard.automaticPublication.status,
      action === 'publish' ? 'published' : 'skipped',
    );
    await publishGeneratedSignals(owner, runId);
    assert.equal(state.saved.content.title, 'Manual revision must survive');
  }
  assert.equal(state.writes.length, 0);
});

test('real extracted source date outside the discovery window stays private through dashboard and publication service', async (t) => {
  const { state, editorialDashboard, publishGeneratedSignals } = await setup(t);
  state.run.snapshot.publication.collection = {
    runId,
    windowStart: '2026-10-24T00:00:37.200Z',
    windowEnd: '2026-10-26T00:00:37.200Z',
    sourceUrl,
    discoveredPublishedAt: '2026-10-24',
  };
  const original = structuredClone(state.run.result);
  const dashboard = await editorialDashboard(owner, runId, 0);
  assert.equal(dashboard.content.eventDate, '2026-10-20');
  assert.equal(dashboard.automaticPublication.status, 'needs_attention');
  assert.match(
    dashboard.automaticPublication.reasons.join(' '),
    /2026-10-20.*2026-10-24.*2026-10-26/,
  );
  const result = await publishGeneratedSignals(owner, runId);
  assert.equal(result.candidates[0].status, 'needs_attention');
  assert.equal(state.writes.length, 0);
  assert.equal(state.saved, null);
  assert.deepEqual(state.run.result, original);
});

test('automatic server write does not publish when supplementary reads fail after a successful preview', async (t) => {
  const { state, publishGeneratedSignals } = await setup(t);
  state.enrichmentFailAfter = 1;
  const result = await publishGeneratedSignals(owner, runId);
  assert.equal(result.candidates[0].status, 'needs_attention');
  assert.equal(state.writes.length, 0);
});

test('unavailable supplementary reads still allow an explicitly manual draft', async (t) => {
  const { state, editorialDashboard, writeEditorialReview } = await setup(t);
  state.enrichmentFailAfter = 0;
  const dashboard = await editorialDashboard(owner, runId, 0);
  assert.equal(dashboard.warnings.length, 1);
  await writeEditorialReview(owner, {
    requestId: '33333333-3333-4333-8333-333333333333',
    runId,
    candidateIndex: 0,
    materialHash: dashboard.materialHash,
    expectedRevision: 0,
    action: 'draft',
    consent: false,
    content: dashboard.content,
  });
  assert.equal(state.saved.action, 'draft');
  assert.equal(state.saved.publication_basis, 'manual_confirmation');
  assert.equal(state.writes.length, 1);
  assert.equal(state.writes[0].automatic, undefined);
});
