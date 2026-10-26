import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import process from 'node:process';
import test from 'node:test';
import { fileURLToPath, URL } from 'node:url';
import { build } from 'esbuild';
import { localDatabaseEnvironmentRoles } from '../lib/local-development.ts';

const owner = 'synthetic-admin';
const runId = '11111111-1111-4111-8111-111111111111';
const itemId = '22222222-2222-4222-8222-222222222222';
const queuedAt = '2026-10-21T10:00:00.000Z';
const key = '__automationPublicationPolicy';
const production = () => ({
  HZENSE_AUTOMATIC_PUBLICATION_ENABLED: '1',
  HZENSE_EDITORIAL_PUBLICATION_ENABLED: '1',
  HZENSE_UNIFIED_SIGNAL_ENABLED: '1',
});
const local = () => ({
  ...production(),
  HZENSE_AUTOMATIC_PUBLICATION_ENABLED: '0',
  NODE_ENV: 'development',
  HZENSE_LOCAL_DEVELOPMENT: '1',
  HZENSE_LOCAL_AI_MODE: 'real',
  HZENSE_AUTOMATION_ENABLED: '1',
  WORKFLOW_TARGET_WORLD: 'local',
  PORT: '3000',
  NEXTAUTH_URL: 'http://127.0.0.1:3000',
  HZENSE_RUNTIME_EXPECTED_HOST: '127.0.0.1',
  HZENSE_RUNTIME_EXPECTED_PORT: '55432',
  HZENSE_RUNTIME_EXPECTED_NAME: 'hzense_local',
  HZENSE_RUNTIME_EXPECTED_USER: 'hzense_runtime',
  ...Object.fromEntries(
    Object.entries(localDatabaseEnvironmentRoles).map(([name, role]) => [
      name,
      `postgresql://${role}:${'a'.repeat(64)}@127.0.0.1:55432/hzense_local`,
    ]),
  ),
});

async function compile() {
  const url = new URL('../workflows/automation.ts', import.meta.url);
  const modules = {
    workflow: 'export async function sleep(){throw Error("unexpected sleep")}',
    'workflow/api': `export async function start(worker,args){globalThis.${key}.starts.push({worker:worker.name,args})}`,
    '../lib/server/automation':
      'export const automationLimits=()=>({batch:1000000,daily:2000000,reserve:100000});',
    '../lib/server/automation-store-access': 'export const automationPool={};',
    '../../../packages/database/src/automation-store.mjs': `
      export class AutomationError extends Error {constructor(code){super(code);this.code=code}}
      export async function readAutomationRun({owner,id}){
        const f=globalThis.${key}; if(owner!==f.owner||id!==f.run.id)throw Error('wrong_run');
        f.reads++;return structuredClone(f.run);
      }
      export async function claimAutomationRun(){const f=globalThis.${key};f.claims++;return structuredClone(f.run)}
      export async function rejectAutomaticPublicationBeforeClaim(){const f=globalThis.${key};f.refusals++;
        if(f.claimConcurrently)f.run.status='running';
        if(f.run.status!=='queued')return false;
        f.run.status='failed';f.run.error_code='automatic_publication_unavailable';f.run.charged_microusd=0;return true;
      }
      export async function updateAutomationRun(args){const f=globalThis.${key};f.updates.push(args);f.run.result=args.result;return structuredClone(f.run)}
    `,
    '../lib/server/import-service': `export async function executeImportAdmin(){throw Error('Unexpected import')}
      export async function runImportItem(){throw Error('Unexpected import')}`,
    '../lib/server/signal-generation': `
      export async function executeGeneration(owner,body,queuedAt,collectionRun){const f=globalThis.${key};f.creates.push({owner,body,queuedAt,collectionRun});return {id:body.id}}
      export async function queueGeneration(owner,id){globalThis.${key}.queues.push({owner,id});return {id,status:'pending',progress_phase:'queued',progress_at:${JSON.stringify(queuedAt)}}}
      export async function failQueuedGeneration(owner,id,at){globalThis.${key}.cleanups.push({owner,id,at})}
    `,
    './signal-generation':
      'export async function signalGenerationWorkflow(){throw Error("Worker must not execute")}',
    './local-signal-generation':
      'export async function localSignalGenerationWorkflow(){throw Error("Worker must not execute")}',
    '../lib/server/source-discovery': `export async function discoverSources(){globalThis.${key}.discoveries++;return []}`,
    '../lib/server/topic-insight-sandbox': `export async function startTopicInsightSandbox(){throw Error('Unexpected sandbox')}
      export async function pollTopicInsightSandbox(){} export async function stopTopicInsightSandbox(){}`,
  };
  const output = await build({
    stdin: {
      contents: `${await readFile(url, 'utf8')}\nexport { claim, findSources, createPrivateGeneration, dispatchGeneration };`,
      loader: 'ts',
      resolveDir: fileURLToPath(new URL('.', url)),
    },
    bundle: true,
    write: false,
    format: 'cjs',
    platform: 'node',
    packages: 'external',
    plugins: [
      {
        name: 'synthetic-collection-publication',
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
  const module = { exports: {} };
  new Function('require', 'module', 'exports', output.outputFiles[0].text)(
    createRequire(import.meta.url),
    module,
    module.exports,
  );
  return module.exports;
}
const compiled = compile();
async function setup(t, publicationMode, env = production()) {
  const previous = process.env;
  process.env = env;
  const state = (globalThis[key] = {
    owner,
    reads: 0,
    claims: 0,
    refusals: 0,
    discoveries: 0,
    starts: [],
    updates: [],
    creates: [],
    queues: [],
    cleanups: [],
    currentConfig: { publicationMode: 'manual' },
    run: {
      id: runId,
      status: 'running',
      trigger: 'manual',
      lease_token: 'synthetic',
      result: {},
      snapshot: {
        kind: 'source_collection',
        profileId: '33333333-3333-4333-8333-333333333333',
        profileRevision: 1,
        ...(publicationMode === undefined ? {} : { publicationMode }),
      },
    },
  });
  t.after(() => {
    process.env = previous;
    delete globalThis[key];
  });
  return { state, ...(await compiled) };
}

for (const mode of [undefined, 'manual']) {
  test(`historic/manual snapshot (${mode}) never inherits a global or newly saved automatic policy`, async (t) => {
    const { state, createPrivateGeneration } = await setup(t, mode);
    state.currentConfig.publicationMode = 'automatic';
    await createPrivateGeneration(owner, runId, 'batch', itemId);
    assert.equal(state.creates.length, 1);
    assert.equal(state.creates[0].body.automaticPublicationConsent, false);
    assert.equal(state.creates[0].body.profileRevision, 1);
    assert.equal(state.queues.length, 1);
  });
}
test('manual snapshot still creates private candidates when production automatic capability is off', async (t) => {
  const { state, createPrivateGeneration } = await setup(t, 'manual', {
    ...production(),
    HZENSE_AUTOMATIC_PUBLICATION_ENABLED: '0',
  });
  await createPrivateGeneration(owner, runId, 'batch', itemId);
  assert.equal(state.creates[0].body.automaticPublicationConsent, false);
  assert.equal(state.creates[0].collectionRun, undefined);
});
test('automatic discovery passes its saved run only through the internal admission argument', async (t) => {
  const { state, createPrivateGeneration } = await setup(t, 'automatic');
  state.run.owner_id = owner;
  state.run.created_at = '2026-10-26T00:00:37.200Z';
  state.run.snapshot.discovery = { lookbackDays: 2, maxSources: 8, keywords: [] };
  state.run.result.discovery = {
    windowStart: '2026-10-24T00:00:37.200Z',
    windowEnd: state.run.created_at,
    articles: [],
  };
  await createPrivateGeneration(owner, runId, 'batch', itemId);
  assert.equal(state.creates[0].collectionRun.id, runId);
  assert.deepEqual(state.creates[0].collectionRun.snapshot.discovery, state.run.snapshot.discovery);
  assert.equal(state.creates[0].queuedAt, undefined);
  assert.equal(Object.hasOwn(state.creates[0].body, 'collection'), false);
  assert.equal(Object.hasOwn(state.creates[0].body, 'collectionRun'), false);
});
for (const [name, env] of [
  ['production', production()],
  ['isolated local without CLI opt-in', local()],
]) {
  test(`automatic snapshot (${name}) retains consent after current configuration changes`, async (t) => {
    const { state, createPrivateGeneration, dispatchGeneration } = await setup(t, 'automatic', env);
    state.currentConfig.publicationMode = 'manual';
    const generation = await createPrivateGeneration(owner, runId, 'batch', itemId);
    assert.equal(state.creates[0].body.automaticPublicationConsent, true);
    await dispatchGeneration(owner, runId, generation);
    assert.deepEqual(state.starts[0].args, [owner, generation.id, queuedAt]);
    assert.equal(
      state.starts[0].worker,
      name === 'production' ? 'signalGenerationWorkflow' : 'localSignalGenerationWorkflow',
    );
  });
}
test('unavailable automatic mode blocks before budget claim, paid discovery and candidate creation', async (t) => {
  const { state, claim, findSources, createPrivateGeneration } = await setup(t, 'automatic', {
    ...production(),
    HZENSE_AUTOMATIC_PUBLICATION_ENABLED: '0',
  });
  state.run.status = 'queued';
  for (const execute of [
    () => claim(owner, runId),
    () => findSources(owner, runId),
    () => createPrivateGeneration(owner, runId, 'batch', itemId),
  ]) {
    await assert.rejects(execute(), { code: 'automatic_publication_unavailable' });
  }
  assert.equal(state.claims, 0);
  assert.equal(state.refusals, 1);
  assert.equal(state.run.status, 'failed');
  assert.equal(state.run.error_code, 'automatic_publication_unavailable');
  assert.equal(state.run.charged_microusd, 0);
  assert.equal(state.discoveries, 0);
  assert.deepEqual(state.updates, []);
  assert.deepEqual(state.creates, []);
  assert.deepEqual(state.queues, []);
  assert.deepEqual(state.starts, []);
});
test('preclaim refusal delegates to an atomic queued guard and never erases concurrent running work', async (t) => {
  const { state, claim } = await setup(t, 'automatic', {
    ...production(),
    HZENSE_AUTOMATIC_PUBLICATION_ENABLED: '0',
  });
  state.run.status = 'queued';
  state.claimConcurrently = true;
  state.run.charged_microusd = 123;
  await assert.rejects(claim(owner, runId), { code: 'automatic_publication_unavailable' });
  assert.equal(state.refusals, 1);
  assert.equal(state.run.status, 'running');
  assert.equal(state.run.charged_microusd, 123);
  assert.equal(state.claims, 0);
});
test('resumed automatic dispatch refuses a capability change without starting a paid worker', async (t) => {
  const { state, createPrivateGeneration, dispatchGeneration } = await setup(t, 'automatic');
  const generation = await createPrivateGeneration(owner, runId, 'batch', itemId);
  process.env.HZENSE_AUTOMATIC_PUBLICATION_ENABLED = '0';
  assert.equal(await dispatchGeneration(owner, runId, generation), false);
  assert.deepEqual(state.starts, []);
  assert.deepEqual(state.cleanups, [{ owner, id: generation.id, at: queuedAt }]);
});
test('invalid local markers fail before any read, reservation or child dispatch', async (t) => {
  const { state, claim } = await setup(t, 'automatic', { ...local(), VERCEL: '1' });
  await assert.rejects(claim(owner, runId), /execution_disabled/);
  assert.equal(state.reads, 0);
  assert.equal(state.claims, 0);
  assert.deepEqual(state.starts, []);
});

test('scheduled local collection reaches worker stages only while the scheduler opt-in is active', async (t) => {
  const { state, claim, findSources, createPrivateGeneration, dispatchGeneration } = await setup(
    t,
    'manual',
    { ...local(), HZENSE_LOCAL_AUTOMATION_SCHEDULER_ENABLED: '1' },
  );
  state.run.trigger = 'scheduled';
  await claim(owner, runId);
  assert.equal(state.claims, 1);
  await findSources(owner, runId);
  assert.equal(state.discoveries, 1);
  const generation = await createPrivateGeneration(owner, runId, 'batch', itemId);
  await dispatchGeneration(owner, runId, generation);
  assert.equal(state.starts[0].worker, 'localSignalGenerationWorkflow');
  assert.equal(state.creates[0].body.automaticPublicationConsent, false);

  process.env.HZENSE_LOCAL_AUTOMATION_SCHEDULER_ENABLED = '0';
  for (const execute of [
    () => claim(owner, runId),
    () => findSources(owner, runId),
    () => createPrivateGeneration(owner, runId, 'batch', itemId),
  ])
    await assert.rejects(execute(), /execution_disabled/);
  assert.equal(await dispatchGeneration(owner, runId, generation), false);
  assert.equal(state.claims, 1);
  assert.equal(state.discoveries, 1);
  assert.equal(state.creates.length, 1);
  assert.equal(state.starts.length, 1);
  assert.deepEqual(state.cleanups, [{ owner, id: generation.id, at: queuedAt }]);
});

test('scheduled worker admission rejects mock, production markers and local insight runs', async (t) => {
  const { state, claim } = await setup(t, 'manual', {
    ...local(),
    HZENSE_LOCAL_AUTOMATION_SCHEDULER_ENABLED: '1',
  });
  state.run.trigger = 'scheduled';
  for (const patch of [
    { HZENSE_LOCAL_AUTOMATION_SCHEDULER_ENABLED: undefined },
    { HZENSE_LOCAL_AI_MODE: 'mock' },
    { NODE_ENV: 'production' },
    { VERCEL: '1' },
    { WORKFLOW_TARGET_WORLD: 'vercel' },
    { HZENSE_RUNTIME_DATABASE_URL: 'postgresql://remote.invalid/db' },
  ]) {
    process.env = { ...local(), HZENSE_LOCAL_AUTOMATION_SCHEDULER_ENABLED: '1', ...patch };
    await assert.rejects(claim(owner, runId), /execution_disabled/);
  }
  process.env = { ...local(), HZENSE_LOCAL_AUTOMATION_SCHEDULER_ENABLED: '1' };
  state.run.snapshot.kind = 'topic_insight';
  await assert.rejects(claim(owner, runId), /execution_disabled/);
  assert.equal(state.claims, 0);
  assert.equal(state.discoveries, 0);
  assert.deepEqual(state.starts, []);

  process.env = production();
  state.run.snapshot.kind = 'source_collection';
  await claim(owner, runId);
  assert.equal(state.claims, 1, 'Production scheduled worker admission remains unchanged');
});
