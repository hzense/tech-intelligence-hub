import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';
import { fileURLToPath, URL } from 'node:url';
import { build } from 'esbuild';

const key = '__topicWorkerAccounting';

async function compile() {
  const modules = {
    'node:fs/promises': `export async function readFile(){return JSON.stringify({owner:'owner',id:'run',env:{}})} export async function unlink(){}`,
    '../lib/server/automation-store-access': 'export const automationPool={};',
    '../../../packages/database/src/automation-store.mjs': `
      export async function readAutomationRun(){return {status:'running',snapshot:{kind:'topic_insight'},lease_token:'lease'}}
      export async function updateAutomationRun(args){const f=globalThis.${key};f.updates.push(args);if(args.status==='completed'&&f.commitError)throw Error(f.commitError);}`,
    '../lib/server/topic-insight-executor': `export async function executeTopicInsight(){const f=globalThis.${key};f.executions++;if(f.executionError)throw Error(f.executionError);return {result:{report:{title:'report'}},costMicrousd:73,costSource:'provider'}}`,
  };
  const output = await build({
    entryPoints: [fileURLToPath(new URL('../workers/topic-insight.ts', import.meta.url))],
    bundle: true,
    write: false,
    platform: 'node',
    format: 'cjs',
    plugins: [
      {
        name: 'worker-no-effects',
        setup(builder) {
          builder.onResolve({ filter: /.*/ }, ({ path }) =>
            Object.hasOwn(modules, path) ? { path, namespace: 'fixture' } : undefined,
          );
          builder.onLoad({ filter: /.*/, namespace: 'fixture' }, ({ path }) => ({
            contents: modules[path],
            loader: 'js',
          }));
        },
      },
    ],
  });
  return async (patch = {}) => {
    const state = (globalThis[key] = { updates: [], executions: 0, ...patch });
    await new Promise((resolve, reject) => {
      const process = {
        env: {},
        exit(code) {
          if (code === 0) resolve();
          else reject(Error(`Worker exit ${code}`));
        },
      };
      const module = { exports: {} };
      new Function('require', 'module', 'exports', 'process', output.outputFiles[0].text)(
        createRequire(import.meta.url),
        module,
        module.exports,
        process,
      );
    });
    return state;
  };
}

test('cloud insight worker charges zero for explicit scope/evidence refusal and preserves ambiguous post-call reserve', async (t) => {
  t.after(() => delete globalThis[key]);
  const run = await compile();
  for (const executionError of [
    'insight_topic_not_leaf',
    'insight_topic_not_tracked',
    'insight_insufficient_evidence',
  ]) {
    const f = await run({ executionError });
    assert.equal(f.executions, 1);
    assert.equal(f.updates.length, 1);
    assert.equal(f.updates[0].status, 'failed');
    assert.equal(f.updates[0].errorCode, executionError);
    assert.equal(f.updates[0].costMicrousd, 0);
    assert.equal(f.updates[0].costSource, 'estimate');
  }
  for (const commitError of [
    'database_unavailable',
    'insight_topic_not_leaf',
    'insight_topic_not_tracked',
    'insight_insufficient_evidence',
  ]) {
    const f = await run({ commitError });
    assert.equal(f.updates.length, 2);
    assert.equal(f.updates[0].costMicrousd, 73);
    assert.equal(f.updates[0].costSource, 'provider');
    assert.equal(f.updates[1].status, 'unknown');
    assert.equal(f.updates[1].costSource, 'reserve');
    assert.equal(
      Object.hasOwn(f.updates[1], 'costMicrousd'),
      false,
      'A failed completion acknowledgement must never be charged zero',
    );
  }
  const unknown = await run({ executionError: 'database_unavailable' });
  assert.equal(unknown.updates[0].status, 'unknown');
  assert.equal(unknown.updates[0].costSource, 'reserve');
});
