import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath, URL } from 'node:url';
import { Buffer } from 'node:buffer';
import { build } from 'esbuild';

test('source discovery orchestrates originals and private candidates without dropping search costs', async () => {
  const source = await readFile(new URL('../workflows/automation.ts', import.meta.url), 'utf8');
  assert.match(source, /findSources\.maxRetries = 0/);
  const mocks = {
    workflow: 'export async function sleep(){}',
    'workflow/api':
      'export async function start(_workflow,args){const f=globalThis.__sourceFlow;f.dispatched.push(args[1]);f.dispatchedArgs.push(args);if(f.dispatchErrors.includes(args[1]))throw Error("unknown");}',
    '../lib/server/automation':
      'export function automationLimits(){return {batch:1000000,daily:5000000,reserve:500000}}',
    '../lib/server/automation-store-access': 'export const automationPool={};',
    '../../../packages/database/src/automation-contract.mjs':
      'export function automationStableId(x){return x.itemId ?? "batch-id"}',
    '../../../packages/database/src/automation-store.mjs': `
      export async function claimAutomationRun(){const f=globalThis.__sourceFlow;if(f.run.status!=='queued')return null;f.run.status='running';return structuredClone(f.run)}
      export async function readAutomationRun(){return structuredClone(globalThis.__sourceFlow.run)}
      export async function updateAutomationRun(args){const f=globalThis.__sourceFlow;if(f.run.status!=='running')throw Error('stale_attempt');f.updates.push(args);f.run.result=args.result;f.run.phase=args.phase;f.run.status=args.status??'running';f.run.charged_microusd=args.costMicrousd??f.run.charged_microusd;return structuredClone(f.run)}
    `,
    '../lib/server/source-discovery': `export async function discoverSources(){const f=globalThis.__sourceFlow;f.discoveries++;f.run.result={discovery:{articles:f.urls.map(url=>({url,title:'原文',publishedAt:'2026-09-30'}))},discoveryCostMicrousd:25000,discoveryCostSource:'provider'};return f.urls;}`,
    '../lib/server/import-service': `
      export async function executeImportAdmin(_owner,_method,body){const f=globalThis.__sourceFlow;f.imports.push(body);return {id:'batch-id',items:f.urls.map((_url,i)=>({id:f.itemIds?.[i]??'item-'+i,status:body.action==='detail'?(f.readbackStates[f.itemIds?.[i]??'item-'+i]??'unknown'):'pending',kind:'url'}))}}
      export async function runImportItem(_owner,_batch,id){const f=globalThis.__sourceFlow;f.importAttempts.push(id);if(f.thrownItems.includes(id))throw Error('unconfirmed');return {status:f.returnedStates[id]??(f.failedItems.includes(id)?'failed':'completed')}}
    `,
    '../lib/server/signal-generation': `
      export async function executeGeneration(_owner,request){const f=globalThis.__sourceFlow;if(!f.run.result.generationIds.includes(request.id))throw Error('request id not pinned');f.generated.push(request);if(f.createErrors[request.id])throw Object.assign(Error('private creation rejection'),{code:f.createErrors[request.id],raw:'private-secret'});return {id:f.createdIds[request.id]??request.id,status:'pending'}}
      export async function queueGeneration(_owner,id){const f=globalThis.__sourceFlow;f.queued.push(id);if(f.queueErrors[id])throw Object.assign(Error('queue failed'),{code:f.queueErrors[id]});return f.queueReceipts[id]??{status:'pending',progress_phase:'queued',progress_at:new Date('2026-10-02T12:00:00.123Z')}}
      export async function failQueuedGeneration(owner,id,queuedAt){const f=globalThis.__sourceFlow;f.closedQueues.push([owner,id,queuedAt]);if(f.cleanupError)throw Error('cleanup unavailable')}
    `,
    './signal-generation': 'export async function signalGenerationWorkflow(){}',
    '../lib/server/topic-insight-sandbox':
      'export async function startTopicInsightSandbox(){} export async function pollTopicInsightSandbox(){} export async function stopTopicInsightSandbox(){}',
  };
  const fixture = await build({
    stdin: {
      contents: source,
      loader: 'ts',
      resolveDir: fileURLToPath(new URL('../workflows', import.meta.url)),
    },
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'node',
    plugins: [
      {
        name: 'synthetic-source-flow',
        setup(builder) {
          builder.onResolve({ filter: /.*/ }, (args) =>
            mocks[args.path] ? { path: args.path, namespace: 'fixture' } : undefined,
          );
          builder.onLoad({ filter: /.*/, namespace: 'fixture' }, (args) => ({
            contents: mocks[args.path],
          }));
        },
      },
    ],
  });
  const { automationWorkflow } = await import(
    `data:text/javascript;base64,${Buffer.from(fixture.outputFiles[0].text).toString('base64')}`
  );
  const setup = (urls) =>
    (globalThis.__sourceFlow = {
      urls,
      imports: [],
      generated: [],
      queued: [],
      dispatched: [],
      dispatchedArgs: [],
      dispatchErrors: [],
      closedQueues: [],
      discoveries: 0,
      updates: [],
      failedItems: [],
      thrownItems: [],
      returnedStates: {},
      readbackStates: {},
      importAttempts: [],
      queueReceipts: {},
      queueErrors: {},
      createErrors: {},
      createdIds: {},
      run: {
        id: 'run',
        status: 'queued',
        lease_token: 'token',
        phase: 'preparing',
        snapshot: { kind: 'source_collection', profileId: 'profile', profileRevision: 1 },
        result: null,
      },
    });
  try {
    let f = setup([]);
    assert.equal(await automationWorkflow('owner', 'run'), 'no_new_sources');
    assert.equal(f.imports.length, 0);
    assert.equal(f.generated.length, 0);
    assert.equal(f.run.charged_microusd, 25000);
    f = setup(['https://example.com/a', 'https://example.com/b']);
    f.failedItems = ['item-1'];
    await automationWorkflow('owner', 'run');
    assert.equal(f.imports[0].request.manifest.urlLines, f.urls.join('\n'));
    assert.deepEqual(f.dispatched, ['item-0']);
    assert.deepEqual(f.dispatchedArgs, [['owner', 'item-0', '2026-10-02T12:00:00.123Z']]);
    assert.equal(f.run.result.failed, 1);
    assert.equal(f.run.result.discovery.articles.length, 2);
    assert.equal(f.run.charged_microusd, 25000);
    assert.equal(f.run.result.queuedSources[0].url, f.urls[0]);
    assert.equal(f.run.result.queuedSources[0].queuedAt, f.dispatchedArgs[0][2]);
    assert.equal(f.generated[0].action, 'create');
    assert.equal(await automationWorkflow('owner', 'run'), 'already_started_or_finished');
    assert.equal(f.discoveries, 1);
    f = setup(['https://example.com/a', 'https://example.com/b']);
    f.dispatchErrors = ['item-0'];
    assert.equal(await automationWorkflow('owner', 'run'), 'completed');
    assert.equal(f.run.status, 'completed');
    assert.equal(f.run.result.failed, 1);
    assert.equal(f.run.result.batchId, 'batch-id');
    assert.deepEqual(f.run.result.generationIds, ['item-0', 'item-1']);
    assert.deepEqual(f.dispatched, ['item-0', 'item-1']);
    assert.deepEqual(f.closedQueues, [['owner', 'item-0', '2026-10-02T12:00:00.123Z']]);
    assert.equal(f.run.charged_microusd, 25000);
    assert.equal(await automationWorkflow('owner', 'run'), 'already_started_or_finished');
    assert.deepEqual(f.dispatched, ['item-0', 'item-1'], 'failed dispatch is never replayed');
    f = setup(['https://example.com/a', 'https://example.com/b']);
    f.dispatchErrors = ['item-0'];
    f.cleanupError = true;
    assert.equal(await automationWorkflow('owner', 'run'), 'failed');
    assert.equal(f.run.status, 'unknown');
    assert.equal(f.run.result.failed, 1);
    assert.deepEqual(f.dispatched, ['item-0', 'item-1']);
    assert.deepEqual(f.run.result.generationIds, ['item-0', 'item-1']);
    assert.equal(f.run.charged_microusd, 25000);
    f = setup(['https://example.com/a']);
    f.failedItems = ['item-0'];
    await automationWorkflow('owner', 'run');
    assert.equal(f.run.status, 'failed');
    assert.equal(f.generated.length, 0);
    for (const receipt of [
      { status: 'pending', progress_phase: 'queued', progress_at: null },
      { status: 'pending', progress_phase: 'queued', progress_at: 'not-a-date' },
      { status: 'pending', progress_phase: 'queued', progress_at: new Date('invalid') },
      { status: 'pending', progress_phase: 'preparing', progress_at: '2026-10-02T12:00:00Z' },
      { status: 'running', progress_phase: 'queued', progress_at: '2026-10-02T12:00:00Z' },
    ]) {
      f = setup(['https://example.com/a']);
      f.queueReceipts['item-0'] = receipt;
      await automationWorkflow('owner', 'run');
      assert.deepEqual(f.dispatched, [], 'unconfirmed queue receipts cannot start a worker');
      assert.deepEqual(f.queued, ['item-0'], 'an invalid receipt never causes automatic requeue');
      assert.equal(f.run.status, 'unknown');
      assert.deepEqual(f.run.result.generationIds, ['item-0']);
      assert.equal(f.run.charged_microusd, 25000);
    }
    f = setup(['https://example.com/a']);
    f.queueReceipts['item-0'] = {
      status: 'pending',
      progress_phase: 'queued',
      progress_at: '2026-10-02T14:00:00.987+02:00',
    };
    await automationWorkflow('owner', 'run');
    assert.equal(f.dispatchedArgs[0][2], '2026-10-02T12:00:00.987Z');
    for (const confirmed of ['completed', 'failed', 'cancelled']) {
      f = setup(['https://example.com/a', 'https://example.com/b']);
      f.thrownItems = ['item-0'];
      f.readbackStates['item-0'] = confirmed;
      await automationWorkflow('owner', 'run');
      assert.deepEqual(f.importAttempts, ['item-0', 'item-1']);
      assert.deepEqual(f.dispatched, confirmed === 'completed' ? ['item-0', 'item-1'] : ['item-1']);
      assert.equal(f.imports.filter((body) => body.action === 'detail').length, 1);
    }
    for (const unconfirmed of ['running', 'unknown', 'queued']) {
      f = setup(['https://example.com/a', 'https://example.com/b']);
      f.thrownItems = ['item-1'];
      f.readbackStates['item-1'] = unconfirmed;
      await automationWorkflow('owner', 'run');
      assert.equal(f.run.status, 'unknown');
      assert.equal(f.run.result.batchId, 'batch-id');
      assert.deepEqual(f.run.result.generationIds, ['item-0']);
      assert.deepEqual(f.importAttempts, ['item-0', 'item-1']);
      assert.deepEqual(f.dispatched, [], 'an unknown item is not retried or treated as failed');
      assert.equal(f.run.charged_microusd, 25000);
    }
    f = setup(['https://example.com/a']);
    f.returnedStates['item-0'] = 'unknown';
    await automationWorkflow('owner', 'run');
    assert.equal(f.run.status, 'unknown');
    assert.deepEqual(f.importAttempts, ['item-0']);
    assert.deepEqual(f.dispatched, []);
    for (const errors of ['createErrors', 'queueErrors']) {
      f = setup(['https://example.com/a', 'https://example.com/b']);
      f[errors]['item-1'] = 'commit_unknown';
      await automationWorkflow('owner', 'run');
      assert.equal(f.run.status, 'unknown');
      assert.equal(f.run.result.batchId, 'batch-id');
      assert.deepEqual(f.run.result.generationIds, ['item-0', 'item-1']);
      assert.equal(f.run.result.queuedSources[0].generationId, 'item-0');
      assert.equal(f.run.charged_microusd, 25000);
      assert.deepEqual(f.dispatched, []);
      assert.equal(f.generated.filter((value) => value.id === 'item-1').length, 1);
      assert.equal(
        f.queued.filter((id) => id === 'item-1').length,
        errors === 'queueErrors' ? 1 : 0,
      );
      await automationWorkflow('owner', 'run');
      assert.equal(f.generated.filter((value) => value.id === 'item-1').length, 1);
    }
    f = setup(['https://example.com/a', 'https://example.com/b']);
    f.createErrors['item-0'] = 'duplicate_source';
    await automationWorkflow('owner', 'run');
    assert.deepEqual(f.run.result.generationIds, ['item-1']);
    assert.deepEqual(f.dispatched, ['item-1']);
    assert.equal(f.run.result.failed, 1);
    f = setup(['https://example.com/a', 'https://example.com/b']);
    f.createdIds['item-0'] = 'existing-manual-task';
    await automationWorkflow('owner', 'run');
    assert.deepEqual(f.run.result.generationIds, ['item-1']);
    assert.deepEqual(f.queued, ['item-1'], 'do not commandeer a semantically deduplicated task');
    assert.deepEqual(f.dispatched, ['item-1']);

    const itemIds = [
      '11111111-1111-4111-8111-111111111111',
      '22222222-2222-4222-8222-222222222222',
      '33333333-3333-4333-8333-333333333333',
    ];
    f = setup(itemIds.map((_, index) => `https://example.com/${index}`));
    f.itemIds = itemIds;
    for (const itemId of itemIds) f.createErrors[itemId] = 'invalid_request';
    await automationWorkflow('owner', 'run');
    assert.equal(f.run.status, 'failed');
    assert.equal(f.run.phase, 'source_failed');
    assert.equal(f.run.result.failed, 3);
    assert.deepEqual(
      f.run.result.sourceFailures,
      itemIds.map((itemId) => ({
        itemId,
        phase: 'create_candidate',
        code: 'invalid_request',
      })),
    );
    assert.deepEqual(f.run.result.generationIds, []);
    assert.deepEqual(f.queued, []);
    assert.deepEqual(f.dispatched, []);
    assert.equal(f.run.charged_microusd, 25000);
    assert.equal(f.generated.length, 3, 'each confirmed refusal is attempted only once');
    assert.equal(JSON.stringify(f.run.result).includes('private'), false);

    // A later ambiguous create retains earlier confirmed receipts without
    // presenting that unknown outcome as another confirmed source failure.
    for (const unknownCode of ['commit_unknown', 'private-code', { toString: null }]) {
      f = setup(['https://example.com/a', 'https://example.com/b']);
      f.itemIds = itemIds.slice(0, 2);
      f.createErrors[itemIds[0]] = 'profile_not_ready';
      f.createErrors[itemIds[1]] = unknownCode;
      await automationWorkflow('owner', 'run');
      assert.equal(f.run.status, 'unknown');
      assert.deepEqual(f.run.result.sourceFailures, [
        {
          itemId: itemIds[0],
          phase: 'create_candidate',
          code: 'profile_not_ready',
        },
      ]);
      assert.deepEqual(f.run.result.generationIds, [itemIds[1]]);
      assert.equal(f.generated.length, 2);
      assert.deepEqual(f.queued, []);
      assert.deepEqual(f.dispatched, []);
      assert.equal(f.run.charged_microusd, 25000);
      assert.equal(JSON.stringify(f.run.result).includes('private'), false);
    }
  } finally {
    delete globalThis.__sourceFlow;
  }
});
