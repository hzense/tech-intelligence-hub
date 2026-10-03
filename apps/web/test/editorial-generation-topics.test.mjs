import assert from 'node:assert/strict';
import test from 'node:test';
import { Buffer } from 'node:buffer';
import { URL } from 'node:url';
import { build } from 'esbuild';

const runId = '11111111-1111-4111-8111-111111111111';
test('editorial material auto-selects generated topics unless supplemental selections already exist', async () => {
  const state = { prefill: undefined, saved: null };
  globalThis.__editorialGenerationTopicsTest = state;
  try {
    const modules = {
      'server-only': 'export {};',
      './editorial-database':
        'export const editorialPool = {}; export const editorialPublicationEnabled = () => true;',
      './editorial-topics':
        "export const editorialTopicOptions = async () => [{ id: 'topic-ai', title: '当前名称' }];",
      '../../../../packages/database/src/editorial-signal-store.mjs':
        'export const saveEditorialSignal = () => { throw new Error("unexpected save"); }; export const readEditorialSignal = async () => globalThis.__editorialGenerationTopicsTest.saved;',
      './signal-generation': 'export const generationRecord = async () => ({});',
      '../candidate-review': `
        export const buildCandidateReview = () => ({
          materialHash: 'a'.repeat(64),
          candidate: {
            title: '合成标题', summary: '测试摘要', event_date: '2026-10-03',
            organizations: [], persons: [], topic_ids: ['topic-ai', 'topic-disabled'],
          },
        });
        export const buildEnrichedCandidateReview = () => { throw new Error('unexpected enrichment'); };`,
      './candidate-enrichment': 'export const listCandidateEnrichmentDtos = async () => [];',
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
    const { editorialDashboard } = await import(
      `data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`
    );
    const read = () => editorialDashboard('owner', runId, 0);
    assert.deepEqual((await read()).content.topics, [{ id: 'topic-ai', title: '当前名称' }]);
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
  } finally {
    delete globalThis.__editorialGenerationTopicsTest;
  }
});
