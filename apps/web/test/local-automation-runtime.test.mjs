import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import process from 'node:process';
import test from 'node:test';
import { fileURLToPath, URL } from 'node:url';
import { build } from 'esbuild';
import {
  isLocalAutomationSchedulerEnabled,
  isLocalRealAutomationEnabled,
  localDatabaseEnvironmentRoles,
} from '../lib/local-development.ts';

const fixtureKey = '__hzenseLocalAutomationRuntime';
const root = fileURLToPath(new URL('..', import.meta.url));
const localHelper = fileURLToPath(new URL('../lib/local-development.ts', import.meta.url));
const owner = 'local:developer';
const runId = '11111111-1111-4111-8111-111111111111';
const errorClass = `export class AutomationError extends Error {
  constructor(code='invalid_request') { super(code); this.code=code; }
}`;

function environment() {
  return {
    NODE_ENV: 'development',
    VERCEL_ENV: 'development',
    PORT: '3000',
    NEXTAUTH_URL: 'http://127.0.0.1:3000',
    HZENSE_LOCAL_DEVELOPMENT: '1',
    HZENSE_LOCAL_AI_MODE: 'real',
    HZENSE_RUNTIME_EXPECTED_HOST: '127.0.0.1',
    HZENSE_RUNTIME_EXPECTED_PORT: '55432',
    HZENSE_RUNTIME_EXPECTED_NAME: 'hzense_local',
    HZENSE_RUNTIME_EXPECTED_USER: 'hzense_runtime',
    HZENSE_AUTOMATION_ENABLED: '1',
    HZENSE_TOPIC_INSIGHTS_ENABLED: '1',
    WORKFLOW_TARGET_WORLD: 'local',
    ...Object.fromEntries(
      Object.entries(localDatabaseEnvironmentRoles).map(([key, role]) => [
        key,
        `postgresql://${role}:${'a'.repeat(64)}@127.0.0.1:55432/hzense_local`,
      ]),
    ),
  };
}

function isolatedState(t) {
  const original = process.env;
  const state = {
    pools: [],
    connections: 0,
    acl: [],
    runtimeChecks: 0,
    releases: [],
    rejectAcl: false,
    cloudEffects: [],
  };
  process.env = environment();
  globalThis[fixtureKey] = state;
  t.after(() => {
    process.env = original;
    delete globalThis[fixtureKey];
  });
  return state;
}

async function fixture(path, modules) {
  const source = await readFile(new URL(path, import.meta.url), 'utf8');
  const compiled = await build({
    stdin: {
      contents: source,
      loader: 'ts',
      resolveDir: root,
    },
    bundle: true,
    write: false,
    platform: 'node',
    format: 'cjs',
    plugins: [
      {
        name: 'local-automation-runtime-no-external-effects',
        setup(builder) {
          builder.onResolve({ filter: /.*/ }, ({ path }) => {
            if (path === '../local-development') return { path: localHelper };
            if (path === 'node:process') return { path, external: true };
            if (!Object.hasOwn(modules, path))
              throw new Error(`Unexpected fixture dependency: ${path}`);
            return { path, namespace: 'fixture' };
          });
          builder.onLoad({ filter: /.*/, namespace: 'fixture' }, ({ path }) => ({
            contents: modules[path],
            loader: 'js',
            resolveDir: root,
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
  return module.exports;
}

function storageModules() {
  return {
    'server-only': '',
    pg: `export default {Pool:class {
      constructor(options){globalThis.${fixtureKey}.pools.push(options)}
      on(){}
      async connect(){
        const f=globalThis.${fixtureKey};f.connections++;
        return {release(destroy){f.releases.push(destroy)}};
      }
    }};`,
    '../runtime-reader-core': `
      import {assertLocalDatabaseUrl} from '../local-development';
      export function readRuntimeReaderConfig(env) {
        globalThis.${fixtureKey}.runtimeChecks++;
        assertLocalDatabaseUrl(env.HZENSE_RUNTIME_DATABASE_URL,'hzense_runtime',env);
      }`,
    '../../../../packages/database/src/automation-role.mjs': `
      export async function assertAutomationRole(_client,kind){
        const f=globalThis.${fixtureKey};f.acl.push(kind);
        if(f.rejectAcl)throw Error('synthetic_acl_failure');
      }`,
    '../../../../packages/database/src/automation-store.mjs': `${errorClass}
      export async function freezeAutomationInputs(){throw Error('Unexpected mutation');}`,
  };
}

test('real local automation execution requires the actual complete local isolation contract', async (t) => {
  const state = isolatedState(t);
  const service = await fixture('../lib/server/automation-store-access.ts', storageModules());
  const valid = environment();
  assert.equal(isLocalRealAutomationEnabled(valid), true);
  assert.equal(service.automationDatabaseConfiguration(), valid.HZENSE_AUTOMATION_DATABASE_URL);
  const client = await service.automationPool.connect();
  client.release();
  assert.equal(state.connections, 1);
  assert.deepEqual(state.acl, ['admin']);
  assert.equal(state.pools.length, 1);
  assert.equal(state.pools[0].connectionString, valid.HZENSE_AUTOMATION_DATABASE_URL);

  for (const [name, patch] of [
    ['mock mode', { HZENSE_LOCAL_AI_MODE: 'mock' }],
    ['missing mode', { HZENSE_LOCAL_AI_MODE: undefined }],
    ['unknown mode', { HZENSE_LOCAL_AI_MODE: 'REAL' }],
    ['cloud Workflow world', { WORKFLOW_TARGET_WORLD: 'vercel' }],
    ['missing Workflow world', { WORKFLOW_TARGET_WORLD: undefined }],
    ['disabled execution', { HZENSE_AUTOMATION_ENABLED: '0' }],
    ['missing execution flag', { HZENSE_AUTOMATION_ENABLED: undefined }],
    ['production runtime', { NODE_ENV: 'production' }],
    ['Vercel environment', { VERCEL_ENV: 'production' }],
    ['Vercel marker', { VERCEL: '1' }],
    [
      'remote automation database',
      {
        HZENSE_AUTOMATION_DATABASE_URL: valid.HZENSE_AUTOMATION_DATABASE_URL.replace(
          '127.0.0.1',
          'synthetic.neon.tech',
        ),
      },
    ],
    [
      'remote runtime database',
      {
        HZENSE_RUNTIME_DATABASE_URL: valid.HZENSE_RUNTIME_DATABASE_URL.replace(
          '127.0.0.1',
          'synthetic.neon.tech',
        ),
      },
    ],
    [
      'test database port',
      {
        HZENSE_AUTOMATION_DATABASE_URL: valid.HZENSE_AUTOMATION_DATABASE_URL.replace(
          ':55432/',
          ':55433/',
        ),
      },
    ],
    [
      'owner database role',
      {
        HZENSE_AUTOMATION_DATABASE_URL: valid.HZENSE_AUTOMATION_DATABASE_URL.replace(
          'hzense_automation_admin',
          'hzense_local_owner',
        ),
      },
    ],
  ]) {
    await t.test(name, async () => {
      process.env = { ...valid, ...patch };
      assert.equal(isLocalRealAutomationEnabled(process.env), false);
      const before = {
        connections: state.connections,
        checks: state.runtimeChecks,
        acl: state.acl.length,
      };
      assert.throws(() => service.automationDatabaseConfiguration(), /execution_disabled/);
      await assert.rejects(service.automationPool.connect(), /execution_disabled/);
      assert.deepEqual(
        {
          connections: state.connections,
          checks: state.runtimeChecks,
          acl: state.acl.length,
        },
        before,
        'Rejected local execution must not reach URL admission, database connections or ACL reads',
      );
    });
  }
});

test('local automation retains configuration storage and ACL checks without enabling execution', async (t) => {
  const state = isolatedState(t);
  const service = await fixture('../lib/server/automation-store-access.ts', storageModules());
  process.env.HZENSE_LOCAL_AI_MODE = 'mock';
  process.env.HZENSE_AUTOMATION_ENABLED = '0';
  await service.automationConfigPool.connect();
  assert.equal(state.connections, 1);
  assert.deepEqual(state.acl, ['admin']);
  await assert.rejects(service.automationPool.connect(), /execution_disabled/);
  assert.equal(state.connections, 1);

  process.env = environment();
  state.rejectAcl = true;
  await assert.rejects(service.automationPool.connect(), /synthetic_acl_failure/);
  assert.equal(state.connections, 2);
  assert.deepEqual(state.acl, ['admin', 'admin']);
  assert.deepEqual(state.releases, [true], 'Failed ACL validation destroys the connection');
});

test('local insight reader uses its restricted role in real and mock mode', async (t) => {
  const state = isolatedState(t);
  const service = await fixture('../lib/server/automation-store-access.ts', storageModules());
  for (const mode of ['real', 'mock']) {
    process.env = { ...environment(), HZENSE_LOCAL_AI_MODE: mode, HZENSE_AUTOMATION_ENABLED: '0' };
    assert.equal(
      service.automationDatabaseConfiguration(true),
      process.env.HZENSE_INSIGHT_READER_DATABASE_URL,
    );
    const client = await service.insightReaderPool.connect();
    client.release();
  }
  assert.deepEqual(state.acl, ['reader', 'reader']);
  assert.equal(state.pools[0].connectionString, environment().HZENSE_INSIGHT_READER_DATABASE_URL);
  const before = state.connections;
  for (const patch of [
    { NODE_ENV: 'production' },
    { VERCEL: '1' },
    { HZENSE_INSIGHT_READER_DATABASE_URL: 'postgresql://remote.invalid/db' },
    {
      HZENSE_INSIGHT_READER_DATABASE_URL: environment().HZENSE_INSIGHT_READER_DATABASE_URL.replace(
        'hzense_insight_reader',
        'hzense_automation_admin',
      ),
    },
  ]) {
    process.env = { ...environment(), ...patch };
    assert.throws(() => service.automationDatabaseConfiguration(true), /execution_disabled/);
    await assert.rejects(service.insightReaderPool.connect(), /execution_disabled/);
  }
  process.env = { ...environment(), HZENSE_TOPIC_INSIGHTS_ENABLED: '0' };
  await assert.rejects(service.insightReaderPool.connect(), /not_configured/);
  assert.equal(state.connections, before);
});

test('local topic Sandbox start, poll and stop fail before any cloud or private-data access', async (t) => {
  const state = isolatedState(t);
  const effect = (name) =>
    `globalThis.${fixtureKey}.cloudEffects.push('${name}');throw Error('Unexpected ${name}');`;
  const service = await fixture('../lib/server/topic-insight-sandbox.ts', {
    'server-only': '',
    'node:fs/promises': `export async function readFile(){${effect('readFile')}}`,
    'node:path': `export function join(){${effect('join')}}`,
    '@vercel/sandbox': `export const Sandbox={
      async create(){${effect('Sandbox.create')}},
      async get(){${effect('Sandbox.get')}}
    };`,
    './sandbox-command': `export async function observeSandboxCommandExit(){${effect('observe')}}`,
    './automation-store-access': `export const automationPool={
      async connect(){${effect('database.connect')}}
    };`,
    '../../../../packages/database/src/automation-store.mjs': `
      export async function readAutomationRun(){${effect('readAutomationRun')}}`,
    '../admin-ai-core': `export function readAiBackendConfiguration(){${effect('AI credentials')}}`,
  });
  const handle = { sandboxName: 'synthetic-never-created', commandId: 'synthetic-command' };
  for (const patch of [
    {},
    { HZENSE_LOCAL_AI_MODE: 'mock' },
    { WORKFLOW_TARGET_WORLD: 'vercel' },
    { NODE_ENV: 'production' },
    { VERCEL: '1' },
    { HZENSE_RUNTIME_DATABASE_URL: 'invalid' },
  ]) {
    process.env = { ...environment(), ...patch };
    await assert.rejects(service.startTopicInsightSandbox(owner, runId), /execution_disabled/);
    await assert.rejects(service.pollTopicInsightSandbox(handle), /execution_disabled/);
    await assert.rejects(service.stopTopicInsightSandbox(handle), /execution_disabled/);
  }
  assert.deepEqual(state.cloudEffects, []);
});

test('local scheduling uses the complete isolation contract and an explicit opt-in', () => {
  const env = environment();
  assert.equal(isLocalAutomationSchedulerEnabled(env), false);
  assert.equal(
    isLocalAutomationSchedulerEnabled({ ...env, HZENSE_LOCAL_AUTOMATION_SCHEDULER_ENABLED: '1' }),
    true,
  );
  for (const patch of [
    { HZENSE_LOCAL_AUTOMATION_SCHEDULER_ENABLED: 'true' },
    { HZENSE_LOCAL_AI_MODE: 'mock' },
    { NODE_ENV: 'production' },
    { VERCEL: '1' },
    { HZENSE_LOCAL_DEVELOPMENT: undefined },
    { WORKFLOW_TARGET_WORLD: 'vercel' },
    { HZENSE_AUTOMATION_ENABLED: '0' },
    { HZENSE_RUNTIME_DATABASE_URL: 'postgresql://remote.invalid/db' },
  ]) {
    assert.equal(
      isLocalAutomationSchedulerEnabled({
        ...env,
        HZENSE_LOCAL_AUTOMATION_SCHEDULER_ENABLED: '1',
        ...patch,
      }),
      false,
    );
  }
});

test('local due collection dispatches only newly queued runs and keeps disabled drafts unchanged', async (t) => {
  const state = isolatedState(t);
  Object.assign(state, {
    writes: [],
    due: [],
    starts: [],
    failures: 0,
    profileChecks: 0,
    draftChecks: 0,
    publications: [],
    publicSignalReads: 0,
    currentInsight: true,
    tasks: [],
    config: {
      kind: 'source_collection',
      enabled: false,
      frequency: 'daily',
      profileId: 'profile',
      profileRevision: 1,
      topicIds: [],
    },
  });
  for (const key of ['BATCH_LIMIT', 'DAILY_LIMIT', 'RESERVE'])
    process.env[`HZENSE_AUTOMATION_${key}_MICROUSD`] = '1000000';
  const service = await fixture('../lib/server/automation.ts', {
    'server-only': '',
    '../../../../packages/database/src/automation-store.mjs': `${errorClass}
      export async function saveAutomationConfig(x){globalThis.${fixtureKey}.writes.push(x);return x.request}
      export async function deleteAutomationConfig(){throw Error('Unexpected delete')}
      export async function readAutomationDashboard(){return {configs:[],runs:[],configDeletionAvailable:true}}
      export async function readAutomationRunDetail(){throw Error('Unexpected detail')}
      export async function enqueueAutomation(){throw Error('Unexpected manual enqueue')}
      export async function enqueueDueAutomations(x){const f=globalThis.${fixtureKey};f.due.push(x);return f.tasks}
      export async function readAutomationRun(){return {snapshot:globalThis.${fixtureKey}.config}}
      export async function failAutomationDispatch(){globalThis.${fixtureKey}.failures++}
      export async function rejectInsightTopicsBeforeClaim(){throw Error('Unexpected insight rejection')}
      export async function rejectAutomaticPublicationBeforeClaim(){throw Error('Unexpected publish')}
      export async function publishAutomationInsight(args){globalThis.${fixtureKey}.publications.push(args);return args}`,
    '../../../../packages/database/src/automation-contract.mjs':
      'export const normalizeAutomationConfig=x=>x;',
    './automation-store-access': `export const automationConfigPool={kind:'config'},automationPool={kind:'execution'};
      export function automationStorageConfiguration(){}
      export function automationDatabaseConfiguration(reader){if(reader&&process.env.HZENSE_TOPIC_INSIGHTS_ENABLED!=='1')throw Error('not_configured')}
      export async function freezeAutomationInputs(){}`,
    './admin-ai': `export async function generationAiAccess(){globalThis.${fixtureKey}.profileChecks++}
      export async function aiStageAccess(){globalThis.${fixtureKey}.profileChecks++}
      export async function validateLocalAiProfileReference(){globalThis.${fixtureKey}.draftChecks++}`,
    '../automatic-publication': 'export const automaticPublicationAvailable=()=>false;',
    './import-service': 'export const importsConfigured=()=>true;',
    './signal-generation':
      'export const generationConfigured=()=>true; export async function generationSummaries(){return []}',
    '../automation-generation-status':
      'export const automationGenerationIds=()=>[]; export const summarizeAutomationGenerations=()=>({});',
    '../topic-insight-core': `export const currentInsight=()=>globalThis.${fixtureKey}.currentInsight?{inputs:[],topicIds:[]}:null;`,
    './insight-topics': 'export async function assertInsightLeafTopics(){}',
    './task-public-signals': `export async function readTaskPublicSignals(){globalThis.${fixtureKey}.publicSignalReads++;return []}`,
    '../content-runtime': 'export async function getTopicEntries(){return []}',
    '../source-discovery-provider': 'export function assertDiscoveryConnection(){}',
    'workflow/api': `export async function start(_workflow,args){globalThis.${fixtureKey}.starts.push(args)}`,
    '../../workflows/automation': 'export async function automationWorkflow(){}',
  });
  const request = { id: 'config', config: state.config, expectedRevision: 1, consent: true };
  assert.equal((await service.automationDashboard(owner)).localSchedulingAvailable, false);
  await service.saveAutomation(owner, request);
  assert.equal(state.draftChecks, 1);
  assert.equal(state.profileChecks, 0);
  await assert.rejects(
    service.saveAutomation(owner, { ...request, config: { ...state.config, enabled: true } }),
    /execution_disabled/,
  );
  assert.deepEqual(await service.dispatchDueAutomations(), { dispatched: 0, failed: 0 });
  assert.equal(state.due.length, 0);

  process.env.HZENSE_LOCAL_AUTOMATION_SCHEDULER_ENABLED = '1';
  assert.equal((await service.automationDashboard(owner)).localSchedulingAvailable, true);
  await service.saveAutomation(owner, { ...request, config: { ...state.config, enabled: true } });
  assert.equal(state.writes.length, 2);
  assert.equal(state.profileChecks, 1);
  assert.deepEqual(state.starts, [], 'Enabling a schedule must not run it immediately');
  await assert.rejects(
    service.saveAutomation(owner, {
      ...request,
      config: { ...state.config, enabled: true, frequency: 'manual' },
    }),
    /invalid_request/,
  );
  await service.saveAutomation(owner, {
    ...request,
    config: { ...state.config, kind: 'topic_insight', enabled: true },
  });
  assert.equal(state.writes.at(-1).request.config.enabled, true);
  assert.deepEqual(state.starts, [], 'Enabling an insight schedule does not run it immediately');
  state.tasks = [{ created: true, run: { id: runId, owner_id: owner } }];
  assert.deepEqual(await service.dispatchDueAutomations(), { dispatched: 1, failed: 0 });
  assert.deepEqual(state.due.at(-1).kinds, ['source_collection', 'topic_insight']);
  assert.equal(state.due.at(-1).allowAutomaticPublication, false);
  assert.deepEqual(state.starts, [[owner, runId]]);
  state.tasks = [{ created: false, run: { id: runId, owner_id: owner } }];
  assert.deepEqual(await service.dispatchDueAutomations(), { dispatched: 0, failed: 0 });
  assert.deepEqual(
    state.starts,
    [[owner, runId]],
    'A repeated scheduler signal does not restart an existing run',
  );

  for (const patch of [
    { HZENSE_LOCAL_AUTOMATION_SCHEDULER_ENABLED: '0' },
    { HZENSE_LOCAL_AI_MODE: 'mock' },
    { NODE_ENV: 'production' },
    { VERCEL_ENV: 'production' },
    { WORKFLOW_TARGET_WORLD: 'vercel' },
    { HZENSE_AUTOMATION_DATABASE_URL: 'postgresql://remote.invalid/db' },
  ]) {
    const active = process.env;
    process.env = { ...active, ...patch };
    const before = state.due.length;
    assert.deepEqual(await service.dispatchDueAutomations(), { dispatched: 0, failed: 0 });
    await assert.rejects(
      service.saveAutomation(owner, { ...request, config: { ...state.config, enabled: true } }),
      /execution_disabled/,
    );
    assert.equal(state.due.length, before);
    process.env = active;
  }
  const realEnvironment = process.env;
  process.env = {
    ...realEnvironment,
    HZENSE_LOCAL_AI_MODE: 'mock',
    HZENSE_AUTOMATION_ENABLED: '0',
  };
  const startsBeforePublication = state.starts.length;
  await service.publishAutomationInsight(owner, runId, true);
  await service.publishAutomationInsight(owner, runId, false);
  assert.deepEqual(
    state.publications.map(({ pool, confirm }) => ({ pool, confirm })),
    [
      { pool: { kind: 'config' }, confirm: true },
      { pool: { kind: 'config' }, confirm: false },
    ],
  );
  assert.equal(
    state.publicSignalReads,
    1,
    'Publication checks current public evidence; withdrawal needs no AI or source read',
  );
  assert.equal(state.starts.length, startsBeforePublication);
  state.currentInsight = false;
  await assert.rejects(service.publishAutomationInsight(owner, runId, true), /insight_stale/);
  assert.equal(state.publications.length, 2);
  process.env.HZENSE_TOPIC_INSIGHTS_ENABLED = '0';
  await assert.rejects(service.publishAutomationInsight(owner, runId, false), /not_configured/);
  process.env = { ...realEnvironment, VERCEL: '1' };
  await assert.rejects(service.publishAutomationInsight(owner, runId, false), /execution_disabled/);
  assert.equal(state.publications.length, 2);
  process.env = realEnvironment;
  delete process.env.HZENSE_LOCAL_DEVELOPMENT;
  delete process.env.HZENSE_LOCAL_AUTOMATION_SCHEDULER_ENABLED;
  await service.dispatchDueAutomations();
  assert.deepEqual(
    state.due.at(-1).kinds,
    ['source_collection', 'topic_insight'],
    'Production keeps both existing task kinds',
  );
});
