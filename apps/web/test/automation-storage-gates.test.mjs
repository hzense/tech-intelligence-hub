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
    deletions: [],
    enqueued: 0,
    due: 0,
    starts: 0,
    replay: true,
    config: null,
    dueKinds: [],
    runs: [],
    summaryCalls: [],
    summariesUnavailable: false,
    summaryRows: [],
    profileErrorCode: 'profile_not_ready',
    profileErrorMessage: 'profile_not_ready',
  });
  try {
    const mod = await fixture('../lib/server/automation.ts', {
      'server-only': '',
      '../../../../packages/database/src/automation-store.mjs': `${errorClass}
        export async function saveAutomationConfig(x){if(x.pool.kind!=='config')throw Error('wrong_pool');globalThis.__automationService.writes.push(x);return x.request}
        export async function deleteAutomationConfig(x){if(x.pool.kind!=='config')throw Error('wrong_pool');globalThis.__automationService.deletions.push(x);return {id:x.request.id,revision:2,deleted_at:'2026-10-02T10:00:00Z'}}
        export async function readAutomationDashboard(x){if(x.pool.kind!=='config')throw Error('wrong_pool');return {configs:[],runs:globalThis.__automationService.runs,configDeletionAvailable:true}}
        export async function enqueueAutomation(x){const f=globalThis.__automationService;if(!f.replay)await x.beforeEnqueue(f.config);f.enqueued++;return {created:!f.replay,run:{id:'existing'}}}
        export async function enqueueDueAutomations(x){globalThis.__automationService.due++;globalThis.__automationService.dueKinds.push(x.kinds);return []}
        export async function readAutomationRun(){} export async function failAutomationDispatch(){} export async function publishAutomationInsight(){}`,
      '../../../../packages/database/src/automation-contract.mjs':
        'export const normalizeAutomationConfig=x=>x;',
      './automation-store-access': `export const automationConfigPool={kind:'config'},automationPool={kind:'execution'};
        export function automationStorageConfiguration(){if(!globalThis.__automationService.storage)throw Error('missing')}
        export function automationDatabaseConfiguration(){automationStorageConfiguration();if(!globalThis.__automationService.enabled)throw Error('off')}
        export async function freezeAutomationInputs(){}`,
      './admin-ai': `export async function generationAiAccess(_id,_revision,credentials){if(credentials)throw Error('credentials_not_needed');const f=globalThis.__automationService;if(!f.profile)throw Object.assign(Error(f.profileErrorMessage),{code:f.profileErrorCode})}
        export async function aiStageAccess(_id,_revision,_stage,credentials){if(credentials)throw Error('credentials_not_needed');return {}}`,
      './import-service':
        'export const importsConfigured=()=>globalThis.__automationService.imports;',
      './signal-generation': `export const generationConfigured=()=>globalThis.__automationService.generation;
        export async function generationSummaries(owner,ids){const f=globalThis.__automationService;f.summaryCalls.push({owner,ids});if(f.summariesUnavailable)throw Error('private failure');return f.summaryRows}`,
      '../automation-generation-status': `export const automationGenerationIds=result=>result?.generationIds??[];
        export const summarizeAutomationGenerations=(result,rows)=>({ids:result?.generationIds??[],rows});`,
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
    f.config = config;
    assert.equal(mod.automationStorageConfigured(), true);
    assert.equal(mod.automationExecutionConfigured('source_collection'), false);
    assert.equal((await mod.automationDashboard('owner')).configDeletionAvailable, true);
    assert.equal(f.summaryCalls.length, 0);
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
    assert.deepEqual(mod.automationExecutionReadiness('source_collection'), {
      ready: false,
      checks: [
        { key: 'storage', ready: true },
        { key: 'execution', ready: true },
        { key: 'budget', ready: true },
        { key: 'import', ready: false },
        { key: 'generation', ready: false },
      ],
    });
    assert.deepEqual(mod.automationExecutionReadiness('topic_insight'), {
      ready: true,
      checks: [
        { key: 'storage', ready: true },
        { key: 'execution', ready: true },
        { key: 'budget', ready: true },
      ],
    });
    f.replay = false;
    await assert.rejects(mod.triggerAutomation('owner', {}), /not_configured/);
    assert.equal(f.enqueued, 0);
    assert.equal(f.starts, 0);
    await mod.dispatchDueAutomations();
    assert.deepEqual(f.dueKinds, [['topic_insight']]);
    await assert.rejects(
      mod.saveAutomation('owner', { ...request, config: { ...config, enabled: true } }),
      /not_configured/,
    );
    f.imports = f.generation = true;
    assert.equal(mod.automationExecutionConfigured('source_collection'), true);
    await mod.saveAutomation('owner', { ...request, config: { ...config, enabled: true } });
    assert.equal(f.starts, 0);
    assert.equal(f.enqueued, 0);
    f.replay = true;
    await mod.triggerAutomation('owner', {});
    assert.equal(f.enqueued, 1);
    assert.equal(f.starts, 0); // Replayed request never dispatches twice.
    f.profile = false;
    // Replaying a saved request does not validate a now-unready profile or call AI.
    await mod.triggerAutomation('owner', {});
    assert.equal(f.enqueued, 2);
    assert.equal(f.starts, 0);
    f.replay = false;
    await assert.rejects(mod.triggerAutomation('owner', {}), /profile_not_ready/);
    assert.equal(f.enqueued, 2);
    f.profileErrorMessage = 'private provider credential must not cross admission';
    for (const [code, expected] of [
      ['profile_not_ready', 'profile_not_ready'],
      ['not_configured', 'not_configured'],
      ['revision_conflict', 'revision_conflict'],
      ['database_unavailable', 'database_unavailable'],
      ['capability_failed', 'profile_not_ready'],
      ['connection_unavailable', 'profile_not_ready'],
      ['invalid_model', 'profile_not_ready'],
      ['private_secret_code', 'database_unavailable'],
      [undefined, 'database_unavailable'],
      [{ secret: 'private-code' }, 'database_unavailable'],
    ]) {
      f.profileErrorCode = code;
      await assert.rejects(mod.triggerAutomation('owner', {}), (error) => {
        assert.equal(error.code, expected);
        assert.equal(error.message, expected);
        assert.equal(error.cause, undefined);
        return true;
      });
    }
    assert.equal(f.enqueued, 2);
    assert.equal(f.starts, 0);
    f.profileErrorCode = f.profileErrorMessage = 'profile_not_ready';
    await mod.dispatchDueAutomations();
    assert.deepEqual(f.dueKinds.at(-1), ['source_collection', 'topic_insight']);
    await assert.rejects(mod.saveAutomation('owner', request), /profile_not_ready/);
    const sourceRun = {
      id: 'source-run',
      snapshot: config,
      status: 'completed',
      phase: 'candidate_tasks_queued',
      result: { generationIds: ['generation-1', 'generation-2'] },
      charged_microusd: 12000,
      cost_source: 'provider',
      publication_status: 'private',
    };
    const insightRun = {
      ...sourceRun,
      id: 'insight-run',
      snapshot: { ...config, kind: 'topic_insight' },
      result: { generationIds: ['must-not-read'] },
    };
    f.runs = [sourceRun, { ...sourceRun, id: 'source-run-2' }, insightRun];
    f.summaryRows = [
      { id: 'generation-1', status: 'completed', progress_phase: 'completed', candidate_count: 2 },
    ];
    const dashboard = await mod.automationDashboard('owner');
    assert.deepEqual(f.summaryCalls, [{ owner: 'owner', ids: ['generation-1', 'generation-2'] }]);
    assert.deepEqual(dashboard.runs[0].generationProgress.rows, f.summaryRows);
    assert.equal('generationProgress' in dashboard.runs[2], false);
    assert.equal(dashboard.runs[0].status, sourceRun.status);
    assert.equal(dashboard.runs[0].phase, sourceRun.phase);
    assert.equal(dashboard.runs[0].charged_microusd, sourceRun.charged_microusd);
    assert.deepEqual(dashboard.runs[0].result, sourceRun.result);
    f.summariesUnavailable = true;
    const degraded = await mod.automationDashboard('owner');
    assert.equal(degraded.runs[0].generationProgress.rows, null);
    assert.equal(degraded.runs[0].status, 'completed');
    assert.equal(f.starts, 0);
    f.enabled = f.imports = f.generation = false;
    for (const key of ['BATCH_LIMIT', 'DAILY_LIMIT', 'RESERVE'])
      delete process.env[`HZENSE_AUTOMATION_${key}_MICROUSD`];
    const dueBeforeDisabled = f.due;
    assert.deepEqual(await mod.dispatchDueAutomations(), { dispatched: 0, failed: 0 });
    assert.equal(f.due, dueBeforeDisabled);
    const deletion = { id: 'config', expectedRevision: 1, consent: true };
    await mod.deleteAutomation('owner', deletion);
    assert.deepEqual(f.deletions, [
      { pool: { kind: 'config' }, owner: 'owner', request: deletion },
    ]);
    assert.equal(f.starts, 0);
    f.storage = false;
    assert.equal(mod.automationStorageConfigured(), false);
    assert.equal(mod.automationExecutionConfigured('source_collection'), false);
  } finally {
    for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
    Object.assign(process.env, saved);
    delete globalThis.__automationService;
  }
});
