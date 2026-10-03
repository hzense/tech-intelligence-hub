import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { URL } from 'node:url';
import { Buffer } from 'node:buffer';
import { setTimeout, clearTimeout } from 'node:timers';
import { build } from 'esbuild';
import { Command } from '@vercel/sandbox';

const code = await build({
  stdin: {
    contents: await readFile(new URL('../lib/server/sandbox-command.ts', import.meta.url), 'utf8'),
    loader: 'ts',
  },
  format: 'esm',
  platform: 'node',
  write: false,
});
const { observeSandboxCommandExit } = await import(
  'data:text/javascript;base64,' + Buffer.from(code.outputFiles[0].contents).toString('base64')
);

function lookup(getCommand) {
  return {
    async getCommand(id, { signal }) {
      signal.throwIfAborted();
      // Use the real installed SDK's detached Command, whose initial metadata
      // never changes. Only its wait:true request has the final process result.
      return new Command({
        client: { getCommand },
        sessionId: 'session',
        cmd: { id, exitCode: null },
      });
    },
  };
}

test('reads actual detached exit results through SDK wait, including pre-claim busy', async () => {
  for (const exitCode of [0, 1, 75]) {
    const calls = [];
    const sandbox = lookup(async (args) => {
      calls.push(args);
      return { json: { command: { id: 'command', exitCode } } };
    });
    assert.equal(
      await observeSandboxCommandExit(sandbox, 'command', new globalThis.AbortController().signal),
      exitCode,
    );
    assert.equal(calls.length, 1);
    assert.equal(calls[0].wait, true);
    assert.equal(calls[0].cmdId, 'command');
  }
});

test('bounds a still-running observation without killing or restarting the command', async () => {
  const sandbox = lookup(
    ({ signal }) =>
      new Promise((_, reject) => {
        // Keep the test process alive; AbortSignal.timeout itself is unref'ed.
        const keepAlive = setTimeout(() => reject(new Error('observation did not abort')), 2000);
        signal.addEventListener(
          'abort',
          () => {
            clearTimeout(keepAlive);
            reject(signal.reason);
          },
          { once: true },
        );
      }),
  );
  assert.equal(
    await observeSandboxCommandExit(sandbox, 'command', new globalThis.AbortController().signal),
    null,
  );
});

test('does not classify transport errors or outer cancellation as a running command', async () => {
  const transport = new Error('lookup unavailable');
  await assert.rejects(
    observeSandboxCommandExit(
      lookup(async () => {
        throw transport;
      }),
      'command',
      new globalThis.AbortController().signal,
    ),
    (error) => error === transport,
  );
  const outer = new globalThis.AbortController();
  const sandbox = lookup(async ({ signal }) => {
    outer.abort(new Error('outer deadline'));
    signal.throwIfAborted();
  });
  await assert.rejects(
    observeSandboxCommandExit(sandbox, 'command', outer.signal),
    (error) => error === outer.signal.reason,
  );
});
