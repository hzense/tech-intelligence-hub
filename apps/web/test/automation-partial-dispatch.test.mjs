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
    workflow: `export async function sleep(duration){
      const f=globalThis.${key};f.sleeps.push(duration);
      if(f.sleeps.length>60)throw Error('import admission wait exceeded its run limit');
      if(f.sleepRunPatch)Object.assign(f.run,structuredClone(f.sleepRunPatch));
    }`,
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
      const f=globalThis.${key};f.discoveries++;
      if(f.discovery)f.run.result.discovery=structuredClone(f.discovery);
      return f.items.map(item=>item.url);
    }`,
    '../../../packages/database/src/automation-store.mjs': `
      export class AutomationError extends Error {constructor(code){super(code);this.code=code}}
      export async function rejectInsightTopicsBeforeClaim(){throw Error('Unexpected insight rejection')}
      export async function rejectAutomaticPublicationBeforeClaim(){throw Error('unexpected rejection')}
      export async function readAutomationRun(){
        const f=globalThis.${key};
        if(f.failCheckpointRead&&f.run.phase==='creating_candidates'&&f.queues.length===2){
          f.failCheckpointRead=false;
          throw new AutomationError('database_unavailable');
        }
        return structuredClone(f.run);
      }
      export async function claimAutomationRun(){
        const f=globalThis.${key};if(f.run.status!=='queued')return null;
        f.run.status='running';return structuredClone(f.run);
      }
      export async function updateAutomationRun(args){
        const f=globalThis.${key};
        if(args.phase==='importing_sources'&&args.result?.sourceFailures&&f.failImportReceipt)throw Error('import receipt unconfirmed');
        let receiptFault;
        if(args.phase==='dispatching_candidates'){
          ++f.receiptWrites;
          if(f.receiptWrites===f.failReceiptWrite)throw Error('receipt write unconfirmed');
          receiptFault=f.receiptFaults?.[f.receiptWrites];
          if(receiptFault==='advanced')f.run.result.concurrentReceipt='keep';
          if(receiptFault==='before'||receiptFault==='advanced')throw new AutomationError('database_unavailable');
        }
        f.runUpdates.push(structuredClone(args));
        f.run={...f.run,...structuredClone(args),status:args.status??f.run.status};
        if(args.status && args.status!=='running')Object.assign(f.run,{lease_token:null,lease_until:null,finished_at:new Date().toISOString()});
        if(receiptFault==='after')throw new AutomationError('commit_unknown');
        return structuredClone(f.run);
      }
    `,
    '../lib/server/import-service': `
      import { ImportAdmissionError } from ${JSON.stringify(fileURLToPath(new URL('../lib/import-admission.ts', import.meta.url)))};
      import { ImportTaskError } from ${JSON.stringify(fileURLToPath(new URL('../../../packages/ingestion/src/import-task-contract.mjs', import.meta.url)))};
      export async function executeImportAdmin(_owner,_method,request){
        const f=globalThis.${key};f.importRequests.push(request.action);
        if(request.action==='detail'&&f.failReadback)throw Error('readback unavailable');
        if(request.action==='create'){
          f.importCreateRequests.push(structuredClone(request));
          if(f.importCreateRequests.length===1)return {id:f.batchId,items:structuredClone(f.items)};
          const item=f.fallbackItems.find(item=>item.url===request.request.manifest.urlLines);
          if(!item)throw Error('unexpected fallback batch');
          f.batches[request.request.id]={id:request.request.id,items:[item]};
          return structuredClone(f.batches[request.request.id]);
        }
        return structuredClone(f.batches[request.batchId]);
      }
      export async function runImportItem(_owner,batchId,itemId,firstUrlAttemptOnly=false){
        const f=globalThis.${key};f.imports.push(itemId);
        if(firstUrlAttemptOnly)f.firstClaims.push({batchId,itemId,parentStatus:f.run.status});
        const index=f.importAttempts[itemId]??0;f.importAttempts[itemId]=index+1;
        const plan=f.importOutcomes[itemId];
        const outcome=plan?.[Math.min(index,plan.length-1)];
        if(!outcome)return {status:'running'};
        const item=f.batches[batchId].items.find(item=>item.id===itemId);
        if(outcome.durableStatus)item.status=outcome.durableStatus;
        if(outcome.admission)throw new ImportAdmissionError(outcome.admission);
        if(outcome.errorCode){
          if(outcome.taskError)throw new ImportTaskError(outcome.errorCode);
          throw Object.assign(Error(outcome.errorCode),{code:outcome.errorCode});
        }
        Object.assign(item,outcome);
        return structuredClone(item);
      }
    `,
    '../lib/server/signal-generation': `
      export async function executeGeneration(_owner,request){
        const f=globalThis.${key};f.creates.push(request);
        if(f.duplicateCreates?.includes(f.creates.length)) {
          if(f.duplicateReturnsTask)return {id:'another-task',status:'completed'};
          throw Object.assign(Error('duplicate'),{code:'duplicate_source'});
        }
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
            resolveDir: fileURLToPath(new URL('.', url)),
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

for (const option of ['failImportReceipt', 'failReadback']) {
  test(`${option} stops isolation when durable state cannot be confirmed`, async (t) => {
    const { state: f, execute } = await setup(t, { count: 3, unknownImport: 1, [option]: true });
    assert.equal(await execute(), 'failed');
    assert.equal(f.run.status, 'unknown');
    assert.equal(f.creates.length, 1);
    assert.equal(f.dispatches.length, 1);
    assert.deepEqual(f.imports, [f.items[1].id]);
  });
}

async function setup(t, options = {}) {
  const previous = process.env.HZENSE_LOCAL_DEVELOPMENT;
  delete process.env.HZENSE_LOCAL_DEVELOPMENT;
  t.mock.method(globalThis.console, 'info', () => {});
  const state = (globalThis[key] = {
    batchId: uuid(2),
    items: Array.from({ length: options.count ?? 2 }, (_, index) => ({
      id: uuid(index + 3),
      kind: 'url',
      status:
        options.itemStatuses?.[index] ??
        (index === options.unknownImport ? 'pending' : 'completed'),
      url: `https://example.com/article-${index}`,
    })),
    imports: [],
    firstClaims: [],
    importAttempts: {},
    importOutcomes: {},
    importRequests: [],
    importCreateRequests: [],
    fallbackItems: [],
    sleeps: [],
    runUpdates: [],
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
      lease_until: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
      snapshot: { kind: 'source_collection', profileId: uuid(21), profileRevision: 1 },
      result: {},
    },
  });
  state.batches = { [state.batchId]: { id: state.batchId, items: state.items } };
  t.after(() => {
    if (previous === undefined) delete process.env.HZENSE_LOCAL_DEVELOPMENT;
    else process.env.HZENSE_LOCAL_DEVELOPMENT = previous;
    delete globalThis[key];
  });
  const { automationWorkflow } = await compiled;
  return { state, execute: () => automationWorkflow(owner, state.run.id) };
}

function withSourceAlternative() {
  const url = 'https://example.com/fallback-0';
  return {
    fallbackItems: [{ id: uuid(100), kind: 'url', status: 'queued', url }],
    discovery: {
      windowStart: '2026-10-24T00:00:00.000Z',
      windowEnd: '2026-10-25T23:59:59.999Z',
      articles: [
        {
          url: 'https://example.com/article-0',
          alternatives: [{ url, title: 'Alternative source', publishedAt: '2026-10-25' }],
        },
      ],
    },
  };
}

test('after a parent interruption, parse untouched original URLs without starting new AI work', async (t) => {
  const { state: f, execute } = await setup(t, {
    count: 4,
    itemStatuses: ['completed', 'completed', 'queued', 'queued'],
    failCreate: 2,
    importOutcomes: { [uuid(5)]: [{ status: 'completed' }], [uuid(6)]: [{ status: 'completed' }] },
  });
  assert.equal(await execute(), 'failed');
  assert.deepEqual(
    f.firstClaims,
    [uuid(5), uuid(6)].map((itemId) => ({
      batchId: f.batchId,
      itemId,
      parentStatus: 'unknown',
    })),
  );
  assert.equal(f.discoveries, 1);
  assert.equal(f.creates.length, 2);
  assert.equal(f.dispatches.length, 1);
  assert.equal(f.importCreateRequests.length, 1);
  assert.equal(await execute(), 'already_started_or_finished');
  assert.equal(f.firstClaims.length, 2);
});

test('recovery stops on a budget refusal and leaves the rest available for manual recovery', async (t) => {
  const { state: f, execute } = await setup(t, {
    count: 3,
    itemStatuses: ['completed', 'queued', 'queued'],
    failCreate: 1,
    importOutcomes: { [uuid(4)]: [{ admission: 'budget_exceeded' }] },
  });
  assert.equal(await execute(), 'failed');
  assert.deepEqual(
    f.firstClaims.map((row) => row.itemId),
    [uuid(4)],
  );
  assert.equal(f.items[2].status, 'queued');
  assert.equal(f.dispatches.length, 0);
});

test('typed worker admission waits durably and dispatches a recovered source exactly once', async (t) => {
  const { state: f, execute } = await setup(t, {
    count: 1,
    itemStatuses: ['queued'],
    importOutcomes: {
      [uuid(3)]: [
        { admission: 'worker_busy' },
        { admission: 'worker_busy' },
        { status: 'completed' },
      ],
    },
  });
  assert.equal(await execute(), 'completed');
  assert.deepEqual(f.sleeps, ['30s', '30s']);
  assert.deepEqual(f.imports, Array(3).fill(f.items[0].id));
  assert.equal(f.importCreateRequests.length, 1);
  assert.equal(f.discoveries, 1);
  assert.equal(f.creates.length, 1);
  assert.deepEqual(f.dispatches, [[owner, f.creates[0].id, queuedAt]]);
  assert.equal(f.run.status, 'completed');
  assert.equal(f.run.result.failed, 0);
  assert.equal(f.run.result.unknown, 0);
  assert.deepEqual(f.run.result.sourceFailures ?? [], []);
  assert.ok(f.runUpdates.every((update) => !update.result?.sourceFailures?.length));
  assert.equal(await execute(), 'already_started_or_finished');
  assert.equal(f.discoveries, 1);
  assert.equal(f.imports.length, 3);
  assert.equal(f.sleeps.length, 2);
  assert.equal(f.creates.length, 1);
  assert.equal(f.dispatches.length, 1);
});

for (const [change, sleepRunPatch] of [
  ['lease expiry', { lease_until: '2000-01-01T00:00:00.000Z' }],
  ['run cancellation', { status: 'cancelled' }],
]) {
  test(`${change} during admission wait stops another import and dispatches prior confirmed work`, async (t) => {
    const { state: f, execute } = await setup(t, {
      count: 3,
      itemStatuses: ['completed', 'queued', 'completed'],
      importOutcomes: { [uuid(4)]: [{ admission: 'worker_busy' }, { status: 'completed' }] },
      sleepRunPatch,
    });
    assert.equal(await execute(), 'failed');
    assert.deepEqual(f.sleeps, ['30s']);
    assert.deepEqual(f.imports, [f.items[1].id]);
    assert.equal(f.items[1].status, 'queued');
    assert.equal(f.discoveries, 1);
    assert.equal(f.importCreateRequests.length, 1);
    assert.equal(f.creates.length, 1);
    assert.equal(f.creates[0].itemId, f.items[0].id);
    assert.deepEqual(f.dispatches, [[owner, f.creates[0].id, queuedAt]]);
    assert.deepEqual(f.cleanups, []);
    assert.deepEqual(f.run.result.generationIds, [f.creates[0].id]);
    assert.equal(await execute(), 'already_started_or_finished');
    assert.equal(f.imports.length, 1);
    assert.equal(f.discoveries, 1);
    assert.equal(f.dispatches.length, 1);
  });
}

test('persistent worker contention has one shared wait limit and preserves later completed work', async (t) => {
  const { state: f, execute } = await setup(t, {
    count: 3,
    itemStatuses: ['queued', 'queued', 'completed'],
    importOutcomes: {
      [uuid(3)]: [{ admission: 'worker_busy' }],
      [uuid(4)]: [{ admission: 'worker_busy' }],
    },
    ...withSourceAlternative(),
  });
  assert.equal(await execute(), 'completed');
  assert.deepEqual(f.sleeps, Array(60).fill('30s'));
  assert.deepEqual(f.imports, [...Array(61).fill(f.items[0].id), f.items[1].id]);
  assert.equal(f.discoveries, 1);
  assert.equal(f.importCreateRequests.length, 1);
  assert.deepEqual(
    f.items.map((item) => item.status),
    ['queued', 'queued', 'completed'],
  );
  assert.equal(f.run.status, 'completed');
  assert.equal(f.run.result.failed, 2);
  assert.equal(f.run.result.unknown, 0);
  assert.deepEqual(f.run.result.sourceFailures, [
    { itemId: f.items[0].id, phase: 'import_source', code: 'worker_busy' },
    { itemId: f.items[1].id, phase: 'import_source', code: 'worker_busy' },
  ]);
  assert.equal(f.creates.length, 1);
  assert.equal(f.creates[0].itemId, f.items[2].id);
  assert.deepEqual(f.dispatches, [[owner, f.creates[0].id, queuedAt]]);
  assert.equal(await execute(), 'already_started_or_finished');
  assert.equal(f.imports.length, 62);
  assert.equal(f.sleeps.length, 60);
  assert.equal(f.discoveries, 1);
  assert.equal(f.dispatches.length, 1);
});

test('primary and fallback imports consume the same bounded admission wait allowance', async (t) => {
  const { state: f, execute } = await setup(t, {
    itemStatuses: ['queued', 'completed'],
    ...withSourceAlternative(),
    importOutcomes: {
      [uuid(3)]: [
        ...Array.from({ length: 59 }, () => ({ admission: 'worker_busy' })),
        {
          status: 'failed',
          error_code: 'fetch_failed',
          fetch_diagnostic: { reason: 'network' },
        },
      ],
      [uuid(100)]: [{ admission: 'worker_busy' }],
    },
  });
  assert.equal(await execute(), 'completed');
  assert.deepEqual(f.sleeps, Array(60).fill('30s'));
  assert.deepEqual(f.imports, [...Array(60).fill(f.items[0].id), uuid(100), uuid(100)]);
  assert.equal(f.discoveries, 1);
  assert.equal(f.importCreateRequests.length, 2);
  assert.equal(f.fallbackItems[0].status, 'queued');
  assert.equal(f.run.result.sourceFallbacks.length, 1);
  assert.equal(f.run.result.failed, 1);
  assert.equal(f.run.result.unknown, 0);
  assert.deepEqual(f.run.result.sourceFailures.at(-1), {
    itemId: uuid(100),
    phase: 'import_source',
    code: 'worker_busy',
  });
  assert.equal(f.creates.length, 1);
  assert.equal(f.creates[0].itemId, f.items[1].id);
  assert.deepEqual(f.dispatches, [[owner, f.creates[0].id, queuedAt]]);
  assert.equal(await execute(), 'already_started_or_finished');
  assert.equal(f.imports.length, 62);
  assert.equal(f.importCreateRequests.length, 2);
  assert.equal(f.discoveries, 1);
});

for (const code of ['budget_exceeded', 'configuration_conflict']) {
  test(`typed ${code} remains a precise blocked import without retry or fallback`, async (t) => {
    const { state: f, execute } = await setup(t, {
      itemStatuses: ['queued', 'completed'],
      importOutcomes: { [uuid(3)]: [{ admission: code }] },
      ...withSourceAlternative(),
    });
    assert.equal(await execute(), 'completed');
    assert.deepEqual(f.sleeps, []);
    assert.deepEqual(f.imports, [f.items[0].id]);
    assert.equal(f.importCreateRequests.length, 1);
    assert.equal(f.items[0].status, 'queued');
    assert.equal(f.run.status, 'completed');
    assert.equal(f.run.result.failed, 1);
    assert.equal(f.run.result.unknown, 0);
    assert.deepEqual(f.run.result.sourceFailures, [
      { itemId: f.items[0].id, phase: 'import_source', code },
    ]);
    assert.equal(f.creates.length, 1);
    assert.equal(f.creates[0].itemId, f.items[1].id);
    assert.deepEqual(f.dispatches, [[owner, f.creates[0].id, queuedAt]]);
    assert.equal(await execute(), 'already_started_or_finished');
    assert.equal(f.imports.length, 1);
    assert.equal(f.discoveries, 1);
    assert.equal(f.dispatches.length, 1);
  });
}

for (const outcome of [
  { admission: 'cancelled', durableStatus: 'cancelled' },
  { status: 'cancelled' },
]) {
  test(`cancelled imports remain terminal (${outcome.admission ? 'admission' : 'result'})`, async (t) => {
    const { state: f, execute } = await setup(t, {
      itemStatuses: ['queued', 'completed'],
      importOutcomes: { [uuid(3)]: [outcome] },
      ...withSourceAlternative(),
    });
    await execute();
    assert.deepEqual(f.sleeps, []);
    assert.deepEqual(f.imports, [f.items[0].id]);
    assert.equal(f.importCreateRequests.length, 1);
    assert.equal(f.items[0].status, 'cancelled');
    assert.equal(f.run.result.failed, 1);
    assert.equal(f.run.result.unknown, 0);
    assert.deepEqual(f.run.result.sourceFailures, [
      { itemId: f.items[0].id, phase: 'import_source', code: 'cancelled' },
    ]);
    assert.equal(f.dispatches.length, 1);
  });
}

for (const outcome of [
  { errorCode: 'worker_busy' },
  { errorCode: 'budget_exceeded' },
  { errorCode: 'configuration_conflict' },
  { errorCode: 'cancelled' },
  { errorCode: 'worker_busy', taskError: true },
  { errorCode: 'commit_unknown', taskError: true },
]) {
  test(`an unproven ${outcome.errorCode} error is never retried (task error=${!!outcome.taskError})`, async (t) => {
    const { state: f, execute } = await setup(t, {
      itemStatuses: ['queued', 'completed'],
      importOutcomes: { [uuid(3)]: [outcome] },
      ...withSourceAlternative(),
    });
    assert.equal(await execute(), 'outcome_unknown');
    assert.deepEqual(f.sleeps, []);
    assert.deepEqual(f.imports, [f.items[0].id]);
    assert.equal(f.importCreateRequests.length, 1);
    assert.equal(f.run.status, 'unknown');
    assert.equal(f.run.result.failed, 0);
    assert.equal(f.run.result.unknown, 1);
    assert.deepEqual(f.run.result.sourceFailures, [
      { itemId: f.items[0].id, phase: 'import_source', code: 'outcome_unknown' },
    ]);
    assert.equal(f.dispatches.length, 1);
    assert.equal(await execute(), 'already_started_or_finished');
    assert.equal(f.imports.length, 1);
    assert.equal(f.discoveries, 1);
    assert.equal(f.dispatches.length, 1);
  });
}

for (const status of ['running', 'unknown', 'completed']) {
  test(`a typed admission refusal reconciles a durable ${status} item without retry`, async (t) => {
    const { state: f, execute } = await setup(t, {
      count: 1,
      itemStatuses: ['queued'],
      importOutcomes: { [uuid(3)]: [{ admission: 'worker_busy', durableStatus: status }] },
      ...withSourceAlternative(),
    });
    assert.equal(await execute(), status === 'completed' ? 'completed' : 'outcome_unknown');
    assert.deepEqual(f.sleeps, []);
    assert.deepEqual(f.imports, [f.items[0].id]);
    assert.equal(f.importCreateRequests.length, 1);
    assert.equal(f.run.result.unknown, status === 'completed' ? 0 : 1);
    assert.equal(f.dispatches.length, status === 'completed' ? 1 : 0);
    assert.equal(await execute(), 'already_started_or_finished');
    assert.equal(f.imports.length, 1);
    assert.equal(f.discoveries, 1);
  });
}

test('an already running import is read back once and never claimed again', async (t) => {
  const { state: f, execute } = await setup(t, {
    itemStatuses: ['running', 'completed'],
    importOutcomes: { [uuid(3)]: [{ status: 'running' }] },
    ...withSourceAlternative(),
  });
  assert.equal(await execute(), 'outcome_unknown');
  assert.deepEqual(f.sleeps, []);
  assert.deepEqual(f.imports, [f.items[0].id]);
  assert.equal(f.importRequests.filter((action) => action === 'detail').length, 1);
  assert.equal(f.importCreateRequests.length, 1);
  assert.equal(f.run.result.unknown, 1);
  assert.equal(f.dispatches.length, 1);
  assert.equal(await execute(), 'already_started_or_finished');
  assert.equal(f.imports.length, 1);
  assert.equal(f.dispatches.length, 1);
});

test('a later unknown import still dispatches the earlier confirmed receipt once', async (t) => {
  const { state: f, execute } = await setup(t, { unknownImport: 1 });
  assert.equal(await execute(), 'outcome_unknown');
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

test('an unknown first import is isolated and later sources still dispatch', async (t) => {
  const { state: f, execute } = await setup(t, { unknownImport: 0 });
  await execute();
  assert.equal(f.run.status, 'unknown');
  assert.equal(f.creates.length, 1);
  assert.deepEqual(f.dispatches, [[owner, f.creates[0].id, queuedAt]]);
  assert.equal(f.run.result.unknown, 1);
  assert.equal(f.run.result.failed, 0);
  assert.deepEqual(f.run.result.sourceFailures, [
    { itemId: f.items[0].id, phase: 'import_source', code: 'outcome_unknown' },
  ]);
  assert.deepEqual(f.imports, [f.items[0].id]);
});

test('an unknown middle source does not stop either healthy neighbour or retry on replay', async (t) => {
  const { state: f, execute } = await setup(t, { count: 3, unknownImport: 1 });
  assert.equal(await execute(), 'outcome_unknown');
  assert.equal(f.creates.length, 2);
  assert.equal(f.dispatches.length, 2);
  assert.deepEqual(f.imports, [f.items[1].id]);
  assert.equal(await execute(), 'already_started_or_finished');
  assert.equal(f.dispatches.length, 2);
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

for (const fault of ['before', 'after', 'read']) {
  test(`dispatch checkpoint recovers a transient storage error (${fault}) without repeating billable work`, async (t) => {
    const { state: f, execute } = await setup(t, {
      count: 5,
      itemStatuses: Array(5).fill('queued'),
      importOutcomes: Object.fromEntries(
        Array.from({ length: 5 }, (_, i) => [uuid(3 + i), [{ status: 'completed' }]]),
      ),
      receiptFaults: { 2: fault },
      failCheckpointRead: fault === 'read',
    });
    assert.equal(await execute(), 'completed');
    assert.equal(f.discoveries, 1);
    assert.deepEqual(
      f.imports,
      f.items.map((item) => item.id),
    );
    assert.deepEqual(
      f.creates.map((request) => request.itemId),
      f.imports,
    );
    assert.deepEqual(
      f.dispatches,
      f.creates.map((request) => [owner, request.id, queuedAt]),
    );
    assert.equal(f.receiptWrites, fault === 'before' ? 8 : 7);
    assert.equal(f.run.result.queuedSources.length, 5);
  });
}

for (const [reason, receiptFaults] of [
  ['repeated storage error', { 1: 'before', 2: 'before' }],
  ['newer saved receipt', { 1: 'advanced' }],
]) {
  test(`dispatch checkpoint stops safely for a ${reason}`, async (t) => {
    const { state: f, execute } = await setup(t, { receiptFaults });
    assert.equal(await execute(), 'failed');
    assert.equal(f.receiptWrites, Object.keys(receiptFaults).length);
    assert.equal(f.discoveries, 1);
    assert.equal(f.creates.length, 1);
    assert.deepEqual(f.dispatches, [[owner, f.creates[0].id, queuedAt]]);
    if (reason === 'newer saved receipt') assert.equal(f.run.result.concurrentReceipt, 'keep');
  });
}

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

for (const duplicateReturnsTask of [false, true]) {
  test(`duplicate sources are skipped without requeueing another task (returned=${duplicateReturnsTask})`, async (t) => {
    const { state: f, execute } = await setup(t, {
      count: 3,
      duplicateCreates: [1, 3],
      duplicateReturnsTask,
    });
    assert.equal(await execute(), 'completed');
    assert.equal(f.run.status, 'completed');
    assert.equal(f.run.result.failed, 0);
    assert.equal(f.run.result.skipped, 2);
    assert.equal(f.run.result.unknown, 0);
    assert.deepEqual(f.run.result.generationIds, [f.creates[1].id]);
    assert.deepEqual(f.queues, [f.creates[1].id]);
    assert.deepEqual(f.dispatches, [[owner, f.creates[1].id, queuedAt]]);
    assert.equal(f.run.result.sourceFailures.length, 2);
    assert.ok(f.run.result.sourceFailures.every((receipt) => receipt.code === 'duplicate_source'));
    assert.equal(await execute(), 'already_started_or_finished');
    assert.equal(f.creates.length, 3);
  });
}
test('all duplicate sources complete with no new work and no failed count', async (t) => {
  const { state: f, execute } = await setup(t, { duplicateCreates: [1, 2] });
  await execute();
  assert.equal(f.run.status, 'completed');
  assert.equal(f.run.phase, 'no_new_sources');
  assert.equal(f.run.result.failed, 0);
  assert.equal(f.run.result.skipped, 2);
  assert.deepEqual(f.queues, []);
  assert.deepEqual(f.dispatches, []);
});
