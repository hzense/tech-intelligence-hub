import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import process from 'node:process';
import { fileURLToPath, URL } from 'node:url';
import { parse } from 'yaml';

test('the lockfile retains the Next.js Workflow adapter without the unused Nest downloader chain', async () => {
  const lock = parse(await readFile(new URL('../../../pnpm-lock.yaml', import.meta.url), 'utf8'));
  const excluded = ['@workflow/nest', 'http-cache-semantics'];
  for (const section of ['packages', 'snapshots']) {
    assert.ok(lock[section], `${section} must contain resolved dependency records`);
    for (const [id, record] of Object.entries(lock[section])) {
      for (const name of excluded) {
        assert.equal(id.startsWith(`${name}@`), false, `${section} must not resolve ${name}`);
        for (const field of ['dependencies', 'optionalDependencies']) {
          assert.equal(
            Object.hasOwn(record[field] ?? {}, name),
            false,
            `${id} must not retain a ${field} edge to ${name}`,
          );
        }
      }
    }
  }
  const workflow = lock.importers['apps/web'].dependencies.workflow;
  const snapshot = lock.snapshots[`workflow@${workflow.version}`];
  assert.ok(snapshot, 'the app must resolve its actual Workflow snapshot');
  assert.ok(snapshot.dependencies['@workflow/next'], 'the Next.js adapter stays installed');
});

test('real Workflow app entry points load without Nest, the SWC CLI or network access', () => {
  // Isolate dependency module caches and hooks from other tests. Even a stale
  // local install containing Nest cannot hide a new dependency on that adapter.
  const result = spawnSync(
    process.execPath,
    [
      '--input-type=module',
      '--eval',
      `
        import assert from 'node:assert/strict';
        import { registerHooks } from 'node:module';
        import { Socket } from 'node:net';
        let forbiddenLoads = 0;
        let networkCalls = 0;
        const offline = () => {
          networkCalls++;
          throw Error('Workflow entry-point smoke test must stay offline');
        };
        globalThis.fetch = offline;
        Socket.prototype.connect = offline;
        const hooks = registerHooks({
          resolve(specifier, context, nextResolve) {
            if (['workflow/nest', '@workflow/nest', '@swc/cli'].some(
              (name) => specifier === name || specifier.startsWith(name + '/'),
            )) {
              forbiddenLoads++;
              throw Error('Unused dependency requested: ' + specifier);
            }
            return nextResolve(specifier, context);
          },
        });
        try {
          const workflow = await import('workflow');
          const api = await import('workflow/api');
          const next = await import('workflow/next');
          assert.equal(typeof workflow.sleep, 'function');
          assert.equal(typeof api.start, 'function');
          assert.equal(typeof next.withWorkflow, 'function');
          assert.equal(forbiddenLoads, 0);
          assert.equal(networkCalls, 0);
        } finally {
          hooks.deregister();
        }
      `,
    ],
    {
      cwd: fileURLToPath(new URL('..', import.meta.url)),
      env: { NODE_ENV: 'test', PATH: process.env.PATH ?? '' },
      encoding: 'utf8',
      timeout: 15000,
      maxBuffer: 128 * 1024,
    },
  );
  assert.ifError(result.error);
  assert.equal(result.signal, null, result.stderr);
  assert.equal(result.status, 0, result.stderr || result.stdout);
});
