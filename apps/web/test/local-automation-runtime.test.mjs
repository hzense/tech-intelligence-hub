import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import process from 'node:process';
import test from 'node:test';
import { fileURLToPath, URL } from 'node:url';
import { build } from 'esbuild';
import {
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

test('local insight reader stays closed even with real AI and reader flags enabled', async (t) => {
  const state = isolatedState(t);
  const service = await fixture('../lib/server/automation-store-access.ts', storageModules());
  for (const patch of [
    {},
    { HZENSE_LOCAL_AI_MODE: 'mock' },
    { NODE_ENV: 'production' },
    { VERCEL: '1' },
    {
      HZENSE_INSIGHT_READER_DATABASE_URL: `postgresql://hzense_insight_reader:${'a'.repeat(64)}@127.0.0.1:55432/hzense_local`,
    },
  ]) {
    process.env = { ...environment(), ...patch };
    assert.throws(() => service.automationDatabaseConfiguration(true), /execution_disabled/);
    await assert.rejects(service.insightReaderPool.connect(), /execution_disabled/);
  }
  assert.equal(state.runtimeChecks, 0);
  assert.equal(state.connections, 0);
  assert.deepEqual(state.pools, []);
  assert.deepEqual(state.acl, []);
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
