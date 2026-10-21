import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import process from 'node:process';
import test from 'node:test';
import { fileURLToPath, URL } from 'node:url';
import { build } from 'esbuild';

function environment() {
  const hostname = 'ep-fixture-pooler.eu-central-1.aws.neon.tech';
  return {
    VERCEL_ENV: 'production',
    HZENSE_RUNTIME_EXPECTED_HOST: hostname,
    HZENSE_RUNTIME_EXPECTED_PORT: '5432',
    HZENSE_RUNTIME_EXPECTED_NAME: 'fixturedb',
    HZENSE_RUNTIME_EXPECTED_USER: 'hzense_runtime',
    HZENSE_GENERATION_DATABASE_URL:
      `postgresql://hzense_generation_admin:synthetic@${hostname}:5432/fixturedb` +
      '?sslmode=verify-full&channel_binding=prefer',
  };
}

function fixture() {
  const state = {
    constructors: [],
    guards: [],
    releases: [],
    listeners: [],
    active: 0,
    peak: 0,
    rejectGuard: null,
  };
  state.Pool = class {
    waiting = [];
    constructor(options) {
      this.options = options;
      state.constructors.push(options);
    }
    on(name, callback) {
      state.listeners.push({ name, callback });
    }
    async connect() {
      if (state.active >= this.options.max)
        await new Promise((resolve) => this.waiting.push(resolve));
      state.active++;
      state.peak = Math.max(state.peak, state.active);
      let released = false;
      return {
        async check(kind) {
          assert.equal(released, false);
          state.guards.push(kind);
          if (state.rejectGuard === kind) throw new Error(`synthetic-${kind}-acl-denied`);
        },
        release: (discard) => {
          assert.equal(released, false, 'Each checked-out client is released once');
          released = true;
          state.releases.push(discard);
          state.active--;
          this.waiting.shift()?.();
        },
      };
    }
  };
  return state;
}

const compiled = build({
  stdin: {
    contents: "export * from './lib/server/generation-database';",
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
      name: 'isolated-pool-driver-and-acl',
      setup(builder) {
        const modules = {
          'server-only': '',
          pg: 'export default {Pool:globalThis.__sharedGenerationPoolTest.Pool};',
          '../../../../packages/database/src/signal-generation-role.mjs': `
            export const assertGenerationRole=(client)=>client.check('generation');
            export const assertGenerationHistoryRole=(client)=>client.check('history');
            export const assertCandidateEnrichmentRole=(client)=>client.check('enrichment');
          `,
        };
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

async function freshModule() {
  const module = { exports: {} };
  new Function('require', 'module', 'exports', (await compiled).outputFiles[0].text)(
    createRequire(import.meta.url),
    module,
    module.exports,
  );
  return module.exports;
}
function setup(t) {
  const original = process.env;
  const state = (globalThis.__sharedGenerationPoolTest = fixture());
  process.env = environment();
  t.after(() => {
    process.env = original;
    delete globalThis.__sharedGenerationPoolTest;
  });
  return state;
}

test('generation, history and enrichment share one bounded pool across route modules and HMR', async (t) => {
  const state = setup(t);
  const first = await freshModule();
  const second = await freshModule();
  const names = ['generationPool', 'generationHistoryPool', 'candidateEnrichmentPool'];
  await Promise.all(
    Array.from({ length: 9 }, async (_, index) => {
      const module = index % 2 ? first : second;
      const client = await module[names[index % names.length]].connect();
      await Promise.resolve();
      client.release();
    }),
  );
  const afterReload = await freshModule();
  (await afterReload.candidateEnrichmentPool.connect()).release();
  assert.equal(state.constructors.length, 1);
  assert.equal(state.constructors[0].max, 1);
  assert.equal(state.constructors[0].enableChannelBinding, true);
  assert.equal(state.peak, 1);
  assert.equal(state.active, 0);
  assert.equal(state.guards.filter((kind) => kind === 'generation').length, 3);
  assert.equal(state.guards.filter((kind) => kind === 'history').length, 3);
  assert.equal(state.guards.filter((kind) => kind === 'enrichment').length, 4);
  assert.equal(state.releases.length, 10);
  assert.equal(state.listeners.length, 1, 'HMR must not add idle-error handlers repeatedly');
});

test('each shared-pool adapter rechecks its own ACL and discards a rejected client', async (t) => {
  const state = setup(t);
  const { generationPool, generationHistoryPool, candidateEnrichmentPool } = await freshModule();
  state.rejectGuard = 'enrichment';
  (await generationHistoryPool.connect()).release();
  await assert.rejects(candidateEnrichmentPool.connect(), /synthetic-enrichment-acl-denied/);
  assert.equal(state.active, 0);
  assert.deepEqual(state.releases, [undefined, true]);
  (await generationPool.connect()).release();
  state.rejectGuard = null;
  (await candidateEnrichmentPool.connect()).release();
  assert.deepEqual(state.guards, ['history', 'enrichment', 'generation', 'enrichment']);
  assert.equal(state.constructors.length, 1);
});

test('shared pool refuses changed connection URLs even from a separately evaluated module', async (t) => {
  const state = setup(t);
  const first = await freshModule();
  (await first.generationPool.connect()).release();
  const originalUrl = process.env.HZENSE_GENERATION_DATABASE_URL;
  process.env.HZENSE_GENERATION_DATABASE_URL = originalUrl.replace(':synthetic@', ':changed@');
  const second = await freshModule();
  await assert.rejects(second.candidateEnrichmentPool.connect(), { code: 'not_configured' });
  await assert.rejects(second.generationHistoryPool.connect(), { code: 'not_configured' });
  assert.equal(state.constructors.length, 1);
  assert.deepEqual(state.guards, ['generation']);
  process.env.HZENSE_GENERATION_DATABASE_URL = originalUrl;
  (await second.candidateEnrichmentPool.connect()).release();
  assert.equal(state.constructors.length, 1);
});

test('separate injected database drivers cannot reuse one another cached credentials or pool', async (t) => {
  const firstState = setup(t);
  const first = await freshModule();
  (await first.generationHistoryPool.connect()).release();
  const secondState = (globalThis.__sharedGenerationPoolTest = fixture());
  process.env.HZENSE_GENERATION_DATABASE_URL = process.env.HZENSE_GENERATION_DATABASE_URL.replace(
    ':synthetic@',
    ':other-driver@',
  );
  const second = await freshModule();
  (await second.candidateEnrichmentPool.connect()).release();
  assert.equal(firstState.constructors.length, 1);
  assert.equal(secondState.constructors.length, 1);
  assert.deepEqual(firstState.guards, ['history']);
  assert.deepEqual(secondState.guards, ['enrichment']);
});
