import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { URL } from 'node:url';
import { Buffer } from 'node:buffer';
import { build } from 'esbuild';

test('source discovery orchestrates originals and private candidates without dropping search costs', async () => {
  const source = await readFile(new URL('../workflows/automation.ts', import.meta.url), 'utf8');
  assert.match(source, /findSources\.maxRetries = 0/);
  const mocks = {
    workflow: 'export async function sleep(){}',
    'workflow/api':
      'export async function start(_workflow,args){const f=globalThis.__sourceFlow;f.dispatched.push(args[1]);if(f.dispatchError)throw Error("unknown");}',
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
      export async function executeImportAdmin(_owner,_method,body){const f=globalThis.__sourceFlow;f.imports.push(body);return {id:'batch-id',items:f.urls.map((_url,i)=>({id:'item-'+i,status:'pending',kind:'url'}))}}
      export async function runImportItem(_owner,_batch,id){return {status:globalThis.__sourceFlow.failedItems.includes(id)?'failed':'completed'}}
    `,
    '../lib/server/signal-generation': `export async function executeGeneration(_owner,request){globalThis.__sourceFlow.generated.push(request)} export async function queueGeneration(){return {status:'pending'}}`,
    './signal-generation': 'export async function signalGenerationWorkflow(){}',
    '../lib/server/topic-insight-sandbox':
      'export async function startTopicInsightSandbox(){} export async function pollTopicInsightSandbox(){} export async function stopTopicInsightSandbox(){}',
  };
  const fixture = await build({
    stdin: { contents: source, loader: 'ts' },
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
      dispatched: [],
      discoveries: 0,
      updates: [],
      failedItems: [],
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
    assert.equal(f.run.result.failed, 1);
    assert.equal(f.run.result.discovery.articles.length, 2);
    assert.equal(f.run.charged_microusd, 25000);
    assert.equal(f.run.result.queuedSources[0].url, f.urls[0]);
    assert.equal(f.generated[0].action, 'create');
    assert.equal(await automationWorkflow('owner', 'run'), 'already_started_or_finished');
    assert.equal(f.discoveries, 1);
    f = setup(['https://example.com/a']);
    f.dispatchError = true;
    await automationWorkflow('owner', 'run');
    assert.equal(f.run.status, 'unknown');
    assert.equal(f.run.result.batchId, 'batch-id');
    assert.deepEqual(f.run.result.generationIds, ['item-0']);
    assert.equal(f.run.charged_microusd, 25000);
    f = setup(['https://example.com/a']);
    f.failedItems = ['item-0'];
    await automationWorkflow('owner', 'run');
    assert.equal(f.run.status, 'failed');
    assert.equal(f.generated.length, 0);
  } finally {
    delete globalThis.__sourceFlow;
  }
});
