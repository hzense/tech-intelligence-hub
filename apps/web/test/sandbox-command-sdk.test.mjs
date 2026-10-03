import { setTimeout, clearTimeout } from 'node:timers';
import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'node:http';
import { Buffer } from 'node:buffer';
import { fileURLToPath, URL } from 'node:url';
import { build } from 'esbuild';
import { Command } from '../node_modules/@vercel/sandbox/dist/command.js';
import { APIClient } from '../node_modules/@vercel/sandbox/dist/api-client/api-client.js';

const compiled = await build({
  entryPoints: [fileURLToPath(new URL('../lib/server/sandbox-command.ts', import.meta.url))],
  bundle: true,
  write: false,
  format: 'esm',
  platform: 'node',
});
const { observeSandboxCommandExit } = await import(
  `data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].contents).toString('base64')}`
);

// Exercise the installed SDK's fetch/response parsing and wait=true request,
// including its wrapping of response-body aborts. No Vercel or AI call is made.
async function fixture(t, onWait) {
  const metadata = {
    id: 'command',
    name: 'node',
    args: [],
    cwd: '/vercel/sandbox',
    sessionId: 'session',
    exitCode: null,
    startedAt: 0,
  };
  const requests = [];
  const server = createServer((request, response) => {
    const url = new URL(request.url, 'http://localhost');
    requests.push(url);
    response.writeHead(200, { 'content-type': 'application/json' });
    if (url.searchParams.get('wait') === 'true') onWait(response, metadata);
    else response.end(JSON.stringify({ command: metadata }));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  });
  const client = new APIClient({
    baseUrl: `http://127.0.0.1:${server.address().port}`,
    token: 'local-test-only',
  });
  const sandbox = {
    async getCommand(commandId, { signal }) {
      const result = await client.getCommand({
        sessionId: 'session',
        cmdId: commandId,
        signal,
      });
      return new Command({ client, sessionId: 'session', cmd: result.json.command });
    },
  };
  return { sandbox, requests };
}

test('the SDK wait request obtains a terminal code despite null detached metadata', async (t) => {
  const { sandbox, requests } = await fixture(t, (response, metadata) => {
    response.end(JSON.stringify({ command: { ...metadata, exitCode: 75, durationMs: 4 } }));
  });
  assert.equal(
    await observeSandboxCommandExit(sandbox, 'command', globalThis.AbortSignal.timeout(15000)),
    75,
  );
  assert.equal(requests.length, 2);
  assert.equal(requests[0].searchParams.has('wait'), false);
  assert.equal(requests[1].searchParams.get('wait'), 'true');
});

test('a local observation timeout stays nonterminal when SDK response parsing wraps the abort', async (t) => {
  let responseClosed;
  const closed = new Promise((resolve) => {
    responseClosed = resolve;
  });
  const { sandbox, requests } = await fixture(t, (response) => {
    response.on('close', responseClosed);
    // A response has arrived, but the SDK is still waiting for its body.
    response.flushHeaders();
  });
  assert.equal(
    await observeSandboxCommandExit(sandbox, 'command', globalThis.AbortSignal.timeout(15000)),
    null,
  );
  await closed;
  assert.equal(requests.length, 2);
});

test('outer cancellation during a delayed SDK response remains an error', async (t) => {
  const outer = new globalThis.AbortController();
  let timer;
  t.after(() => clearTimeout(timer));
  const { sandbox, requests } = await fixture(t, (response) => {
    response.flushHeaders();
    timer = setTimeout(() => outer.abort(new Error('outer-observation-cancelled')), 30);
  });
  await assert.rejects(
    observeSandboxCommandExit(sandbox, 'command', outer.signal),
    /outer-observation-cancelled/,
  );
  assert.equal(outer.signal.aborted, true);
  assert.equal(requests.length, 2);
});
