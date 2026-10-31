import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import process from 'node:process';
import test from 'node:test';
import { fileURLToPath, URL } from 'node:url';
import { build } from 'esbuild';
import { generationCost } from '../lib/signal-generation-core.ts';
import { selectInsightSignals } from '../lib/topic-insight-core.ts';

const key = '__topicInsightAccounting';
const owner = 'local:accounting';
const id = '11111111-1111-4111-8111-111111111111';
const token = '22222222-2222-4222-8222-222222222222';

async function compile({ realTopics = false } = {}) {
  const executor = new URL('../lib/server/topic-insight-executor.ts', import.meta.url);
  const provider = fileURLToPath(new URL('../lib/topic-insight-provider.ts', import.meta.url));
  const modules = {
    'server-only': '',
    './insight-topics': `export async function assertTrackedInsightTopics(){if(globalThis.${key}.rejectTopics)throw Error('insight_topic_not_leaf')}`,
    './runtime-reader': `export async function readRuntimeLeafTopics(){return globalThis.${key}.leaves}`,
    '../lib/server/insight-topics': 'export async function assertTrackedInsightTopics(){}',
    './admin-ai': `export async function aiStageAccess(){globalThis.${key}.accesses++;return globalThis.${key}.access}`,
    '../admin-ai-core':
      'export const readAiBackendConfiguration=()=>({allowedHosts:["example.com"]});',
    './task-public-signals': `export async function readTaskPublicSignals(){const f=globalThis.${key};f.signalReads++;return f.signals}`,
    '../topic-insight-core': `export const insightInput=s=>({id:s.id});
      export function selectInsightSignals(signals,ids,end){const f=globalThis.${key};f.selectionSignals=signals;return f.useRealSelection?f.selectInsightSignals(signals,ids,end):{signals:f.signals,windowStart:'2026-10-01',windowEnd:'2026-10-29'};}`,
    '../topic-insight-provider': `export {TopicInsightProviderError} from ${JSON.stringify(provider)};
      export const insightRules='synthetic rules';
      export async function invokeTopicInsight(){const f=globalThis.${key};f.calls++;return f.generated;}`,
    '../../../../packages/ingestion/src/signal-generation-contract.mjs':
      'export const estimateGenerationTokens=()=>100;',
    '../signal-generation-core': `export const generationCost=(...args)=>globalThis.${key}.generationCost(...args);`,
    './automation-store-access': `export async function freezeAutomationInputs(_owner,_id,_token,snapshot){globalThis.${key}.run.frozen_inputs=snapshot;}`,
    '../lib/local-development':
      'export const isLocalRealAutomationEnabled=()=>true,isLocalAutomationSchedulerEnabled=()=>false;',
    '../lib/server/automation-store-access': 'export const automationPool={};',
    '../lib/topic-insight-provider': `export {TopicInsightProviderError} from ${JSON.stringify(provider)};`,
    '../../../packages/database/src/automation-store.mjs': `
      export async function readAutomationRun(){return structuredClone(globalThis.${key}.run)}
      export async function beginTopicInsightExecution(){const f=globalThis.${key};if(f.run.phase!=='preparing')throw Error('stale_attempt');f.run.phase='preparing_topic';}
      export async function updateAutomationRun(args){const f=globalThis.${key};f.update=args;
        f.run={...f.run,status:args.status,result:args.result,phase:args.phase,
          charged_microusd:args.costMicrousd??f.run.reserved_microusd,cost_source:args.costSource,lease_token:null};
        return structuredClone(f.run);}
    `,
  };
  const output = await build({
    stdin: {
      contents: `export {runLocalTopicInsightStep} from ${JSON.stringify(fileURLToPath(new URL('../workflows/local-topic-insight.ts', import.meta.url)))};`,
      resolveDir: fileURLToPath(new URL('.', executor)),
      loader: 'ts',
    },
    bundle: true,
    write: false,
    format: 'cjs',
    platform: 'node',
    plugins: [
      {
        name: 'isolated-accounting',
        setup(builder) {
          builder.onResolve({ filter: /.*/ }, ({ path, importer }) => {
            if (path === provider) return { path: provider };
            if (realTopics && path === './insight-topics')
              return {
                path: fileURLToPath(new URL('../lib/server/insight-topics.ts', import.meta.url)),
              };
            if (path === '../lib/server/topic-insight-executor')
              return { path: fileURLToPath(executor) };
            // Only the executor/workflow dependencies are mocked. The diagnostic
            // error class and its validation are bundled from the actual provider.
            if (importer === provider) return undefined;
            if (Object.hasOwn(modules, path)) return { path, namespace: 'fixture' };
            return undefined;
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

function fixture(generated) {
  return (globalThis[key] = {
    generationCost,
    calls: 0,
    accesses: 0,
    signalReads: 0,
    selectInsightSignals,
    leaves: [
      { id: 'topic-ai', parentId: 'topic-parent' },
      { id: 'topic-security', parentId: 'topic-parent' },
      { id: 'topic-root', parentId: null },
    ],
    signals: [
      { id: 'a', topics: ['topic-ai'] },
      { id: 'b', topics: ['topic-ai'] },
    ],
    access: {
      profile: { stages: { analyze: { max_output_tokens: 512, prompt: '' } } },
      connection: {
        settings: {
          input_price_microusd_per_million: 1000000,
          output_price_microusd_per_million: 2000000,
        },
      },
      apiKey: 'synthetic-not-used',
    },
    generated: {
      report: { title: 'Already validated report' },
      inputTokens: 10,
      outputTokens: 2,
      providerCostMicrousd: null,
      ...generated,
    },
    run: {
      id,
      owner_id: owner,
      status: 'running',
      phase: 'preparing',
      trigger: 'manual',
      lease_token: token,
      reserved_microusd: 500000,
      created_at: '2026-10-29T12:00:00Z',
      result: null,
      snapshot: { kind: 'topic_insight' },
      config_snapshot: { profileId: 'profile', profileRevision: 1, topicIds: ['topic-ai'] },
    },
  });
}

test('topic accounting keeps provider receipts and reserves every ambiguous post-call usage failure', async (t) => {
  const previous = process.env.HZENSE_AUTOMATION_ENABLED;
  process.env.HZENSE_AUTOMATION_ENABLED = '1';
  t.after(() => {
    if (previous === undefined) delete process.env.HZENSE_AUTOMATION_ENABLED;
    else process.env.HZENSE_AUTOMATION_ENABLED = previous;
    delete globalThis[key];
  });
  const mod = await compile();
  const rejectedTopic = fixture({});
  rejectedTopic.rejectTopics = true;
  assert.equal(await mod.runLocalTopicInsightStep(owner, id, token), 'failed');
  assert.equal(rejectedTopic.calls + rejectedTopic.accesses, 0);
  assert.equal(rejectedTopic.run.charged_microusd, 0);
  assert.equal(rejectedTopic.run.frozen_inputs, undefined);
  assert.equal(rejectedTopic.update.errorCode, 'insight_topic_not_leaf');
  const missingTopicEvidence = fixture({});
  missingTopicEvidence.run.config_snapshot.topicIds.push('topic-security');
  assert.equal(await mod.runLocalTopicInsightStep(owner, id, token), 'failed');
  assert.equal(missingTopicEvidence.calls + missingTopicEvidence.accesses, 0);
  assert.equal(missingTopicEvidence.run.charged_microusd, 0);
  assert.equal(missingTopicEvidence.update.errorCode, 'insight_insufficient_evidence');
  assert.deepEqual(missingTopicEvidence.run.config_snapshot.topicIds, [
    'topic-ai',
    'topic-security',
  ]);
  const bothTopics = fixture({});
  bothTopics.run.config_snapshot.topicIds.push('topic-security');
  bothTopics.signals[1].topics = ['topic-security'];
  assert.equal(await mod.runLocalTopicInsightStep(owner, id, token), 'completed');
  assert.equal(bothTopics.calls, 1);
  assert.deepEqual(bothTopics.run.result.topicIds, ['topic-ai', 'topic-security']);
  const invalidUsage = [
    { inputTokens: -1 },
    { outputTokens: -1 },
    { inputTokens: NaN },
    { outputTokens: Infinity },
    { inputTokens: 1.5 },
    { outputTokens: Number.MAX_SAFE_INTEGER + 1 },
    { inputTokens: undefined, outputTokens: -1 },
  ];
  for (const providerCostMicrousd of [0, 73]) {
    for (const usage of invalidUsage) {
      const f = fixture({ providerCostMicrousd, ...usage });
      assert.equal(await mod.runLocalTopicInsightStep(owner, id, token), 'completed');
      assert.equal(f.calls, 1);
      assert.equal(f.run.charged_microusd, providerCostMicrousd);
      assert.equal(f.run.cost_source, 'provider');
      assert.deepEqual(f.run.result.report, f.generated.report);
    }
  }
  for (const providerCostMicrousd of [null, undefined, -1, NaN]) {
    for (const usage of invalidUsage) {
      const f = fixture({ providerCostMicrousd, ...usage });
      assert.equal(await mod.runLocalTopicInsightStep(owner, id, token), 'unknown');
      assert.equal(f.calls, 1);
      assert.equal(f.run.charged_microusd, 500000);
      assert.equal(f.run.cost_source, 'reserve');
      assert.equal(f.update.errorCode, 'outcome_unknown');
    }
  }
  const estimated = fixture({});
  assert.equal(await mod.runLocalTopicInsightStep(owner, id, token), 'completed');
  assert.equal(estimated.run.charged_microusd, 14);
  assert.equal(estimated.run.cost_source, 'estimate');

  for (const usage of [
    { inputTokens: undefined },
    { outputTokens: null },
    { inputTokens: undefined, outputTokens: undefined },
  ]) {
    const missing = fixture(usage);
    assert.equal(await mod.runLocalTopicInsightStep(owner, id, token), 'completed');
    assert.equal(missing.calls, 1);
    assert.equal(missing.run.charged_microusd, 3272);
    assert.equal(missing.run.cost_source, 'estimate');
    assert.deepEqual(missing.run.result.report, missing.generated.report);
  }

  const overflow = fixture({
    inputTokens: Number.MAX_SAFE_INTEGER,
    outputTokens: Number.MAX_SAFE_INTEGER,
  });
  assert.equal(await mod.runLocalTopicInsightStep(owner, id, token), 'unknown');
  assert.equal(overflow.calls, 1);
  assert.equal(overflow.run.charged_microusd, 500000);
  assert.equal(overflow.run.cost_source, 'reserve');
});

test('executor reuses one current public snapshot for tracked qualification and separate recent report evidence', async (t) => {
  const previous = process.env.HZENSE_AUTOMATION_ENABLED;
  process.env.HZENSE_AUTOMATION_ENABLED = '1';
  t.after(() => {
    if (previous === undefined) delete process.env.HZENSE_AUTOMATION_ENABLED;
    else process.env.HZENSE_AUTOMATION_ENABLED = previous;
    delete globalThis[key];
  });
  const mod = await compile({ realTopics: true });
  const signals = (topic, total, recent) =>
    Array.from({ length: total }, (_, i) => ({
      id: `${topic}-${i}`,
      topics: [topic, topic],
      public_version: 1,
      occurred_at: i < recent ? '2026-10-28T12:00:00Z' : '2001-01-01T00:00:00Z',
    }));
  let f = fixture({});
  f.useRealSelection = true;
  f.signals = signals('topic-ai', 9, 2);
  f.signals.push(...f.signals);
  assert.equal(await mod.runLocalTopicInsightStep(owner, id, token), 'failed');
  assert.equal(f.update.errorCode, 'insight_topic_not_tracked');
  assert.equal(f.calls + f.accesses, 0);
  assert.equal(f.run.charged_microusd, 0);
  f = fixture({});
  f.useRealSelection = true;
  f.signals = signals('topic-ai', 10, 2);
  assert.equal(await mod.runLocalTopicInsightStep(owner, id, token), 'completed');
  assert.equal(f.calls, 1);
  assert.equal(f.signalReads, 1);
  assert.equal(f.selectionSignals, f.signals);
  assert.equal(
    f.run.result.inputs.length,
    2,
    'All-time qualification does not change the report window to all-time',
  );
  f = fixture({});
  f.useRealSelection = true;
  f.signals = signals('topic-ai', 10, 0);
  assert.equal(await mod.runLocalTopicInsightStep(owner, id, token), 'failed');
  assert.equal(f.update.errorCode, 'insight_insufficient_evidence');
  assert.equal(f.calls + f.accesses, 0);
  assert.equal(f.run.charged_microusd, 0);
  f = fixture({});
  f.useRealSelection = true;
  f.run.config_snapshot.topicIds.push('topic-security');
  f.signals = [...signals('topic-ai', 10, 2), ...signals('topic-security', 10, 0)];
  assert.equal(await mod.runLocalTopicInsightStep(owner, id, token), 'failed');
  assert.equal(f.update.errorCode, 'insight_insufficient_evidence');
  assert.equal(f.calls + f.accesses, 0);
  assert.equal(f.run.charged_microusd, 0);
  f = fixture({});
  f.useRealSelection = true;
  f.run.config_snapshot.topicIds = ['topic-root'];
  f.signals = signals('topic-root', 20, 2);
  assert.equal(await mod.runLocalTopicInsightStep(owner, id, token), 'failed');
  assert.equal(f.update.errorCode, 'insight_topic_not_tracked');
  assert.equal(f.calls + f.accesses, 0);
  assert.equal(f.run.charged_microusd, 0);
});
