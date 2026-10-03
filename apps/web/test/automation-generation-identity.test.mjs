import test from 'node:test';
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { readFile } from 'node:fs/promises';
import { fileURLToPath, URL } from 'node:url';
import { build } from 'esbuild';
import { automationStableId } from '../../../packages/database/src/automation-contract.mjs';
import { aiUuid } from '../../../packages/database/src/ai-config-contract.mjs';
import { signalGenerationSourceHash } from '../../../packages/database/src/signal-generation-store.mjs';
import { parseImportOutput } from '../../../packages/ingestion/src/import-task-contract.mjs';
import { buildGenerationSource } from '../../../packages/ingestion/src/signal-generation-contract.mjs';
import { createGenerationExecutor, GenerationError } from '../lib/signal-generation-core.ts';
import { createGenerationHandler } from '../lib/admin-signal-generation-handler.ts';
import { createGenerationSourceInspector } from '../lib/signal-generation-source-inspection.ts';
import {
  generationRecordId,
  GenerationRecordIdError,
  isGenerationRecordId,
} from '../lib/signal-generation-id.ts';

const { Request, structuredClone } = globalThis;
const owner = 'synthetic-identity-owner';
const runId = '07cdf704-3632-4a41-821c-e79445ca0374';
const batchId = 'bcab3ce0-72b6-bc06-5db3-c001841601de';
const itemId = '11111111-1111-4111-8111-111111111111';
const generationId = automationStableId({ runId, itemId, kind: 'generation' });
const profileId = '22222222-2222-4222-8222-222222222222';
const connectionId = '33333333-3333-4333-8333-333333333333';
const output = parseImportOutput({
  fragments: [
    { text: 'Synthetic source for identifier compatibility.', locator: { paragraph: 1 } },
  ],
});
const source = buildGenerationSource(output);
const connection = {
  id: connectionId,
  revision: 1,
  protocol: 'openai-compatible',
  base_url: 'https://provider.example.com/v1',
  settings: {
    timeout_ms: 3000,
    max_concurrency: 1,
    daily_budget_microusd: 1000000,
    input_price_microusd_per_million: 1000000,
    output_price_microusd_per_million: 2000000,
  },
};
const stage = {
  connection_id: connectionId,
  connection_revision: 1,
  model_id: 'synthetic/model',
  prompt: 'Extract private candidates.',
  temperature: 0.7,
  max_output_tokens: 1000,
  require_tools: false,
};
const profile = {
  id: profileId,
  revision: 1,
  name: 'Synthetic profile',
  stages: { extract: stage, verify: stage, analyze: stage },
  created_at: '2026-10-03T00:00:00.000Z',
  updated_at: '2026-10-03T00:00:00.000Z',
  readiness: { ready: true, reasons: [] },
};
const createBody = (changes = {}) => ({
  action: 'create',
  id: generationId,
  batchId,
  itemId,
  profileId,
  profileRevision: 1,
  consent: true,
  ...changes,
});
const post = (body, headers = {}) =>
  new Request('https://hzense.com/api/admin/signal-generation', {
    method: 'POST',
    headers: {
      host: 'hzense.com',
      origin: 'https://hzense.com',
      'content-type': 'application/json',
      ...headers,
    },
    body: JSON.stringify(body),
  });

function fixture() {
  const f = {
    rows: new Map(),
    sourceReads: [],
    accessReads: [],
    creates: [],
    enqueues: [],
    deletions: [],
    finishes: [],
    providerCalls: 0,
    sourceFence: 7,
    sourceOwner: owner,
    claimAllowed: false,
  };
  const read = (requestOwner, id) => {
    const row = f.rows.get(id);
    if (!row || row.owner_id !== requestOwner) throw new GenerationError('not_found');
    return row;
  };
  const deps = {
    topics: async () => [],
    source: async (requestOwner, requestedBatch, requestedItem, options) => {
      f.sourceReads.push({
        owner: requestOwner,
        batchId: requestedBatch,
        itemId: requestedItem,
        options,
      });
      if (requestOwner !== f.sourceOwner) throw new GenerationError('not_found');
      assert.equal(requestedBatch, batchId);
      assert.equal(requestedItem, itemId);
      return { fence: f.sourceFence, output: structuredClone(output) };
    },
    access: async (id, revision, credentials) => {
      f.accessReads.push({ id, revision, credentials });
      assert.equal(id, profileId);
      assert.equal(revision, 1);
      assert.notEqual(credentials, true, 'these identity checks must never fetch provider keys');
      return structuredClone({ profile, connection });
    },
    create: async (requestOwner, args) => {
      f.creates.push(structuredClone({ owner: requestOwner, ...args }));
      const request = args.request;
      const row = {
        id: request.id,
        owner_id: requestOwner,
        batch_id: request.batchId,
        item_id: request.itemId,
        profile_id: request.profileId,
        profile_revision: request.profileRevision,
        source_fence: request.sourceFence,
        source_hash: request.sourceHash,
        generation_version: `private-candidate-v1${args.retryOf ? `/retry/${args.retryOf}` : ''}`,
        snapshot: args.snapshot,
        status: 'pending',
        progress_phase: 'created',
        lease_token: null,
        lease_until: null,
        reserved_microusd: args.reserveMicrousd,
        charged_microusd: 0,
        result: null,
        error_code: null,
        created_at: '2026-10-03T00:00:00.000Z',
        finished_at: null,
      };
      f.rows.set(row.id, row);
      return structuredClone(row);
    },
    get: async (requestOwner, id) => structuredClone(read(requestOwner, id)),
    claim: async (requestOwner, id) => {
      const row = read(requestOwner, id);
      if (f.claimAllowed) {
        row.status = 'running';
        row.lease_token = 'synthetic-lease';
      }
      return { claimed: f.claimAllowed, run: structuredClone(row) };
    },
    finish: async (requestOwner, args) => {
      f.finishes.push(structuredClone(args));
      const row = read(requestOwner, args.id);
      assert.equal(args.token, row.lease_token);
      Object.assign(row, { status: args.outcome, error_code: args.errorCode, lease_token: null });
      return structuredClone(row);
    },
    cancel: async (requestOwner, id) => {
      const row = read(requestOwner, id);
      row.status = 'cancelled';
      return structuredClone(row);
    },
    invoke: async () => {
      f.providerCalls++;
      assert.fail('identifier compatibility never authorizes a provider call');
    },
    allowedHosts: ['provider.example.com'],
  };
  f.execute = createGenerationExecutor(deps);
  f.inspect = createGenerationSourceInspector(deps.source);
  f.queue = async (requestOwner, id) => {
    const row = read(requestOwner, id);
    f.enqueues.push({ owner: requestOwner, id });
    row.progress_phase = 'queued';
    row.progress_at = '2026-10-03T00:00:00.123Z';
    return structuredClone(row);
  };
  f.handler = createGenerationHandler({
    session: async () => ({ user: { id: owner } }),
    origin: () => 'https://hzense.com',
    dashboard: async () => ({ runs: [] }),
    execute: f.execute,
    inspectSource: f.inspect,
    detail: (requestOwner, id) => f.execute(requestOwner, { action: 'detail', id }),
    enqueue: f.queue,
    delete: async (requestOwner, id) => {
      read(requestOwner, id);
      f.deletions.push({ owner: requestOwner, id });
      return { id, deleted: true };
    },
  });
  return f;
}

test('automation record IDs preserve the stored hash without changing AI configuration UUID rules', () => {
  assert.equal(automationStableId({ runId, kind: 'import' }), batchId);
  assert.equal(generationRecordId(batchId), batchId);
  assert.equal(generationRecordId(batchId.toUpperCase()), batchId);
  assert.equal(generationRecordId(generationId), generationId);
  for (const value of [
    batchId,
    generationId,
    '00000000-0000-0000-0000-000000000000',
    'ffffffff-ffff-ffff-ffff-ffffffffffff',
  ]) {
    assert.equal(isGenerationRecordId(value), true);
    assert.equal(generationRecordId(value.toUpperCase()), value);
  }
  assert.throws(() => aiUuid(batchId), { code: 'invalid_request' });
  assert.equal(aiUuid(profileId), profileId);
  assert.equal(aiUuid(connectionId), connectionId);
  for (const value of [
    null,
    undefined,
    true,
    123,
    {},
    [],
    '',
    'arbitrary',
    batchId.replaceAll('-', ''),
    `{${batchId}}`,
    ` ${batchId}`,
    `${batchId}\n`,
    `${batchId}0`,
    batchId.replace('b', 'g'),
  ]) {
    assert.equal(isGenerationRecordId(value), false);
    assert.throws(() => generationRecordId(value), GenerationRecordIdError);
    assert.throws(() => generationRecordId(value), { code: 'invalid_request' });
  }
});

test('real generation creation accepts persisted automation IDs while preserving owner, source fence and no-AI semantics', async () => {
  const f = fixture();
  const dto = await f.execute(
    owner,
    createBody({
      id: generationId.toUpperCase(),
      batchId: batchId.toUpperCase(),
      itemId: itemId.toUpperCase(),
      retryOf: batchId.toUpperCase(),
    }),
  );
  assert.equal(dto.id, generationId);
  assert.equal(dto.batch_id, batchId);
  assert.equal(dto.retry_of, batchId);
  assert.equal(dto.status, 'pending');
  assert.deepEqual(f.sourceReads, [
    { owner, batchId, itemId, options: { requireCanonical: true } },
  ]);
  assert.deepEqual(f.creates[0].request, {
    id: generationId,
    batchId,
    itemId,
    sourceFence: 7,
    sourceHash: signalGenerationSourceHash(source),
    profileId,
    profileRevision: 1,
  });
  assert.equal(f.creates[0].owner, owner);
  assert.equal(f.creates[0].retryOf, batchId);
  assert.ok(f.creates[0].reserveMicrousd > 0);
  assert.equal(f.accessReads.length, 1);
  assert.equal(f.providerCalls, 0);
  assert.equal(f.enqueues.length, 0);
  assert.equal(
    (await f.execute(owner, { action: 'run', id: generationId.toUpperCase() })).id,
    generationId,
  );
  assert.equal(f.providerCalls, 0, 'a declined admission remains authoritative for hash IDs');
  f.claimAllowed = true;
  f.sourceFence++;
  assert.equal((await f.execute(owner, { action: 'run', id: generationId })).status, 'failed');
  assert.equal(f.finishes[0].errorCode, 'preflight_failed');
  assert.equal(f.accessReads.length, 1, 'a changed source fence prevents credential access');
  assert.equal(f.sourceReads.length, 2);
  assert.equal(
    f.providerCalls,
    0,
    'a changed source fence blocks execution before provider access',
  );
});

test('record compatibility does not relax creation consent, fields, profile identity or source ownership', async () => {
  const f = fixture();
  for (const changes of [
    { id: 'invalid' },
    { batchId: 'invalid' },
    { itemId: 'invalid' },
    { retryOf: 'invalid' },
    { profileId: batchId },
    { profileRevision: 0 },
    { consent: false },
    { owner: 'other-admin' },
    { text: 'injected source' },
  ]) {
    const response = await f.handler(post(createBody(changes)));
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { error: 'invalid_request' });
  }
  assert.equal(f.sourceReads.length, 0);
  assert.equal(f.creates.length, 0);
  assert.equal(f.providerCalls, 0);
  f.sourceOwner = 'another-admin';
  assert.equal((await f.handler(post(createBody()))).status, 404);
  assert.equal((await f.handler(post({ action: 'inspect_source', batchId, itemId }))).status, 404);
  assert.equal(f.creates.length, 0);
  assert.equal(f.accessReads.length, 0);
  assert.equal(f.providerCalls, 0);
});

test('real HTTP create, inspect, detail, queue and delete routes keep deterministic record IDs and never invoke AI', async () => {
  const f = fixture();
  let response = await f.handler(post(createBody()));
  assert.equal(response.status, 200);
  assert.equal((await response.json()).run.id, generationId);
  response = await f.handler(
    post({ action: 'inspect_source', batchId: batchId.toUpperCase(), itemId }),
  );
  assert.equal(response.status, 200);
  assert.match(response.headers.get('cache-control'), /no-store/);
  const inspection = (await response.json()).inspection;
  assert.equal(inspection.batchId, batchId);
  assert.equal(inspection.itemId, itemId);
  assert.equal(inspection.fence, 7);
  assert.equal(inspection.ready, true);
  assert.equal(JSON.stringify(inspection).includes('Synthetic source'), false);
  for (const request of [
    new Request(`https://hzense.com/api/admin/signal-generation?id=${generationId.toUpperCase()}`, {
      headers: { host: 'hzense.com' },
    }),
    post({ action: 'detail', id: generationId.toUpperCase() }),
  ]) {
    response = await f.handler(request);
    assert.equal(response.status, 200);
    assert.equal((await response.json()).run.id, generationId);
  }
  response = await f.handler(post({ action: 'run', id: generationId.toUpperCase() }));
  assert.equal(response.status, 202);
  assert.equal((await response.json()).run.id, generationId);
  assert.deepEqual(f.enqueues, [{ owner, id: generationId }]);
  response = await f.handler(post({ action: 'delete', id: generationId.toUpperCase() }));
  assert.equal(response.status, 200);
  assert.deepEqual(f.deletions, [{ owner, id: generationId }]);
  for (const action of ['detail', 'run', 'delete']) {
    response = await f.handler(post({ action, id: 'malformed-record-id' }));
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { error: 'invalid_request' });
  }
  response = await f.handler(
    new Request('https://hzense.com/api/admin/signal-generation?id=malformed', {
      headers: { host: 'hzense.com' },
    }),
  );
  assert.equal(response.status, 400);
  for (const changes of [
    { batchId: 'malformed' },
    { itemId: 'malformed' },
    { owner: 'injected' },
    { text: 'injected' },
  ]) {
    response = await f.handler(post({ action: 'inspect_source', batchId, itemId, ...changes }));
    assert.equal(response.status, 400);
  }
  assert.equal(
    (
      await f.handler(
        post({ action: 'run', id: generationId }, { origin: 'https://other.example.com' }),
      )
    ).status,
    403,
  );
  assert.equal(f.enqueues.length, 1);
  assert.equal(f.deletions.length, 1);
  assert.equal(f.creates.length, 1);
  assert.equal(f.providerCalls, 0);
});

test('real automation workflow carries its unchanged hash IDs through the real generation executor', async () => {
  const workflowUrl = new URL('../workflows/automation.ts', import.meta.url);
  const workflowSource = await readFile(workflowUrl, 'utf8');
  const adapters = {
    workflow: 'export async function sleep(){throw Error("unexpected sleep")}',
    'workflow/api':
      'export async function start(_workflow,args){globalThis.__identityWorkflow.dispatches.push(args)}',
    '../lib/server/automation':
      'export function automationLimits(){return {batch:1000000,daily:5000000,reserve:500000}}',
    '../lib/server/automation-store-access': 'export const automationPool={};',
    '../../../packages/database/src/automation-store.mjs': `
      export async function claimAutomationRun(args){const f=globalThis.__identityWorkflow;f.checkOwner(args.owner);if(f.run.status!=='queued')return null;f.run.status='running';return structuredClone(f.run)}
      export async function readAutomationRun(args){const f=globalThis.__identityWorkflow;f.checkOwner(args.owner);return structuredClone(f.run)}
      export async function updateAutomationRun(args){const f=globalThis.__identityWorkflow;f.checkOwner(args.owner);if(args.token!==f.run.lease_token)throw Error('stale_attempt');f.updates.push(structuredClone(args));f.run.result=args.result;f.run.phase=args.phase;f.run.status=args.status??f.run.status;return structuredClone(f.run)}
    `,
    '../lib/server/import-service': `
      export async function executeImportAdmin(owner,method,body){const f=globalThis.__identityWorkflow;f.checkOwner(owner);f.imports.push({method,body});return {id:body.request.id,items:[{id:f.itemId,status:'completed',kind:'url'}]}}
      export async function runImportItem(){throw Error('completed source must not be re-imported')}
    `,
    '../lib/server/signal-generation': `
      export async function executeGeneration(owner,body){return globalThis.__identityWorkflow.execute(owner,body)}
      export async function queueGeneration(owner,id){return globalThis.__identityWorkflow.queue(owner,id)}
      export async function failQueuedGeneration(){throw Error('unexpected dispatch failure')}
    `,
    './signal-generation':
      'export async function signalGenerationWorkflow(){throw Error("scheduler must not execute a worker")}',
    '../lib/server/source-discovery':
      'export async function discoverSources(){return ["https://example.com/original"]}',
    '../lib/server/topic-insight-sandbox':
      'export async function startTopicInsightSandbox(){throw Error("unused")} export async function pollTopicInsightSandbox(){} export async function stopTopicInsightSandbox(){}',
  };
  const compiled = await build({
    stdin: {
      contents: workflowSource,
      resolveDir: fileURLToPath(new URL('.', workflowUrl)),
      loader: 'ts',
    },
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'node',
    plugins: [
      {
        name: 'identity-boundary-storage-and-scheduler',
        setup(builder) {
          builder.onResolve({ filter: /.*/ }, (args) =>
            Object.hasOwn(adapters, args.path)
              ? { path: args.path, namespace: 'fixture' }
              : undefined,
          );
          builder.onLoad({ filter: /.*/, namespace: 'fixture' }, ({ path }) => ({
            contents: adapters[path],
          }));
        },
      },
    ],
  });
  const { automationWorkflow } = await import(
    `data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString('base64')}`
  );
  const f = fixture();
  const state = {
    execute: f.execute,
    queue: f.queue,
    itemId,
    imports: [],
    dispatches: [],
    updates: [],
    checkOwner: (value) => assert.equal(value, owner),
    run: {
      id: runId,
      status: 'queued',
      lease_token: 'synthetic-automation-lease',
      snapshot: { kind: 'source_collection', profileId, profileRevision: 1 },
      result: { discoveryCostMicrousd: 64200, discoveryCostSource: 'provider' },
    },
  };
  globalThis.__identityWorkflow = state;
  try {
    assert.equal(await automationWorkflow(owner, runId), 'completed');
    assert.equal(state.imports.length, 1);
    assert.equal(state.imports[0].body.request.id, batchId);
    assert.equal(f.creates.length, 1);
    assert.equal(f.creates[0].request.id, generationId);
    assert.equal(f.creates[0].request.batchId, batchId);
    assert.equal(f.creates[0].request.itemId, itemId);
    assert.equal(f.creates[0].request.sourceFence, 7);
    assert.equal(state.run.phase, 'candidate_tasks_queued');
    assert.deepEqual(state.run.result.generationIds, [generationId]);
    assert.equal(state.run.result.batchId, batchId);
    assert.equal(state.run.result.failed, 0);
    assert.deepEqual(state.dispatches, [[owner, generationId, '2026-10-03T00:00:00.123Z']]);
    assert.equal(state.updates.at(-1).costMicrousd, 64200);
    assert.equal(state.updates.at(-1).costSource, 'provider');
    assert.equal(f.providerCalls, 0);
    assert.equal(await automationWorkflow(owner, runId), 'already_started_or_finished');
    assert.equal(f.creates.length, 1);
    assert.equal(f.enqueues.length, 1);
    assert.equal(state.dispatches.length, 1);
    assert.equal(f.providerCalls, 0);
  } finally {
    delete globalThis.__identityWorkflow;
  }
});
