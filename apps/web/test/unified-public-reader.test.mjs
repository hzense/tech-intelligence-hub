import assert from 'node:assert/strict';
import test from 'node:test';
import { Buffer } from 'node:buffer';
import { URL } from 'node:url';
import { build } from 'esbuild';

test('unified operations share one validated connection, but recheck ACL and readiness on every call', async () => {
  const state = {
    connects: 0,
    checks: 0,
    requestConnections: 0,
    releases: [],
    queries: [],
    ready: true,
    aclValid: true,
    queryFails: false,
  };
  globalThis.__unifiedReaderTest = state;
  try {
    const modules = {
      'server-only': 'export {};',
      'next/server':
        'export async function connection() { globalThis.__unifiedReaderTest.requestConnections++; }',
      '../editorial-signal-reader-core': `
        export function editorialReaderConnectionString() { return 'synthetic-local-reader'; }
        export function createEditorialSignalReader() { throw new Error('wrong reader'); }
      `,
      '../../../../packages/database/src/editorial-signal-role.mjs': `
        export async function assertEditorialRole(client, role) {
          const state = globalThis.__unifiedReaderTest;
          state.checks++;
          if (role !== 'reader' || !state.aclValid) throw new Error('private ACL detail');
          client.checked = true;
        }
      `,
      pg: `export default { Pool: class {
        on() {}
        async connect() {
          const state = globalThis.__unifiedReaderTest;
          const id = ++state.connects;
          return {
            checked: false,
            async query(sql, parameters) {
              if (!this.checked) throw new Error('query before ACL validation');
              state.queries.push({ id, sql, parameters });
              if (state.queryFails) throw new Error('private timeout detail');
              return { rows: sql.includes('unified_public_status') ? [{ ready: state.ready }] : [] };
            },
            release(discard) { state.releases.push(discard); },
          };
        }
      } };`,
    };
    const bundled = await build({
      entryPoints: [new URL('../lib/server/unified-signals.ts', import.meta.url).pathname],
      bundle: true,
      write: false,
      format: 'esm',
      platform: 'node',
      plugins: [
        {
          name: 'isolate-unified-reader',
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
    const api = await import(
      `data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`
    );
    assert.deepEqual(await api.getUnifiedSignals(), []);
    assert.equal(await api.getUnifiedSignalById('missing-public-id'), undefined);
    await api.probeUnifiedSignals();
    assert.deepEqual(await api.readUnifiedSignalsForTask(), []);
    assert.equal(state.connects, 4);
    assert.equal(state.checks, 4, 'one fresh ACL check per operation, not per SQL');
    assert.equal(state.requestConnections, 2, 'background reads require no Next request context');
    assert.equal(state.queries.length, 8);
    assert.deepEqual(
      state.queries.map(({ id }) => id),
      [1, 1, 2, 2, 3, 3, 4, 4],
    );
    assert.match(state.queries[3].sql, /WHERE u.signal_id = \$1 LIMIT 2/);
    assert.deepEqual(state.queries[3].parameters, ['missing-public-id']);
    assert.match(state.queries[5].sql, /LIMIT 1$/);
    assert.deepEqual(state.releases, [false, false, false, false]);

    const publicFailure = {
      name: 'PublicSignalReaderError',
      message: 'Public signals are unavailable',
    };
    state.aclValid = false;
    await assert.rejects(api.getUnifiedSignals(), publicFailure);
    assert.equal(state.queries.length, 8, 'ACL drift blocks any content query');
    assert.equal(state.checks, 5);
    assert.equal(state.releases.at(-1), true);
    state.aclValid = true;
    state.ready = false;
    await assert.rejects(api.getUnifiedSignalById('missing-public-id'), publicFailure);
    assert.equal(state.queries.length, 9, 'readiness drift blocks content query');
    state.ready = true;
    state.queryFails = true;
    await assert.rejects(api.probeUnifiedSignals(), publicFailure);
    assert.equal(state.releases.at(-1), true, 'timed-out client is discarded');
    state.queryFails = false;
    await api.probeUnifiedSignals();
    assert.equal(state.releases.at(-1), false, 'failures are not cached');
  } finally {
    delete globalThis.__unifiedReaderTest;
  }
});
