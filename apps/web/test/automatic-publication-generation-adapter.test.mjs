import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { createRequire } from 'node:module';
import process from 'node:process';
import test from 'node:test';
import { fileURLToPath, URL } from 'node:url';
import { build } from 'esbuild';
import { parseImportOutput } from '../../../packages/ingestion/src/import-task-contract.mjs';
import { localDatabaseEnvironmentRoles } from '../lib/local-development.ts';

const owner = 'synthetic-admin';
const runId = '11111111-1111-4111-8111-111111111111';
const batchId = '22222222-2222-4222-8222-222222222222';
const itemId = '33333333-3333-4333-8333-333333333333';
const profileId = '44444444-4444-4444-8444-444444444444';
const connectionId = '55555555-5555-4555-8555-555555555555';
const articleUrl = 'https://news.example.com/articles/research?id=123';
const storePath = fileURLToPath(
  new URL('../../../packages/database/src/signal-generation-store.mjs', import.meta.url),
);

function environment() {
  const hostname = 'ep-fixture-pooler.eu-central-1.aws.neon.tech';
  const connection = (role) =>
    `postgresql://${role}:synthetic@${hostname}:5432/fixturedb?sslmode=verify-full&channel_binding=prefer`;
  return {
    VERCEL_ENV: 'production',
    HZENSE_RUNTIME_EXPECTED_HOST: hostname,
    HZENSE_RUNTIME_EXPECTED_PORT: '5432',
    HZENSE_RUNTIME_EXPECTED_NAME: 'fixturedb',
    HZENSE_RUNTIME_EXPECTED_USER: 'hzense_runtime',
    HZENSE_GENERATION_DATABASE_URL: connection('hzense_generation_admin'),
    HZENSE_AI_DATABASE_URL: connection('hzense_ai_admin'),
    HZENSE_AI_ALLOWED_HOSTS: 'provider.example.com',
    HZENSE_AI_KEYRING: JSON.stringify({
      active: 'synthetic',
      keys: { synthetic: Buffer.alloc(32, 8).toString('base64') },
    }),
    HZENSE_SIGNAL_GENERATION_ENABLED: '1',
    HZENSE_GENERATION_WORKFLOW_ENABLED: '1',
    HZENSE_GENERATION_BATCH_LIMIT_MICROUSD: '5000000',
    HZENSE_GENERATION_DAILY_LIMIT_MICROUSD: '10000000',
    HZENSE_AUTOMATIC_PUBLICATION_ENABLED: '1',
    HZENSE_EDITORIAL_PUBLICATION_ENABLED: '1',
    HZENSE_UNIFIED_SIGNAL_ENABLED: '1',
  };
}

function fixture() {
  const output = parseImportOutput({
    fragments: [{ text: 'Synthetic article content', locator: { paragraph: 1 } }],
  });
  const stage = {
    connection_id: connectionId,
    connection_revision: 1,
    model_id: 'fixture/model',
    prompt: 'Synthetic prompt',
    temperature: 0.5,
    max_output_tokens: 128,
    require_tools: false,
  };
  const state = {
    creates: [],
    accesses: [],
    queries: [],
    released: 0,
    invocations: 0,
    output,
    sourceOwner: owner,
    source: { kind: 'url', fence: 1, url: articleUrl, content: output },
    profile: {
      id: profileId,
      revision: 1,
      stages: { extract: stage, verify: stage, analyze: stage },
      readiness: { ready: true },
    },
    connection: {
      id: connectionId,
      revision: 1,
      protocol: 'openai-compatible',
      base_url: 'https://provider.example.com/v1',
      settings: {
        input_price_microusd_per_million: 1,
        output_price_microusd_per_million: 1,
      },
    },
    async query(sql, values) {
      state.queries.push({ sql, values });
      if (sql.includes('FROM public.import_batches b')) {
        assert.match(sql, /WHERE b\.owner_id=\$1 AND b\.id=\$2 AND i\.id=\$3/);
        assert.match(sql, /NOT b\.cancelled AND b\.deleted_at IS NULL/);
        assert.match(sql, /i\.status='completed' AND i\.kind='url'/);
        assert.deepEqual(values, [owner, batchId, itemId]);
        return {
          rows:
            state.sourceOwner === values[0] && state.source.kind === 'url'
              ? [{ ...state.source, batch_id: values[1], item_id: values[2] }]
              : [],
        };
      }
      assert.match(sql, /^(BEGIN|SET LOCAL|COMMIT|ROLLBACK)/);
      return { rows: [] };
    },
  };
  return state;
}

async function compile() {
  const modules = {
    'server-only': '',
    pg: 'export default {Pool:class {constructor(){throw Error("Unexpected real database");}}};',
    '../../../../packages/database/src/signal-generation-store.mjs': `
      export * from ${JSON.stringify(storePath)};
      export async function createSignalGeneration(args) {
        globalThis.__automaticPublicationAdmission.creates.push(args);
        return {id:args.request.id,status:'pending',lease_until:null,
          generation_version:args.configuration.version,snapshot:args.snapshot,
          reserved_microusd:'0',charged_microusd:'0'};
      }
    `,
    '../../../../packages/database/src/import-store.mjs': `
      export async function getImportBatch({owner,id}) {
        if(owner!==${JSON.stringify(owner)} || id!==${JSON.stringify(batchId)}) throw Error('not_found');
        return {items:[{id:${JSON.stringify(itemId)},status:'completed',fence:1}]};
      }
      export async function getImportOutput(){return globalThis.__automaticPublicationAdmission.output;}
      export async function listImportBatches(){throw Error('Unexpected list');}
      export async function getImportItemLabels(){throw Error('Unexpected labels');}
    `,
    './generation-import-reader': `
      export const importsConfigured=()=>true;
      export const importPool={async connect(){return {
        query:(...args)=>globalThis.__automaticPublicationAdmission.query(...args),
        release:()=>globalThis.__automaticPublicationAdmission.released++,
      };}};
    `,
    './editorial-topics': 'export const editorialTopicOptions=async()=>[];',
    './editorial-database': 'export const editorialPool={};',
    './admin-ai': `
      export async function generationAiAccess(id,revision,credentials) {
        const f=globalThis.__automaticPublicationAdmission;
        f.accesses.push({id,revision,credentials});
        if(credentials) throw Error('Creation must not obtain API keys');
        if(id!==f.profile.id || revision!==f.profile.revision) throw Error('profile_not_ready');
        return {profile:f.profile,connection:f.connection};
      }
      export async function getAiDashboard(){throw Error('Unexpected dashboard');}
    `,
    '../signal-generation-provider': `
      export async function invokeSignalGeneration(){
        globalThis.__automaticPublicationAdmission.invocations++;
        throw Error('Creation must not invoke a model');
      }
    `,
  };
  const compiled = await build({
    stdin: {
      contents: "export {executeGeneration} from './lib/server/signal-generation';",
      resolveDir: fileURLToPath(new URL('..', import.meta.url)),
      loader: 'ts',
    },
    bundle: true,
    write: false,
    platform: 'node',
    format: 'cjs',
    packages: 'external',
    plugins: [
      {
        name: 'isolate-automatic-publication-admission',
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
const service = compile();
const create = (extra = {}) => ({
  action: 'create',
  id: runId,
  batchId,
  itemId,
  profileId,
  profileRevision: 1,
  consent: true,
  ...extra,
});

async function setup(t) {
  const original = process.env;
  const state = (globalThis.__automaticPublicationAdmission = fixture());
  process.env = environment();
  t.after(() => {
    assert.equal(state.invocations, 0, 'Creation is separate from all paid provider execution');
    assert.ok(state.accesses.every((entry) => entry.credentials === undefined));
    process.env = original;
    delete globalThis.__automaticPublicationAdmission;
  });
  return { state, ...(await service) };
}

test('server never infers publication consent from AI consent or enabled operator flags', async (t) => {
  const { state, executeGeneration } = await setup(t);
  for (const body of [create(), create({ automaticPublicationConsent: false })]) {
    await executeGeneration(owner, body);
    assert.equal(Object.hasOwn(state.creates.at(-1).snapshot, 'publication'), false);
  }
  assert.equal(state.queries.length, 0, 'No public-source disclosure read without consent');
});

test('server pins explicitly consented ordinary source URL to current owner, fence and hash', async (t) => {
  const { state, executeGeneration } = await setup(t);
  await executeGeneration(owner, create({ automaticPublicationConsent: true }));
  const saved = state.creates[0];
  assert.equal(saved.owner, owner);
  assert.equal(saved.request.batchId, batchId);
  assert.equal(saved.request.itemId, itemId);
  assert.equal(saved.request.sourceFence, 1);
  assert.deepEqual(saved.snapshot.publication, {
    mode: 'automatic',
    policy: 'auto-publication-v1',
    sourceUrls: [articleUrl],
  });
  assert.equal(state.queries.filter(({ sql }) => sql.startsWith('SELECT')).length, 1);
  assert.equal(state.released, 1);
});

test('server rejects explicit automatic consent after any required operator switch is disabled', async (t) => {
  const { state, executeGeneration } = await setup(t);
  for (const flag of [
    'HZENSE_AUTOMATIC_PUBLICATION_ENABLED',
    'HZENSE_EDITORIAL_PUBLICATION_ENABLED',
    'HZENSE_UNIFIED_SIGNAL_ENABLED',
  ]) {
    process.env[flag] = '0';
    await assert.rejects(executeGeneration(owner, create({ automaticPublicationConsent: true })), {
      code: 'publication_policy_changed',
    });
    process.env[flag] = '1';
  }
  assert.equal(state.creates.length, 0);
  assert.equal(state.queries.length, 0);
});

test('server keeps private files, protected URLs and changed source bindings out of public policy', async (t) => {
  const { state, executeGeneration } = await setup(t);
  const original = { ...state.source };
  const changedOutput = parseImportOutput({
    fragments: [{ text: 'Changed after source admission', locator: { paragraph: 1 } }],
  });
  const cases = [
    { name: 'private file', source: { kind: 'file' } },
    { name: 'signed URL', source: { url: 'https://news.example.com/article?token=private' } },
    { name: 'cloud share', source: { url: 'https://drive.google.com/file/d/private/view' } },
    { name: 'internal path', source: { url: 'https://news.example.com/private/article' } },
    { name: 'different owner', sourceOwner: 'other-admin' },
    { name: 'new source fence', source: { fence: 2 } },
    { name: 'changed content hash', source: { content: changedOutput } },
  ];
  for (const scenario of cases) {
    state.source = { ...original, ...scenario.source };
    state.sourceOwner = scenario.sourceOwner ?? owner;
    await executeGeneration(owner, create({ automaticPublicationConsent: true }));
    assert.deepEqual(state.creates.at(-1).snapshot.publication.sourceUrls, [], scenario.name);
  }
  assert.equal(state.creates.length, cases.length);
  assert.equal(state.released, cases.length);
});

test('local real AI accepts explicit saved-collection consent without enabling default manual consent', async (t) => {
  const { state, executeGeneration } = await setup(t);
  process.env = {
    ...process.env,
    NODE_ENV: 'development',
    VERCEL_ENV: 'development',
    HZENSE_LOCAL_DEVELOPMENT: '1',
    HZENSE_LOCAL_AI_MODE: 'real',
    PORT: '3000',
    NEXTAUTH_URL: 'http://127.0.0.1:3000',
    HZENSE_AUTOMATIC_PUBLICATION_ENABLED: '0',
    HZENSE_RUNTIME_EXPECTED_HOST: '127.0.0.1',
    HZENSE_RUNTIME_EXPECTED_PORT: '55432',
    HZENSE_RUNTIME_EXPECTED_NAME: 'hzense_local',
    HZENSE_RUNTIME_EXPECTED_USER: 'hzense_runtime',
    ...Object.fromEntries(
      Object.entries(localDatabaseEnvironmentRoles).map(([key, role]) => [
        key,
        `postgresql://${role}:${'a'.repeat(64)}@127.0.0.1:55432/hzense_local`,
      ]),
    ),
  };
  await executeGeneration(owner, create());
  assert.equal(Object.hasOwn(state.creates.at(-1).snapshot, 'publication'), false);
  await executeGeneration(owner, create({ automaticPublicationConsent: true }));
  assert.deepEqual(state.creates.at(-1).snapshot.publication, {
    mode: 'automatic',
    policy: 'auto-publication-v1',
    sourceUrls: [articleUrl],
  });
  process.env.HZENSE_UNIFIED_SIGNAL_ENABLED = '0';
  await assert.rejects(executeGeneration(owner, create({ automaticPublicationConsent: true })), {
    code: 'publication_policy_changed',
  });
  assert.equal(state.creates.length, 2);
});
