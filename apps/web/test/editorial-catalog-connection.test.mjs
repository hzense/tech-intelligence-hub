import assert from 'node:assert/strict';
import test from 'node:test';
import process from 'node:process';
import { Buffer } from 'node:buffer';
import { URL } from 'node:url';
import { build } from 'esbuild';

test('actual editorial catalog discards query failures but releases local validation failures normally', async () => {
  const state = { rows: [], queryFails: false, releases: [] };
  globalThis.__editorialCatalogTest = state;
  const previous = process.env.HZENSE_EDITORIAL_PUBLICATION_ENABLED;
  process.env.HZENSE_EDITORIAL_PUBLICATION_ENABLED = '1';
  try {
    const modules = {
      'server-only': 'export {};',
      pg: `export default { Pool: class {
        on() {}
        async connect() { return {
          async query() {
            const state = globalThis.__editorialCatalogTest;
            if (state.queryFails) throw new Error('synthetic query timeout');
            return { rows: state.rows };
          },
          release(discard) { globalThis.__editorialCatalogTest.releases.push(discard); },
        }; }
      } };`,
      '../../../../packages/database/src/editorial-signal-store.mjs':
        'export const saveEditorialSignal = () => {}; export const readEditorialSignal = () => {};',
      '../../../../packages/database/src/editorial-signal-role.mjs':
        'export async function assertEditorialRole() {}',
      '../editorial-review-service':
        'export const createEditorialReviewService = (deps) => ({ read: deps.topics, write: () => {} });',
      '../candidate-review-config':
        "export const readCandidateRoleConfiguration = () => 'synthetic-not-a-real-connection';",
      './signal-generation': 'export const generationRecord = () => {};',
      '../candidate-review':
        'export const buildCandidateReview = () => {}; export const buildEnrichedCandidateReview = () => {};',
      './candidate-enrichment': 'export const listCandidateEnrichmentDtos = () => {};',
      './material-registration': 'export const materialPublicationPreview = () => {};',
      '../content-runtime': 'export const getTopicTitleMap = () => new Map();',
    };
    const bundled = await build({
      entryPoints: [new URL('../lib/server/editorial-review.ts', import.meta.url).pathname],
      bundle: true,
      write: false,
      format: 'esm',
      platform: 'node',
      plugins: [
        {
          name: 'isolate-editorial-catalog',
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
    assert.deepEqual(await editorialDashboard(), []);
    assert.equal(state.releases.at(-1), false);
    state.queryFails = true;
    await assert.rejects(editorialDashboard(), /synthetic query timeout/);
    assert.equal(state.releases.at(-1), true);
    state.queryFails = false;
    state.rows = Array.from({ length: 1001 }, () => ({ id: 'fixture' }));
    await assert.rejects(editorialDashboard(), /editorial_catalog_unavailable/);
    assert.equal(state.releases.at(-1), false);
    state.rows = [];
    assert.deepEqual(await editorialDashboard(), []);
    assert.deepEqual(state.releases, [false, true, false, false]);
  } finally {
    if (previous === undefined) delete process.env.HZENSE_EDITORIAL_PUBLICATION_ENABLED;
    else process.env.HZENSE_EDITORIAL_PUBLICATION_ENABLED = previous;
    delete globalThis.__editorialCatalogTest;
  }
});
