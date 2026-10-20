import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  assertLocalDatabaseUrl,
  assertLocalDevelopmentRequest,
  isLocalDevelopment,
  isLocalRealAi,
  isLocalRealAutomationEnabled,
  isLocalMockAi,
  localRequestMatchesOrigin,
  localDatabaseEnvironmentRoles,
} from '../lib/local-development.ts';

export function localEnvironment() {
  return {
    NODE_ENV: 'development',
    VERCEL_ENV: 'development',
    PORT: '3000',
    NEXTAUTH_URL: 'http://127.0.0.1:3000',
    HZENSE_LOCAL_DEVELOPMENT: '1',
    HZENSE_RUNTIME_EXPECTED_HOST: '127.0.0.1',
    HZENSE_RUNTIME_EXPECTED_PORT: '55432',
    HZENSE_RUNTIME_EXPECTED_NAME: 'hzense_local',
    HZENSE_RUNTIME_EXPECTED_USER: 'hzense_runtime',
    ...Object.fromEntries(
      Object.entries(localDatabaseEnvironmentRoles).map(([key, role]) => [
        key,
        `postgresql://${role}:${'a'.repeat(64)}@127.0.0.1:55432/hzense_local`,
      ]),
    ),
  };
}

test('real AI requires explicit mode and the complete local environment contract', () => {
  const env = localEnvironment();
  for (const mode of [undefined, '', 'mock', 'REAL', 'invalid']) {
    assert.equal(isLocalRealAi({ ...env, HZENSE_LOCAL_AI_MODE: mode }), false);
    assert.equal(isLocalMockAi({ ...env, HZENSE_LOCAL_AI_MODE: mode }), true);
  }
  const real = { ...env, HZENSE_LOCAL_AI_MODE: 'real' };
  assert.equal(isLocalRealAi(real), true);
  assert.equal(isLocalMockAi(real), false);
  for (const patch of [
    { NODE_ENV: 'production' },
    { VERCEL: '1' },
    { HZENSE_LOCAL_DEVELOPMENT: '0' },
    {
      HZENSE_AI_DATABASE_URL: env.HZENSE_AI_DATABASE_URL.replace('127.0.0.1', 'example.neon.tech'),
    },
  ]) {
    assert.equal(isLocalRealAi({ ...real, ...patch }), false);
    assert.equal(isLocalMockAi({ ...real, ...patch }), false);
  }
});

test('local source collection requires real AI, local Workflow world and explicit enablement', () => {
  const real = {
    ...localEnvironment(),
    HZENSE_LOCAL_AI_MODE: 'real',
    WORKFLOW_TARGET_WORLD: 'local',
    HZENSE_AUTOMATION_ENABLED: '1',
  };
  assert.equal(isLocalRealAutomationEnabled(real), true);
  for (const patch of [
    { HZENSE_LOCAL_AI_MODE: 'mock' },
    { HZENSE_LOCAL_AI_MODE: undefined },
    { WORKFLOW_TARGET_WORLD: 'vercel' },
    { WORKFLOW_TARGET_WORLD: undefined },
    { HZENSE_AUTOMATION_ENABLED: '0' },
    { HZENSE_AUTOMATION_ENABLED: undefined },
    { NODE_ENV: 'production' },
    { VERCEL: '1' },
    { HZENSE_LOCAL_DEVELOPMENT: '0' },
    {
      HZENSE_AUTOMATION_DATABASE_URL: real.HZENSE_AUTOMATION_DATABASE_URL.replace(
        '127.0.0.1',
        'example.neon.tech',
      ),
    },
  ])
    assert.equal(isLocalRealAutomationEnabled({ ...real, ...patch }), false);
});

test('local contract requires explicit development origin and validated role-specific local databases', () => {
  const env = localEnvironment();
  assert.equal(isLocalDevelopment(env), true);
  assert.equal(
    assertLocalDatabaseUrl(env.HZENSE_AI_DATABASE_URL, 'hzense_ai_admin', env),
    env.HZENSE_AI_DATABASE_URL,
  );
  assert.equal(
    assertLocalDatabaseUrl(env.HZENSE_AUTOMATION_DATABASE_URL, 'hzense_automation_admin', env),
    env.HZENSE_AUTOMATION_DATABASE_URL,
  );
  for (const [key, value] of [
    ['HZENSE_LOCAL_DEVELOPMENT', '0'],
    ['NODE_ENV', 'production'],
    ['PORT', '03000'],
    ['PORT', '65536'],
    ['NEXTAUTH_URL', 'http://localhost:3000'],
    ['VERCEL_ENV', 'production'],
    ['VERCEL', '1'],
    ['VERCEL_REGION', 'dev1'],
    ['CI', '1'],
    ['AWS_ACCESS_KEY_ID', 'synthetic'],
    ['NODE_TLS_REJECT_UNAUTHORIZED', '0'],
    ['DATABASE_URL', env.HZENSE_RUNTIME_DATABASE_URL],
    ['DATABASE_DIRECT_URL', env.HZENSE_RUNTIME_DATABASE_URL],
    ['OTHER_DATABASE_URL', env.HZENSE_RUNTIME_DATABASE_URL],
  ])
    assert.equal(isLocalDevelopment({ ...env, [key]: value }), false, key);
  for (const value of [
    env.HZENSE_AI_DATABASE_URL.replace('127.0.0.1', 'example.neon.tech'),
    env.HZENSE_AI_DATABASE_URL.replace('55432', '55433'),
    env.HZENSE_AI_DATABASE_URL.replace('hzense_local', 'postgres'),
    `${env.HZENSE_AI_DATABASE_URL}?sslmode=disable`,
    env.HZENSE_AI_DATABASE_URL.replace('hzense_ai_admin', 'hzense_local_owner'),
  ])
    assert.equal(isLocalDevelopment({ ...env, HZENSE_AI_DATABASE_URL: value }), false);
  for (const value of [
    env.HZENSE_AUTOMATION_DATABASE_URL.replace('127.0.0.1', 'example.neon.tech'),
    env.HZENSE_AUTOMATION_DATABASE_URL.replace('55432', '55433'),
    env.HZENSE_AUTOMATION_DATABASE_URL.replace('hzense_automation_admin', 'hzense_local_owner'),
  ])
    assert.equal(isLocalDevelopment({ ...env, HZENSE_AUTOMATION_DATABASE_URL: value }), false);
});

test('loopback requests reject cross-origin, rebinding and proxy targets', () => {
  const env = localEnvironment();
  const req = (overrides = {}, method = 'POST') => ({
    headers: new globalThis.Headers({
      host: '127.0.0.1:3000',
      origin: env.NEXTAUTH_URL,
      ...overrides,
    }),
    method,
    url: `${env.NEXTAUTH_URL}/api/admin/imports`,
  });
  assert.doesNotThrow(() => assertLocalDevelopmentRequest(req(), env));
  assert.equal(localRequestMatchesOrigin(req(), env.NEXTAUTH_URL, env), true);
  assert.equal(localRequestMatchesOrigin(req(), 'https://hzense.com', env), false);
  assert.equal(
    localRequestMatchesOrigin(req(), env.NEXTAUTH_URL, { ...env, NODE_ENV: 'production' }),
    false,
  );
  assert.doesNotThrow(() =>
    assertLocalDevelopmentRequest({ ...req(), url: 'http://localhost:3000/api/auth/csrf' }, env),
  );
  assert.throws(() => assertLocalDevelopmentRequest(req({ host: 'localhost:3000' }), env));
  assert.throws(() => assertLocalDevelopmentRequest(req({ origin: 'http://localhost:3000' }), env));
  assert.doesNotThrow(() =>
    assertLocalDevelopmentRequest(
      { headers: new globalThis.Headers({ host: '127.0.0.1:3000' }), method: 'GET' },
      env,
    ),
  );
  for (const overrides of [
    { host: 'attacker.invalid:3000' },
    { origin: 'https://attacker.invalid' },
    { 'sec-fetch-site': 'cross-site' },
    { 'x-forwarded-host': 'hzense.com' },
    { 'x-forwarded-proto': 'https' },
    { 'x-forwarded-port': '443' },
    { forwarded: 'host=hzense.com' },
  ])
    assert.throws(() => assertLocalDevelopmentRequest(req(overrides), env));
  assert.throws(() =>
    assertLocalDevelopmentRequest({ ...req(), url: 'https://hzense.com/admin' }, env),
  );
  assert.throws(() =>
    assertLocalDevelopmentRequest(
      { headers: new globalThis.Headers({ host: '127.0.0.1:3000' }), method: 'POST' },
      env,
    ),
  );
});
