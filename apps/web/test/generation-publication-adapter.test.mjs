import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath, URL } from 'node:url';
import process from 'node:process';
import { build } from 'esbuild';

const fixture = `
export const id='11111111-1111-4111-8111-111111111111';
export const queries=[];
export const row={id,owner_id:'admin',status:'completed',lease_until:null,
  result:{classification:'private',candidates:[{index:0,classification:'private',status:'needs_review'}]}};
export const publication={action:'publish',fail:false,missing:false};
export function forbidden(){throw new Error('Unexpected AI or import access');}
export class Pool {
  on(){}
  async connect(){return {release(){},async query(sql,values){
    queries.push({kind:'generation',sql,values});
    if(/AS safe|AS \\"safe\\"/.test(sql)) return {rows:[{safe:true}]};
    if(sql.startsWith('SELECT') && sql.includes('FROM public.signal_generation_runs')){
      const owns=sql.includes('WHERE id=$1') ? values[0]===id && values[1]==='admin' : values[0]==='admin';
      return {rows:owns?[row]:[]};
    }
    if(/^(UPDATE|INSERT|DELETE)/.test(sql)) throw new Error('Read attempted a write');
    return {rows:[]};
  }}};
}
export const editorialPool={async connect(){return {release(){},async query(sql,values){
  queries.push({kind:'editorial',sql,values});
  if(publication.fail)throw new Error('PRIVATE_CONNECTION_ERROR');
  if(values[0]!=='admin')throw new Error('Wrong owner');
  return {rows:publication.missing?[]:[{run_id:id,candidate_index:0,revision:2,action:publication.action,
    public_id:publication.action==='publish'?'editorial-'+ 'a'.repeat(32):null}]};
}}}};
`;

test('list and detail project publication history with spend and publication writes disabled, retaining tasks on failure', async (t) => {
  const compiled = await build({
    stdin: {
      contents: `export {generationDashboard,generationDetail} from './lib/server/signal-generation'; export * from 'publication-fixture';`,
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
        name: 'synthetic-publication-backends',
        setup(b) {
          b.onResolve(
            {
              filter:
                /^(server-only|pg|publication-fixture|\.\/generation-import-reader|\.\/admin-ai|\.\/editorial-database)$/,
            },
            ({ path }) => ({ path, namespace: 'fixture' }),
          );
          b.onLoad({ filter: /.*/, namespace: 'fixture' }, ({ path }) => ({
            contents:
              path === 'publication-fixture'
                ? fixture
                : path === 'server-only'
                  ? ''
                  : path === 'pg'
                    ? `import {Pool} from 'publication-fixture'; export default {Pool};`
                    : path === './editorial-database'
                      ? `export {editorialPool} from 'publication-fixture'; export const editorialPublicationEnabled=()=>false;`
                      : path === './generation-import-reader'
                        ? `import {forbidden} from 'publication-fixture'; export const importPool={connect:forbidden}; export const importsConfigured=()=>false;`
                        : `export {forbidden as getAiDashboard,forbidden as generationAiAccess} from 'publication-fixture';`,
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
  // Only synthetic credentials; never inherit a production connection.
  process.env = {
    VERCEL_ENV: 'production',
    HZENSE_SIGNAL_GENERATION_ENABLED: '0',
    HZENSE_EDITORIAL_PUBLICATION_ENABLED: '0',
    HZENSE_RUNTIME_EXPECTED_HOST: 'ep-fixture-pooler.eu-central-1.aws.neon.tech',
    HZENSE_RUNTIME_EXPECTED_PORT: '5432',
    HZENSE_RUNTIME_EXPECTED_NAME: 'fixturedb',
    HZENSE_RUNTIME_EXPECTED_USER: 'hzense_runtime',
    HZENSE_GENERATION_DATABASE_URL:
      'postgresql://hzense_generation_admin:fixture@ep-fixture-pooler.eu-central-1.aws.neon.tech:5432/fixturedb?sslmode=verify-full&channel_binding=prefer',
  };
  const dashboard = await service.generationDashboard('admin');
  assert.equal(dashboard.runs[0].publication.candidates[0].status, 'published');
  assert.equal(dashboard.runs[0].result.candidates[0].status, 'needs_review');
  assert.equal(service.queries.filter((query) => query.kind === 'editorial').length, 1);
  service.publication.action = 'withdraw';
  assert.equal(
    (await service.generationDetail('admin', service.id)).publication.candidates[0].status,
    'withdrawn',
  );
  service.publication.missing = true;
  assert.equal(
    (await service.generationDetail('admin', service.id)).publication.state,
    'unavailable',
  );
  service.publication.missing = false;
  service.publication.fail = true;
  const failed = await service.generationDashboard('admin');
  assert.equal(failed.runs.length, 1);
  assert.equal(failed.runs[0].publication.state, 'unavailable');
  assert.doesNotMatch(JSON.stringify(failed), /PRIVATE_CONNECTION_ERROR/);
  const before = service.queries.filter((query) => query.kind === 'editorial').length;
  await assert.rejects(service.generationDetail('other-admin', service.id), { code: 'not_found' });
  assert.equal(service.queries.filter((query) => query.kind === 'editorial').length, before);
  assert.equal(
    service.queries.some((query) => /^(UPDATE|INSERT|DELETE)/.test(query.sql)),
    false,
  );
});
