import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  assertLocalDevelopmentLaunchEnvironment,
  buildLocalDevelopmentEnvironment,
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
  assert.ok(isLocalDevelopment(env));
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
