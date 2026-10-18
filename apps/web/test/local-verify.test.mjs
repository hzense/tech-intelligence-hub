import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import process from 'node:process';
import test from 'node:test';
import {
  assertVerifyFiles,
  buildPnpmCommand,
  buildVerifyEnvironment,
  main,
  parseVerifyArguments,
} from '../../../scripts/local-verify.mjs';

const absent = async () => {
  throw Object.assign(new Error('missing'), { code: 'ENOENT' });
};
const root = resolve('/synthetic/repository');
const expectedTasks = [
  'workflow:validate',
  'content:validate',
  'seed:validate',
  'lint',
  'typecheck',
  'test',
];

test('arguments allow only an optional single build flag', () => {
  assert.deepEqual(parseVerifyArguments(), { build: false });
  assert.deepEqual(parseVerifyArguments(['--build']), { build: true });
  for (const args of [
    ['--build', '--build'],
    ['build'],
    ['--check'],
    ['--port=3001'],
    ['--install'],
    ['--audit'],
    ['--unsafe=synthetic-secret'],
  ])
    assert.throws(
      () => parseVerifyArguments(args),
      (error) => {
        assert.match(error.message, /仅支持一次 --build/);
        assert.doesNotMatch(error.message, /synthetic-secret/);
        return true;
      },
    );
});

test('verification environment discards credentials, integration opt-ins, hooks and NODE_ENV without setting CI', () => {
  const parent = Object.freeze({
    PATH: '/synthetic/bin',
    HOME: '/synthetic/home',
    NODE_ENV: 'test',
    CI: 'false',
    DATABASE_URL: 'synthetic-secret',
    MIGRATION_TEST_ADMIN_URL: 'synthetic-secret',
    HZENSE_AI_KEYRING: 'synthetic-secret',
    OPENAI_API_KEY: 'synthetic-secret',
    HZENSE_IMPORT_BROWSER_TEST: '1',
    HZENSE_ADMIN_AUTH_INTEGRATION: '1',
    HZENSE_PARSER_TEST_PYTHON: '/unsafe/python',
    RUNTIME_READER_TEST_ISOLATED_CLUSTER: '1',
    HZENSE_IMPORT_ENABLED: '1',
    HZENSE_SEARCH_MODE: 'database',
    NODE_OPTIONS: '--import=/unsafe/hook',
    HTTPS_PROXY: 'synthetic-secret',
    TURBO_TOKEN: 'synthetic-secret',
    COREPACK_ENABLE_NETWORK: '1',
  });
  const env = buildVerifyEnvironment(parent);
  assert.equal(env.PATH, parent.PATH);
  assert.equal(env.HOME, parent.HOME);
  assert.equal(env.VERCEL_ENV, 'development');
  assert.equal(env.NEXT_PUBLIC_SITE_URL, 'http://127.0.0.1:3000');
  assert.equal(env.HZENSE_IMPORT_ENABLED, '0');
  assert.equal(env.HZENSE_SEARCH_MODE, 'in-process');
  assert.equal(env.COREPACK_ENABLE_NETWORK, '0');
  assert.equal(env.npm_config_pm_on_fail, 'error');
  assert.equal(env.TURBO_TELEMETRY_DISABLED, '1');
  assert.equal(env.NEXT_TELEMETRY_DISABLED, '1');
  for (const key of [
    'NODE_ENV',
    'CI',
    'DATABASE_URL',
    'MIGRATION_TEST_ADMIN_URL',
    'HZENSE_AI_KEYRING',
    'OPENAI_API_KEY',
    'HZENSE_IMPORT_BROWSER_TEST',
    'HZENSE_ADMIN_AUTH_INTEGRATION',
    'HZENSE_PARSER_TEST_PYTHON',
    'RUNTIME_READER_TEST_ISOLATED_CLUSTER',
    'NODE_OPTIONS',
    'HTTPS_PROXY',
    'TURBO_TOKEN',
  ])
    assert.equal(Object.hasOwn(env, key), false, key);
  assert.doesNotMatch(JSON.stringify(env), /synthetic-secret|unsafe/);
  assert.equal(parent.NODE_ENV, 'test');
});

test('all root and web dotenv variants are refused even without build; files are only inspected', async () => {
  const paths = [];
  await assertVerifyFiles(root, async (path) => {
    paths.push(path);
    return absent();
  });
  assert.equal(paths.length, 16);
  for (const directory of ['', 'apps/web'])
    for (const name of [
      '.env',
      '.env.local',
      '.env.development',
      '.env.development.local',
      '.env.production',
      '.env.production.local',
      '.env.test',
      '.env.test.local',
    ])
      assert.ok(paths.includes(resolve(root, directory, name)));
  for (const blocked of paths)
    await assert.rejects(
      assertVerifyFiles(root, async (path) => (path === blocked ? {} : absent())),
      /不会读取或删除/,
    );
  await assert.rejects(
    assertVerifyFiles(root, async (path) => {
      if (path.endsWith('.env.test'))
        throw Object.assign(new Error('synthetic-secret'), { code: 'EACCES' });
      return absent();
    }),
    (error) => {
      assert.match(error.message, /无法安全检查/);
      assert.doesNotMatch(error.message, /synthetic-secret/);
      return true;
    },
  );
});

test('build refuses a development lock before any command, never deleting it or stopping the service', async () => {
  let starts = 0;
  const inspect = async (path) => (path.endsWith('/.next/dev/lock') ? {} : absent());
  const options = {
    environment: {},
    repositoryRoot: root,
    inspect,
    log: () => {},
    runProcess: () => {
      starts++;
      return 0;
    },
  };
  await assert.rejects(main(['--build'], options), /请先停止 Next.js 开发服务/);
  assert.equal(starts, 0);
  assert.equal(await main([], options), 0);
  assert.equal(starts, expectedTasks.length);
  await assert.rejects(
    assertVerifyFiles(
      root,
      async (path) => {
        if (path.endsWith('/.next/dev/lock')) throw new Error('synthetic-secret');
        return absent();
      },
      true,
    ),
    (error) => {
      assert.match(error.message, /无法安全检查 Next.js 开发锁/);
      assert.doesNotMatch(error.message, /synthetic-secret/);
      return true;
    },
  );
});

test('commands use pnpm pinned by the repository without automatic version download and accept no arbitrary task', () => {
  assert.deepEqual(buildPnpmCommand('test'), {
    command: 'pnpm',
    args: ['--pm-on-fail=error', 'run', 'test'],
  });
  const path = '/synthetic/pnpm/bin/pnpm.cjs';
  assert.deepEqual(buildPnpmCommand('build', { npm_execpath: path }), {
    command: process.execPath,
    args: [path, '--pm-on-fail=error', 'run', 'build'],
  });
  assert.equal(buildPnpmCommand('test', { npm_execpath: '/synthetic/npm-cli.js' }).command, 'pnpm');
  for (const task of ['install', 'audit', 'deploy', 'test; echo synthetic-secret'])
    assert.throws(
      () => buildPnpmCommand(task),
      (error) => {
        assert.doesNotMatch(error.message, /synthetic-secret/);
        return true;
      },
    );
});

test('default checks run in order with isolated environment and explicit scope; build is optional and last', async () => {
  for (const build of [false, true]) {
    const calls = [];
    const logs = [];
    assert.equal(
      await main(build ? ['--build'] : [], {
        environment: { DATABASE_URL: 'synthetic-secret', CI: 'false' },
        repositoryRoot: root,
        inspect: absent,
        log: (line) => logs.push(line),
        runProcess: async (command, args, options) => {
          calls.push(args.at(-1));
          assert.equal(command, 'pnpm');
          assert.equal(options.cwd, root);
          assert.equal(options.env.DATABASE_URL, undefined);
          assert.equal(options.env.NODE_ENV, undefined);
          assert.equal(options.env.CI, undefined);
          assert.equal(options.env.HZENSE_SIGNAL_GENERATION_ENABLED, '0');
          return 0;
        },
      }),
      0,
    );
    assert.deepEqual(calls, build ? [...expectedTasks, 'build'] : expectedTasks);
    assert.match(logs.join('\n'), /不包含 PostgreSQL 集成、浏览器、真实 AI 或部署验收/);
    assert.match(logs.join('\n'), /不安装依赖、不执行联网 audit/);
    assert.doesNotMatch(logs.join('\n'), /synthetic-secret/);
  }
});

test('failure and interruption stop immediately and preserve nonzero exit codes', async () => {
  for (const [failure, expected] of [
    [2, 2],
    [130, 130],
    [143, 143],
    [null, 1],
    [-1, 1],
    ['synthetic-secret', 1],
  ]) {
    const calls = [];
    const logs = [];
    const code = await main(['--build'], {
      environment: {},
      inspect: absent,
      log: (line) => logs.push(line),
      runProcess: async (_command, args) => {
        calls.push(args.at(-1));
        return calls.length === 3 ? failure : 0;
      },
    });
    assert.equal(code, expected);
    assert.deepEqual(calls, expectedTasks.slice(0, 3));
    assert.match(logs.join('\n'), /后续检查未执行/);
    assert.doesNotMatch(logs.join('\n'), /synthetic-secret/);
  }
});

test('production, Preview, CI and dotenv guards reject before running checks', async () => {
  let calls = 0;
  const options = {
    inspect: absent,
    log: () => {},
    runProcess: () => {
      calls++;
      return 0;
    },
  };
  for (const environment of [
    { NODE_ENV: 'production' },
    { VERCEL_ENV: 'production' },
    { VERCEL_ENV: 'preview' },
    { VERCEL: '1' },
    { CI: 'true' },
    { GITHUB_ACTIONS: 'true' },
  ])
    await assert.rejects(main([], { ...options, environment }), /禁止/);
  await assert.rejects(
    main([], { ...options, environment: {}, inspect: async () => ({}) }),
    /自动加载云端配置/,
  );
  assert.equal(calls, 0);
});

test('process exceptions never expose raw details and stop later checks', async () => {
  let calls = 0;
  await assert.rejects(
    main([], {
      environment: {},
      inspect: absent,
      log: () => {},
      runProcess: () => {
        calls++;
        throw new Error('postgresql://synthetic-secret@production.invalid/db');
      },
    }),
    (error) => {
      assert.match(error.message, /无法执行 workflow:validate/);
      assert.doesNotMatch(error.message, /synthetic-secret|production.invalid/);
      return true;
    },
  );
  assert.equal(calls, 1);
});
