import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { readFile } from 'node:fs/promises';
import { fileURLToPath, URL } from 'node:url';
import { Buffer } from 'node:buffer';

// Compose the real automation workflow, child workflow and Sandbox admission.
// Only storage, scheduler transport and infrastructure are synthetic: replacing
// Sandbox admission with a successful start() mock hid the missing queue fence.
test('automation queue receipts reach real child workflow and Sandbox admission unchanged', async () => {
  const files = {
    automation: '../workflows/automation.ts',
    generation: '../workflows/signal-generation.ts',
    sandbox: '../lib/server/generation-sandbox.ts',
  };
  const sources = Object.fromEntries(
    await Promise.all(
      Object.entries(files).map(async ([key, path]) => [
        key,
        await readFile(new URL(path, import.meta.url), 'utf8'),
      ]),
    ),
  );
  const fixtures = {
    workflow: 'export async function sleep(){}',
    api: `export async function start(workflow,args){
      const f=globalThis.__automationTicket;
      f.dispatches.push(args);
      if(f.stale)f.generations[args[1]].progress_at=new Date('2026-10-02T12:00:00.124Z');
      f.childResults.push(await workflow(...args));
    }`,
    limits:
      'export function automationLimits(){return {batch:1000000,daily:5000000,reserve:500000}}',
    pool: 'export const automationPool={};',
    ids: 'export function automationStableId(value){return value.itemId??"batch-id"}',
    store: `
      export async function claimAutomationRun(){const f=globalThis.__automationTicket;if(f.run.status!=='queued')return null;f.run.status='running';return structuredClone(f.run)}
      export async function readAutomationRun(){return structuredClone(globalThis.__automationTicket.run)}
      export async function updateAutomationRun(args){const f=globalThis.__automationTicket;f.run={...f.run,result:args.result,phase:args.phase,status:args.status??'running'};return structuredClone(f.run)}
    `,
    discovery: `export async function discoverSources(){return ['https://example.com/original']}`,
    imports: `
      export async function executeImportAdmin(){return {id:'batch-id',items:[{id:'item-id',status:'completed',kind:'url'}]}}
      export async function runImportItem(){throw Error('completed originals must not be reimported')}
    `,
    generationStore: `
      export function generationConfigured(){return true}
      export async function executeGeneration(_owner,request){const row={id:request.id,status:'pending',progress_phase:'created'};globalThis.__automationTicket.generations[request.id]=row;return structuredClone(row)}
      export async function queueGeneration(_owner,id){const f=globalThis.__automationTicket;f.queueCalls++;const row=f.generations[id];row.progress_phase='queued';row.progress_at=new Date('2026-10-02T12:00:00.123Z');return structuredClone(row)}
      export async function generationDetail(_owner,id){return structuredClone(globalThis.__automationTicket.generations[id])}
      export async function failQueuedGeneration(_owner,id,queuedAt){const f=globalThis.__automationTicket;f.finalChecks.push({id,queuedAt})}
    `,
    enrichment:
      'export function candidateEnrichmentConfigured(){return false} export async function candidateEnrichmentDetail(){throw Error("unused")}',
    topic:
      'export async function startTopicInsightSandbox(){} export async function pollTopicInsightSandbox(){} export async function stopTopicInsightSandbox(){}',
    generationConfig:
      'export function readGenerationConfiguration(){return {connectionString:"postgresql://db.example.com/test"}}',
    aiConfig:
      'export function readAiBackendConfiguration(){return {connectionString:"postgresql://db.example.com/test",allowedHosts:["provider.example.com"]}}',
    importConfig:
      'export function generationImportConfiguration(){return {connectionString:"postgresql://db.example.com/test"}}',
    fs: 'export async function readFile(){return Buffer.from("synthetic worker bytes, never executed")}',
    infrastructure: `
      const sandbox={name:'synthetic',async writeFiles(files){globalThis.__automationTicket.files=files},
        async runCommand(){globalThis.__automationTicket.commands++;return {cmdId:'command'}},
        async getCommand(){return {exitCode:0}},async stop(){}};
      export const Sandbox={async create(){globalThis.__automationTicket.allocations++;return sandbox},async get(){return sandbox}};
    `,
    empty: '',
  };
  const mappings = {
    workflow: 'workflow',
    'workflow/api': 'api',
    '../lib/server/automation': 'limits',
    '../lib/server/automation-store-access': 'pool',
    '../../../packages/database/src/automation-contract.mjs': 'ids',
    '../../../packages/database/src/automation-store.mjs': 'store',
    '../lib/server/source-discovery': 'discovery',
    '../lib/server/import-service': 'imports',
    '../lib/server/signal-generation': 'generationStore',
    '../lib/server/topic-insight-sandbox': 'topic',
    './candidate-enrichment': 'enrichment',
    '../signal-generation-config': 'generationConfig',
    '../admin-ai-core': 'aiConfig',
    './generation-import-reader': 'importConfig',
    'node:fs/promises': 'fs',
    '@vercel/sandbox': 'infrastructure',
    'server-only': 'empty',
  };
  const bundled = await build({
    stdin: {
      contents: sources.automation,
      loader: 'ts',
      resolveDir: fileURLToPath(new URL('../workflows', import.meta.url)),
    },
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'node',
    plugins: [
      {
        name: 'real-automation-generation-admission',
        setup(builder) {
          builder.onResolve({ filter: /.*/ }, (args) => {
            if (args.path === './signal-generation')
              return args.importer === 'sandbox'
                ? { path: 'generationStore', namespace: 'fixture' }
                : { path: 'generation', namespace: 'real' };
            if (args.path === '../lib/server/generation-sandbox')
              return { path: 'sandbox', namespace: 'real' };
            const path = mappings[args.path];
            return path === undefined ? undefined : { path, namespace: 'fixture' };
          });
          builder.onLoad({ filter: /.*/, namespace: 'fixture' }, ({ path }) => ({
            contents: fixtures[path],
          }));
          builder.onLoad({ filter: /.*/, namespace: 'real' }, ({ path }) => ({
            contents: sources[path],
            loader: 'ts',
          }));
        },
      },
    ],
  });
  const { automationWorkflow } = await import(
    `data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`
  );
  const setup = (stale = false) =>
    (globalThis.__automationTicket = {
      stale,
      allocations: 0,
      commands: 0,
      queueCalls: 0,
      dispatches: [],
      childResults: [],
      finalChecks: [],
      files: [],
      generations: {},
      run: {
        id: 'automation-run',
        status: 'queued',
        lease_token: 'lease-token',
        snapshot: { kind: 'source_collection', profileId: 'profile', profileRevision: 1 },
        result: {},
      },
    });
  try {
    const f = setup();
    await automationWorkflow('owner', f.run.id);
    assert.equal(f.allocations, 1, 'a valid queue receipt passes the real Sandbox admission');
    assert.equal(f.commands, 1);
    assert.equal(f.queueCalls, 1);
    assert.deepEqual(f.dispatches, [['owner', 'item-id', '2026-10-02T12:00:00.123Z']]);
    assert.deepEqual(f.childResults, ['finished']);
    const task = JSON.parse(f.files.find((file) => file.path.endsWith('/task.json')).content);
    assert.equal(task.id, 'item-id');
    assert.equal(task.queuedAt, f.dispatches[0][2]);
    assert.equal(f.run.result.queuedSources[0].queuedAt, task.queuedAt);
    assert.deepEqual(f.run.result.generationIds, ['item-id']);
    assert.deepEqual(f.finalChecks, [{ id: 'item-id', queuedAt: task.queuedAt }]);
    await automationWorkflow('owner', f.run.id);
    assert.equal(f.allocations, 1, 'replayed parent does not create another worker');
    assert.equal(f.queueCalls, 1);

    const stale = setup(true);
    await automationWorkflow('owner', stale.run.id);
    assert.equal(stale.allocations, 0, 'a superseded timestamp still fails real admission');
    assert.equal(stale.commands, 0);
    assert.equal(stale.queueCalls, 1, 'stale dispatch is not requeued automatically');
    assert.deepEqual(stale.childResults, ['already_started_or_finished']);
  } finally {
    delete globalThis.__automationTicket;
  }
});
