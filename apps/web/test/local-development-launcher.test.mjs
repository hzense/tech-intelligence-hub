import assert from 'node:assert/strict';
import { test } from 'node:test';
import { URL } from 'node:url';
import { mkdtemp, mkdir, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  assertLocalDevelopmentLaunchEnvironment,
  buildLocalDevelopmentEnvironment,
  parseLocalDevelopmentArguments,
  main,
} from '../../../scripts/local-development.mjs';
import {
  localDatabaseBaseRoles,
  upgradeLocalDatabaseCredentials,
} from '../../../scripts/local-database.mjs';
import { isLocalDevelopment } from '../lib/local-development.ts';

function credentials() {
  return upgradeLocalDatabaseCredentials({
    version: 1,
    developmentPassword: 'a'.repeat(64),
    testPassword: 'b'.repeat(64),
    roles: Object.fromEntries(localDatabaseBaseRoles.map((role) => [role, 'c'.repeat(64)])),
  });
}
const launch = {
  root: '/synthetic/repository',
  port: 3000,
};

test('development launcher discards all inherited service credentials and binds only loopback', () => {
  const env = buildLocalDevelopmentEnvironment(
    {
      PATH: '/synthetic/bin',
      DATABASE_URL: 'production-private',
      GOOGLE_CLIENT_SECRET: 'production-private',
      OPENAI_API_KEY: 'production-private',
      GH_TOKEN: 'production-private',
      WORKFLOW_TARGET_WORLD: 'vercel',
      WORKFLOW_LOCAL_BASE_URL: 'https://hzense.com',
      NODE_OPTIONS: '--import=unsafe',
      HZENSE_LOCAL_SESSION_SECRET: 'stale-secret',
      HZENSE_LOCAL_LOGIN_TOKEN_HASH: 'stale-token',
      HZENSE_LOCAL_LOGIN_TOKEN_FILE: '/stale/login.token',
      HZENSE_LOCAL_LOGIN_EXPIRES_AT: '123456',
      HZENSE_AI_ALLOWED_HOSTS: 'untrusted.invalid',
      HZENSE_LOCAL_AI_MODE: 'real',
      HZENSE_AUTOMATION_ENABLED: '1',
      HZENSE_LOCAL_AUTOMATION_SCHEDULER_ENABLED: '1',
      HZENSE_AUTOMATION_BATCH_LIMIT_MICROUSD: '999999999',
      HZENSE_AUTOMATION_DAILY_LIMIT_MICROUSD: '999999999',
      HZENSE_AUTOMATION_RESERVE_MICROUSD: '999999999',
      HZENSE_TOPIC_INSIGHTS_ENABLED: '1',
      HZENSE_AUTOMATION_DATABASE_URL: 'production-private',
      HZENSE_INSIGHT_READER_DATABASE_URL: 'production-private',
      HZENSE_AUTOMATION_DISPATCH_TOKEN: 'production-private',
      CRON_SECRET: 'production-private',
    },
    credentials(),
    launch,
  );
  assert.equal(env.DATABASE_URL, undefined);
  assert.equal(env.OPENAI_API_KEY, undefined);
  assert.equal(env.GH_TOKEN, undefined);
  assert.equal(env.GOOGLE_CLIENT_SECRET, '');
  assert.equal(env.WORKFLOW_TARGET_WORLD, 'local');
  assert.equal(env.WORKFLOW_LOCAL_BASE_URL, 'http://127.0.0.1:3000');
  assert.equal(env.HZENSE_LOCAL_AI_MODE, 'mock');
  assert.equal(env.HZENSE_SIGNAL_READ_MODE, 'database');
  assert.equal(env.HZENSE_AUTOMATION_ENABLED, '0');
  assert.equal(env.HZENSE_LOCAL_AUTOMATION_SCHEDULER_ENABLED, '0');
  assert.equal(env.HZENSE_AUTOMATION_BATCH_LIMIT_MICROUSD, '5000000');
  assert.equal(env.HZENSE_AUTOMATION_DAILY_LIMIT_MICROUSD, '10000000');
  assert.equal(env.HZENSE_AUTOMATION_RESERVE_MICROUSD, '5000000');
  assert.equal(env.HZENSE_TOPIC_INSIGHTS_ENABLED, '1');
  assert.equal(env.HZENSE_AI_ALLOWED_HOSTS, 'openrouter.ai,ai-gateway.vercel.sh');
  assert.equal(env.HZENSE_AUTOMATION_DISPATCH_TOKEN, undefined);
  assert.equal(env.CRON_SECRET, undefined);
  const automationTarget = new URL(env.HZENSE_AUTOMATION_DATABASE_URL);
  assert.deepEqual(
    [
      automationTarget.username,
      automationTarget.hostname,
      automationTarget.port,
      automationTarget.pathname,
    ],
    ['hzense_automation_admin', '127.0.0.1', '55432', '/hzense_local'],
  );
  assert.ok(isLocalDevelopment(env));
  const insightTarget = new URL(env.HZENSE_INSIGHT_READER_DATABASE_URL);
  assert.deepEqual(
    [insightTarget.username, insightTarget.hostname, insightTarget.port, insightTarget.pathname],
    ['hzense_insight_reader', '127.0.0.1', '55432', '/hzense_local'],
  );
  assert.doesNotMatch(JSON.stringify(env), /production-private|unsafe/);
  for (const key of [
    'HZENSE_LOCAL_LOGIN_EXPIRES_AT',
    'HZENSE_LOCAL_LOGIN_TOKEN_FILE',
    'HZENSE_LOCAL_LOGIN_TOKEN_HASH',
    'HZENSE_LOCAL_SESSION_SECRET',
  ])
    assert.equal(env[key], undefined);
  assert.doesNotMatch(JSON.stringify(env), /stale-secret|stale-token|stale\/login/);
});

test('real provider mode is opt-in via a validated local launch argument', () => {
  assert.deepEqual(parseLocalDevelopmentArguments([]), {
    port: 3000,
    check: false,
    aiMode: 'mock',
    automaticPublication: false,
  });
  assert.deepEqual(parseLocalDevelopmentArguments(['--ai=real', '--port=3001', '--check']), {
    port: 3001,
    check: true,
    aiMode: 'real',
    automaticPublication: false,
  });
  for (const args of [
    ['--ai=invalid'],
    ['--ai=real', '--ai=mock'],
    ['--ai=real', '--ai=real'],
    ['--ai', 'real'],
  ])
    assert.throws(() => parseLocalDevelopmentArguments(args));
  const env = buildLocalDevelopmentEnvironment(
    { OPENAI_API_KEY: 'inherited-secret', HZENSE_GENERATION_DAILY_LIMIT_MICROUSD: '999999999' },
    credentials(),
    { ...launch, aiMode: 'real' },
  );
  assert.equal(env.HZENSE_LOCAL_AI_MODE, 'real');
  assert.equal(env.HZENSE_AUTOMATIC_PUBLICATION_ENABLED, '0');
  assert.equal(env.HZENSE_AUTOMATION_ENABLED, '1');
  assert.equal(env.HZENSE_LOCAL_AUTOMATION_SCHEDULER_ENABLED, '1');
  assert.equal(env.HZENSE_AUTOMATION_BATCH_LIMIT_MICROUSD, '5000000');
  assert.equal(env.HZENSE_AUTOMATION_DAILY_LIMIT_MICROUSD, '10000000');
  assert.equal(env.HZENSE_AUTOMATION_RESERVE_MICROUSD, '5000000');
  assert.equal(env.HZENSE_TOPIC_INSIGHTS_ENABLED, '1');
  assert.equal(env.CRON_SECRET, undefined);
  assert.equal(env.WORKFLOW_TARGET_WORLD, 'local');
  assert.equal(env.HZENSE_GENERATION_DAILY_LIMIT_MICROUSD, '10000000');
  assert.equal(env.HZENSE_GENERATION_BATCH_LIMIT_MICROUSD, '5000000');
  assert.equal(env.OPENAI_API_KEY, undefined);
  assert.ok(isLocalDevelopment(env));
  assert.throws(() =>
    buildLocalDevelopmentEnvironment({}, credentials(), { ...launch, aiMode: 'unknown' }),
  );
});

test('automatic publication is separately opted into and cannot run in local mock mode', () => {
  assert.deepEqual(parseLocalDevelopmentArguments(['--ai=real', '--auto-publish']), {
    port: 3000,
    check: false,
    aiMode: 'real',
    automaticPublication: true,
  });
  assert.throws(() => parseLocalDevelopmentArguments(['--auto-publish', '--auto-publish']));
  assert.throws(() =>
    buildLocalDevelopmentEnvironment({}, credentials(), {
      ...launch,
      aiMode: 'mock',
      automaticPublication: true,
    }),
  );
  const inherited = { HZENSE_AUTOMATIC_PUBLICATION_ENABLED: '1' };
  assert.equal(
    buildLocalDevelopmentEnvironment(inherited, credentials(), {
      ...launch,
      aiMode: 'real',
    }).HZENSE_AUTOMATIC_PUBLICATION_ENABLED,
    '0',
  );
  assert.equal(
    buildLocalDevelopmentEnvironment({}, credentials(), {
      ...launch,
      aiMode: 'real',
      automaticPublication: true,
    }).HZENSE_AUTOMATIC_PUBLICATION_ENABLED,
    '1',
  );
});

test('real mode check warns of provider spending without starting or invoking AI', async () => {
  const logs = [];
  await main(['--check', '--ai=real'], {
    environment: {},
    repositoryRoot: launch.root,
    inspect: async () => {
      throw Object.assign(new Error('missing'), { code: 'ENOENT' });
    },
    verifyDatabase: async () => undefined,
    loadCredentials: async () => credentials(),
    runProcess: async () => assert.fail('check must not start a server'),
    startScheduler: () => assert.fail('check must not start a scheduler'),
    log: (message) => logs.push(message),
  });
  assert.ok(logs.some((line) => line.includes('资料会发送给供应商')));
  assert.ok(logs.some((line) => line.includes('供应商费用')));
  assert.doesNotMatch(logs.join('\n'), /[a-f0-9]{64}|postgresql:/);
});

test('launcher owns scheduler lifetime in real mode, including process failure; mock never starts it', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'hzense-scheduler-launcher-')));
  await mkdir(join(root, '.hzense-local'), { mode: 0o700 });
  try {
    for (const aiMode of ['mock', 'real']) {
      for (const fail of [false, true]) {
        const events = [];
        const result = main([`--ai=${aiMode}`], {
          environment: {},
          repositoryRoot: root,
          inspect: async () => {
            throw Object.assign(new Error('missing'), { code: 'ENOENT' });
          },
          verifyDatabase: async () => undefined,
          loadCredentials: async () => credentials(),
          startScheduler: ({ port }) => {
            assert.equal(port, 3000);
            events.push('scheduler');
            return { stop: () => events.push('stop') };
          },
          runProcess: async (_command, _args, { env }) => {
            assert.equal(
              env.HZENSE_LOCAL_AUTOMATION_SCHEDULER_ENABLED,
              aiMode === 'real' ? '1' : '0',
            );
            events.push('process');
            if (fail) throw new Error('synthetic start failure');
            return 130;
          },
          log: () => undefined,
        });
        if (fail) await assert.rejects(result, /synthetic/);
        else assert.equal(await result, 130);
        assert.deepEqual(
          events,
          aiMode === 'real' ? ['scheduler', 'process', 'stop'] : ['process'],
        );
      }
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('launcher requires an explicit credential upgrade before exposing local automation configuration', () => {
  for (const version of [1, 2, 3])
    assert.throws(
      () => buildLocalDevelopmentEnvironment({}, { ...credentials(), version }, launch),
      /local:db:init/,
    );
});

test('launcher rejects deployment markers before scrubbing inherited variables', () => {
  for (const env of [
    { CI: '1' },
    { AWS_REGION: 'example' },
    { VERCEL_REGION: 'example' },
    { NODE_ENV: 'production' },
    { VERCEL_ENV: 'preview' },
    { NODE_TLS_REJECT_UNAUTHORIZED: '0' },
  ])
    assert.throws(() => assertLocalDevelopmentLaunchEnvironment(env));
});

test('check performs read-only database verification without starting server or issuing credentials', async () => {
  const calls = [];
  const logs = [];
  assert.equal(
    await main(['--check'], {
      environment: {},
      repositoryRoot: launch.root,
      inspect: async () => {
        throw Object.assign(new Error('missing'), { code: 'ENOENT' });
      },
      verifyDatabase: async (options) => {
        calls.push(options.args);
      },
      loadCredentials: async (options) => {
        assert.equal(options.create, false);
        return credentials();
      },
      runProcess: async () => {
        assert.fail('server must not start');
      },
      log: (message) => logs.push(message),
    }),
    0,
  );
  assert.deepEqual(calls, [['verify']]);
  assert.ok(logs.some((line) => line.includes('不需要登录令牌')));
  assert.doesNotMatch(logs.join('\n'), /[a-f0-9]{64}|postgresql:/);
});
