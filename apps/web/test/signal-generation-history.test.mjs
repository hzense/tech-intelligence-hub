import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath, URL } from 'node:url';
import process from 'node:process';
import { build } from 'esbuild';
import { createGenerationHandler } from '../lib/admin-signal-generation-handler.ts';
const { Request } = globalThis;

// Exercise the real server adapter, configuration policy, DTO and SQL store.
// Only network/database drivers and unrelated import/AI services are synthetic.
const fixture = `
export const queries = [];
export const id = '11111111-1111-4111-8111-111111111111';
export const row = {id, owner_id:'admin',status:'completed',result:{classification:'private',candidates:[{title:'Saved candidate'}]},snapshot:{source:'PRIVATE_SOURCE'},lease_token:'PRIVATE_LEASE',configuration:{internal:true}};
export let safeRole = true;
export function setSafeRole(value) { safeRole=value; }
export function forbidden() { throw new Error('Unexpected import or AI access'); }
export class Pool {
  on() {}
  async connect() { return {release(){}, async query(sql, values) {
    queries.push({sql, values});
    if (/AS safe|AS \\"safe\\"/.test(sql)) return {rows:[{safe:safeRole}]};
    if (sql.startsWith('SELECT') && sql.includes('FROM public.signal_generation_runs')) {
      const match = sql.includes('WHERE id=$1') ? values[0]===id && values[1]==='admin' : values[0]==='admin';
      return {rows:match ? [row] : []};
    }
    if (/^(UPDATE|INSERT|DELETE)/.test(sql)) throw new Error('Read attempted a write');
    return {rows:[]};
  }}; }
}
`;

test('disabled generation history is owner-scoped, read-only and independent of AI/import configuration', async (t) => {
  const compiled = await build({
    stdin: {
      contents: `export * from './lib/server/signal-generation'; export * from 'history-fixture';`,
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
        name: 'synthetic-backends',
        setup(b) {
          b.onResolve(
            { filter: /^(server-only|pg|history-fixture|\.\/import-service|\.\/admin-ai)$/ },
            ({ path }) => ({ path, namespace: 'fixture' }),
          );
          b.onLoad({ filter: /.*/, namespace: 'fixture' }, ({ path }) => ({
            contents:
              path === 'history-fixture'
                ? fixture
                : path === 'server-only'
                  ? ''
                  : path === 'pg'
                    ? `import {Pool} from 'history-fixture'; export default {Pool};`
                    : path === './import-service'
                      ? `import {forbidden} from 'history-fixture'; export const importPool={connect:forbidden}; export const importsConfigured=forbidden;`
                      : `import {forbidden} from 'history-fixture'; export const getAiDashboard=forbidden; export const generationAiAccess=forbidden;`,
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
  const service = module.exports;
  const original = { ...process.env };
  t.after(() => {
    process.env = original;
  });
  // Do not inherit or use any real database / AI settings.
  process.env = {
    VERCEL_ENV: 'production',
    HZENSE_SIGNAL_GENERATION_ENABLED: '0',
    HZENSE_RUNTIME_EXPECTED_HOST: 'ep-fixture-pooler.eu-central-1.aws.neon.tech',
    HZENSE_RUNTIME_EXPECTED_PORT: '5432',
    HZENSE_RUNTIME_EXPECTED_NAME: 'fixturedb',
    HZENSE_RUNTIME_EXPECTED_USER: 'hzense_runtime',
    HZENSE_GENERATION_DATABASE_URL:
      'postgresql://hzense_generation_admin:fixture@ep-fixture-pooler.eu-central-1.aws.neon.tech:5432/fixturedb?sslmode=verify-full&channel_binding=prefer',
  };
  assert.equal(service.generationConfigured(), false);
  assert.equal(service.generationHistoryConfigured(), true);
  const detail = await service.generationDetail('admin', service.id);
  assert.equal(detail.result.candidates[0].title, 'Saved candidate');
  assert.doesNotMatch(
    JSON.stringify(detail),
    /PRIVATE_SOURCE|PRIVATE_LEASE|owner_id|snapshot|configuration/,
  );
  const dashboard = await service.generationDashboard('admin');
  assert.deepEqual(dashboard, { runs: [detail], profiles: [], batches: [] });
  // An expired-looking run is displayed as stored, never recovered by a history read.
  service.row.status = 'running';
  service.row.lease_until = '2000-01-01T00:00:00Z';
  assert.equal((await service.generationDetail('admin', service.id)).status, 'running');
  service.row.status = 'completed';
  assert.ok(
    service.queries.some((q) => q.sql === 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY'),
  );
  assert.ok(!service.queries.some((q) => /^(UPDATE|INSERT|DELETE)/.test(q.sql)));
  await assert.rejects(service.generationDetail('other-admin', service.id), { code: 'not_found' });
  assert.deepEqual((await service.generationDashboard('other-admin')).runs, []);
  const before = service.queries.length;
  for (const action of ['create', 'run', 'cancel'])
    await assert.rejects(service.executeGeneration('admin', { action, id: service.id }), {
      code: 'not_configured',
    });
  await assert.rejects(service.inspectGenerationInput('admin', {}), { code: 'not_configured' });
  assert.equal(service.queries.length, before);
  // Missing budgets / AI setup also cannot hide history or permit writes.
  process.env.HZENSE_SIGNAL_GENERATION_ENABLED = '1';
  assert.equal(service.generationConfigured(), false);
  assert.equal((await service.generationDetail('admin', service.id)).status, 'completed');
  await assert.rejects(service.executeGeneration('admin', { action: 'run', id: service.id }), {
    code: 'not_configured',
  });
  service.setSafeRole(false);
  await assert.rejects(service.generationDetail('admin', service.id), {
    code: 'database_unavailable',
  });
  service.setSafeRole(true);
  delete process.env.HZENSE_GENERATION_DATABASE_URL;
  assert.equal(service.generationHistoryConfigured(), false);
  await assert.rejects(service.generationDetail('admin', service.id), { code: 'not_configured' });
});

test('history HTTP lookup authenticates, validates exact input and never dispatches the write executor', async () => {
  let reads = 0;
  const id = '11111111-1111-4111-8111-111111111111';
  const deps = {
    session: async () => ({ user: { id: 'admin' } }),
    origin: () => 'https://hzense.com',
    dashboard: async () => ({ runs: [], profiles: [], batches: [] }),
    execute: async () => assert.fail('write executor must not run'),
    detail: async (owner, runId) => {
      assert.equal(owner, 'admin');
      assert.equal(runId, id);
      reads++;
      return { id, status: 'completed' };
    },
  };
  const request = (body = { action: 'detail', id }, headers = {}) =>
    new Request('https://hzense.com/api/admin/signal-generation', {
      method: 'POST',
      headers: {
        host: 'hzense.com',
        origin: 'https://hzense.com',
        'content-type': 'application/json',
        ...headers,
      },
      body: JSON.stringify(body),
    });
  const handler = createGenerationHandler(deps);
  assert.equal(
    (await createGenerationHandler({ ...deps, session: async () => null })(request())).status,
    401,
  );
  assert.equal((await handler(request(undefined, { origin: 'https://evil.example' }))).status, 403);
  for (const body of [
    { action: 'detail', id, owner: 'other' },
    { action: 'detail' },
    { action: 'detail', id: 'bad' },
    { action: 'detail', id, readOnly: false },
  ])
    assert.equal((await handler(request(body))).status, 400);
  assert.equal(reads, 0);
  const response = await handler(request());
  assert.equal(response.status, 200);
  assert.match(response.headers.get('cache-control'), /no-store/);
  assert.equal(reads, 1);
  const denied = await createGenerationHandler({
    ...deps,
    detail: async () => {
      throw new Error('PRIVATE_BACKEND_DIAGNOSTIC');
    },
  })(request());
  assert.equal(denied.status, 503);
  assert.deepEqual(await denied.json(), { error: 'unavailable' });
});
