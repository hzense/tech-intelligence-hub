import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import process from 'node:process';
import { fileURLToPath, URL } from 'node:url';
import { build } from 'esbuild';

test('real RSC renders reuse current reads while subsequent renders and searches see withdrawals', async () => {
  const root = fileURLToPath(new URL('..', import.meta.url));
  const compiled = await build({
    stdin: {
      resolveDir: root,
      loader: 'ts',
      contents: `
        import assert from 'node:assert/strict';
        import React from 'react';
        import { renderToReadableStream } from 'next/dist/compiled/react-server-dom-webpack/server.edge.js';
        import { getSignalEntries, getSignalEntryById } from './lib/seed-runtime.ts';
        import { getPublicExploration } from './lib/public-exploration-runtime.ts';
        import { getPublicResourceDetail } from './lib/server/resource-detail.ts';
        import { searchPublishedContent } from './lib/server/search.ts';
        import { searchPublishedContent as searchInProcess } from './lib/search-runtime.ts';

        async function verify() {
          process.env.HZENSE_UNIFIED_SIGNAL_ENABLED = '1';
          process.env.HZENSE_SEARCH_MODE = 'in-process';
          process.env.HZENSE_TOPIC_INSIGHTS_ENABLED = '1';
          const id = 'editorial-' + 'a'.repeat(32);
          const resource = { id: 'person-current', name: 'Current researcher', type: 'person', introduction: null, source_urls: [] };
          const signal = {
            id, title: 'Current research proof', summary: 'Current public evidence',
            status: 'accepted', type: 'editorial', publication_basis: 'manual_confirmation',
            publication_revision: 1, occurred_at: '2026-10-15T12:00:00Z', captured_at: '2026-10-15T12:00:00Z',
            topics: [], entities: [resource.id], source_id: '', source_url: '',
            public_people: [{ id: resource.id, name: resource.name, event_role: 'researcher', canonical_entity_id: resource.id }],
            public_organizations: [], public_resources: [resource], public_sources: [], public_topics: [],
          };
          const state = globalThis.__requestReuse = { rows: [signal], lists: 0, byIds: 0, insights: 0, validated: [], fail: false };

          async function Metadata() {
            const [entry, directory] = await Promise.all([getSignalEntryById(id), getPublicExploration()]);
            return (entry?.title ?? 'withdrawn') + ':' + directory.signals.length;
          }
          async function Body() {
            const [entry, first, second] = await Promise.all([
              getSignalEntryById(id), getPublicResourceDetail(resource.id), getPublicResourceDetail(resource.id),
            ]);
            assert.equal(first, second, 'resource detail is reused within a render');
            return (entry?.title ?? 'withdrawn') + ':' + (first?.entity.name ?? 'absent');
          }
          async function render() {
            const stream = await renderToReadableStream(React.createElement(React.Fragment, null,
              React.createElement(Metadata), React.createElement(Body)), {});
            return new Response(stream).text();
          }
          assert.match(await render(), /Current research proof/);
          assert.equal(state.lists, 1, 'metadata and body share one directory read');
          assert.equal(state.byIds, 1, 'metadata and body share one bounded detail read');
          assert.equal(state.insights, 1, 'repeated resource detail reuses its report validation');
          state.rows = [];
          assert.match(await render(), /withdrawn/);
          assert.equal(state.lists, 2, 'the next render rechecks the public directory');
          assert.equal(state.byIds, 2, 'the next render rechecks detail visibility');

          state.rows = [signal];
          const beforeDirect = state.lists;
          await getSignalEntries();
          state.rows = [];
          assert.deepEqual(await getSignalEntries(), []);
          assert.equal(state.lists - beforeDirect, 2, 'background calls do not retain a previous snapshot');

          state.rows = [signal];
          const beforeSearch = state.lists;
          const results = await searchPublishedContent('Current');
          assert.ok(results.some(row => row.href === '/signals/' + id));
          assert.ok(results.some(row => row.href === '/persons/' + resource.id));
          assert.deepEqual(state.validated, [id]);
          assert.equal(state.lists - beforeSearch, 1, 'signal, resource and report search share one snapshot outside RSC');
          state.rows = [];
          assert.deepEqual(await searchPublishedContent('Current'), []);
          assert.equal(state.lists - beforeSearch, 2, 'a new search rechecks withdrawal');

          state.rows = [signal];
          const beforeInProcess = state.lists;
          assert.equal((await searchInProcess('Current', 'signal')).length, 1);
          assert.equal(state.lists - beforeInProcess, 1, 'legacy and editorial search projections share one read');
          const beforeTopic = state.lists;
          await searchPublishedContent('Current', 'topic');
          assert.equal(state.lists, beforeTopic, 'topic-only searches do not fetch signals');

          const old = { ...signal, id: 'editorial-' + 'b'.repeat(32), entities: [],
            public_people: [{ id: 'person-0', name: resource.name, event_role: 'researcher' }] };
          delete old.public_resources;
          state.rows = [old, signal];
          const beforeOld = state.lists;
          assert.deepEqual((await getSignalEntryById(old.id)).entities, [resource.id]);
          assert.equal(state.lists - beforeOld, 1, 'name-only compatibility resolves other current public identities');
          state.rows = [old];
          assert.deepEqual((await getSignalEntryById(old.id)).entities, [], 'withdrawn identity cannot survive the next detail read');

          state.fail = true;
          await assert.rejects(searchPublishedContent('Current'), /public reader unavailable/);
          state.fail = false;
          state.rows = [];
          assert.deepEqual(await searchPublishedContent('Current'), [], 'a failed search is not cached into the next request');
          process.stdout.write('request reuse verified');
        }
        verify().catch(error => { console.error(error); process.exitCode = 1; });
      `,
    },
    bundle: true,
    write: false,
    format: 'cjs',
    platform: 'node',
    external: ['react', 'next/dist/compiled/react-server-dom-webpack/server.edge.js'],
    plugins: [
      {
        name: 'current-public-readers',
        setup(plugin) {
          const modules = {
            'server-only': 'export {};',
            '@hzense/content': `
              export async function loadSeedCatalog() { return { entities: [], signals: [], sources: [], radar: [], relations: [] }; }
              export async function loadTaxonomy() { return { topics: [] }; }`,
            'unified-signals': `
              export async function getUnifiedSignals() {
                const s = globalThis.__requestReuse; s.lists++;
                if(s.fail) throw new Error('public reader unavailable');
                return structuredClone(s.rows);
              }
              export async function getUnifiedSignalById(id) {
                const s = globalThis.__requestReuse; s.byIds++;
                if(s.fail) throw new Error('public reader unavailable');
                return structuredClone(s.rows.find(row => row.id === id));
              }`,
            'public-signals': `
              export async function getPublicSignals() { throw new Error('unexpected old reader'); }
              export async function getPublicSignalById() { throw new Error('unexpected old reader'); }
              export async function searchPublicSignals() { throw new Error('unexpected old reader'); }
              export async function waitForPublicSignalRequest() {}`,
            'editorial-signals': 'export async function getEditorialSignals() { return []; }',
            'legacy-signal-archive':
              'export async function getLegacyArchivedSignals() { return []; }',
            'content-runtime': `
              export async function getInsightEntries() { return []; }
              export async function getTopicEntries() { return []; }
              export async function getTopicTitleMap() { return new Map(); }`,
            'topic-insights': `export async function visibleTopicInsights(signals) {
              const s = globalThis.__requestReuse; s.insights++;
              s.validated = signals.map(signal => signal.id); return [];
            }`,
            'runtime-reader': 'export async function searchRuntimeDocuments() { return []; }',
          };
          plugin.onResolve({ filter: /.*/ }, (args) => {
            const key =
              args.path === 'server-only' || args.path === '@hzense/content'
                ? args.path
                : args.path.split('/').at(-1).replace(/\.ts$/, '');
            if (Object.hasOwn(modules, key)) return { path: key, namespace: 'public-provider' };
          });
          plugin.onLoad({ filter: /.*/, namespace: 'public-provider' }, (args) => ({
            contents: modules[args.path],
            loader: 'js',
          }));
        },
      },
    ],
  });
  const output = execFileSync(
    process.execPath,
    ['--conditions=react-server', '--eval', compiled.outputFiles[0].text],
    { cwd: root, encoding: 'utf8', timeout: 30_000 },
  );
  assert.match(output, /request reuse verified/);
});
