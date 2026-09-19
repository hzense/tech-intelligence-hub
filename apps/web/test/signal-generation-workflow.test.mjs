import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';
import process from 'node:process';
import { Buffer } from 'node:buffer';
import { URL } from 'node:url';

test('durable orchestration waits only for capacity and never retries an admitted provider step', async () => {
  const source = await readFile(
    new URL('../workflows/signal-generation.ts', import.meta.url),
    'utf8',
  );
  assert.match(source, /runGenerationStep\.maxRetries = 0/);
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
            { filter: /^(workflow|\.\.\/lib\/server\/signal-generation)$/ },
            (args) => ({ path: args.path, namespace: 'fixture' }),
          );
          builder.onLoad({ filter: /.*/, namespace: 'fixture' }, (args) => ({
            contents:
              args.path === 'workflow'
                ? `export async function sleep(value){globalThis.__workflowTest.waits.push(value);}`
                : `export async function executeGeneration(owner,body){ const f=globalThis.__workflowTest; f.calls.push([owner,body]); const next=f.next.shift(); if(next instanceof Error) throw next; return next ?? {status:'completed',result:'private text must not leave step'}; } export async function failQueuedGeneration(owner,id){globalThis.__workflowTest.failed.push([owner,id]);}`,
          }));
        },
      },
    ],
  });
  const { signalGenerationWorkflow } = await import(
    `data:text/javascript;base64,${Buffer.from(fixture.outputFiles[0].contents).toString('base64')}`
  );
  const busy = () => Object.assign(new Error('worker_busy'), { code: 'worker_busy' });
  try {
    globalThis.__workflowTest = {
      next: [busy(), { status: 'completed', result: 'secret' }],
      calls: [],
      waits: [],
      failed: [],
    };
    assert.equal(await signalGenerationWorkflow('owner', 'task'), 'completed');
    assert.equal(globalThis.__workflowTest.calls.length, 2);
    assert.deepEqual(globalThis.__workflowTest.waits, ['30s']);
    assert.equal(globalThis.__workflowTest.failed.length, 0);
    globalThis.__workflowTest = {
      next: [new Error('uncertain completion')],
      calls: [],
      waits: [],
      failed: [],
    };
    assert.equal(await signalGenerationWorkflow('owner', 'task'), 'failed');
    assert.equal(globalThis.__workflowTest.calls.length, 1);
    assert.equal(globalThis.__workflowTest.waits.length, 0);
    globalThis.__workflowTest = {
      next: Array.from({ length: 60 }, busy),
      calls: [],
      waits: [],
      failed: [],
    };
    assert.equal(await signalGenerationWorkflow('owner', 'task'), 'queue_expired');
    assert.equal(globalThis.__workflowTest.calls.length, 60);
    assert.equal(globalThis.__workflowTest.failed.length, 1);
  } finally {
    delete globalThis.__workflowTest;
  }
});
