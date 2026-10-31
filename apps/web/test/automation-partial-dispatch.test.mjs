import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { readFile } from 'node:fs/promises';
import process from 'node:process';
import test from 'node:test';
import { fileURLToPath, URL } from 'node:url';
import { build } from 'esbuild';

const owner = 'synthetic-partial-dispatch';
const uuid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const queuedAt = '2026-10-25T12:00:00.123Z';
const key = '__automationPartialDispatch';

// Execute the actual workflow and stable request-ID algorithm. Only external
// services/storage are synthetic; no child worker or provider is invoked.
async function compile() {
  const url = new URL('../workflows/automation.ts', import.meta.url);
  const modules = {
    workflow: 'export async function sleep(){throw Error("unexpected sleep")}',
    'workflow/api': `export async function start(_workflow,args){
      const f=globalThis.${key};f.dispatches.push(args);
      if(f.dispatchFailures.includes(args[1]))throw Error('dispatch acknowledgement unknown');
    }`,
    '../lib/server/automation':
      'export function automationLimits(){return {batch:5000000,daily:10000000,reserve:500000}}',
    '../lib/server/automation-store-access': 'export const automationPool={}',
    '../lib/local-development':
      'export function isLocalAutomationSchedulerEnabled(){return false} export function isLocalRealAutomationEnabled(){return false}',
    '../lib/automatic-publication': 'export function automaticPublicationAvailable(){return false}',
    './signal-generation':
      'export async function signalGenerationWorkflow(){throw Error("unexpected worker")}',
    './local-signal-generation':
      'export async function localSignalGenerationWorkflow(){throw Error("unexpected worker")}',
    './local-topic-insight':
      'export async function runLocalTopicInsightStep(){return "local_topic_completed"}',
    '../lib/server/insight-topics': 'export async function assertTrackedInsightTopics(){}',
    '../lib/server/topic-insight-sandbox':
      'export async function startTopicInsightSandbox(){throw Error("unexpected sandbox")} export async function pollTopicInsightSandbox(){} export async function stopTopicInsightSandbox(){}',
    '../lib/server/source-discovery': `export async function discoverSources(){
      const f=globalThis.${key};f.discoveries++;return f.items.map(item=>item.url);
    }`,
    '../../../packages/database/src/automation-store.mjs': `
      export class AutomationError extends Error {constructor(code){super(code);this.code=code}}
      export async function rejectInsightTopicsBeforeClaim(){throw Error('Unexpected insight rejection')}
      export async function rejectAutomaticPublicationBeforeClaim(){throw Error('unexpected rejection')}
      export async function readAutomationRun(){return structuredClone(globalThis.${key}.run)}
      export async function claimAutomationRun(){
        const f=globalThis.${key};if(f.run.status!=='queued')return null;
        f.run.status='running';return structuredClone(f.run);
      }
      export async function updateAutomationRun(args){
        const f=globalThis.${key};
        if(args.phase==='dispatching_candidates'&&++f.receiptWrites===f.failReceiptWrite)
          throw Error('receipt write unconfirmed');
        f.run={...f.run,...structuredClone(args),status:args.status??f.run.status};
        return structuredClone(f.run);
      }
    `,
    '../lib/server/import-service': `
      export async function executeImportAdmin(_owner,_method,request){
        const f=globalThis.${key};f.importRequests.push(request.action);
        return {id:f.batchId,items:structuredClone(f.items)};
      }
      export async function runImportItem(_owner,_batchId,itemId){
        const f=globalThis.${key};f.imports.push(itemId);return {status:'running'};
      }
    `,
    '../lib/server/signal-generation': `
      export async function executeGeneration(_owner,request){
        const f=globalThis.${key};f.creates.push(request);
        const row={id:request.id,status:'pending',progress_phase:'created'};
        f.children[request.id]=row;
        if(f.creates.length===f.failCreate)throw Error('creation outcome unknown');
        return structuredClone(row);
      }
      export async function queueGeneration(_owner,id){
        const f=globalThis.${key};f.queues.push(id);
        const row=f.children[id];row.progress_phase='queued';row.progress_at=${JSON.stringify(queuedAt)};
        if(f.queues.length===f.failQueue)throw Error('queue outcome unknown');
        if(f.queues.length===f.failDispatch)f.dispatchFailures.push(id);
        return structuredClone(row);
      }
      export async function failQueuedGeneration(_owner,id,at){
        const f=globalThis.${key};f.cleanups.push({id,at});
        if(f.failCleanup)throw Error('cleanup unknown');
        const row=f.children[id];
        if(row.status==='pending'&&row.progress_at===at)row.status='failed';
      }
    `,
  };
  const output = await build({
    stdin: {
      contents: await readFile(url, 'utf8'),
      loader: 'ts',
      resolveDir: fileURLToPath(new URL('.', url)),
    },
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'node',
    plugins: [
      {
        name: 'synthetic-partial-dispatch-boundaries',
        setup(builder) {
          builder.onResolve({ filter: /.*/ }, ({ path }) =>
            Object.hasOwn(modules, path) ? { path, namespace: 'fixture' } : undefined,
          );
          builder.onLoad({ filter: /.*/, namespace: 'fixture' }, ({ path }) => ({
            contents: modules[path],
          }));
        },
      },
    ],
  });
  return import(
    `data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString('base64')}`
  );
}
const compiled = compile();

async function setup(t, options = {}) {
  const previous = process.env.HZENSE_LOCAL_DEVELOPMENT;
  delete process.env.HZENSE_LOCAL_DEVELOPMENT;
  const state = (globalThis[key] = {
    batchId: uuid(2),
    items: Array.from({ length: options.count ?? 2 }, (_, index) => ({
      id: uuid(index + 3),
      kind: 'url',
      status: index === options.unknownImport ? 'pending' : 'completed',
      url: `https://example.com/article-${index}`,
    })),
    imports: [],
    importRequests: [],
    discoveries: 0,
    creates: [],
    queues: [],
    children: {},
    dispatches: [],
    dispatchFailures: [],
    cleanups: [],
    receiptWrites: 0,
    ...options,
    run: {
      id: uuid(1),
      status: 'queued',
      trigger: 'manual',
      lease_token: uuid(20),
      snapshot: { kind: 'source_collection', profileId: uuid(21), profileRevision: 1 },
      result: {},
    },
  });
  t.after(() => {
    if (previous === undefined) delete process.env.HZENSE_LOCAL_DEVELOPMENT;
    else process.env.HZENSE_LOCAL_DEVELOPMENT = previous;
    delete globalThis[key];
  });
  const { automationWorkflow } = await compiled;
  return { state, execute: () => automationWorkflow(owner, state.run.id) };
}

test('a later unknown import still dispatches the earlier confirmed receipt once', async (t) => {
  const { state: f, execute } = await setup(t, { unknownImport: 1 });
  assert.equal(await execute(), 'failed');
  const firstId = f.creates[0].id;
  assert.deepEqual(f.dispatches, [[owner, firstId, queuedAt]]);
  assert.deepEqual(f.cleanups, []);
  assert.deepEqual(f.imports, [f.items[1].id]);
  assert.equal(f.run.status, 'unknown');
  assert.equal(f.run.result.queuedSources[0].generationId, firstId);
  assert.equal(await execute(), 'already_started_or_finished');
  assert.equal(f.discoveries, 1);
  assert.equal(f.dispatches.length, 1);
});

test('an unknown first import does not invent or dispatch a child', async (t) => {
  const { state: f, execute } = await setup(t, { unknownImport: 0 });
  await execute();
  assert.equal(f.run.status, 'unknown');
  assert.deepEqual(f.creates, []);
  assert.deepEqual(f.dispatches, []);
  assert.deepEqual(f.imports, [f.items[0].id]);
});

for (const option of ['failCreate', 'failQueue']) {
  test(`later ${option} preserves the uncertain request ID without dispatching it`, async (t) => {
    const { state: f, execute } = await setup(t, { [option]: 2 });
    await execute();
    assert.equal(f.run.status, 'unknown');
    assert.equal(f.creates.length, 2);
    assert.deepEqual(f.dispatches, [[owner, f.creates[0].id, queuedAt]]);
    assert.deepEqual(
      f.run.result.generationIds,
      f.creates.map((request) => request.id),
    );
    assert.deepEqual(f.cleanups, []);
  });
}

test('a lost parent receipt write does not strand an acknowledged child queue', async (t) => {
  const { state: f, execute } = await setup(t, { failReceiptWrite: 1 });
  await execute();
  assert.equal(f.run.status, 'unknown');
  assert.equal(f.creates.length, 1);
  assert.deepEqual(f.dispatches, [[owner, f.creates[0].id, queuedAt]]);
  assert.deepEqual(f.run.result.generationIds, [f.creates[0].id]);
});

for (const failCleanup of [false, true]) {
  test(`unknown source and dispatch failure reconcile prior children (cleanup failure=${failCleanup})`, async (t) => {
    const { state: f, execute } = await setup(t, {
      count: 3,
      unknownImport: 2,
      failDispatch: 1,
      failCleanup,
    });
    await execute();
    assert.equal(f.run.status, 'unknown');
    assert.deepEqual(
      f.dispatches,
      f.creates.map((request) => [owner, request.id, queuedAt]),
    );
    assert.deepEqual(f.cleanups, [{ id: f.creates[0].id, at: queuedAt }]);
    assert.equal(f.children[f.creates[0].id].status, failCleanup ? 'pending' : 'failed');
    assert.deepEqual(f.imports, [f.items[2].id]);
  });
}

test('final receipt failure never dispatches acknowledged children a second time', async (t) => {
  const { state: f, execute } = await setup(t, { failReceiptWrite: 4 });
  await execute();
  assert.equal(f.run.status, 'unknown');
  assert.deepEqual(
    f.dispatches,
    f.creates.map((request) => [owner, request.id, queuedAt]),
  );
  assert.deepEqual(f.cleanups, []);
  await execute();
  assert.equal(f.dispatches.length, 2);
});

test('normal completion still dispatches all children with their original fences', async (t) => {
  const { state: f, execute } = await setup(t);
  assert.equal(await execute(), 'completed');
  assert.equal(f.run.status, 'completed');
  assert.deepEqual(
    f.dispatches,
    f.creates.map((request) => [owner, request.id, queuedAt]),
  );
  assert.equal(f.run.result.queuedSources.length, 2);
  assert.equal(f.run.result.failed, 0);
  assert.deepEqual(f.cleanups, []);
});
