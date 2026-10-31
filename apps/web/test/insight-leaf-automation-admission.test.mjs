import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath, URL } from 'node:url';
import process from 'node:process';
import test from 'node:test';
import { build } from 'esbuild';

const key = '__insightLeafAdmission';
const owner = 'local:leaf-test';
const id = '11111111-1111-4111-8111-111111111111';
const profileId = '22222222-2222-4222-8222-222222222222';
const config = (patch = {}) => ({
  name: '专题',
  kind: 'topic_insight',
  enabled: false,
  frequency: 'weekly',
  sourceUrls: [],
  topicIds: ['topic-leaf'],
  profileId,
  profileRevision: 1,
  ...patch,
});
const request = (value, patch = {}) => ({
  id,
  config: value,
  expectedRevision: 1,
  consent: true,
  ...patch,
});

async function compile() {
  const contract = fileURLToPath(
    new URL('../../../packages/database/src/automation-contract.mjs', import.meta.url),
  );
  const modules = {
    'server-only': '',
    '../../../../packages/database/src/automation-store.mjs': `export {AutomationError} from ${JSON.stringify(contract)};
      export async function readAutomationDashboard({owner}){const f=globalThis.${key};return {configs:f.configs.filter(row=>row.owner_id===owner),runs:[],configDeletionAvailable:true}}
      export async function saveAutomationConfig(args){const f=globalThis.${key};f.writes.push(args);return args.request}
      export async function deleteAutomationConfig(args){globalThis.${key}.deletes.push(args);return {id:args.request.id}}
      export async function readAutomationRunDetail(){return globalThis.${key}.historical}
      export async function enqueueAutomation(args){const f=globalThis.${key};if(f.replay)return {created:false,run:f.historical};await args.beforeEnqueue(f.config);f.enqueues++;
        const run={id:'manual',owner_id:args.owner,snapshot:structuredClone(f.config),result:{topicIds:f.config.topicIds}};f.runs.set(run.id,run);
        if(f.invalidateAfterEnqueue)f.denied.add('topic-leaf');
        if(f.untrackAfterEnqueue)f.untracked.add('topic-leaf');return {created:true,run};}
      export async function enqueueDueAutomations(){return globalThis.${key}.due}
      export async function readAutomationRun({id}){return globalThis.${key}.runs.get(id)}
      export async function failAutomationDispatch(args){globalThis.${key}.unknown.push(args)}
      export async function rejectInsightTopicsBeforeClaim(args){globalThis.${key}.refusals.push(args);return true}
      export async function rejectAutomaticPublicationBeforeClaim(){throw Error('unexpected automatic publication')}
      export async function publishAutomationInsight(args){globalThis.${key}.publications.push(args);return args}`,
    './automation-store-access': `export const automationConfigPool={kind:'config'},automationPool={kind:'execution'};
      export function automationStorageConfiguration(){} export function automationDatabaseConfiguration(){} export async function freezeAutomationInputs(){}`,
    './insight-topics': `import {AutomationError} from ${JSON.stringify(contract)};
      export async function assertTrackedInsightTopics(ids,signals){const f=globalThis.${key};f.topicReads++;f.scopeSignals=signals;
        if(f.catalogUnavailable)throw new AutomationError('database_unavailable');
        if(!ids.length||ids.some(id=>f.denied.has(id)))throw new AutomationError('insight_topic_not_leaf');
        if(ids.some(id=>f.untracked.has(id)))throw new AutomationError('insight_topic_not_tracked');}`,
    './admin-ai': `export async function aiStageAccess(){globalThis.${key}.profiles++;return {}}
      export async function generationAiAccess(){globalThis.${key}.profiles++;return {}}
      export async function validateLocalAiProfileReference(){globalThis.${key}.profiles++;}`,
    '../local-development': `export const isLocalDevelopment=()=>globalThis.${key}.local,isLocalAutomationSchedulerEnabled=()=>true;`,
    '../automatic-publication': 'export const automaticPublicationAvailable=()=>false;',
    './import-service': 'export const importsConfigured=()=>true;',
    './signal-generation':
      'export const generationConfigured=()=>true;export async function generationSummaries(){return []}',
    '../automation-generation-status':
      'export const automationGenerationIds=()=>[],summarizeAutomationGenerations=()=>({});',
    '../topic-insight-core': `export function currentInsight(_result,signals){globalThis.${key}.validationSignals=signals;return globalThis.${key}.validated}`,
    './task-public-signals': `export async function readTaskPublicSignals(){globalThis.${key}.signalReads++;return globalThis.${key}.signals}`,
    '../content-runtime':
      'export async function getTopicEntries(){return [{frontMatter:{id:"topic-parent"}}]}',
    '../source-discovery-provider': 'export function assertDiscoveryConnection(){}',
    'workflow/api': `export async function start(_workflow,args){globalThis.${key}.starts.push(args)}`,
    '../../workflows/automation': 'export async function automationWorkflow(){}',
  };
  const output = await build({
    entryPoints: [fileURLToPath(new URL('../lib/server/automation.ts', import.meta.url))],
    bundle: true,
    write: false,
    platform: 'node',
    format: 'cjs',
    plugins: [
      {
        name: 'leaf-admission-no-effects',
        setup(builder) {
          builder.onResolve({ filter: /.*/ }, ({ path }) => {
            if (
              path === contract ||
              path === '../../../../packages/database/src/automation-contract.mjs'
            )
              return { path: contract, namespace: 'file' };
            if (Object.hasOwn(modules, path)) return { path, namespace: 'fixture' };
          });
          builder.onLoad({ filter: /.*/, namespace: 'fixture' }, ({ path }) => ({
            contents: modules[path],
            loader: 'js',
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
function fixture() {
  return (globalThis[key] = {
    local: true,
    configs: [],
    config: config(),
    denied: new Set(['topic-parent', 'topic-unknown']),
    untracked: new Set(['topic-nine', 'topic-root']),
    writes: [],
    deletes: [],
    publications: [],
    profiles: 0,
    topicReads: 0,
    signalReads: 0,
    enqueues: 0,
    starts: [],
    refusals: [],
    unknown: [],
    due: [],
    runs: new Map(),
    historical: {
      id: 'history',
      snapshot: { kind: 'topic_insight', topicIds: ['topic-parent'] },
      result: { topicIds: ['topic-parent'] },
    },
    validated: { topicIds: ['topic-leaf'], inputs: [{ id: 'a' }, { id: 'b' }] },
    signals: [
      { id: 'a', topics: ['topic-leaf'] },
      { id: 'b', topics: ['topic-leaf'] },
    ],
  });
}

test('new saves require leaf topics while exact owner/revision-bound schedule shutdown remains available', async (t) => {
  const saved = process.env;
  process.env = {
    HZENSE_LOCAL_DEVELOPMENT: '1',
    HZENSE_AUTOMATION_BATCH_LIMIT_MICROUSD: '10000',
    HZENSE_AUTOMATION_DAILY_LIMIT_MICROUSD: '10000',
    HZENSE_AUTOMATION_RESERVE_MICROUSD: '1000',
  };
  t.after(() => {
    process.env = saved;
    delete globalThis[key];
  });
  const mod = await compile();
  for (const local of [true, false])
    for (const enabled of [true, false]) {
      const f = fixture();
      f.local = local;
      await assert.rejects(
        mod.saveAutomation(owner, request(config({ enabled, topicIds: ['topic-parent'] }))),
        { code: 'insight_topic_not_leaf' },
      );
      for (const topic of ['topic-nine', 'topic-root'])
        await assert.rejects(
          mod.saveAutomation(owner, request(config({ enabled, topicIds: [topic] }))),
          { code: 'insight_topic_not_tracked' },
        );
      assert.equal(f.writes.length + f.profiles, 0);
      await mod.saveAutomation(owner, request(config({ enabled })));
      assert.equal(f.writes.length, 1);
    }
  let f = fixture();
  const old = config({ enabled: true, topicIds: ['topic-parent'] });
  f.configs = [{ id, owner_id: owner, revision: 4, enabled: true, config: old }];
  f.catalogUnavailable = true;
  await mod.saveAutomation(owner, request({ ...old, enabled: false }, { expectedRevision: 4 }));
  assert.equal(f.writes.length, 1);
  assert.equal(
    f.profiles + f.topicReads,
    0,
    'Exact shutdown requires neither catalog nor AI readiness',
  );
  assert.deepEqual(f.writes[0].request.config.topicIds, ['topic-parent']);
  f.catalogUnavailable = false;
  for (const candidate of [
    request({ ...old, enabled: false, name: 'changed' }, { expectedRevision: 4 }),
    request({ ...old, enabled: false, frequency: 'daily' }, { expectedRevision: 4 }),
    request({ ...old, enabled: false }, { expectedRevision: 3 }),
    request({ ...old, enabled: false }, { id: profileId, expectedRevision: 4 }),
    request({ ...old, enabled: false, topicIds: ['topic-unknown'] }, { expectedRevision: 4 }),
  ])
    await assert.rejects(mod.saveAutomation(owner, candidate), { code: 'insight_topic_not_leaf' });
  await assert.rejects(
    mod.saveAutomation(
      'another-owner',
      request({ ...old, enabled: false }, { expectedRevision: 4 }),
    ),
    { code: 'insight_topic_not_leaf' },
  );
  assert.equal(f.writes.length, 1);
  f.configs[0].enabled = false;
  f.configs[0].config.enabled = false;
  await assert.rejects(
    mod.saveAutomation(owner, request({ ...old, enabled: false }, { expectedRevision: 4 })),
    { code: 'insight_topic_not_leaf' },
  );
  await mod.deleteAutomation(owner, { id, expectedRevision: 4, consent: true });
  assert.equal(f.deletes.length, 1);
  f = fixture();
  await mod.saveAutomation(
    owner,
    request(
      config({
        kind: 'source_collection',
        topicIds: ['topic-parent'],
        sourceUrls: ['https://example.com/'],
      }),
    ),
  );
  assert.equal(f.topicReads, 0, 'Source collection scope is unchanged');
});

test('manual and scheduled admission reject old parent scopes without dispatching or masking valid siblings', async (t) => {
  const saved = process.env;
  process.env = {
    HZENSE_AUTOMATION_BATCH_LIMIT_MICROUSD: '10000',
    HZENSE_AUTOMATION_DAILY_LIMIT_MICROUSD: '10000',
    HZENSE_AUTOMATION_RESERVE_MICROUSD: '1000',
  };
  t.after(() => {
    process.env = saved;
    delete globalThis[key];
  });
  const mod = await compile();
  let f = fixture();
  f.config = config({ topicIds: ['topic-parent'] });
  await assert.rejects(mod.triggerAutomation(owner, {}), { code: 'insight_topic_not_leaf' });
  assert.equal(f.enqueues + f.profiles + f.starts.length, 0);
  f.replay = true;
  assert.deepEqual((await mod.triggerAutomation(owner, {})).run, f.historical);
  assert.equal(f.starts.length, 0, 'Replayed history does not create a new paid attempt');
  f = fixture();
  f.invalidateAfterEnqueue = true;
  await assert.rejects(mod.triggerAutomation(owner, {}), { code: 'insight_topic_not_leaf' });
  assert.equal(f.enqueues, 1);
  assert.equal(f.refusals.length, 1);
  assert.equal(f.unknown.length + f.starts.length, 0);
  f = fixture();
  f.config = config({ topicIds: ['topic-nine'] });
  await assert.rejects(mod.triggerAutomation(owner, {}), { code: 'insight_topic_not_tracked' });
  assert.equal(f.enqueues + f.profiles + f.starts.length, 0);
  f = fixture();
  f.untrackAfterEnqueue = true;
  await assert.rejects(mod.triggerAutomation(owner, {}), { code: 'insight_topic_not_tracked' });
  assert.equal(f.enqueues, 1);
  assert.equal(f.refusals[0].errorCode, 'insight_topic_not_tracked');
  assert.equal(f.unknown.length + f.starts.length, 0);
  f = fixture();
  for (const [runId, topicIds] of [
    ['old-parent', ['topic-parent']],
    ['untracked-leaf', ['topic-nine']],
    ['valid-leaf', ['topic-leaf']],
  ]) {
    const run = { id: runId, owner_id: owner, snapshot: config({ topicIds }) };
    f.runs.set(runId, run);
    f.due.push({ created: true, run });
  }
  assert.deepEqual(await mod.dispatchDueAutomations(), { dispatched: 1, failed: 2 });
  assert.deepEqual(f.starts, [[owner, 'valid-leaf']]);
  assert.deepEqual(
    f.refusals.map((row) => row.id),
    ['old-parent', 'untracked-leaf'],
  );
  assert.deepEqual(f.unknown, []);
});

test('new publication requires leaf scope and evidence for every topic while old reads and withdrawals remain unchanged', async (t) => {
  const saved = process.env;
  process.env = { HZENSE_LOCAL_DEVELOPMENT: '1' };
  t.after(() => {
    process.env = saved;
    delete globalThis[key];
  });
  const mod = await compile();
  const f = fixture();
  f.runs.set('parent', {
    snapshot: config({ topicIds: ['topic-parent'] }),
    result: { topicIds: ['topic-parent'] },
  });
  await assert.rejects(mod.publishAutomationInsight(owner, 'parent', true), {
    code: 'insight_topic_not_leaf',
  });
  assert.equal(f.signalReads, 1);
  assert.equal(f.publications.length, 0);
  await mod.publishAutomationInsight(owner, 'parent', false);
  assert.equal(f.publications.length, 1);
  assert.deepEqual(await mod.automationRunDetail(owner, 'history'), f.historical);
  f.runs.set('multi', {
    snapshot: config({ topicIds: ['topic-leaf', 'topic-second'] }),
    result: { topicIds: ['topic-leaf', 'topic-second'] },
  });
  f.validated = { topicIds: ['topic-leaf', 'topic-second'], inputs: [{ id: 'a' }, { id: 'b' }] };
  f.signals.push({ id: 'not-an-input', topics: ['topic-second'] });
  await assert.rejects(mod.publishAutomationInsight(owner, 'multi', true), {
    code: 'insight_insufficient_evidence',
  });
  assert.equal(
    f.publications.length,
    1,
    'Unrelated public evidence cannot authorize the second topic',
  );
  f.signals[1].topics.push('topic-second');
  await mod.publishAutomationInsight(owner, 'multi', true);
  assert.equal(f.publications.length, 2);
  assert.equal(f.starts.length + f.profiles, 0);
  assert.equal(
    f.scopeSignals,
    f.validationSignals,
    'Qualification and fingerprint validation use the same public snapshot',
  );
  assert.equal(f.signalReads, 3, 'Each confirmation reads the public signal list once');
});

test('untracked completed reports remain readable and withdrawable and an exact old schedule can be stopped', async (t) => {
  const saved = process.env;
  process.env = { HZENSE_LOCAL_DEVELOPMENT: '1' };
  t.after(() => {
    process.env = saved;
    delete globalThis[key];
  });
  const mod = await compile();
  const f = fixture();
  const old = config({ enabled: true, topicIds: ['topic-nine'] });
  f.configs = [{ id, owner_id: owner, revision: 4, enabled: true, config: old }];
  f.catalogUnavailable = true;
  await mod.saveAutomation(owner, request({ ...old, enabled: false }, { expectedRevision: 4 }));
  assert.equal(f.writes.length, 1);
  assert.equal(f.topicReads + f.profiles, 0);
  f.catalogUnavailable = false;
  f.runs.set('old', { snapshot: old, result: { topicIds: ['topic-nine'] } });
  await assert.rejects(mod.publishAutomationInsight(owner, 'old', true), {
    code: 'insight_topic_not_tracked',
  });
  assert.equal(f.publications.length, 0);
  await mod.publishAutomationInsight(owner, 'old', false);
  assert.equal(f.publications.length, 1);
  assert.deepEqual(await mod.automationRunDetail(owner, 'history'), f.historical);
  assert.equal(f.starts.length, 0);
});
