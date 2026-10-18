import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { basename, resolve } from 'node:path';
import process from 'node:process';
import test from 'node:test';
import {
  assertLocalExecution,
  assertNoLocalDotenv,
  buildLocalCommand,
  buildLocalEnvironment,
  main,
  parseLocalArguments,
  runLocalProcess,
} from '../../../scripts/local-site.mjs';

const absent = async () => {
  throw Object.assign(new Error('missing'), { code: 'ENOENT' });
};

test('local environment keeps only system essentials and fixed snapshot settings', () => {
  const parent = Object.freeze({
    PATH: '/synthetic/bin',
    HOME: '/synthetic/home',
    LANG: 'zh_CN.UTF-8',
    DATABASE_URL: 'private-database-secret',
    DATABASE_DIRECT_URL: 'private-migration-secret',
    HZENSE_RUNTIME_DATABASE_URL: 'private-runtime-secret',
    HZENSE_AI_DATABASE_URL: 'private-ai-secret',
    HZENSE_AI_KEYRING: 'private-keyring',
    HZENSE_UNIFIED_SIGNAL_ENABLED: '1',
    HZENSE_AUTOMATION_ENABLED: '1',
    HZENSE_SEARCH_MODE: 'database',
    HZENSE_TOPIC_INSIGHTS_ENABLED: '1',
    HZENSE_IMPORT_BLOB_TOKEN: 'private-blob-secret',
    OPENAI_API_KEY: 'private-api-secret',
    GH_TOKEN: 'private-github-secret',
    AWS_ACCESS_KEY_ID: 'private-aws-secret',
    HTTPS_PROXY: 'private-proxy-secret',
    NEXT_PUBLIC_SECRET: 'private-public-secret',
    NEXTAUTH_SECRET: 'private-auth-secret',
    NODE_OPTIONS: '--import=/unsafe-hook.mjs',
    NODE_TLS_REJECT_UNAUTHORIZED: '0',
    VERCEL_ENV: 'production',
    VERCEL: '1',
    UNRECOGNIZED_SECRET: 'private-new-secret',
  });
  const env = buildLocalEnvironment(parent, 3001);
  assert.equal(env.PATH, parent.PATH);
  assert.equal(env.HOME, parent.HOME);
  assert.equal(env.LANG, parent.LANG);
  assert.equal(env.NODE_ENV, 'development');
  assert.equal(env.VERCEL_ENV, 'development');
  assert.equal(env.VERCEL, '');
  assert.equal(env.PORT, '3001');
  assert.equal(env.NEXT_PUBLIC_SITE_URL, 'http://127.0.0.1:3001');
  assert.equal(env.NEXT_TELEMETRY_DISABLED, '1');
  assert.equal(env.HZENSE_LOCAL_PREVIEW, '1');
  assert.equal(env.HZENSE_SIGNAL_READ_MODE, 'legacy');
  assert.equal(env.HZENSE_LEGACY_SIGNAL_ARCHIVE_MODE, 'seed');
  assert.equal(env.HZENSE_SEARCH_MODE, 'in-process');
  for (const [key, value] of Object.entries(env)) {
    if (key.endsWith('_ENABLED')) assert.equal(value, '0', key);
  }
  for (const key of [
    'NEXTAUTH_SECRET',
    'AUTH_SECRET',
    'GOOGLE_CLIENT_ID',
    'GOOGLE_CLIENT_SECRET',
    'HZENSE_ADMIN_EMAIL',
  ])
    assert.equal(env[key], '', key);
  for (const key of [
    'DATABASE_URL',
    'DATABASE_DIRECT_URL',
    'HZENSE_AI_DATABASE_URL',
    'OPENAI_API_KEY',
    'NODE_OPTIONS',
    'NODE_TLS_REJECT_UNAUTHORIZED',
    'HTTPS_PROXY',
    'NEXT_PUBLIC_SECRET',
    'UNRECOGNIZED_SECRET',
  ])
    assert.equal(Object.hasOwn(env, key), false, key);
  assert.doesNotMatch(JSON.stringify(env), /private-|unsafe-hook/);
  assert.equal(parent.HZENSE_UNIFIED_SIGNAL_ENABLED, '1');
});

test('arguments accept only a single check flag and valid explicit port', () => {
  assert.deepEqual(parseLocalArguments(), { port: 3000, check: false });
  assert.deepEqual(parseLocalArguments(['--port=3001', '--check']), { port: 3001, check: true });
  assert.deepEqual(parseLocalArguments(['--check', '--port=65535']), { port: 65535, check: true });
  for (const args of [
    ['--port=0'],
    ['--port=65536'],
    ['--port=03000'],
    ['--port=3.5'],
    ['--port=-1'],
    ['--port=3000;echo'],
    ['--port=3000', '--port=3001'],
    ['--check', '--check'],
    ['--hostname=0.0.0.0'],
    ['--production'],
  ])
    assert.throws(() => parseLocalArguments(args));
  for (const port of [0, 65536, 3.5, '3000', NaN]) {
    assert.throws(() => buildLocalEnvironment({}, port));
    assert.throws(() => buildLocalCommand({}, port));
  }
});

test('entry refuses production, preview and deployment environments before isolation', () => {
  for (const env of [
    { NODE_ENV: 'production' },
    { VERCEL_ENV: 'production' },
    { VERCEL_ENV: 'preview' },
    { VERCEL: '1' },
    { VERCEL_URL: 'deployment.invalid' },
    { VERCEL_PROJECT_ID: 'project' },
    { VERCEL_DEPLOYMENT_ID: 'deployment' },
    { AWS_LAMBDA_FUNCTION_NAME: 'lambda' },
    { CI: 'true' },
    { GITHUB_ACTIONS: 'true' },
  ])
    assert.throws(() => assertLocalExecution(env), /禁止/);
  assert.doesNotThrow(() => assertLocalExecution({}));
  assert.doesNotThrow(() =>
    assertLocalExecution({ NODE_ENV: 'development', VERCEL_ENV: 'development', VERCEL: '' }),
  );
});

test('dotenv checks cover root and app development files without reading content', async () => {
  const root = resolve('/synthetic/repository');
  const paths = [];
  await assertNoLocalDotenv(root, async (path) => {
    paths.push(path);
    return absent();
  });
  assert.equal(paths.length, 8);
  assert.deepEqual(paths.map((path) => basename(path)).sort(), [
    '.env',
    '.env',
    '.env.development',
    '.env.development',
    '.env.development.local',
    '.env.development.local',
    '.env.local',
    '.env.local',
  ]);
  assert.equal(
    paths.some((path) => path.endsWith('.env.example')),
    false,
  );
  for (const blocked of paths) {
    await assert.rejects(
      assertNoLocalDotenv(root, async (path) => (path === blocked ? {} : absent())),
      /不会读取或删除/,
    );
  }
  await assert.rejects(
    assertNoLocalDotenv(root, async () => {
      throw Object.assign(new Error('synthetic-sensitive-details'), { code: 'EACCES' });
    }),
    (error) => {
      assert.match(error.message, /无法安全检查/);
      assert.doesNotMatch(error.message, /synthetic-sensitive-details/);
      return true;
    },
  );
});

test('pnpm command is loopback-only and can use current Node plus npm_execpath', () => {
  assert.deepEqual(buildLocalCommand({}, 3001), {
    command: 'pnpm',
    args: ['--filter', '@hzense/web', 'dev', '--hostname', '127.0.0.1', '--port', '3001'],
  });
  const path = '/synthetic/pnpm/bin/pnpm.cjs';
  assert.deepEqual(buildLocalCommand({ npm_execpath: path }), {
    command: process.execPath,
    args: [path, '--filter', '@hzense/web', 'dev', '--hostname', '127.0.0.1', '--port', '3000'],
  });
  assert.equal(buildLocalCommand({ npm_execpath: '/synthetic/npm-cli.js' }).command, 'pnpm');
});

test('--check validates isolation without starting a server', async () => {
  const logs = [];
  let starts = 0;
  const code = await main(['--check', '--port=3001'], {
    environment: {},
    inspect: absent,
    log: (line) => logs.push(line),
    runProcess: () => {
      starts++;
    },
  });
  assert.equal(code, 0);
  assert.equal(starts, 0);
  assert.match(logs.join('\n'), /仓库数据快照/);
  assert.match(logs.join('\n'), /不包含生产数据库/);
  assert.match(logs.join('\n'), /未启动服务/);
  assert.match(logs.join('\n'), /127\.0\.0\.1:3001/);
});

test('main starts only with isolated environment and refuses unsafe preflight', async () => {
  let starts = 0;
  const options = {
    environment: { DATABASE_URL: 'synthetic-sensitive-database' },
    repositoryRoot: resolve('/synthetic/repository'),
    inspect: absent,
    log: () => {},
    runProcess: (command, args, processOptions) => {
      starts++;
      assert.equal(command, 'pnpm');
      assert.equal(args.includes('127.0.0.1'), true);
      assert.equal(processOptions.cwd, resolve('/synthetic/repository'));
      assert.equal(processOptions.env.DATABASE_URL, undefined);
      return 0;
    },
  };
  assert.equal(await main([], options), 0);
  assert.equal(starts, 1);
  await assert.rejects(main([], { ...options, environment: { VERCEL_ENV: 'production' } }), /禁止/);
  await assert.rejects(main([], { ...options, inspect: async () => ({}) }), /自动加载云端配置/);
  assert.equal(starts, 1);
});

test('interrupt and terminate are forwarded to the pnpm/Next process group and listeners removed', async () => {
  for (const [signal, exitCode] of [
    ['SIGINT', 130],
    ['SIGTERM', 143],
  ]) {
    const signals = new EventEmitter();
    const child = new EventEmitter();
    child.pid = 12345;
    const killed = [];
    const result = runLocalProcess(
      'pnpm',
      [],
      { env: {}, cwd: '/synthetic' },
      {
        signals,
        platform: 'darwin',
        spawnProcess: (_command, _args, options) => {
          assert.equal(options.detached, true);
          assert.equal(options.shell, false);
          return child;
        },
        killProcess: (pid, sentSignal) => killed.push([pid, sentSignal]),
      },
    );
    signals.emit(signal);
    signals.emit(signal);
    assert.deepEqual(killed, [[-12345, signal]]);
    child.emit('close', null, signal);
    assert.equal(await result, exitCode);
    assert.equal(signals.listenerCount('SIGINT'), 0);
    assert.equal(signals.listenerCount('SIGTERM'), 0);
  }
});

test('process errors do not leak raw details or leave signal handlers', async () => {
  const signals = new EventEmitter();
  const child = new EventEmitter();
  const result = runLocalProcess('pnpm', [], {}, { signals, spawnProcess: () => child });
  child.emit('error', new Error('synthetic-sensitive-error'));
  await assert.rejects(result, (error) => {
    assert.match(error.message, /无法启动本地服务/);
    assert.doesNotMatch(error.message, /synthetic-sensitive-error/);
    return true;
  });
  assert.equal(signals.listenerCount('SIGINT'), 0);
  assert.equal(signals.listenerCount('SIGTERM'), 0);
});
