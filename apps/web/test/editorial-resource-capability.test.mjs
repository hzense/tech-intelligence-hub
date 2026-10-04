import assert from 'node:assert/strict';
import test from 'node:test';
import { Buffer } from 'node:buffer';
import { URL } from 'node:url';
import { build } from 'esbuild';

test('resource publication readiness distinguishes audited legacy and upgraded writers without granting access', async () => {
  const state = {
    available: false,
    queryFails: false,
    roleFails: false,
    queries: [],
    releases: [],
  };
  globalThis.__editorialResourceCapabilityTest = state;
  try {
    const modules = {
      'server-only': 'export {};',
      pg: `export default { Pool: class {
        on() {}
        async connect() { return {
          async query(sql) {
            const state = globalThis.__editorialResourceCapabilityTest;
            state.queries.push(sql);
            if (state.queryFails) throw new Error('synthetic unavailable');
            return {rows:[{available:state.available}]};
          },
          release(discard) { globalThis.__editorialResourceCapabilityTest.releases.push(discard); }
        }; }
      } };`,
      '../candidate-review-config':
        "export const readCandidateRoleConfiguration = () => 'synthetic-local-fixture';",
      '../../../../packages/database/src/editorial-signal-role.mjs': `export async function assertEditorialRole(_client,role) {
        if (role !== 'writer' || globalThis.__editorialResourceCapabilityTest.roleFails)
          throw new Error('editorial_role_invalid');
      }`,
    };
    const bundled = await build({
      entryPoints: [new URL('../lib/server/editorial-database.ts', import.meta.url).pathname],
      bundle: true,
      write: false,
      format: 'esm',
      platform: 'node',
      plugins: [
        {
          name: 'isolate-editorial-resource-capability',
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
    const { editorialResourcePublicationReady: ready } = await import(
      `data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`
    );
    assert.equal(await ready(), false);
    state.available = true;
    assert.equal(await ready(), true);
    state.available = 'true';
    await assert.rejects(ready(), { code: 'database_unavailable' });
    state.queryFails = true;
    await assert.rejects(ready(), /synthetic unavailable/);
    state.roleFails = true;
    const priorQueries = state.queries.length;
    await assert.rejects(ready(), /editorial_role_invalid/);
    assert.equal(state.queries.length, priorQueries);
    assert.deepEqual(state.releases, [false, false, true, true, true]);
    assert.ok(
      state.queries.every(
        (sql) =>
          sql ===
          "SELECT pg_catalog.has_column_privilege('public.entities','name','SELECT') AS available",
      ),
    );
  } finally {
    delete globalThis.__editorialResourceCapabilityTest;
  }
});
