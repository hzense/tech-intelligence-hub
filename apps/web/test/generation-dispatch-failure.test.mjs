import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath, URL } from 'node:url';
import { Buffer } from 'node:buffer';
import { build } from 'esbuild';

const queuedAt = '2026-10-03T12:00:00.123Z';
const owner = 'synthetic-owner';

async function loadDispatchers() {
  const adapters = {
    workflow: 'export async function sleep(){}',
    'workflow/api': `export async function start(_workflow,args){return globalThis.__dispatchFailure.start(args)}`,
    '../lib/server/automation': 'export function automationLimits(){return {}}',
    '../lib/server/automation-store-access': 'export const automationPool={}',
    '../../../packages/database/src/automation-contract.mjs':
      'export function automationStableId(value){return value.itemId??"batch"}',
    '../../../packages/database/src/automation-store.mjs': `
      export async function claimAutomationRun(){const f=globalThis.__dispatchFailure;if(f.run.status!=='queued')return null;f.run.status='running';return structuredClone(f.run)}
      export async function readAutomationRun(){return structuredClone(globalThis.__dispatchFailure.run)}
      export async function updateAutomationRun(args){const f=globalThis.__dispatchFailure;f.updates.push(structuredClone(args));f.run={...f.run,result:args.result,phase:args.phase,status:args.status??f.run.status};return structuredClone(f.run)}
    `,
    '../lib/server/source-discovery':
      'export async function discoverSources(){return globalThis.__dispatchFailure.items.map(id=>`https://example.com/${id}`)}',
    '../lib/server/import-service': `
      export async function executeImportAdmin(){return {id:'batch',items:globalThis.__dispatchFailure.items.map(id=>({id,kind:'url',status:'completed'}))}}
      export async function runImportItem(){throw Error('must not import completed source')}
    `,
    generation: `
      export async function executeGeneration(_owner,body){return globalThis.__dispatchFailure.create(body.id)}
      export async function queueGeneration(owner,id){return globalThis.__dispatchFailure.queue(owner,id)}
      export async function failQueuedGeneration(owner,id,queuedAt){return globalThis.__dispatchFailure.failQueued(owner,id,queuedAt)}
      export async function resolveQueuedGeneration(){}
      export async function generationDashboard(){}
      export async function generationDetail(){}
      export async function deleteGeneration(){}
      export async function inspectGenerationInput(){}
    `,
    './signal-generation': 'export async function signalGenerationWorkflow(){}',
    '../lib/server/topic-insight-sandbox':
      'export async function startTopicInsightSandbox(){} export async function pollTopicInsightSandbox(){} export async function stopTopicInsightSandbox(){}',
    '@/lib/admin-signal-generation-handler':
      'export function createGenerationHandler(deps){return deps}',
    '@/lib/server/admin-auth': 'export async function getAdminSession(){}',
    '@/lib/admin-auth-policy': 'export function parseAdminAuthEnvironment(){}',
  };
  const aliases = {
    '../lib/server/signal-generation': 'generation',
    '@/lib/server/signal-generation': 'generation',
    '@/workflows/signal-generation': './signal-generation',
  };
  const compile = async (path, suffix = '') => {
    const url = new URL(path, import.meta.url);
    const result = await build({
      stdin: {
        contents: (await readFile(url, 'utf8')) + suffix,
        resolveDir: fileURLToPath(new URL('.', url)),
        loader: 'ts',
      },
      bundle: true,
      write: false,
      platform: 'node',
      format: 'esm',
      plugins: [
        {
          name: 'dispatch-storage-and-scheduler',
          setup(builder) {
            builder.onResolve({ filter: /.*/ }, ({ path }) => {
              const key = aliases[path] ?? path;
              return Object.hasOwn(adapters, key) ? { path: key, namespace: 'fixture' } : undefined;
            });
            builder.onLoad({ filter: /.*/, namespace: 'fixture' }, ({ path }) => ({
              contents: adapters[path],
            }));
          },
        },
      ],
    });
    return import(
      `data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`
    );
  };
  return {
    workflow: await compile('../workflows/automation.ts', '\nexport { dispatchGeneration };'),
    route: await compile('../app/api/admin/signal-generation/route.ts'),
  };
}

function fixture(items = ['first', 'second', 'third']) {
  const f = {
    items,
    rows: {},
    dispatches: [],
    cleanupCalls: [],
    queueCalls: [],
    updates: [],
    startErrors: {},
    acceptedStates: {},
    cleanupErrors: new Set(),
    run: {
      id: 'automation',
      status: 'queued',
      lease_token: 'lease',
      snapshot: { kind: 'source_collection', profileId: 'profile', profileRevision: 1 },
      result: {},
    },
    create(id) {
      f.rows[id] = { id, owner, status: 'pending', progress_phase: 'created' };
      return globalThis.structuredClone(f.rows[id]);
    },
    queue(requestOwner, id) {
      assert.equal(requestOwner, owner);
      f.queueCalls.push(id);
      f.rows[id] = { ...f.rows[id], progress_phase: 'queued', progress_at: queuedAt };
      return globalThis.structuredClone(f.rows[id]);
    },
    start(args) {
      f.dispatches.push(args);
      const id = args[1];
      if (f.acceptedStates[id]) Object.assign(f.rows[id], f.acceptedStates[id]);
      if (f.startErrors[id]) throw f.startErrors[id];
      return { runId: `workflow-${id}` };
    },
    failQueued(requestOwner, id, receipt) {
      f.cleanupCalls.push([requestOwner, id, receipt]);
      if (f.cleanupErrors.has(id)) throw Error('cleanup unavailable');
      const row = f.rows[id];
      // Mirror the existing storage contract: owner lock, exact queue receipt,
      // pending state and not deleted. The SQL fence has its own database tests.
      if (
        row.owner === requestOwner &&
        row.status === 'pending' &&
        row.progress_phase === 'queued' &&
        row.progress_at === receipt &&
        !row.deleted_at
      )
        row.status = 'failed';
    },
  };
  globalThis.__dispatchFailure = f;
  return f;
}

test('manual dispatch failure closes only its queue receipt and preserves the original error', async () => {
  const { route } = await loadDispatchers();
  try {
    for (const acceptedState of [
      {},
      { status: 'running' },
      { status: 'completed' },
      { status: 'cancelled' },
      { progress_at: '2026-10-03T12:00:01.123Z' },
      { deleted_at: '2026-10-03T12:00:01.123Z' },
    ]) {
      const f = fixture(['first']);
      f.create('first');
      const error = (f.startErrors.first = Error('scheduler acknowledgement lost'));
      f.acceptedStates.first = acceptedState;
      await assert.rejects(route.GET.enqueue(owner, 'first'), (actual) => actual === error);
      assert.deepEqual(f.dispatches, [[owner, 'first', queuedAt]]);
      assert.deepEqual(f.cleanupCalls, [[owner, 'first', queuedAt]]);
      assert.deepEqual(f.queueCalls, ['first']);
      assert.equal(
        f.rows.first.status,
        Object.keys(acceptedState).length ? (acceptedState.status ?? 'pending') : 'failed',
      );
    }
    const f = fixture(['first']);
    f.create('first');
    const original = (f.startErrors.first = Error('scheduler unavailable'));
    f.cleanupErrors.add('first');
    await assert.rejects(route.GET.enqueue(owner, 'first'), (actual) => actual === original);
    assert.equal(f.dispatches.length, 1);
    assert.equal(f.cleanupCalls.length, 1);
    assert.equal(f.rows.first.status, 'pending');
  } finally {
    delete globalThis.__dispatchFailure;
  }
});

test('automation continues dispatching persisted queues after failures without replaying start', async () => {
  const { workflow } = await loadDispatchers();
  try {
    const f = fixture();
    f.startErrors.first = Error('scheduler unavailable');
    f.startErrors.second = Error('scheduler acknowledgement lost');
    f.acceptedStates.second = { status: 'running' };
    assert.equal(await workflow.automationWorkflow(owner, f.run.id), 'completed');
    assert.deepEqual(
      f.dispatches,
      f.items.map((id) => [owner, id, queuedAt]),
    );
    assert.deepEqual(f.cleanupCalls, [
      [owner, 'first', queuedAt],
      [owner, 'second', queuedAt],
    ]);
    assert.equal(f.rows.first.status, 'failed');
    assert.equal(f.rows.second.status, 'running', 'lost acknowledgement cannot undo a claim');
    assert.equal(f.rows.third.status, 'pending');
    assert.equal(f.run.result.failed, 2);
    assert.deepEqual(f.run.result.generationIds, f.items);
    assert.equal(await workflow.automationWorkflow(owner, f.run.id), 'already_started_or_finished');
    assert.equal(f.dispatches.length, 3);
    assert.equal(f.queueCalls.length, 3);
    assert.equal(workflow.dispatchGeneration.maxRetries, 0);
  } finally {
    delete globalThis.__dispatchFailure;
  }
});

test('automation cleanup failure retains the original dispatch error and does not strand later tasks', async () => {
  const { workflow } = await loadDispatchers();
  try {
    const f = fixture();
    const original = (f.startErrors.first = Error('scheduler unavailable'));
    f.cleanupErrors.add('first');
    f.create('first');
    f.queue(owner, 'first');
    await assert.rejects(
      workflow.dispatchGeneration(owner, { id: 'first', queuedAt }),
      (actual) => actual === original,
    );
    f.dispatches.length = 0;
    f.cleanupCalls.length = 0;
    f.queueCalls.length = 0;
    assert.equal(await workflow.automationWorkflow(owner, f.run.id), 'failed');
    assert.deepEqual(
      f.dispatches,
      f.items.map((id) => [owner, id, queuedAt]),
    );
    assert.equal(f.rows.first.status, 'pending');
    assert.equal(f.run.result.failed, 1);
    assert.equal(f.run.status, 'unknown', 'unconfirmed cleanup must not report completion');
    assert.deepEqual(f.run.result.generationIds, f.items);
    assert.equal(f.queueCalls.length, 3);
    assert.equal(f.cleanupCalls.length, 1);
  } finally {
    delete globalThis.__dispatchFailure;
  }
});
