import assert from 'node:assert/strict';
import test from 'node:test';
import { Buffer } from 'node:buffer';
import { URL } from 'node:url';
import { build } from 'esbuild';
import { previewEditorialResources } from '../../../packages/database/src/editorial-resource-store.mjs';

const runId = '11111111-1111-4111-8111-111111111111';
test('editorial material auto-selects generated topics unless supplemental selections already exist', async () => {
  const state = {
    prefill: undefined,
    saved: null,
    resources: undefined,
    enriched: undefined,
    writes: [],
    resourceQueries: [],
    resourceReleases: [],
    resourceError: null,
    resourcePublicationReady: false,
    readinessChecks: 0,
    previewEditorialResources,
    reviewerPool: {
      async connect() {
        return {
          async query(sql) {
            state.resourceQueries.push(sql);
            assert.equal(
              sql,
              'SELECT id,name,type,status,aliases FROM public.entities ORDER BY id LIMIT 10001',
            );
            if (state.resourceError) throw state.resourceError;
            return {
              rows: [
                {
                  id: 'company-example',
                  type: 'company',
                  name: '示例公司',
                  status: 'active',
                  aliases: [],
                },
              ],
            };
          },
          release(discard) {
            state.resourceReleases.push(discard);
          },
        };
      },
    },
  };
  globalThis.__editorialGenerationTopicsTest = state;
  try {
    const modules = {
      'server-only': 'export {};',
      './editorial-database': `export const editorialPool = { role: 'writer', connect: async () => { throw new Error('legacy writer cannot preview entities'); } };
         export const editorialPublicationEnabled = () => true;
         export const editorialResourcePublicationReady = async () => { const state = globalThis.__editorialGenerationTopicsTest; state.readinessChecks++; return state.resourcePublicationReady; };`,
      './candidate-review-database':
        'export const candidateReviewPool = globalThis.__editorialGenerationTopicsTest.reviewerPool;',
      './editorial-topics':
        "export const editorialTopicOptions = async () => [{ id: 'topic-ai', title: '当前名称' }];",
      './generation-import-reader': 'export const importPool = {};',
      '../material-source-reader': `export const readMaterialSupplement = async () => ({batchId:'${runId}',itemId:'${runId}',fence:1,contentHash:'b'.repeat(64),sourceUrl:'https://example.com/original'});`,
      '../seed-runtime':
        "export const getResourceEntries = async () => [{id:'company-example',type:'company',name:'示例公司',status:'active'}];",
      '../../../../packages/database/src/editorial-signal-store.mjs': `export const saveEditorialSignal = async ({pool,owner,request,material}) => { if(pool.role !== 'writer') throw new Error('publication must use writer'); globalThis.__editorialGenerationTopicsTest.writes.push({owner,request,material}); return {request_id:request.requestId,revision:1,action:request.action,content:request.content}; };
         export const readEditorialSignal = async ({pool}) => { if(pool.role !== 'writer') throw new Error('revision reads must use writer'); return globalThis.__editorialGenerationTopicsTest.saved; };
         export const previewEditorialResources = args => globalThis.__editorialGenerationTopicsTest.previewEditorialResources(args);`,
      './signal-generation': `export const generationRecord = async () => ({owner_id:'owner',batch_id:'${runId}',item_id:'${runId}',source_fence:1,source_hash:'b'.repeat(64)});`,
      '../candidate-review': `
        export const buildCandidateReview = () => ({
          materialHash: 'a'.repeat(64),
          candidate: {
            title: '合成标题', summary: '测试摘要', event_date: '2026-10-03',
            organizations: [], persons: [], topic_ids: ['topic-ai', 'topic-disabled'],
            ...(globalThis.__editorialGenerationTopicsTest.resources === undefined ? {} : { resources: globalThis.__editorialGenerationTopicsTest.resources }),
          },
        });
        export const buildEnrichedCandidateReview = () => ({candidate:globalThis.__editorialGenerationTopicsTest.enriched});`,
      './candidate-enrichment': `export const listCandidateEnrichmentDtos = async () => globalThis.__editorialGenerationTopicsTest.enriched ? [{status:'completed',material_hash:'a'.repeat(64),result:{candidate:globalThis.__editorialGenerationTopicsTest.enriched}}] : [];`,
      './material-registration':
        'export const materialPublicationPreview = async () => ({editorialPrefill: globalThis.__editorialGenerationTopicsTest.prefill});',
    };
    const bundled = await build({
      entryPoints: [new URL('../lib/server/editorial-review.ts', import.meta.url).pathname],
      bundle: true,
      write: false,
      format: 'esm',
      platform: 'node',
      plugins: [
        {
          name: 'isolate-editorial-topic-material',
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
    const { editorialDashboard, writeEditorialReview } = await import(
      `data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`
    );
    const read = () => editorialDashboard('owner', runId, 0);
    assert.deepEqual((await read()).content.topics, [{ id: 'topic-ai', title: '当前名称' }]);
    assert.deepEqual(state.resourceQueries, []);
    assert.equal(state.readinessChecks, 0);
    for (const topics of [[], [{ id: 'topic-supplemental', title: '补证选择' }]]) {
      state.prefill = { topics };
      assert.deepEqual((await read()).content.topics, topics);
    }
    state.saved = {
      request_id: runId,
      revision: 1,
      action: 'draft',
      content: {
        title: '合成标题',
        summary: '测试摘要',
        eventDate: null,
        organizations: [],
        persons: [],
        topics: [],
        sourceUrls: [],
      },
    };
    assert.deepEqual((await read()).content.topics, []);
    state.saved = null;
    state.prefill = { organizations: ['旧补证组织'], persons: ['旧补证姓名'] };
    state.resources = [
      {
        type: 'company',
        name: '示例公司',
        introduction: '示例公司提供云产品。',
        event_role: '发布产品',
        evidence: [{ fragment_id: 'f1', quote: '示例公司提供云产品。' }],
      },
      {
        type: 'person',
        name: '示例人物',
        introduction: null,
        event_role: '介绍产品',
        evidence: [{ fragment_id: 'f2', quote: '示例人物介绍产品。' }],
      },
    ];
    const resources = await read();
    assert.equal(resources.resourcePublicationReady, false);
    assert.equal(state.resourceQueries.length, 1);
    assert.equal(state.readinessChecks, 1);
    assert.deepEqual(resources.content.organizations, ['示例公司']);
    assert.deepEqual(resources.content.persons, ['示例人物']);
    assert.deepEqual(
      resources.content.resources,
      state.resources.map((resource) => ({
        ...resource,
        entity_id: resource.type === 'company' ? 'company-example' : null,
      })),
    );
    assert.deepEqual(resources.content.sourceUrls, []);
    const enrichmentResource = {
      type: 'person',
      name: '普通补全人物',
      introduction: null,
      event_role: '说明产品',
      evidence: [{ fragment_id: 'fragment-1', quote: '普通补全人物说明产品。' }],
    };
    state.prefill = undefined;
    state.enriched = {
      event_date: '2026-10-03',
      organizations: ['示例公司'],
      persons: [{ name: enrichmentResource.name, organization: '示例公司' }],
      resources: [...state.resources, enrichmentResource],
    };
    const enriched = await read();
    assert.deepEqual(
      enriched.content.resources.map(({ name }) => name),
      ['示例公司', '示例人物', '普通补全人物'],
    );
    assert.deepEqual(enriched.content.persons, ['示例人物', '普通补全人物']);
    await writeEditorialReview('owner', {
      action: 'draft',
      candidateIndex: 0,
      consent: false,
      content: enriched.content,
      expectedRevision: 0,
      materialHash: enriched.materialHash,
      requestId: runId,
      runId,
    });
    assert.deepEqual(state.writes.at(-1).material.resources, state.enriched.resources);
    assert.deepEqual(
      state.writes.at(-1).material.resourceSourceOptions,
      state.enriched.resources.map(({ name, type }) => ({
        name,
        type,
        sourceUrls: ['https://example.com/original'],
      })),
    );

    const supplementalResource = {
      ...enrichmentResource,
      name: '补证人物',
      evidence: [{ fragment_id: 'fragment-2', quote: '补证人物说明产品。' }],
    };
    const supplementaryResources = [...state.resources, supplementalResource];
    const resourceSourceOptions = supplementaryResources.map(({ name, type }) => ({
      name,
      type,
      sourceUrls: [
        name === '补证人物' ? 'https://example.com/supplement' : 'https://example.com/original',
      ],
    }));
    state.prefill = {
      resources: supplementaryResources,
      resourceSourceOptions,
      sourceOptions: ['https://example.com/supplement'],
      topics: [],
    };
    const supplemented = await read();
    assert.deepEqual(
      supplemented.content.resources.map(({ name }) => name),
      ['示例公司', '示例人物', '补证人物'],
    );
    assert.deepEqual(supplemented.content.persons, ['示例人物', '补证人物']);
    assert.deepEqual(supplemented.sourceOptions, [
      'https://example.com/original',
      'https://example.com/supplement',
    ]);
    await writeEditorialReview('owner', {
      action: 'draft',
      candidateIndex: 0,
      consent: false,
      content: supplemented.content,
      expectedRevision: 0,
      materialHash: supplemented.materialHash,
      requestId: runId,
      runId,
    });
    assert.deepEqual(state.writes.at(-1).material.resources, supplementaryResources);
    assert.deepEqual(state.writes.at(-1).material.resourceSourceOptions, resourceSourceOptions);
    assert.equal(state.writes.at(-1).material.materialHash, 'a'.repeat(64));
    state.resourcePublicationReady = true;
    assert.equal((await read()).resourcePublicationReady, true);
    state.resourceError = Object.assign(new Error('synthetic preview permission failure'), {
      code: '42501',
    });
    await assert.rejects(read(), { code: 'database_unavailable' });
    assert.equal(state.resourceReleases.at(-1), true);
  } finally {
    delete globalThis.__editorialGenerationTopicsTest;
  }
});
