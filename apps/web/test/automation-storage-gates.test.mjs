import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Buffer } from 'node:buffer';
import { URL } from 'node:url';
import process from 'node:process';
import { build } from 'esbuild';

async function fixture(path, mocks) {
  const source = await readFile(new URL(path, import.meta.url), 'utf8');
  const compiled = await build({
    stdin: { contents: source, loader: 'ts' },
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'node',
    plugins: [
      {
        name: 'isolated-automation',
        setup(builder) {
          builder.onResolve({ filter: /.*/ }, ({ path }) => {
            if (!(path in mocks)) throw new Error(`Unexpected dependency: ${path}`);
            return { path, namespace: 'fixture' };
          });
          builder.onLoad({ filter: /.*/, namespace: 'fixture' }, ({ path }) => ({
            contents: mocks[path],
          }));
        },
      },
    ],
  });
  return import(
    `data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString('base64')}`
  );
}
const errorClass = `export class AutomationError extends Error {constructor(code='invalid_request'){super(code);this.code=code}}`;

test('configuration connections retain role checks while execution and public reader stay gated', async () => {
  const saved = { ...process.env };
  globalThis.__automationStorage = { connections: 0, acl: 0, deny: false };
  try {
    const mod = await fixture('../lib/server/automation-store-access.ts', {
      'server-only': '',
      pg: `export default {Pool: class {on(){} async connect(){globalThis.__automationStorage.connections++;return {release(){}}}}};`,
      '../runtime-reader-core': `export function readRuntimeReaderConfig(env){if(new URL(env.HZENSE_RUNTIME_DATABASE_URL).protocol!=='postgresql:')throw Error('invalid')}`,
      '../../../../packages/database/src/automation-role.mjs': `export async function assertAutomationRole(){const f=globalThis.__automationStorage;f.acl++;if(f.deny)throw Error('role_invalid')}`,
      '../../../../packages/database/src/automation-store.mjs': `${errorClass}; export async function freezeAutomationInputs(){}`,
    });
    process.env.HZENSE_AUTOMATION_ENABLED = '0';
    process.env.HZENSE_TOPIC_INSIGHTS_ENABLED = '0';
    delete process.env.HZENSE_AUTOMATION_DATABASE_URL;
    assert.throws(() => mod.automationStorageConfiguration(), /not_configured/);
    process.env.HZENSE_AUTOMATION_DATABASE_URL =
      'postgresql://hzense_migrator:synthetic@example.invalid/test';
    assert.throws(() => mod.automationStorageConfiguration(), /not_configured/);
    process.env.HZENSE_AUTOMATION_DATABASE_URL =
      'postgresql://hzense_automation_admin:synthetic@example.invalid/test';
    await mod.automationConfigPool.connect();
    assert.equal(globalThis.__automationStorage.acl, 1);
    await assert.rejects(mod.automationPool.connect(), /not_configured/);
    await assert.rejects(mod.insightReaderPool.connect(), /not_configured/);
    assert.equal(globalThis.__automationStorage.connections, 1);
    globalThis.__automationStorage.deny = true;
    await assert.rejects(mod.automationConfigPool.connect(), /role_invalid/);
    globalThis.__automationStorage.deny = false;
    process.env.HZENSE_AUTOMATION_ENABLED = '1';
    await mod.automationPool.connect();
    process.env.HZENSE_AUTOMATION_ENABLED = '0';
    await assert.rejects(mod.automationPool.connect(), /not_configured/);
    await mod.automationConfigPool.connect();
  } finally {
    for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
    Object.assign(process.env, saved);
    delete globalThis.__automationStorage;
  }
});

test('inactive configuration saves without execution budgets, while enable/trigger/cron fail closed', async () => {
  const saved = { ...process.env };
  const f = (globalThis.__automationService = {
    enabled: false,
    storage: true,
    imports: false,
    generation: false,
    profile: true,
    writes: [],
    enqueued: 0,
    due: 0,
    starts: 0,
  });
  try {
    const mod = await fixture('../lib/server/automation.ts', {
      'server-only': '',
      '../../../../packages/database/src/automation-store.mjs': `${errorClass}
        export async function saveAutomationConfig(x){if(x.pool.kind!=='config')throw Error('wrong_pool');globalThis.__automationService.writes.push(x);return x.request}
        export async function readAutomationDashboard(x){if(x.pool.kind!=='config')throw Error('wrong_pool');return {configs:[],runs:[]}}
        export async function enqueueAutomation(){globalThis.__automationService.enqueued++;return {created:false,run:{id:'existing'}}}
        export async function enqueueDueAutomations(){globalThis.__automationService.due++;return []}
        export async function readAutomationRun(){} export async function failAutomationDispatch(){} export async function publishAutomationInsight(){}`,
      '../../../../packages/database/src/automation-contract.mjs':
        'export const normalizeAutomationConfig=x=>x;',
      './automation-store-access': `export const automationConfigPool={kind:'config'},automationPool={kind:'execution'};
        export function automationStorageConfiguration(){if(!globalThis.__automationService.storage)throw Error('missing')}
        export function automationDatabaseConfiguration(){automationStorageConfiguration();if(!globalThis.__automationService.enabled)throw Error('off')}
        export async function freezeAutomationInputs(){}`,
      './admin-ai': `export async function generationAiAccess(_id,_revision,credentials){if(credentials)throw Error('credentials_not_needed');if(!globalThis.__automationService.profile)throw Error('profile_not_ready')}
        export async function aiStageAccess(_id,_revision,_stage,credentials){if(credentials)throw Error('credentials_not_needed');return {}}`,
      './import-service':
        'export const importsConfigured=()=>globalThis.__automationService.imports;',
      './signal-generation':
        'export const generationConfigured=()=>globalThis.__automationService.generation;',
      '../topic-insight-core': 'export const currentInsight=()=>true;',
      './task-public-signals': 'export async function readTaskPublicSignals(){return []}',
      '../content-runtime': 'export async function getTopicEntries(){return []}',
      '../source-discovery-provider': 'export function assertDiscoveryConnection(){}',
      'workflow/api': 'export async function start(){globalThis.__automationService.starts++}',
      '../../workflows/automation': 'export async function automationWorkflow(){}',
    });
    for (const key of ['BATCH_LIMIT', 'DAILY_LIMIT', 'RESERVE'])
      delete process.env[`HZENSE_AUTOMATION_${key}_MICROUSD`];
    const config = {
      kind: 'source_collection',
      enabled: false,
      profileId: 'profile',
      profileRevision: 1,
      topicIds: [],
      discovery: { keywords: [], lookbackDays: 2, maxSources: 5 },
    };
    const request = { id: 'config', config, expectedRevision: 0, consent: true };
    assert.equal(mod.automationStorageConfigured(), true);
    assert.equal(mod.automationExecutionConfigured('source_collection'), false);
    await mod.automationDashboard('owner');
    await mod.saveAutomation('owner', request);
    assert.equal(f.writes.length, 1);
    assert.equal(f.starts, 0);
    await assert.rejects(
      mod.saveAutomation('owner', { ...request, config: { ...config, enabled: true } }),
      /execution_disabled/,
    );
    await assert.rejects(mod.triggerAutomation('owner', {}), /execution_disabled/);
    assert.deepEqual(await mod.dispatchDueAutomations(), { dispatched: 0, failed: 0 });
    assert.equal(f.due, 0);
    assert.equal(f.enqueued, 0);
    f.enabled = true;
    await assert.rejects(mod.triggerAutomation('owner', {}), /not_configured/);
    await assert.rejects(
      mod.saveAutomation('owner', { ...request, config: { ...config, enabled: true } }),
      /not_configured/,
    );
    for (const key of ['BATCH_LIMIT', 'DAILY_LIMIT', 'RESERVE'])
      process.env[`HZENSE_AUTOMATION_${key}_MICROUSD`] = '1000000';
    assert.equal(mod.automationExecutionConfigured('source_collection'), false);
    assert.equal(mod.automationExecutionConfigured('topic_insight'), true);
    await assert.rejects(
      mod.saveAutomation('owner', { ...request, config: { ...config, enabled: true } }),
      /not_configured/,
    );
    f.imports = f.generation = true;
    assert.equal(mod.automationExecutionConfigured('source_collection'), true);
    await mod.saveAutomation('owner', { ...request, config: { ...config, enabled: true } });
    assert.equal(f.starts, 0);
    assert.equal(f.enqueued, 0);
    await mod.triggerAutomation('owner', {});
    assert.equal(f.enqueued, 1);
    assert.equal(f.starts, 0); // Replayed request never dispatches twice.
    f.profile = false;
    await assert.rejects(mod.saveAutomation('owner', request), /profile_not_ready/);
    f.storage = false;
    assert.equal(mod.automationStorageConfigured(), false);
    assert.equal(mod.automationExecutionConfigured('source_collection'), false);
  } finally {
    for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
    Object.assign(process.env, saved);
    delete globalThis.__automationService;
  }
});
