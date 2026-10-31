import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import process from 'node:process';
import test from 'node:test';
import { fileURLToPath, URL } from 'node:url';
import { build } from 'esbuild';
import { localDatabaseEnvironmentRoles } from '../lib/local-development.ts';

const key = '__localTopicInsight';
const owner = 'local:developer';
const id = '11111111-1111-4111-8111-111111111111';
const token = '22222222-2222-4222-8222-222222222222';
const environment = () => ({
  NODE_ENV: 'development',
  PORT: '3000',
  NEXTAUTH_URL: 'http://127.0.0.1:3000',
  HZENSE_LOCAL_DEVELOPMENT: '1',
  HZENSE_LOCAL_AI_MODE: 'real',
  HZENSE_RUNTIME_EXPECTED_HOST: '127.0.0.1',
  HZENSE_RUNTIME_EXPECTED_PORT: '55432',
  HZENSE_RUNTIME_EXPECTED_NAME: 'hzense_local',
  HZENSE_RUNTIME_EXPECTED_USER: 'hzense_runtime',
  HZENSE_AUTOMATION_ENABLED: '1',
  WORKFLOW_TARGET_WORLD: 'local',
  ...Object.fromEntries(
    Object.entries(localDatabaseEnvironmentRoles).map(([name, role]) => [
      name,
      `postgresql://${role}:${'a'.repeat(64)}@127.0.0.1:55432/hzense_local`,
    ]),
  ),
});

async function compile() {
  const url = new URL('../workflows/automation.ts', import.meta.url);
  const files = {
    '../lib/local-development': '../lib/local-development.ts',
    './local-topic-insight': '../workflows/local-topic-insight.ts',
    '../lib/topic-insight-provider': '../lib/topic-insight-provider.ts',
    './topic-insight-core.ts': '../lib/topic-insight-core.ts',
  };
  const unexpected = 'throw Error("unexpected non-local effect")';
  const modules = {
    workflow: `export async function sleep(){${unexpected}}`,
    'workflow/api': `export async function start(){${unexpected}}`,
    '../lib/server/automation':
      'export const automationLimits=()=>({batch:100000,daily:100000,reserve:10000});',
    '../lib/server/automation-store-access': 'export const automationPool={};',
    '../../../packages/database/src/automation-store.mjs': `
      export class AutomationError extends Error {constructor(code){super(code);this.code=code}}
      export async function readAutomationRun(){const f=globalThis.${key};f.reads++;return structuredClone(f.run)}
      export async function claimAutomationRun(){const f=globalThis.${key};f.claims++;if(f.run.status!=='queued')return null;f.run.status='running';return structuredClone(f.run)}
      export async function rejectInsightTopicsBeforeClaim({errorCode}){const f=globalThis.${key};f.topicRefusals++;f.refusalCode=errorCode;if(f.run.status==='queued'){f.run.status='failed';f.run.charged_microusd=0;}return true;}
      export async function rejectAutomaticPublicationBeforeClaim(){${unexpected}}
      export async function beginTopicInsightExecution({owner,id,token}){
        const f=globalThis.${key},r=f.run;f.fences++;
        if(r.id!==id||r.owner_id!==owner||r.lease_token!==token||r.phase!=='preparing'||r.status!=='running')throw Error('stale_attempt');
        r.phase='preparing_topic';
      }
      export async function updateAutomationRun(args){
        const f=globalThis.${key};f.updates.push(structuredClone(args));
        if(f.writeFailure==='before'&&args.status==='completed')throw Error('private commit failure');
        f.run={...f.run,phase:args.phase,result:args.result,status:args.status,
          charged_microusd:args.costMicrousd??f.run.reserved_microusd,cost_source:args.costSource};
        if(args.status!=='running')f.run.lease_token=null;
        if(f.writeFailure==='after'&&args.status==='completed')throw Error('private lost acknowledgement');
        return structuredClone(f.run);
      }`,
    '../../../packages/database/src/automation-contract.mjs':
      'export const automationStableId=()=>"unused";',
    '../lib/server/topic-insight-executor': `export async function executeTopicInsight(){
      const f=globalThis.${key};f.executions++;
      if(f.run.phase!=='preparing_topic')throw Error('missing paid-call fence');
      if(f.error)throw f.error;
      return f.completion;
    }`,
    '../lib/server/import-service': `export async function executeImportAdmin(){${unexpected}} export async function runImportItem(){${unexpected}}`,
    '../lib/server/signal-generation': `export async function executeGeneration(){${unexpected}} export async function failQueuedGeneration(){${unexpected}} export async function queueGeneration(){${unexpected}}`,
    './signal-generation': `export async function signalGenerationWorkflow(){${unexpected}}`,
    './local-signal-generation': `export async function localSignalGenerationWorkflow(){${unexpected}}`,
    '../lib/automatic-publication': 'export const automaticPublicationAvailable=()=>false;',
    '../lib/server/source-discovery': `export async function discoverSources(){${unexpected}}`,
    '../lib/automation-source-failures':
      'export const appendAutomationSourceFailure=()=>[],appendAutomationImportFailure=()=>[],automationSourceFailureCode=()=>null,readAutomationSourceFailures=()=>[];',
    '../lib/automation-source-fallbacks':
      'export const canTrySourceFallback=()=>false,readAutomationSourceFallbacks=()=>[],sourceFallbackLimit=0,sourceFallbackUrls=()=>[];',
    '../lib/server/insight-topics': `import {AutomationError} from '../../../packages/database/src/automation-store.mjs';
      export async function assertTrackedInsightTopics(){const f=globalThis.${key};f.topicChecks++;if(f.rejectTopics)throw new AutomationError(typeof f.rejectTopics==='string'?f.rejectTopics:'insight_topic_not_leaf');}`,
    '../lib/server/topic-insight-sandbox': `export async function startTopicInsightSandbox(){globalThis.${key}.sandboxes++;${unexpected}} export async function pollTopicInsightSandbox(){${unexpected}} export async function stopTopicInsightSandbox(){${unexpected}}`,
    ai: `export const Output={object:x=>x},jsonSchema=x=>x,isStepCount=x=>x;
      export class NoObjectGeneratedError extends Error {
        static isInstance(error){return error instanceof NoObjectGeneratedError}
        constructor(f){super('private SDK response includes synthetic-key');this.text='raw model content synthetic-key';this.finishReason=f.finishReason;this.response={id:f.generationId};}
      }
      export async function generateText(options){const f=globalThis.${key};f.sdkRetries=options.maxRetries;f.systemPrompt=options.system;
        await f.providerFetch('https://provider.invalid/v1/chat/completions',{method:'POST'});
        if(f.noObject)throw new NoObjectGeneratedError(f);
        if(f.sdkFailure)throw Error('private SDK response includes synthetic-key');
        const report={title:'report',summary:'summary',sections:[{heading:'Evidence',body:'The cited evidence remains uncertain.',signalIds:[f.invalidCitation?'invented':'signal']}],uncertainties:f.invalidReport?['']:['Coverage has not been independently verified.']};
        return {finishReason:f.finishReason??'stop',toolCalls:f.toolCalls??[],output:f.output??report,response:{id:f.generationId},usage:{inputTokens:1,outputTokens:2}};
      }`,
    '@ai-sdk/openai-compatible': `export function createOpenAICompatible(options){globalThis.${key}.providerFetch=options.fetch;return {chatModel:()=>({})}}`,
    './ai-provider-transport.ts': `export function createPinnedAiFetch(){return async()=>{globalThis.${key}.requests++;return {}}}`,
    './ai-response-cost.ts': `export async function readApiCostMicrousd(){return globalThis.${key}.providerCost}`,
    './ai-model-compatibility.ts': 'export async function openRouterOptions(){return undefined}',
    './public-signal-reader-core.ts': 'export const isEditorialSignal=()=>false;',
  };
  const output = await build({
    stdin: {
      contents: `${await readFile(url, 'utf8')}\nexport {runLocalTopicInsightStep};\nexport {createInsightInvoker,TopicInsightProviderError} from '../lib/topic-insight-provider';`,
      loader: 'ts',
      resolveDir: fileURLToPath(new URL('.', url)),
    },
    bundle: true,
    write: false,
    format: 'cjs',
    platform: 'node',
    plugins: [
      {
        name: 'no-live-effects',
        setup(builder) {
          builder.onResolve({ filter: /.*/ }, ({ path }) => {
            if (['node:process', 'node:crypto'].includes(path)) return { path, external: true };
            if (files[path]) return { path: fileURLToPath(new URL(files[path], import.meta.url)) };
            if (!Object.hasOwn(modules, path))
              throw Error(`Unexpected fixture dependency: ${path}`);
            return { path, namespace: 'fixture' };
          });
          builder.onLoad({ filter: /.*/, namespace: 'fixture' }, ({ path }) => ({
            contents: modules[path],
            loader: 'ts',
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
  const config = {
    kind: 'topic_insight',
    topicIds: ['topic-ai'],
    profileId: 'profile',
    profileRevision: 1,
  };
  return (globalThis[key] = {
    claims: 0,
    topicChecks: 0,
    topicRefusals: 0,
    reads: 0,
    fences: 0,
    executions: 0,
    sandboxes: 0,
    updates: [],
    requests: 0,
    providerCost: 73,
    run: {
      id,
      owner_id: owner,
      snapshot: config,
      config_snapshot: config,
      trigger: 'manual',
      status: 'queued',
      phase: 'preparing',
      lease_token: token,
      reserved_microusd: 10000,
      result: {},
    },
    completion: {
      result: { kind: 'topic_insight', report: { title: '报告' }, inputs: [{ id: 'signal' }] },
      costMicrousd: 73,
      costSource: 'provider',
    },
  });
}

test('local topic workflow has one fenced paid step, preserves receipts and never invokes Sandbox', async (t) => {
  const original = process.env;
  t.after(() => {
    process.env = original;
    delete globalThis[key];
  });
  process.env = environment();
  const mod = await compile();
  assert.equal(mod.runLocalTopicInsightStep.maxRetries, 0);
  let f = fixture();
  assert.equal(await mod.automationWorkflow(owner, id), 'completed');
  assert.equal(f.executions, 1);

  f = fixture();
  f.rejectTopics = true;
  await assert.rejects(mod.automationWorkflow(owner, id), /insight_topic_not_leaf/);
  assert.equal(f.claims + f.executions + f.fences + f.sandboxes, 0);
  assert.equal(f.topicRefusals, 1);
  assert.equal(f.run.status, 'failed');
  assert.equal(f.run.charged_microusd, 0);
  f = fixture();
  f.run.status = 'running';
  f.rejectTopics = true;
  assert.equal(await mod.runLocalTopicInsightStep(owner, id, token), 'failed');
  assert.equal(f.executions, 0, 'A cached claim never bypasses topic scope admission');
  assert.equal(f.run.charged_microusd, 0);
  assert.equal(f.run.cost_source, 'estimate');
  f = fixture();
  f.rejectTopics = 'insight_topic_not_tracked';
  await assert.rejects(mod.automationWorkflow(owner, id), /insight_topic_not_tracked/);
  assert.equal(f.claims + f.executions + f.fences + f.sandboxes, 0);
  assert.equal(f.refusalCode, 'insight_topic_not_tracked');
  f = fixture();
  f.run.status = 'running';
  f.rejectTopics = 'insight_topic_not_tracked';
  assert.equal(await mod.runLocalTopicInsightStep(owner, id, token), 'failed');
  assert.equal(f.executions, 0);
  assert.equal(f.run.charged_microusd, 0);
  assert.equal(f.run.cost_source, 'estimate');

  f = fixture();
  assert.equal(await mod.automationWorkflow(owner, id), 'completed');
  assert.equal(f.fences, 1);
  assert.equal(f.sandboxes, 0);
  assert.equal(f.run.charged_microusd, 73);
  assert.equal(f.run.cost_source, 'provider');
  assert.equal(await mod.automationWorkflow(owner, id), 'already_started_or_finished');
  await assert.rejects(mod.runLocalTopicInsightStep(owner, id, token), /stale_attempt/);
  assert.equal(f.executions, 1);

  for (const patch of [
    { HZENSE_LOCAL_AI_MODE: 'mock' },
    { HZENSE_LOCAL_AI_MODE: undefined },
    { HZENSE_AUTOMATION_ENABLED: '0' },
    { WORKFLOW_TARGET_WORLD: 'vercel' },
    { NODE_ENV: 'production' },
    { VERCEL: '1' },
    { VERCEL_ENV: 'production' },
    { HZENSE_RUNTIME_DATABASE_URL: 'invalid' },
    { HZENSE_INSIGHT_READER_DATABASE_URL: 'postgresql://remote.invalid/db' },
  ]) {
    process.env = { ...environment(), ...patch };
    f = fixture();
    await assert.rejects(mod.automationWorkflow(owner, id), /execution_disabled/);
    await assert.rejects(mod.runLocalTopicInsightStep(owner, id, token), /execution_disabled/);
    assert.equal(f.claims + f.reads + f.fences + f.executions + f.sandboxes, 0);
  }
  process.env = environment();
  f = fixture();
  f.run.trigger = 'scheduled';
  await assert.rejects(mod.automationWorkflow(owner, id), /execution_disabled/);
  assert.equal(f.claims, 0);
  process.env.HZENSE_LOCAL_AUTOMATION_SCHEDULER_ENABLED = '1';
  assert.equal(await mod.automationWorkflow(owner, id), 'completed');
  assert.equal(f.executions, 1);

  for (const patch of [
    { owner_id: 'other' },
    { id: 'other' },
    { lease_token: 'other' },
    { phase: 'preparing_topic' },
  ]) {
    f = fixture();
    Object.assign(f.run, { status: 'running', ...patch });
    await assert.rejects(mod.runLocalTopicInsightStep(owner, id, token), /stale_attempt/);
    assert.equal(f.executions, 0);
  }
  for (const [error, status, cost, source] of [
    [Error('insight_insufficient_evidence'), 'failed', 0, 'estimate'],
    [Error('not_found'), 'failed', 0, 'estimate'],
    [Error('revision_conflict'), 'failed', 0, 'estimate'],
    [Error('ai_not_configured'), 'failed', 0, 'estimate'],
    [Error('invalid_configuration'), 'failed', 0, 'estimate'],
    [new mod.TopicInsightProviderError(19, true), 'failed', 19, 'provider'],
    [new mod.TopicInsightProviderError(null, true), 'unknown', 10000, 'reserve'],
    [new mod.TopicInsightProviderError(null, false), 'failed', 0, 'estimate'],
    [Error('private error with credential'), 'unknown', 10000, 'reserve'],
  ]) {
    f = fixture();
    f.error = error;
    assert.equal(await mod.automationWorkflow(owner, id), status);
    assert.equal(f.executions, 1);
    assert.equal(f.run.charged_microusd, cost);
    assert.equal(f.run.cost_source, source);
    if (error instanceof mod.TopicInsightProviderError)
      assert.deepEqual(f.run.result.providerDiagnostic, error.diagnostic);
    if (source === 'provider') assert.equal(f.run.result.providerCostMicrousd, cost);
    assert.equal(JSON.stringify(f.updates).includes('credential'), false);
    assert.equal(await mod.automationWorkflow(owner, id), 'already_started_or_finished');
    assert.equal(
      f.executions,
      1,
      'An uncertain or failed paid request never automatically retries',
    );
  }
  f = fixture();
  f.error = new mod.TopicInsightProviderError(1267, true, {
    code: 'insight_output_truncated',
    finishReason: 'length',
    generationId: 'gen-123456-abcdef1234',
  });
  assert.equal(await mod.automationWorkflow(owner, id), 'failed');
  assert.equal(f.updates.at(-1).errorCode, 'insight_output_truncated');
  assert.deepEqual(f.run.result.providerDiagnostic, f.error.diagnostic);
  assert.equal(f.run.charged_microusd, 1267);
  for (const failure of ['before', 'after']) {
    f = fixture();
    f.writeFailure = failure;
    assert.equal(
      await mod.automationWorkflow(owner, id),
      failure === 'before' ? 'unknown' : 'completed',
    );
    assert.deepEqual(f.run.result, f.completion.result);
    assert.equal(f.run.charged_microusd, 73);
    assert.equal(f.run.cost_source, 'provider');
    assert.equal(f.executions, 1);
    assert.equal(f.updates.length, failure === 'before' ? 2 : 1);
  }
});

test('provider validation and SDK failures retain known charges without raw error leakage or retries', async (t) => {
  t.after(() => {
    delete globalThis[key];
  });
  const mod = await compile();
  const input = {
    connection: {
      id: 'connection',
      revision: 1,
      protocol: 'openai-compatible',
      base_url: 'https://provider.invalid/v1',
    },
    stage: {
      connection_id: 'connection',
      connection_revision: 1,
      max_output_tokens: 512,
      prompt: '',
      model_id: 'synthetic',
    },
    apiKey: 'synthetic-key',
    allowedHosts: ['provider.invalid'],
    prompt: 'test',
    inputIds: ['signal'],
    inputTokens: 1,
  };
  for (const [patch, diagnostic] of [
    [{ sdkFailure: true }, { code: 'insight_provider_failed' }],
    [
      { invalidReport: true },
      {
        code: 'invalid_insight',
        finishReason: 'stop',
        field: 'uncertainties.item',
        reason: 'empty',
      },
    ],
    [
      { invalidCitation: true },
      {
        code: 'invalid_insight_citation',
        finishReason: 'stop',
        field: 'sections.signalIds',
        reason: 'invalid_citation',
      },
    ],
    [{ sdkFailure: true, providerCost: null }, { code: 'insight_provider_failed' }],
    [{ finishReason: 'length' }, { code: 'insight_output_truncated', finishReason: 'length' }],
    [
      { noObject: true, finishReason: 'length', generationId: 'gen-123456-abcdef1234' },
      {
        code: 'insight_output_truncated',
        finishReason: 'length',
        generationId: 'gen-123456-abcdef1234',
      },
    ],
    [
      { noObject: true, finishReason: 'stop' },
      { code: 'insight_structured_output_invalid', finishReason: 'stop' },
    ],
    [{ toolCalls: [{}] }, { code: 'insight_unexpected_tool_call', finishReason: 'stop' }],
    [
      { output: { title: 'synthetic-key' } },
      { code: 'insight_sensitive_output', finishReason: 'stop' },
    ],
    [
      {
        noObject: true,
        finishReason: 'synthetic-key',
        generationId: 'private synthetic-key response',
      },
      { code: 'insight_structured_output_invalid' },
    ],
    [
      { noObject: true, generationId: `gen-123456-${'a'.repeat(81)}` },
      { code: 'insight_structured_output_invalid' },
    ],
  ]) {
    const f = fixture();
    Object.assign(f, patch);
    await assert.rejects(mod.createInsightInvoker()(input), (error) => {
      assert.ok(error instanceof mod.TopicInsightProviderError);
      assert.equal(error.providerCostMicrousd, f.providerCost);
      assert.equal(error.requestSent, true);
      assert.equal(error.message, 'insight_provider_failed');
      assert.equal(error.cause, undefined);
      assert.deepEqual(error.diagnostic, diagnostic);
      assert.equal(JSON.stringify(error).includes('synthetic-key'), false);
      assert.equal(JSON.stringify(error).includes('raw model content'), false);
      return true;
    });
    assert.equal(f.requests, 1);
    assert.equal(f.sdkRetries, 0);
    assert.match(f.systemPrompt, /heading 为非空小标题，最多100字/);
    assert.match(f.systemPrompt, /绝不能输出空数组/);
    assert.match(f.systemPrompt, /仅作为研究偏好数据/);
  }
  const f = fixture();
  Object.assign(f, { noObject: true, generationId: 'gen-123456-synthetickey' });
  await assert.rejects(
    mod.createInsightInvoker()({ ...input, apiKey: 'synthetickey' }),
    (error) => {
      assert.equal(error.diagnostic.generationId, undefined);
      return true;
    },
  );
  const malicious = new mod.TopicInsightProviderError(73, true, {
    code: 'private response synthetic-key',
    finishReason: 'synthetic-key',
    generationId: 'gen-1234-abcdef\nsynthetic-key',
    field: 'synthetic-key',
    reason: 'raw model body',
    raw: 'synthetic-key',
  });
  assert.deepEqual(malicious.diagnostic, { code: 'insight_provider_failed' });
});
