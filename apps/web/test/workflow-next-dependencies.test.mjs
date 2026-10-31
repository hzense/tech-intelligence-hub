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

test('patched minimatch supports the installed Queue, oclif and FileList consumers offline', () => {
  const result = spawnSync(
    process.execPath,
    [
      '--input-type=module',
      '--eval',
      `
        import assert from 'node:assert/strict';
        import { createRequire } from 'node:module';
        import { Socket } from 'node:net';
        import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
        import { tmpdir } from 'node:os';
        import { join, dirname } from 'node:path';
        import { pathToFileURL } from 'node:url';
        let networkCalls = 0;
        const offline = () => {
          networkCalls++;
          throw Error('Dependency compatibility checks must stay offline');
        };
        globalThis.fetch = offline;
        Socket.prototype.connect = offline;
        const app = createRequire(join(process.cwd(), 'package.json'));
        // Resolve through real production edges, not a root/dev copy of minimatch.
        const workflow = createRequire(app.resolve('workflow'));
        const cli = createRequire(workflow.resolve('@workflow/cli/package.json'));
        const world = createRequire(cli.resolve('@workflow/world-local'));
        const queueEntry = world.resolve('@vercel/queue');
        const queue = createRequire(queueEntry);
        const core = createRequire(cli.resolve('@oclif/core'));
        const ejs = createRequire(core.resolve('ejs'));
        const jake = createRequire(ejs.resolve('jake'));
        const filelistEntry = jake.resolve('filelist');
        const filelist = createRequire(filelistEntry);
        const semver = core('semver');
        for (const consumer of [queue, core, filelist]) {
          const metadata = consumer('minimatch/package.json');
          assert.ok(semver.gte(metadata.version, '11.0.1'), 'production edge must be patched');
          assert.ok(semver.satisfies(process.version, metadata.engines.node));
          const cjs = consumer('minimatch');
          const esm = await import(new URL(
            metadata.exports['.'].import.default,
            pathToFileURL(consumer.resolve('minimatch/package.json')),
          ));
          for (const matcher of [cjs, esm]) {
            assert.equal(matcher.minimatch('app/api/events/route.ts', 'app/**/route.ts'), true);
            assert.equal(matcher.minimatch('app/api/events/route.ts', 'pages/**/*.js'), false);
            assert.deepEqual(matcher.match(['one.js', 'two.ts', '.hidden.js', 'notes.txt'], '*.{js,ts}'), ['one.js', 'two.ts']);
          }
        }
        // Load both Queue formats so named-import/require export drift is exercised.
        const queuePackage = JSON.parse(readFileSync(join(dirname(queueEntry), '..', 'package.json'), 'utf8'));
        const queueEsm = await import(pathToFileURL(join(dirname(queueEntry), '..', queuePackage.module)));
        assert.equal(typeof world('@vercel/queue').QueueClient, 'function');
        assert.equal(typeof queueEsm.QueueClient, 'function');
        // Execute oclif's real wildcard plugin filter, stopping before loading plugins.
        const PluginLoader = core('./config/plugin-loader.js').default;
        const loader = new PluginLoader({});
        const groups = [];
        loader.loadPlugins = async (...args) => { groups.push(args); };
        await loader.loadCorePlugins({ rootPlugin: {
          root: process.cwd(),
          pjson: { oclif: { plugins: ['@fixture/*'] }, dependencies: {
            '@fixture/alpha': '1', '@fixture/beta': '1', unrelated: '1',
          } },
        } });
        assert.deepEqual(groups.flatMap(([, , names]) => names), ['@fixture/alpha', '@fixture/beta']);
        // Exercise FileList's actual .match consumer against disposable files.
        const fixture = mkdtempSync(join(tmpdir(), 'hzense-minimatch-'));
        try {
          mkdirSync(join(fixture, 'nested'));
          for (const name of ['one.js', '.hidden.js', 'nested/two.ts', 'nested/notes.txt'])
            writeFileSync(join(fixture, name), 'fixture');
          const { FileList } = jake('filelist');
          const files = new FileList(join(fixture, '**/*.{js,ts}'));
          assert.deepEqual(files.toArray().sort(), [join(fixture, 'nested/two.ts'), join(fixture, 'one.js')].sort());
        } finally {
          rmSync(fixture, { recursive: true, force: true });
        }
        assert.equal(networkCalls, 0);
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
