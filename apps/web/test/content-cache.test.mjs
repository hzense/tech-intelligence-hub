import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { execPath } from 'node:process';
import test from 'node:test';

const repositoryRoot = resolve(import.meta.dirname, '../../..');
const turboBin = join(repositoryRoot, 'node_modules/turbo/bin/turbo');

test('database and ingestion source changes invalidate Web artifacts through real workspace dependencies', async () => {
  const root = await mkdtemp(join(tmpdir(), 'hzense-shared-cache-'));
  const put = async (path, value) => {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), value);
  };
  try {
    for (const path of ['package.json', 'pnpm-workspace.yaml', 'pnpm-lock.yaml', 'turbo.json'])
      await put(path, await readFile(join(repositoryRoot, path), 'utf8'));
    for (const path of [
      'apps/web',
      'packages/database',
      'packages/ingestion',
      'packages/content',
      'packages/search',
    ]) {
      const manifest = JSON.parse(
        await readFile(join(repositoryRoot, path, 'package.json'), 'utf8'),
      );
      manifest.scripts = { build: 'exit 0', test: 'exit 0' };
      await put(`${path}/package.json`, JSON.stringify(manifest));
    }
    await put('.gitignore', '.turbo/\n');
    const inputs = [
      'packages/database/src/signal-generation-store.mjs',
      'packages/ingestion/src/signal-generation-contract.mjs',
    ];
    for (const path of inputs) await put(path, 'export const initial = true;\n');
    execFileSync('git', ['init', '--quiet'], { cwd: root });
    execFileSync('git', ['add', '.'], { cwd: root });
    const snapshot = () =>
      JSON.parse(
        execFileSync(
          execPath,
          [turboBin, 'run', 'build', 'test', '--filter=@hzense/web', '--dry=json'],
          { cwd: root, encoding: 'utf8', timeout: 20_000, stdio: ['ignore', 'pipe', 'pipe'] },
        ),
      ).tasks;
    const baseline = snapshot();
    for (const name of ['@hzense/database#build', '@hzense/ingestion#build'])
      assert.ok(
        baseline.some((task) => task.taskId === name),
        `${name} must be in Web build graph`,
      );
    for (const path of inputs) {
      await put(path, 'export const changed = true;\n');
      const changed = snapshot();
      for (const name of ['@hzense/web#build', '@hzense/web#test', '@hzense/database#build'])
        assert.notEqual(
          changed.find((task) => task.taskId === name).hash,
          baseline.find((task) => task.taskId === name).hash,
          `${path} must invalidate ${name}`,
        );
      await put(path, 'export const initial = true;\n');
      assert.equal(
        snapshot().find((task) => task.taskId === '@hzense/web#build').hash,
        baseline.find((task) => task.taskId === '@hzense/web#build').hash,
      );
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('root content changes invalidate build and test hashes without changing application code', async () => {
  // Use an isolated workspace: never modify live content or run a real build.
  const root = await mkdtemp(join(tmpdir(), 'hzense-content-cache-'));
  const put = async (path, value) => {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), value);
  };
  try {
    const { packageManager } = JSON.parse(
      await readFile(join(repositoryRoot, 'package.json'), 'utf8'),
    );
    await put(
      'package.json',
      JSON.stringify({ name: 'cache-fixture', private: true, packageManager }),
    );
    await put('pnpm-workspace.yaml', 'packages:\n  - apps/*\n');
    await put('pnpm-lock.yaml', "lockfileVersion: '9.0'\nimporters:\n  .: {}\n  apps/web: {}\n");
    await put('turbo.json', await readFile(join(repositoryRoot, 'turbo.json'), 'utf8'));
    await put('.gitignore', '.turbo/\n');
    await put(
      'apps/web/package.json',
      JSON.stringify({ name: '@hzense/web', scripts: { build: 'exit 0', test: 'exit 0' } }),
    );
    await put('apps/web/index.js', 'export const unchanged = true;\n');
    const inputs = [
      'data/seed/signals.yaml',
      'data/seed/entities.yaml',
      'data/seed/radar.yaml',
      'data/taxonomy/taxonomy.yaml',
      'content/daily/2026/example.md',
    ];
    for (const path of inputs) await put(path, 'initial\n');
    execFileSync('git', ['init', '--quiet'], { cwd: root });
    execFileSync('git', ['add', '.'], { cwd: root });

    const snapshot = () => {
      const result = JSON.parse(
        execFileSync(
          execPath,
          [turboBin, 'run', 'build', 'test', '--filter=@hzense/web', '--dry=json'],
          { cwd: root, encoding: 'utf8', timeout: 20_000, stdio: ['ignore', 'pipe', 'pipe'] },
        ),
      );
      return Object.fromEntries(result.tasks.map((task) => [task.taskId, task.hash]));
    };
    const baseline = snapshot();
    assert.ok(baseline['@hzense/web#build']);
    assert.ok(baseline['@hzense/web#test']);
    assert.deepEqual(snapshot(), baseline, 'unchanged inputs must retain stable hashes');
    for (const path of inputs) {
      await put(path, 'changed\n');
      const changed = snapshot();
      for (const task of Object.keys(baseline)) {
        assert.notEqual(changed[task], baseline[task], `${path} must invalidate ${task}`);
      }
      await put(path, 'initial\n');
      assert.deepEqual(snapshot(), baseline, 'restored input must restore the hash');
    }
    await put('content/daily/2026/new.md', 'new article\n');
    const added = snapshot();
    assert.notEqual(added['@hzense/web#build'], baseline['@hzense/web#build']);
    assert.notEqual(added['@hzense/web#test'], baseline['@hzense/web#test']);
    await rm(join(root, 'content/daily/2026/new.md'));
    assert.deepEqual(snapshot(), baseline, 'removed new content must restore the hash');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
