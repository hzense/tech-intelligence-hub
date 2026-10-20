import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import process from 'node:process';
import test from 'node:test';
import { fileURLToPath, URL } from 'node:url';
import { build } from 'esbuild';
import { parseImportOutput } from '../../../packages/ingestion/src/import-task-contract.mjs';
import { LOCAL_GENERATION_PROFILE_ID } from '../lib/local-generation.ts';
import { encryptAiKey } from '../../../packages/database/src/ai-config-crypto.mjs';

const { structuredClone } = globalThis;
const id = '11111111-1111-4111-8111-111111111111';
const profileId = '22222222-2222-4222-8222-222222222222';
const connectionId = '33333333-3333-4333-8333-333333333333';
const queuedAt = '2026-10-20T10:00:00.000Z';
const settings = {
  timeout_ms: 10000,
  max_concurrency: 1,
  daily_budget_microusd: 1000000,
  input_price_microusd_per_million: 1,
  output_price_microusd_per_million: 1,
};
function environment(mode) {
  const url = (role) => `postgresql://${role}:${'a'.repeat(64)}@127.0.0.1:55432/hzense_local`;
  return {
    NODE_ENV: 'development',
    HZENSE_LOCAL_DEVELOPMENT: '1',
    HZENSE_LOCAL_AI_MODE: mode,
    PORT: '3000',
    NEXTAUTH_URL: 'http://127.0.0.1:3000',
    HZENSE_RUNTIME_EXPECTED_HOST: '127.0.0.1',
    HZENSE_RUNTIME_EXPECTED_PORT: '55432',
    HZENSE_RUNTIME_EXPECTED_NAME: 'hzense_local',
    HZENSE_RUNTIME_EXPECTED_USER: 'hzense_runtime',
    HZENSE_RUNTIME_DATABASE_URL: url('hzense_runtime'),
    HZENSE_AI_DATABASE_URL: url('hzense_ai_admin'),
    HZENSE_GENERATION_DATABASE_URL: url('hzense_generation_admin'),
    HZENSE_AI_ALLOWED_HOSTS: 'provider.example.com',
    HZENSE_AI_KEYRING: JSON.stringify({
      active: 'synthetic',
      keys: { synthetic: Buffer.alloc(32, 9).toString('base64') },
    }),
    HZENSE_SIGNAL_GENERATION_ENABLED: '1',
    HZENSE_GENERATION_WORKFLOW_ENABLED: '1',
    HZENSE_GENERATION_BATCH_LIMIT_MICROUSD: '5000000',
    HZENSE_GENERATION_DAILY_LIMIT_MICROUSD: '10000000',
    WORKFLOW_TARGET_WORLD: 'local',
  };
}

async function compile(
  contents,
  modules,
  resolveDir = fileURLToPath(new URL('..', import.meta.url)),
) {
  const compiled = await build({
    stdin: {
      contents,
      resolveDir,
      loader: 'ts',
    },
    bundle: true,
    write: false,
    platform: 'node',
    format: 'cjs',
    packages: 'external',
    plugins: [
      {
        name: 'no-network-local-fixtures',
        setup(builder) {
          builder.onResolve({ filter: /.*/ }, ({ path }) =>
            Object.hasOwn(modules, path) ? { path, namespace: 'fixture' } : undefined,
          );
          builder.onLoad({ filter: /.*/, namespace: 'fixture' }, ({ path }) => ({
            contents: modules[path],
            loader: 'js',
            resolveDir: fileURLToPath(new URL('..', import.meta.url)),
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

test('server enables normal AI admission only in explicit strict local real mode', async (t) => {
  const original = process.env;
  globalThis.__localAiDatabaseCalls = 0;
  t.after(() => {
    process.env = original;
    delete globalThis.__localAiDatabaseCalls;
  });
  const service = await compile("export * from './lib/server/admin-ai';", {
    'server-only': '',
    pg: `export default {Pool: class {
      on() {}
      async connect() {globalThis.__localAiDatabaseCalls++;throw Error('Synthetic database unavailable');}
    }};`,
    '../ai-provider':
      'export async function invokeAiProbe(){throw Error("Unexpected provider call");}',
  });
  const draft = {
    id,
    name: 'Synthetic draft',
    protocol: 'openai-compatible',
    base_url: 'https://provider.example.com/v1',
    enabled: false,
    settings,
  };
  for (const mode of ['mock', 'unknown']) {
    process.env = environment(mode);
    await assert.rejects(
      service.executeAiAdmin('run-probe', {
        id,
        connection_id: connectionId,
        connection_revision: 1,
        kind: 'models',
      }),
      { code: 'local_provider_disabled' },
    );
    const before = globalThis.__localAiDatabaseCalls;
    await assert.rejects(service.executeAiAdmin('create-connection', draft), {
      code: 'database_unavailable',
    });
    assert.equal(globalThis.__localAiDatabaseCalls, before + 1);
  }
  process.env = environment('real');
  const before = globalThis.__localAiDatabaseCalls;
  await assert.rejects(service.executeAiAdmin('create-connection', draft), {
    code: 'invalid_request',
  });
  assert.equal(globalThis.__localAiDatabaseCalls, before, 'Real mode cannot save keyless drafts');
  await assert.rejects(
    service.executeAiAdmin('run-probe', {
      id,
      connection_id: connectionId,
      connection_revision: 1,
      kind: 'models',
    }),
    { code: 'database_unavailable' },
  );
  assert.equal(
    globalThis.__localAiDatabaseCalls,
    before + 1,
    'Real probes reach normal DB admission',
  );
  process.env.VERCEL_ENV = 'production';
  await assert.rejects(service.executeAiAdmin('run-probe', {}), /ai_not_configured/);
  assert.equal(globalThis.__localAiDatabaseCalls, before + 1);
});

test('explicit local real probes persist normal receipts and replay without another provider call', async (t) => {
  const original = process.env;
  process.env = environment('real');
  const timestamp = new Date('2026-10-20T10:00:00Z');
  const state = {
    probes: [],
    invocations: [],
    events: [],
    overBudget: false,
    connection: {
      id: connectionId,
      revision: 1,
      enabled: true,
      protocol: 'openai-compatible',
      base_url: 'https://provider.example.com/v1',
      settings,
      encrypted_key: encryptAiKey(
        'synthetic-never-sent',
        connectionId,
        JSON.parse(process.env.HZENSE_AI_KEYRING),
      ),
    },
    async query(sql, args = []) {
      state.events.push(sql);
      if (sql.includes('SELECT current_user,session_user'))
        return {
          rows: [
            {
              current_user: 'hzense_ai_admin',
              session_user: 'hzense_ai_admin',
              rolsuper: false,
              rolcreaterole: false,
              rolcreatedb: false,
              rolreplication: false,
              rolbypassrls: false,
              rolinherit: false,
              memberships: false,
            },
          ],
        };
      const tag = sql.match(/\/\* ai:([^ ]+) \*\//)?.[1];
      if (tag === 'connection') return { rows: [structuredClone(state.connection)] };
      if (tag === 'probe')
        return { rows: structuredClone(state.probes.filter((row) => row.id === args[0])) };
      if (tag === 'probe-budget')
        return {
          rows: [{ today_count: '0', today_cost: state.overBudget ? '1000000' : '0', active: '0' }],
        };
      if (tag === 'probe-reserve') {
        const [probeId, cid, revision, kind, model, fingerprint, configuration, amount] = args;
        const row = {
          id: probeId,
          connection_id: cid,
          connection_revision: revision,
          kind,
          model_id: model,
          fingerprint,
          configuration: JSON.parse(configuration),
          status: 'pending',
          reserved_microusd: amount,
          charged_microusd: amount,
          result: {},
          created_at: timestamp,
          finished_at: null,
          input_tokens: null,
          output_tokens: null,
          error_code: null,
        };
        state.probes.push(row);
        return { rows: [structuredClone(row)] };
      }
      if (tag === 'probe-running')
        state.probes.find((row) => row.id === args[0]).status = 'running';
      if (tag === 'probe-finish') {
        const [probeId, status, charged, inputTokens, outputTokens, result, errorCode] = args;
        const row = state.probes.find((item) => item.id === probeId);
        Object.assign(row, {
          status,
          charged_microusd: charged,
          input_tokens: inputTokens,
          output_tokens: outputTokens,
          result: JSON.parse(result),
          error_code: errorCode,
          finished_at: timestamp,
        });
        return { rows: [structuredClone(row)] };
      }
      return { rows: [] };
    },
  };
  globalThis.__localAiProbeStore = state;
  t.after(() => {
    process.env = original;
    delete globalThis.__localAiProbeStore;
  });
  const service = await compile("export * from './lib/server/admin-ai';", {
    'server-only': '',
    pg: `export default {Pool:class {
      on() {}
      async connect(){return {query:globalThis.__localAiProbeStore.query,release(){}};}
    }};`,
    '../ai-provider': `export async function invokeAiProbe(input) {
      const f=globalThis.__localAiProbeStore;
      if(f.events.at(-1)!=='COMMIT')throw Error('Provider before committed admission');
      f.invocations.push(input);
      return {success:true,model_id:input.modelId??null,input_tokens:10,output_tokens:5,
        result:input.kind==='models'?{models:[{id:'fixture/model'}],count:1,truncated:false}:{sentinel_matched:true}};
    }`,
  });
  for (const [probeId, kind] of [
    [id, 'models'],
    [profileId, 'connection'],
  ]) {
    const command = {
      id: probeId,
      connection_id: connectionId,
      connection_revision: 1,
      kind,
      ...(kind === 'models' ? {} : { model_id: 'fixture/model' }),
    };
    const response = await service.executeAiAdmin('run-probe', command);
    assert.equal(response.probe.status, 'succeeded');
    const count = state.invocations.length;
    assert.deepEqual(await service.executeAiAdmin('run-probe', command), response);
    assert.equal(state.invocations.length, count, 'Receipt replay does not repeat a provider call');
  }
  assert.equal(state.invocations.length, 2);
  assert.equal(state.probes.length, 2);
  assert.doesNotMatch(JSON.stringify(state.probes), /synthetic-never-sent/);
  state.overBudget = true;
  await assert.rejects(
    service.executeAiAdmin('run-probe', {
      id: connectionId,
      connection_id: connectionId,
      connection_revision: 1,
      kind: 'connection',
      model_id: 'fixture/model',
    }),
    { code: 'daily_budget_exceeded' },
  );
  assert.equal(state.invocations.length, 2);
  process.env.HZENSE_LOCAL_AI_MODE = 'mock';
  await assert.rejects(
    service.executeAiAdmin('run-probe', {
      id: connectionId,
      connection_id: connectionId,
      connection_revision: 1,
      kind: 'models',
    }),
    { code: 'local_provider_disabled' },
  );
  assert.equal(state.invocations.length, 2);
});

const storePath = fileURLToPath(
  new URL('../../../packages/database/src/signal-generation-store.mjs', import.meta.url),
);
const generationModules = {
  'server-only': '',
  pg: 'export default {Pool:class {constructor(){throw Error("Unexpected database driver");}}};',
  '../../../../packages/database/src/signal-generation-store.mjs': `
    export * from ${JSON.stringify(storePath)};
    const f=()=>globalThis.__localGenerationRuntime;
    const copy=(value)=>structuredClone(value);
    export async function getSignalGeneration({owner,id}) {
      if(owner!=='local:developer'||f().run?.id!==id) throw Error('not_found');
      return copy(f().run);
    }
    export async function createSignalGeneration(args) {
      f().creates.push(args);
      const version=args.configuration.version+(args.retryOf?'/retry/'+args.retryOf:'');
      f().run={id:args.request.id,batch_id:args.request.batchId,item_id:args.request.itemId,
        source_fence:args.request.sourceFence,source_hash:args.request.sourceHash,
        profile_id:args.request.profileId,profile_revision:args.request.profileRevision,
        generation_version:version,configuration:{...args.configuration,version},
        snapshot:args.snapshot,status:'pending',lease_until:null,lease_token:null,
        reserved_microusd:'0',charged_microusd:'0',result:null,error_code:null};
      return copy(f().run);
    }
    export async function claimSignalGeneration(args) {
      f().claims.push(args);
      f().run.status='running';f().run.lease_token='synthetic-lease';
      return {claimed:true,run:copy(f().run)};
    }
    export async function queueSignalGeneration(args) {
      f().queues.push(args);return copy(f().run);
    }
    export async function finishSignalGeneration(args) {
      f().finishes.push(args);f().run.status=args.outcome;f().run.result=args.result??null;
      f().run.lease_token=null;return copy(f().run);
    }
    export async function updateSignalGenerationProgress() {}
    export async function getSignalGenerationDailyUsage(args) {f().usage.push(args);return null;}
    export async function listSignalGenerationDisplays() {return f().run?[copy(f().run)]:[];}
  `,
  '../../../../packages/database/src/import-store.mjs': `
    export async function getImportBatch(){return {items:[{id:'${connectionId}',status:'completed',fence:1}]};}
    export async function getImportOutput(){return globalThis.__localGenerationRuntime.output;}
    export async function listImportBatches(){return [];}
    export async function getImportItemLabels(){return [];}
  `,
  './generation-import-reader':
    'export const importPool={};export const importsConfigured=()=>true;',
  './editorial-topics': 'export const editorialTopicOptions=async()=>[];',
  './editorial-database': 'export const editorialPool={};',
  '../generation-publication':
    'export async function withGenerationPublications(runs){return runs;}',
  './admin-ai': `
    export async function generationAiAccess(id,revision,credentials) {
      const f=globalThis.__localGenerationRuntime;f.accesses.push({id,revision,credentials});
      if(id!==f.profile.id||revision!==f.profile.revision) throw Error('profile_not_ready');
      if(!f.profile.readiness.ready) throw Error('profile_not_ready');
      return {...structuredClone({profile:f.profile,connection:f.connection}),
        ...(credentials?{apiKey:'synthetic-never-sent'}:{})};
    }
    export async function getAiDashboard() {
      const f=globalThis.__localGenerationRuntime;f.dashboardReads++;
      return {profiles:[f.profile],connections:[f.connection]};
    }
  `,
  '../signal-generation-provider': `
    export async function invokeSignalGeneration(input) {
      const f=globalThis.__localGenerationRuntime;f.invocations.push(input);
      if(f.providerError)throw Error('Synthetic provider outcome unknown');
      return {success:true,input_tokens:10,output_tokens:5,
        output:{classification:'private',validation_version:1,candidates:[],rejected:[],reason:'Synthetic'}};
    }
  `,
};
function runtimeFixture() {
  const stage = {
    connection_id: connectionId,
    connection_revision: 1,
    model_id: 'fixture/model',
    prompt: 'Synthetic prompt',
    temperature: 0.5,
    max_output_tokens: 128,
    require_tools: false,
  };
  return {
    creates: [],
    claims: [],
    queues: [],
    finishes: [],
    accesses: [],
    invocations: [],
    usage: [],
    dashboardReads: 0,
    output: parseImportOutput({
      fragments: [{ text: 'Synthetic source', locator: { paragraph: 1 } }],
    }),
    profile: {
      id: profileId,
      revision: 1,
      name: 'Synthetic real profile',
      stages: { extract: stage, verify: stage, analyze: stage },
      readiness: { ready: true },
    },
    connection: {
      id: connectionId,
      revision: 1,
      protocol: 'openai-compatible',
      base_url: 'https://provider.example.com/v1',
      settings,
    },
  };
}
const create = (selected = profileId, requestId = id, retryOf) => ({
  action: 'create',
  id: requestId,
  batchId: id,
  itemId: connectionId,
  profileId: selected,
  profileRevision: 1,
  consent: true,
  ...(retryOf ? { retryOf } : {}),
});

test('local real generation uses normal capability admission, accounting and exactly one provider call', async (t) => {
  const original = process.env;
  t.after(() => {
    process.env = original;
    delete globalThis.__localGenerationRuntime;
  });
  const service = await compile(
    "export * from './lib/server/signal-generation';",
    generationModules,
  );
  const f = (globalThis.__localGenerationRuntime = runtimeFixture());
  process.env = environment('real');
  assert.equal(service.generationConfigured(), true);
  const created = await service.executeGeneration('local:developer', create());
  assert.equal(created.ai_mode, 'local-real');
  assert.equal(f.run.generation_version, 'local-real-ai-v1');
  assert.equal(f.creates[0].configuration.batchLimitMicrousd, 5000000);
  assert.equal(f.accesses[0].credentials, undefined);
  const dashboard = await service.generationDashboard('local:developer');
  assert.equal(dashboard.profiles[0].provider_host, 'provider.example.com');
  assert.equal(f.usage[0].budgetMode, 'local-real');
  const completed = await service.executeGeneration(
    'local:developer',
    { action: 'run', id },
    queuedAt,
  );
  assert.equal(completed.status, 'completed');
  assert.equal(f.claims[0].budgetMode, 'local-real');
  assert.equal(f.claims[0].queuedAt, queuedAt);
  assert.equal(f.invocations.length, 1);
  assert.deepEqual(f.invocations[0].allowedHosts, ['provider.example.com']);
  assert.equal(f.invocations[0].apiKey, 'synthetic-never-sent');
  f.providerError = true;
  await service.executeGeneration('local:developer', { action: 'run', id }, queuedAt);
  assert.equal(f.invocations.length, 2, 'An uncertain call is not automatically retried');
  assert.equal(f.finishes.at(-1).outcome, 'unknown');
  f.profile.readiness.ready = false;
  await assert.rejects(service.executeGeneration('local:developer', create()), /profile_not_ready/);
  delete process.env.HZENSE_AI_KEYRING;
  assert.equal(
    service.generationConfigured(),
    false,
    'Real mode requires the normal AI backend config',
  );
});

test('local mode switches reject incompatible queued tasks and retries before budget or provider admission', async (t) => {
  const original = process.env;
  t.after(() => {
    process.env = original;
    delete globalThis.__localGenerationRuntime;
  });
  const service = await compile(
    "export * from './lib/server/signal-generation';",
    generationModules,
  );
  for (const [from, to, selected] of [
    ['mock', 'real', LOCAL_GENERATION_PROFILE_ID],
    ['real', 'mock', profileId],
  ]) {
    const f = (globalThis.__localGenerationRuntime = runtimeFixture());
    process.env = environment(from);
    await service.executeGeneration('local:developer', create(selected));
    const originalRun = structuredClone(f.run);
    process.env = environment(to);
    await assert.rejects(service.queueGeneration('local:developer', id), {
      code: 'configuration_changed',
    });
    await assert.rejects(service.executeGeneration('local:developer', { action: 'run', id }), {
      code: 'configuration_changed',
    });
    await assert.rejects(
      service.executeGeneration(
        'local:developer',
        create(to === 'mock' ? LOCAL_GENERATION_PROFILE_ID : profileId, connectionId, id),
      ),
      {
        code: 'configuration_changed',
      },
    );
    assert.deepEqual(f.run, originalRun);
    assert.equal(f.claims.length, 0);
    assert.equal(f.queues.length, 0);
    assert.equal(f.invocations.length, 0);
    f.run.status = 'failed';
    const dashboard = await service.generationDashboard('local:developer');
    assert.equal(dashboard.runs[0].can_retry, false);
    assert.equal(dashboard.runs[0].ai_mode, from === 'mock' ? 'local-mock' : 'local-real');
  }
  const f = (globalThis.__localGenerationRuntime = runtimeFixture());
  process.env = environment('mock');
  await service.executeGeneration('local:developer', create(LOCAL_GENERATION_PROFILE_ID));
  await service.executeGeneration('local:developer', { action: 'run', id });
  assert.equal(f.invocations.length, 0);
  assert.equal(f.claims[0].budgetMode, 'local-mock');
  assert.equal(f.finishes[0].outcome, 'completed');
});

test('local Workflow carries only identifiers and never retries a failed generation step', async (t) => {
  const original = process.env;
  const calls = [];
  globalThis.__localWorkflowCalls = calls;
  t.after(() => {
    process.env = original;
    delete globalThis.__localWorkflowCalls;
  });
  const workflow = await compile(
    (await readFile(new URL('../workflows/local-signal-generation.ts', import.meta.url), 'utf8')) +
      '\nexport { runLocalGenerationStep };',
    {
      '../lib/server/signal-generation': `
      export async function executeGeneration(...args){globalThis.__localWorkflowCalls.push(args);throw Error('Synthetic failure');}
      export async function failQueuedGeneration(...args){globalThis.__localWorkflowCalls.push(['fail',...args]);}
    `,
    },
    fileURLToPath(new URL('../workflows', import.meta.url)),
  );
  assert.equal(workflow.runLocalGenerationStep.maxRetries, 0);
  process.env = environment('real');
  await assert.rejects(
    workflow.localSignalGenerationWorkflow('local:developer', id, queuedAt),
    /local_generation_failed/,
  );
  assert.deepEqual(calls, [
    ['local:developer', { action: 'run', id }, queuedAt],
    ['fail', 'local:developer', id, queuedAt],
  ]);
});
