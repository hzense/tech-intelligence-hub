import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';
import process from 'node:process';
import { Buffer } from 'node:buffer';
import { URL } from 'node:url';

test('Turbo restores the private worker required by the Workflow output trace', async () => {
  const turbo = JSON.parse(await readFile(new URL('../../../turbo.json', import.meta.url), 'utf8'));
  const outputs = (turbo.tasks['@hzense/web#build'] ?? turbo.tasks.build).outputs;
  assert.ok(outputs.includes('.generation-worker/**'));
  assert.ok(outputs.includes('.next/**'));
  const next = await readFile(new URL('../next.config.ts', import.meta.url), 'utf8');
  assert.match(
    next,
    /'\/.well-known\/workflow\/v1\/step': \['\.\/.generation-worker\/worker.cjs'\]/,
  );
});

test('short steps poll detached work and never replay an uncertain invocation', async () => {
  const source = await readFile(
    new URL('../workflows/signal-generation.ts', import.meta.url),
    'utf8',
  );
  assert.match(source, /runGenerationStep\.maxRetries = 0/);
  assert.match(source, /pollGenerationStep\.maxRetries = 3/);
  assert.doesNotMatch(source, /executeGeneration\(/);
  const fixture = await build({
    stdin: { contents: source, loader: 'ts', resolveDir: process.cwd() },
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'node',
    plugins: [
      {
        name: 'synthetic-workflow',
        setup(builder) {
          builder.onResolve(
            { filter: /^(workflow|\.\.\/lib\/server\/(signal-generation|generation-sandbox))$/ },
            (args) => ({ path: args.path, namespace: 'fixture' }),
          );
          builder.onLoad({ filter: /.*/, namespace: 'fixture' }, (args) => ({
            contents:
              args.path === 'workflow'
                ? 'export async function sleep(value){globalThis.__workflowTest.waits.push(value);}'
                : args.path.endsWith('/signal-generation')
                  ? 'export async function failQueuedGeneration(owner,id){globalThis.__workflowTest.failed.push([owner,id]);}'
                  : "export async function startGenerationSandbox(owner,id){const f=globalThis.__workflowTest;f.calls.push([owner,id]);if(f.startError)throw new Error('secret');return f.noStart?null:{sandboxName:'sandbox',commandId:'command'};} export async function pollGenerationSandbox(handle){const f=globalThis.__workflowTest;f.polls.push(handle);const n=f.next.shift();if(n instanceof Error)throw n;return n??f.fallback??'finished';} export async function stopGenerationSandbox(handle){globalThis.__workflowTest.stops.push(handle);}",
          }));
        },
      },
    ],
  });
  const { signalGenerationWorkflow } = await import(
    'data:text/javascript;base64,' + Buffer.from(fixture.outputFiles[0].contents).toString('base64')
  );
  const setup = (extra = {}) =>
    (globalThis.__workflowTest = {
      next: [],
      calls: [],
      waits: [],
      failed: [],
      polls: [],
      stops: [],
      ...extra,
    });
  try {
    let f = setup({ next: ['running', 'running', 'finished'] });
    assert.equal(await signalGenerationWorkflow('owner', 'task'), 'finished');
    assert.equal(f.calls.length, 1);
    assert.equal(f.polls.length, 3);
    assert.equal(f.stops.length, 1);
    assert.deepEqual(f.polls[0], { sandboxName: 'sandbox', commandId: 'command' });
    f = setup({ next: ['busy', 'finished'] });
    assert.equal(await signalGenerationWorkflow('owner', 'task'), 'finished');
    assert.equal(f.calls.length, 2);
    f = setup({ next: [new Error('unknown')] });
    await assert.rejects(signalGenerationWorkflow('owner', 'task'), /unknown/);
    assert.equal(f.calls.length, 1);
    assert.equal(f.stops.length, 1);
    f = setup({ startError: true });
    await assert.rejects(signalGenerationWorkflow('owner', 'task'), /generation_dispatch_failed/);
    assert.equal(f.failed.length, 1);
    assert.equal(f.calls.length, 1);
    f = setup({ fallback: 'busy' });
    assert.equal(await signalGenerationWorkflow('owner', 'task'), 'queue_expired');
    assert.equal(f.calls.length, 60);
    assert.equal(f.failed.length, 1);
    f = setup({ fallback: 'running' });
    assert.equal(await signalGenerationWorkflow('owner', 'task'), 'running');
    assert.equal(f.calls.length, 1);
    assert.equal(f.polls.length, 64);
    assert.equal(f.stops.length, 1);
    f = setup({ noStart: true });
    assert.equal(await signalGenerationWorkflow('owner', 'task'), 'already_started_or_finished');
    assert.equal(f.polls.length, 0);
  } finally {
    delete globalThis.__workflowTest;
  }
});
