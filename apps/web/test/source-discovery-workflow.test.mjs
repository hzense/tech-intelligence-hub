import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath, URL } from 'node:url';
import { Buffer } from 'node:buffer';
import process from 'node:process';
import { build } from 'esbuild';

test('source discovery orchestrates originals and private candidates without dropping search costs', async () => {
  const source = await readFile(new URL('../workflows/automation.ts', import.meta.url), 'utf8');
  for (const step of [
    'claim',
    'findSources',
    'createSourceBatch',
    'createFallbackSourceBatch',
    'importSourceItem',
    'createPrivateGeneration',
    'dispatchGeneration',
    'startTopicWorker',
  ])
    assert.match(source, new RegExp(`${step}\\.maxRetries = 0`));
  const mocks = {
    workflow: 'export async function sleep(){}',
    'workflow/api':
      'export async function start(workflow,args){const f=globalThis.__sourceFlow;f.dispatched.push(args[1]);f.dispatchedArgs.push(args);f.dispatchedWorkflows.push(workflow.name);if(f.dispatchErrors.includes(args[1]))throw Error("unknown");}',
    '../lib/local-development': `export function isLocalRealAutomationEnabled(){return process.env.HZENSE_LOCAL_DEVELOPMENT==='1'&&process.env.HZENSE_LOCAL_AI_MODE==='real'&&process.env.WORKFLOW_TARGET_WORLD==='local'&&process.env.HZENSE_AUTOMATION_ENABLED==='1'&&globalThis.__sourceFlow.localIsolationValid}
      export function isLocalAutomationSchedulerEnabled(){return isLocalRealAutomationEnabled()&&process.env.HZENSE_LOCAL_AUTOMATION_SCHEDULER_ENABLED==='1'}`,
    '../lib/server/automation':
      'export function automationLimits(){return {batch:1000000,daily:5000000,reserve:500000}}',
    '../lib/server/automation-store-access': 'export const automationPool={};',
    '../../../packages/database/src/automation-contract.mjs': `import {createHash} from 'node:crypto';
      export function automationStableId(x){if(x.kind!=='import_fallback')return x.itemId??'batch-id';const hex=createHash('sha256').update(JSON.stringify(x)).digest('hex');return hex.slice(0,8)+'-'+hex.slice(8,12)+'-4'+hex.slice(13,16)+'-8'+hex.slice(17,20)+'-'+hex.slice(20,32)}`,
    '../../../packages/database/src/automation-store.mjs': `
      export class AutomationError extends Error {constructor(code){super(code);this.code=code}}
      export async function rejectInsightTopicsBeforeClaim(){throw Error('Unexpected insight rejection')}
      export async function rejectAutomaticPublicationBeforeClaim(){const f=globalThis.__sourceFlow;f.rejectedAutomaticClaims++;f.run.status='failed'}
      export async function claimAutomationRun(){const f=globalThis.__sourceFlow;f.claims++;if(f.run.status!=='queued')return null;f.run.status='running';return structuredClone(f.run)}
      export async function readAutomationRun(){const f=globalThis.__sourceFlow;f.reads++;return structuredClone(f.run)}
      export async function updateAutomationRun(args){const f=globalThis.__sourceFlow;if(f.run.status!=='running')throw Error('stale_attempt');f.updates.push(args);f.run.result=args.result;f.run.phase=args.phase;f.run.status=args.status??'running';f.run.charged_microusd=args.costMicrousd??f.run.charged_microusd;return structuredClone(f.run)}
    `,
    '../lib/server/source-discovery': `export async function discoverSources(){const f=globalThis.__sourceFlow;f.discoveries++;f.run.result={discovery:{windowStart:'2026-09-29',windowEnd:'2026-10-02',articles:f.discoveryArticles??f.urls.map(url=>({url,title:'原文',publishedAt:'2026-09-30'}))},discoveryCostMicrousd:25000,discoveryCostSource:'provider'};if(f.discoveryFailure){Object.assign(f.run,f.discoveryFailure);throw Error(f.discoveryFailure.error_code)}return f.urls;}`,
    '../lib/server/import-service': `
      export async function executeImportAdmin(_owner,_method,body){
        const f=globalThis.__sourceFlow;f.imports.push(body);
        if(body.action==='create'){
          const id=body.request.id;
          if(id!=='batch-id'&&!f.run.result.sourceFallbacks?.some(row=>row.batchId===id))throw Error('fallback batch id not pinned');
          const urls=body.request.manifest.urlLines.split('\\n');
          const batch=f.batches[id]??{id,items:urls.map((url,i)=>({id:id==='batch-id'?(f.itemIds?.[i]??'item-'+i):f.fallbackItemIds[url],status:'pending',kind:'url',url}))};
          f.batches[id]=batch;
          if(f.importCreateErrors[urls[0]])throw Error('create outcome unconfirmed');
          return structuredClone(batch);
        }
        const batch=f.batches[body.batchId];
        if(!batch)throw Error('batch not found');
        return {id:batch.id,items:batch.items.map(item=>({...item,status:f.readbackStates[item.id]??'unknown',...f.importErrors[item.id]}))};
      }
      export async function runImportItem(_owner,_batch,id){const f=globalThis.__sourceFlow;f.importAttempts.push(id);if(f.thrownItems.includes(id))throw Error('unconfirmed');return {status:f.returnedStates[id]??(f.failedItems.includes(id)?'failed':'completed'),...f.importErrors[id]}}
    `,
    '../lib/server/signal-generation': `
      export async function executeGeneration(_owner,request){const f=globalThis.__sourceFlow;if(!f.run.result.generationIds.includes(request.id))throw Error('request id not pinned');f.generated.push(request);if(f.createErrors[request.id])throw Object.assign(Error('private creation rejection'),{code:f.createErrors[request.id],raw:'private-secret'});return {id:f.createdIds[request.id]??request.id,status:'pending'}}
      export async function queueGeneration(_owner,id){const f=globalThis.__sourceFlow;f.queued.push(id);if(f.switchToMockAfterQueue)process.env.HZENSE_LOCAL_AI_MODE='mock';if(f.queueErrors[id])throw Object.assign(Error('queue failed'),{code:f.queueErrors[id]});return f.queueReceipts[id]??{status:'pending',progress_phase:'queued',progress_at:new Date('2026-10-02T12:00:00.123Z')}}
      export async function failQueuedGeneration(owner,id,queuedAt){const f=globalThis.__sourceFlow;f.closedQueues.push([owner,id,queuedAt]);if(f.cleanupError)throw Error('cleanup unavailable')}
    `,
    './signal-generation': 'export async function signalGenerationWorkflow(){}',
    './local-signal-generation': 'export async function localSignalGenerationWorkflow(){}',
    './local-topic-insight':
      'export async function runLocalTopicInsightStep(){return "local_topic_completed"}',
    '../lib/server/insight-topics': 'export async function assertInsightLeafTopics(){}',
    '../lib/server/topic-insight-sandbox':
      'export async function startTopicInsightSandbox(){globalThis.__sourceFlow.topicCalls++} export async function pollTopicInsightSandbox(){globalThis.__sourceFlow.topicCalls++} export async function stopTopicInsightSandbox(){globalThis.__sourceFlow.topicCalls++}',
  };
  const fixture = await build({
    stdin: {
      contents: `${source}\nexport {findSources,createSourceBatch,createFallbackSourceBatch,importSourceItem,createPrivateGeneration,dispatchGeneration,startTopicWorker,pollTopicWorker,stopTopicWorker};`,
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
  const steps = await import(
    `data:text/javascript;base64,${Buffer.from(fixture.outputFiles[0].text).toString('base64')}`
  );
  const { automationWorkflow } = steps;
  const environmentKeys = [
    'HZENSE_LOCAL_DEVELOPMENT',
    'HZENSE_LOCAL_AI_MODE',
    'WORKFLOW_TARGET_WORLD',
    'HZENSE_AUTOMATION_ENABLED',
    'HZENSE_LOCAL_AUTOMATION_SCHEDULER_ENABLED',
    'HZENSE_EDITORIAL_PUBLICATION_ENABLED',
    'HZENSE_UNIFIED_SIGNAL_ENABLED',
    'HZENSE_AUTOMATIC_PUBLICATION_ENABLED',
  ];
  const savedEnvironment = Object.fromEntries(
    environmentKeys.map((key) => [key, process.env[key]]),
  );
  const setup = (urls) =>
    (globalThis.__sourceFlow = {
      urls,
      imports: [],
      batches: {},
      fallbackItemIds: {},
      importCreateErrors: {},
      generated: [],
      queued: [],
      dispatched: [],
      dispatchedArgs: [],
      dispatchedWorkflows: [],
      dispatchErrors: [],
      closedQueues: [],
      discoveries: 0,
      updates: [],
      failedItems: [],
      thrownItems: [],
      returnedStates: {},
      readbackStates: {},
      importErrors: {},
      importAttempts: [],
      queueReceipts: {},
      queueErrors: {},
      createErrors: {},
      createdIds: {},
      claims: 0,
      rejectedAutomaticClaims: 0,
      reads: 0,
      topicCalls: 0,
      localIsolationValid: true,
      run: {
        id: 'run',
        status: 'queued',
        trigger: 'manual',
        lease_token: 'token',
        phase: 'preparing',
        snapshot: { kind: 'source_collection', profileId: 'profile', profileRevision: 1 },
        result: null,
      },
    });
  try {
    delete process.env.HZENSE_LOCAL_DEVELOPMENT;
    let f = setup([]);
    assert.equal(await automationWorkflow('owner', 'run'), 'no_new_sources');
    assert.equal(f.imports.length, 0);
    assert.equal(f.generated.length, 0);
    assert.equal(f.run.charged_microusd, 25000);
    f = setup([]);
    f.discoveryFailure = {
      status: 'failed',
      phase: 'discovery_failed',
      error_code: 'discovery_all_sources_rejected',
      lease_token: null,
      charged_microusd: 7364,
      cost_source: 'provider',
      result: {
        discovery: {
          articles: [],
          rejected: 8,
          duplicates: 0,
          validation: {
            version: 1,
            returnedCount: 8,
            validCitationCount: 8,
            rejections: Array.from({ length: 8 }, (_, index) => ({
              index,
              reasons: ['uncited_url'],
            })),
            reasonCounts: { uncited_url: 8 },
          },
        },
        discoveryCostMicrousd: 7364,
        discoveryCostSource: 'provider',
      },
    };
    assert.equal(await automationWorkflow('owner', 'run'), 'failed');
    assert.equal(f.imports.length, 0);
    assert.equal(f.generated.length, 0);
    assert.equal(f.dispatched.length, 0);
    assert.equal(f.updates.length, 0, 'workflow must not overwrite the terminal discovery receipt');
    assert.equal(f.run.status, 'failed');
    assert.equal(f.run.phase, 'discovery_failed');
    assert.equal(f.run.error_code, 'discovery_all_sources_rejected');
    assert.equal(f.run.charged_microusd, 7364);
    assert.deepEqual(f.run.result, f.discoveryFailure.result);
    assert.equal(await automationWorkflow('owner', 'run'), 'already_started_or_finished');
    assert.equal(f.discoveries, 1);
    f = setup(['https://example.com/a', 'https://example.com/b']);
    f.failedItems = ['item-1'];
    await automationWorkflow('owner', 'run');
    assert.equal(f.imports[0].request.manifest.urlLines, f.urls.join('\n'));
    assert.deepEqual(f.dispatched, ['item-0']);
    assert.deepEqual(f.dispatchedArgs, [['owner', 'item-0', '2026-10-02T12:00:00.123Z']]);
    assert.deepEqual(f.dispatchedWorkflows, ['signalGenerationWorkflow']);
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
      assert.deepEqual(
        f.dispatched,
        ['item-0'],
        'the earlier confirmed queue is dispatched; the unknown item is never retried',
      );
      assert.deepEqual(f.dispatchedArgs, [['owner', 'item-0', '2026-10-02T12:00:00.123Z']]);
      assert.deepEqual(f.closedQueues, []);
      assert.equal(f.run.result.failed, 0, 'an unknown source is not a confirmed failure');
      assert.equal(f.run.charged_microusd, 25000);
      assert.equal(await automationWorkflow('owner', 'run'), 'already_started_or_finished');
      assert.deepEqual(f.dispatched, ['item-0']);
      assert.deepEqual(f.importAttempts, ['item-0', 'item-1']);
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
      assert.deepEqual(
        f.dispatched,
        ['item-0'],
        'only the acknowledged queue receipt is dispatched; the uncertain item ID stays pinned',
      );
      assert.deepEqual(f.dispatchedArgs, [['owner', 'item-0', '2026-10-02T12:00:00.123Z']]);
      assert.deepEqual(f.closedQueues, []);
      assert.equal(f.generated.filter((value) => value.id === 'item-1').length, 1);
      assert.equal(
        f.queued.filter((id) => id === 'item-1').length,
        errors === 'queueErrors' ? 1 : 0,
      );
      await automationWorkflow('owner', 'run');
      assert.equal(f.generated.filter((value) => value.id === 'item-1').length, 1);
      assert.deepEqual(f.dispatched, ['item-0'], 'replay cannot dispatch either item again');
      assert.deepEqual(f.run.result.generationIds, ['item-0', 'item-1']);
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
    for (const lostAck of [false, true]) {
      f = setup(['https://example.com/denied']);
      f.itemIds = [itemIds[0]];
      f.failedItems = [itemIds[0]];
      f.importErrors[itemIds[0]] = {
        error_code: 'fetch_failed',
        fetch_diagnostic: {
          reason: 'http_status',
          status: 403,
          body: 'private-body',
          url: 'private-url',
        },
      };
      if (lostAck) {
        f.thrownItems = [itemIds[0]];
        f.readbackStates[itemIds[0]] = 'failed';
      }
      await automationWorkflow('owner', 'run');
      assert.equal(f.run.status, 'failed');
      assert.equal(f.run.phase, 'source_failed');
      assert.deepEqual(f.run.result.sourceFailures, [
        {
          itemId: itemIds[0],
          phase: 'import_source',
          code: 'fetch_failed',
          fetchDiagnostic: { reason: 'http_status', status: 403 },
        },
      ]);
      assert.equal(f.run.charged_microusd, 25000);
      assert.equal(f.run.result.discoveryCostSource, 'provider');
      assert.equal(f.run.result.failed, 1);
      assert.deepEqual(f.generated, []);
      assert.deepEqual(f.queued, []);
      assert.deepEqual(f.dispatched, []);
      assert.equal(JSON.stringify(f.run.result).includes('private'), false);
      await automationWorkflow('owner', 'run');
      assert.equal(f.discoveries, 1, 'a failed source must not restart paid discovery');
      assert.deepEqual(f.importAttempts, [itemIds[0]], '403 is not blindly fetched again');
    }

    const primaryUrl = 'https://example.com/original-event';
    const fallbackUrls = [
      'https://second.example.com/same-event',
      'https://third.example.com/same-event',
    ];
    const fallbackFixture = () => {
      const fixture = setup([primaryUrl]);
      fixture.itemIds = [itemIds[0]];
      fixture.fallbackItemIds = Object.fromEntries(
        fallbackUrls.map((url, index) => [url, itemIds[index + 1]]),
      );
      fixture.discoveryArticles = [
        {
          url: primaryUrl,
          title: '事件原始报道',
          publishedAt: '2026-09-30',
          alternatives: fallbackUrls.map((url) => ({
            url,
            title: '同一事件的备用报道',
            publishedAt: '2026-09-30',
          })),
        },
      ];
      fixture.failedItems = [itemIds[0]];
      fixture.importErrors[itemIds[0]] = {
        error_code: 'fetch_failed',
        fetch_diagnostic: { reason: 'http_status', status: 403 },
      };
      return fixture;
    };
    const createdImports = (fixture) =>
      fixture.imports.filter((request) => request.action === 'create');

    // A confirmed inaccessible original can use already-discovered alternatives,
    // but must not repeat search, create two candidates or lose its original receipt.
    for (const lostAck of [false, true]) {
      f = fallbackFixture();
      if (lostAck) {
        f.thrownItems = [itemIds[0]];
        f.readbackStates[itemIds[0]] = 'failed';
      }
      await automationWorkflow('owner', 'run');
      assert.equal(f.run.status, 'completed');
      assert.equal(f.run.result.failed, 0, 'one recovered event is not counted as a failed event');
      assert.equal(f.run.result.batchId, 'batch-id', 'the original batch remains addressable');
      assert.deepEqual(f.importAttempts, itemIds.slice(0, 2));
      assert.equal(createdImports(f).length, 2, 'a successful first alternative stops fallback');
      const fallbackBatch = createdImports(f)[1].request.id;
      assert.deepEqual(createdImports(f)[1].request.manifest, {
        files: [],
        urlLines: fallbackUrls[0],
      });
      assert.equal(createdImports(f)[1].request.intent, 'preview');
      assert.deepEqual(f.run.result.sourceFallbacks, [
        {
          primaryItemId: itemIds[0],
          originalUrl: primaryUrl,
          batchId: fallbackBatch,
          url: fallbackUrls[0],
          itemId: itemIds[1],
        },
      ]);
      assert.deepEqual(f.run.result.sourceFailures, [
        {
          itemId: itemIds[0],
          phase: 'import_source',
          code: 'fetch_failed',
          fetchDiagnostic: { reason: 'http_status', status: 403 },
        },
      ]);
      assert.equal(f.generated.length, 1);
      assert.equal(f.generated[0].batchId, fallbackBatch);
      assert.equal(f.generated[0].itemId, itemIds[1]);
      assert.equal(f.generated[0].automaticPublicationConsent, false);
      assert.deepEqual(f.dispatched, [itemIds[1]]);
      assert.equal(f.run.result.queuedSources[0].url, fallbackUrls[0]);
      assert.equal(f.discoveries, 1);
      assert.equal(f.run.charged_microusd, 25000);
      assert.equal(f.run.result.discoveryCostSource, 'provider');
      assert.equal(await automationWorkflow('owner', 'run'), 'already_started_or_finished');
      assert.equal(f.discoveries, 1, 'replay cannot repeat the paid discovery');
      assert.equal(createdImports(f).length, 2, 'replay cannot create another fallback batch');
      assert.deepEqual(f.importAttempts, itemIds.slice(0, 2));
      assert.deepEqual(f.dispatched, [itemIds[1]], 'replay cannot dispatch the candidate twice');
    }

    f = fallbackFixture();
    f.failedItems = [];
    await automationWorkflow('owner', 'run');
    assert.equal(createdImports(f).length, 1, 'an accessible original needs no fallback batch');
    assert.deepEqual(f.importAttempts, [itemIds[0]]);
    assert.deepEqual(f.dispatched, [itemIds[0]]);
    assert.equal(f.run.result.sourceFallbacks?.length ?? 0, 0);

    for (const secondAlternativeSucceeds of [false, true]) {
      f = fallbackFixture();
      f.failedItems = secondAlternativeSucceeds ? itemIds.slice(0, 2) : itemIds;
      for (const itemId of itemIds.slice(1))
        f.importErrors[itemId] = {
          error_code: 'fetch_failed',
          fetch_diagnostic: { reason: 'http_status', status: 503 },
        };
      await automationWorkflow('owner', 'run');
      assert.deepEqual(f.importAttempts, itemIds, 'each confirmed unavailable URL is tried once');
      assert.equal(createdImports(f).length, 3);
      assert.equal(new Set(createdImports(f).map((body) => body.request.id)).size, 3);
      assert.equal(f.run.result.failed, secondAlternativeSucceeds ? 0 : 1);
      assert.equal(f.run.status, secondAlternativeSucceeds ? 'completed' : 'failed');
      assert.equal(f.run.result.batchId, 'batch-id');
      assert.equal(f.run.result.sourceFallbacks.length, 2);
      assert.equal(f.run.result.sourceFailures.length, secondAlternativeSucceeds ? 2 : 3);
      assert.deepEqual(f.dispatched, secondAlternativeSucceeds ? [itemIds[2]] : []);
      assert.equal(f.generated.length, secondAlternativeSucceeds ? 1 : 0);
      if (secondAlternativeSucceeds) {
        assert.equal(f.generated[0].batchId, createdImports(f)[2].request.id);
        assert.equal(f.run.result.queuedSources[0].url, fallbackUrls[1]);
      }
      assert.equal(f.discoveries, 1);
      assert.equal(f.run.charged_microusd, 25000);
    }

    for (const error of [
      { error_code: 'parse_failed' },
      { error_code: 'unsupported_content' },
      { error_code: 'fetch_failed', fetch_diagnostic: { reason: 'http_status', status: 400 } },
      { error_code: 'fetch_failed' },
    ]) {
      f = fallbackFixture();
      f.importErrors[itemIds[0]] = error;
      await automationWorkflow('owner', 'run');
      assert.equal(f.run.status, 'failed');
      assert.equal(
        createdImports(f).length,
        1,
        'non-fetch or unclassified failure is not fallback consent',
      );
      assert.deepEqual(f.importAttempts, [itemIds[0]]);
      assert.deepEqual(f.generated, []);
    }
    for (const status of ['cancelled', 'unknown']) {
      f = fallbackFixture();
      f.returnedStates[itemIds[0]] = status;
      await automationWorkflow('owner', 'run');
      assert.equal(f.run.status, status === 'unknown' ? 'unknown' : 'failed');
      assert.equal(createdImports(f).length, 1);
      assert.deepEqual(f.importAttempts, [itemIds[0]]);
      assert.deepEqual(f.dispatched, []);
    }
    f = fallbackFixture();
    f.returnedStates[itemIds[1]] = 'unknown';
    await automationWorkflow('owner', 'run');
    assert.equal(f.run.status, 'unknown');
    assert.equal(
      createdImports(f).length,
      2,
      'an ambiguous alternative cannot advance to the next one',
    );
    assert.deepEqual(f.importAttempts, itemIds.slice(0, 2));
    assert.equal(f.run.result.sourceFallbacks[0].itemId, itemIds[1]);
    assert.deepEqual(f.generated, []);
    assert.equal(f.run.charged_microusd, 25000);

    for (const status of ['failed', 'cancelled']) {
      f = fallbackFixture();
      f.returnedStates[itemIds[1]] = status;
      f.importErrors[itemIds[1]] = { error_code: 'parse_failed' };
      await automationWorkflow('owner', 'run');
      assert.equal(f.run.status, 'failed');
      assert.equal(f.run.result.failed, 1);
      assert.equal(
        createdImports(f).length,
        2,
        'parse failure or cancellation cannot select another source',
      );
      assert.deepEqual(f.importAttempts, itemIds.slice(0, 2));
      assert.deepEqual(f.generated, []);
    }

    f = fallbackFixture();
    f.importCreateErrors[fallbackUrls[0]] = true;
    await automationWorkflow('owner', 'run');
    assert.equal(f.run.status, 'unknown');
    assert.equal(createdImports(f).length, 2);
    assert.deepEqual(f.importAttempts, [itemIds[0]]);
    assert.equal(f.run.result.sourceFallbacks[0].batchId, createdImports(f)[1].request.id);
    assert.equal(f.run.result.sourceFallbacks[0].itemId, undefined);
    assert.deepEqual(f.generated, []);
    assert.equal(await automationWorkflow('owner', 'run'), 'already_started_or_finished');
    assert.equal(
      createdImports(f).length,
      2,
      'unconfirmed create stays pinned instead of being recreated',
    );

    // Recovery of the source does not grant another generation budget, permit
    // another model call or silently expand publication authorization.
    f = fallbackFixture();
    f.createErrors[itemIds[1]] = 'budget_exceeded';
    await automationWorkflow('owner', 'run');
    assert.equal(f.run.status, 'failed');
    assert.equal(f.run.result.failed, 1);
    assert.equal(f.run.result.sourceFailures.at(-1).code, 'budget_exceeded');
    assert.equal(f.generated.length, 1);
    assert.equal(
      createdImports(f).length,
      2,
      'candidate refusal cannot select another source to retry',
    );
    assert.deepEqual(f.queued, []);
    assert.deepEqual(f.dispatched, []);
    assert.equal(f.run.charged_microusd, 25000);
    f = fallbackFixture();
    f.dispatchErrors = [itemIds[1]];
    await automationWorkflow('owner', 'run');
    assert.equal(
      createdImports(f).length,
      2,
      'dispatch failure cannot retry generation on an alternative',
    );
    assert.deepEqual(f.dispatched, [itemIds[1]]);
    assert.deepEqual(f.closedQueues, [['owner', itemIds[1], '2026-10-02T12:00:00.123Z']]);

    const publicationEnvironment = [
      'HZENSE_EDITORIAL_PUBLICATION_ENABLED',
      'HZENSE_UNIFIED_SIGNAL_ENABLED',
      'HZENSE_AUTOMATIC_PUBLICATION_ENABLED',
    ];
    const priorPublicationEnvironment = Object.fromEntries(
      publicationEnvironment.map((key) => [key, process.env[key]]),
    );
    for (const key of publicationEnvironment) process.env[key] = '1';
    for (const publicationMode of [undefined, 'manual', 'automatic']) {
      f = fallbackFixture();
      f.run.snapshot.publicationMode = publicationMode;
      await automationWorkflow('owner', 'run');
      assert.equal(f.generated.length, 1);
      assert.equal(f.generated[0].automaticPublicationConsent, publicationMode === 'automatic');
      assert.equal(f.generated[0].itemId, itemIds[1]);
    }
    process.env.HZENSE_AUTOMATIC_PUBLICATION_ENABLED = '0';
    f = fallbackFixture();
    f.run.snapshot.publicationMode = 'automatic';
    await assert.rejects(automationWorkflow('owner', 'run'), /automatic_publication_unavailable/);
    assert.equal(f.claims, 0);
    assert.equal(f.rejectedAutomaticClaims, 1);
    assert.equal(f.discoveries, 0);
    assert.deepEqual(f.imports, []);
    for (const [key, value] of Object.entries(priorPublicationEnvironment)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }

    f = setup(['https://example.com/denied', 'https://example.com/allowed']);
    f.itemIds = itemIds.slice(0, 2);
    f.failedItems = [itemIds[0]];
    f.importErrors[itemIds[0]] = {
      error_code: 'fetch_failed',
      fetch_diagnostic: { reason: 'http_status', status: 403 },
    };
    await automationWorkflow('owner', 'run');
    assert.equal(f.run.status, 'completed');
    assert.equal(f.run.result.failed, 1);
    assert.equal(f.run.result.sourceFailures[0].fetchDiagnostic.status, 403);
    assert.deepEqual(
      f.dispatched,
      [itemIds[1]],
      'an inaccessible source must not block usable sources',
    );

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

    const localReal = () =>
      Object.assign(process.env, {
        HZENSE_LOCAL_DEVELOPMENT: '1',
        HZENSE_LOCAL_AI_MODE: 'real',
        WORKFLOW_TARGET_WORLD: 'local',
        HZENSE_AUTOMATION_ENABLED: '1',
        HZENSE_LOCAL_AUTOMATION_SCHEDULER_ENABLED: '0',
      });
    localReal();
    f = setup(['https://example.com/local']);
    assert.equal(await automationWorkflow('owner', 'run'), 'completed');
    assert.equal(f.claims, 1);
    assert.equal(f.topicCalls, 0);
    assert.deepEqual(f.dispatchedWorkflows, ['localSignalGenerationWorkflow']);
    assert.deepEqual(f.dispatchedArgs, [['owner', 'item-0', '2026-10-02T12:00:00.123Z']]);
    assert.equal(f.run.charged_microusd, 25000);

    localReal();
    process.env.HZENSE_LOCAL_AUTOMATION_SCHEDULER_ENABLED = '1';
    f = setup(['https://example.com/local-scheduled']);
    f.run.trigger = 'scheduled';
    assert.equal(await automationWorkflow('owner', 'run'), 'completed');
    assert.equal(f.claims, 1);
    assert.equal(f.topicCalls, 0);
    assert.deepEqual(f.dispatchedWorkflows, ['localSignalGenerationWorkflow']);
    assert.deepEqual(f.dispatchedArgs, [['owner', 'item-0', '2026-10-02T12:00:00.123Z']]);

    for (const overrides of [
      { HZENSE_LOCAL_AI_MODE: 'mock' },
      { HZENSE_LOCAL_AI_MODE: 'unknown' },
      { WORKFLOW_TARGET_WORLD: 'vercel' },
      { HZENSE_AUTOMATION_ENABLED: '0' },
    ]) {
      localReal();
      Object.assign(process.env, overrides);
      f = setup(['https://example.com/blocked']);
      await assert.rejects(automationWorkflow('owner', 'run'), /execution_disabled/);
      assert.equal(f.reads, 0);
      assert.equal(f.claims, 0);
      assert.equal(f.run.status, 'queued');
      assert.equal(f.discoveries, 0);
      assert.deepEqual(f.importAttempts, []);
      assert.deepEqual(f.generated, []);
      assert.deepEqual(f.dispatched, []);
      assert.equal(f.topicCalls, 0);
    }
    localReal();
    f = setup(['https://example.com/blocked']);
    f.localIsolationValid = false;
    await assert.rejects(automationWorkflow('owner', 'run'), /execution_disabled/);
    assert.equal(f.claims, 0);
    assert.equal(f.reads, 0);

    localReal();
    f = setup([]);
    f.run.snapshot.kind = 'topic_insight';
    assert.equal(await automationWorkflow('owner', 'run'), 'local_topic_completed');
    assert.equal(f.reads, 1);
    assert.equal(f.claims, 1, 'local topic execution uses its dedicated local step');
    assert.equal(f.topicCalls, 0);
    for (const step of ['startTopicWorker', 'pollTopicWorker', 'stopTopicWorker'])
      await assert.rejects(steps[step]('owner', 'run'), /execution_disabled/);
    assert.equal(f.topicCalls, 0, 'resuming a cached topic claim must not access Sandbox');

    for (const trigger of ['scheduled', undefined]) {
      localReal();
      f = setup(['https://example.com/scheduled']);
      f.run.trigger = trigger;
      await assert.rejects(automationWorkflow('owner', 'run'), /execution_disabled/);
      assert.equal(f.reads, 1);
      assert.equal(f.claims, 0, 'local non-manual tasks must not reserve budget');
      assert.equal(f.discoveries, 0);
      assert.deepEqual(f.imports, []);
      assert.deepEqual(f.generated, []);
      assert.deepEqual(f.dispatched, []);

      // Cached claims are not admission: persisted scheduled runs must still
      // fail before search, import creation or candidate creation on recovery.
      for (const step of [
        'findSources',
        'createSourceBatch',
        'createFallbackSourceBatch',
        'createPrivateGeneration',
      ]) {
        f = setup(['https://example.com/scheduled']);
        f.run.trigger = trigger;
        f.run.status = 'running';
        await assert.rejects(steps[step]('owner', 'run', 'batch', 'item'), /execution_disabled/);
        assert.equal(f.reads, 1);
        assert.equal(f.discoveries, 0);
        assert.deepEqual(f.imports, []);
        assert.deepEqual(f.generated, []);
        assert.deepEqual(f.updates, []);
      }
    }
    localReal();
    f = setup([]);
    f.run.status = 'running';
    f.run.snapshot.kind = 'topic_insight';
    await assert.rejects(steps.findSources('owner', 'run'), /execution_disabled/);
    assert.equal(f.discoveries, 0, 'a resumed source step must verify the persisted task kind');

    // A resumed workflow can bypass completed steps, so every external action
    // must still refuse a mode switch after the claim was persisted.
    localReal();
    process.env.HZENSE_LOCAL_AI_MODE = 'mock';
    f = setup(['https://example.com/blocked']);
    f.run.status = 'running';
    for (const step of [
      'findSources',
      'createSourceBatch',
      'createFallbackSourceBatch',
      'importSourceItem',
      'createPrivateGeneration',
    ])
      await assert.rejects(steps[step]('owner', 'run', 'item'), /execution_disabled/);
    assert.equal(f.reads, 0);
    assert.equal(f.discoveries, 0);
    assert.deepEqual(f.imports, []);
    assert.deepEqual(f.importAttempts, []);
    assert.deepEqual(f.generated, []);
    assert.equal(
      await steps.dispatchGeneration('owner', 'run', {
        id: 'item',
        queuedAt: '2026-10-02T12:00:00.123Z',
      }),
      false,
    );
    assert.deepEqual(f.dispatched, []);
    assert.deepEqual(f.closedQueues, [['owner', 'item', '2026-10-02T12:00:00.123Z']]);

    localReal();
    f = setup(['https://example.com/local']);
    f.dispatchErrors = ['item-0'];
    await automationWorkflow('owner', 'run');
    assert.deepEqual(f.dispatchedWorkflows, ['localSignalGenerationWorkflow']);
    assert.deepEqual(f.closedQueues, [['owner', 'item-0', '2026-10-02T12:00:00.123Z']]);
    assert.equal(await automationWorkflow('owner', 'run'), 'already_started_or_finished');
    assert.equal(f.dispatched.length, 1, 'local dispatch ambiguity must not retry start');

    localReal();
    f = setup(['https://example.com/local']);
    f.switchToMockAfterQueue = true;
    await automationWorkflow('owner', 'run');
    assert.deepEqual(
      f.dispatched,
      [],
      'a mode switch before dispatch must not reach either worker',
    );
    assert.deepEqual(f.closedQueues, [['owner', 'item-0', '2026-10-02T12:00:00.123Z']]);

    localReal();
    f = setup(['https://example.com/local']);
    f.queueReceipts['item-0'] = { status: 'pending', progress_phase: 'queued', progress_at: null };
    await automationWorkflow('owner', 'run');
    assert.deepEqual(f.dispatched, [], 'local generation needs the same exact queue receipt');
    assert.equal(f.run.status, 'unknown');

    delete process.env.HZENSE_LOCAL_DEVELOPMENT;
    f = setup(['https://example.com/production-scheduled']);
    f.run.trigger = 'scheduled';
    assert.equal(await automationWorkflow('owner', 'run'), 'completed');
    assert.deepEqual(f.dispatchedWorkflows, ['signalGenerationWorkflow']);
    assert.equal(f.claims, 1, 'production scheduled execution is unchanged');
  } finally {
    for (const [key, value] of Object.entries(savedEnvironment)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    delete globalThis.__sourceFlow;
  }
});
