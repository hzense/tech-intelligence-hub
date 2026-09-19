import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { readFile } from 'node:fs/promises';
import { URL } from 'node:url';
import { Buffer } from 'node:buffer';
import process from 'node:process';

test('Sandbox dispatch confines secrets, never waits for AI, and polling cannot resume execution', async () => {
  const source = await readFile(
    new URL('../lib/server/generation-sandbox.ts', import.meta.url),
    'utf8',
  );
  const code = await build({
    stdin: { contents: source, loader: 'ts' },
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'node',
    plugins: [
      {
        name: 'sandbox-fixture',
        setup(b) {
          b.onResolve(
            { filter: /^(server-only|node:fs\/promises|@vercel\/sandbox|\.\/|\.\.\/)/ },
            ({ path }) => ({ path, namespace: 'fixture' }),
          );
          b.onLoad({ filter: /.*/, namespace: 'fixture' }, ({ path }) => ({
            contents:
              path === 'server-only'
                ? ''
                : path === 'node:fs/promises'
                  ? "export async function readFile(){return Buffer.from('trusted-code');}"
                  : path === '@vercel/sandbox'
                    ? `const f=globalThis.__sandboxTest; const sandbox={name:'test-sandbox',async writeFiles(files){f.files=files;}, async runCommand(args){f.commands.push(args); if(f.fail)throw new Error('SECRET');return {cmdId:'cmd'};},async getCommand(id){f.polled.push(id);return {exitCode:f.exit};},async stop(){f.stops++;}}; export const Sandbox={async create(args){f.created.push(args);return sandbox;},async get(args){f.gets.push(args);return sandbox;}};`
                    : path.endsWith('/signal-generation')
                      ? 'export const generationConfigured=()=>true;export async function generationDetail(){return {status:globalThis.__sandboxTest.status};}'
                      : path.endsWith('/signal-generation-config')
                        ? "export const readGenerationConfiguration=()=>({connectionString:'postgresql://db.neon.tech/db'});"
                        : path.endsWith('/admin-ai-core')
                          ? "export const readAiBackendConfiguration=()=>({connectionString:'postgresql://db.neon.tech/db',allowedHosts:['provider.example.com']});"
                          : "export const generationImportConfiguration=()=>({connectionString:'postgresql://db.neon.tech/db'});",
          }));
        },
      },
    ],
  });
  const f = (globalThis.__sandboxTest = {
    status: 'pending',
    files: [],
    commands: [],
    created: [],
    gets: [],
    polled: [],
    stops: 0,
    exit: null,
  });
  const old = process.env;
  process.env = {
    HZENSE_AI_KEYRING: 'PRIVATE_KEYRING',
    HZENSE_GENERATION_DATABASE_URL: 'PRIVATE_DB',
    HZENSE_IMPORT_BLOB_TOKEN: 'BLOB_DO_NOT_FORWARD',
    AUTH_SECRET: 'DO_NOT_FORWARD',
    VERCEL_TOKEN: 'DO_NOT_FORWARD',
  };
  try {
    const worker = await import(
      'data:text/javascript;base64,' + Buffer.from(code.outputFiles[0].contents).toString('base64')
    );
    const handle = await worker.startGenerationSandbox('owner', 'task');
    assert.deepEqual(handle, { sandboxName: 'test-sandbox', commandId: 'cmd' });
    assert.equal(f.created[0].timeout, 1800000);
    assert.equal(f.created[0].persistent, false);
    assert.deepEqual(f.created[0].networkPolicy, {
      allow: ['db.neon.tech', 'provider.example.com'],
    });
    assert.equal(f.commands[0].detached, true);
    assert.doesNotMatch(JSON.stringify([f.created, f.commands]), /PRIVATE_|DO_NOT_FORWARD/);
    const task = JSON.parse(f.files[1].content.toString());
    assert.equal(task.env.HZENSE_AI_KEYRING, 'PRIVATE_KEYRING');
    assert.doesNotMatch(JSON.stringify(task), /DO_NOT_FORWARD/);
    assert.equal(await worker.pollGenerationSandbox(handle), 'running');
    f.exit = 75;
    assert.equal(await worker.pollGenerationSandbox(handle), 'busy');
    f.exit = 1;
    assert.equal(await worker.pollGenerationSandbox(handle), 'finished');
    assert.ok(f.gets.every((get) => get.resume === false));
    assert.equal(f.commands.length, 1);
    await worker.stopGenerationSandbox(handle);
    assert.equal(f.stops, 1);
    f.status = 'completed';
    assert.equal(await worker.startGenerationSandbox('owner', 'task'), null);
    assert.equal(f.created.length, 1);
    f.status = 'pending';
    f.fail = true;
    await assert.rejects(
      worker.startGenerationSandbox('owner', 'task'),
      /generation_dispatch_failed/,
    );
    assert.equal(f.stops, 2);
  } finally {
    process.env = old;
    delete globalThis.__sandboxTest;
  }
});
