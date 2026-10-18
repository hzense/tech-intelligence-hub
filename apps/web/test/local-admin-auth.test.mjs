import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Buffer } from 'node:buffer';
import { randomBytes, randomUUID } from 'node:crypto';
import { fileURLToPath, URL } from 'node:url';
import { test } from 'node:test';
import { build } from 'esbuild';
import { getLocalAdminSession } from '../lib/local-admin-auth.ts';
import { localEnvironment } from './local-development.test.mjs';

const now = 1900000000000;
function request(overrides = {}, method = 'GET') {
  return {
    headers: new globalThis.Headers({ host: '127.0.0.1:3000', ...overrides }),
    method,
    url: 'http://127.0.0.1:3000/admin',
  };
}

test('strict local requests receive a request-scoped developer identity without tokens or cookies', () => {
  const env = localEnvironment();
  assert.equal(
    Object.keys(env).some((key) => /TOKEN|SECRET/.test(key)),
    false,
  );
  const session = getLocalAdminSession(request(), env, now);
  assert.deepEqual(session, {
    user: { id: 'local:developer', email: 'developer@localhost' },
    expires: new Date(now + 3600000).toISOString(),
  });
  assert.deepEqual(
    getLocalAdminSession(request({ cookie: 'next-auth.session-token=forged' }), env, now),
    session,
  );
  session.user.id = 'modified-by-caller';
  assert.equal(getLocalAdminSession(request(), env, now).user.id, 'local:developer');
});

test('production, deployment markers, missing explicit local mode and nonlocal databases never grant local identity', () => {
  const env = localEnvironment();
  for (const [key, value] of [
    ['HZENSE_LOCAL_DEVELOPMENT', undefined],
    ['HZENSE_LOCAL_DEVELOPMENT', '0'],
    ['NODE_ENV', 'production'],
    ['NODE_ENV', 'test'],
    ['VERCEL', '1'],
    ['VERCEL_ENV', 'production'],
    ['VERCEL_ENV', 'preview'],
    ['VERCEL_REGION', 'test-region'],
    ['CI', '1'],
    ['GITHUB_ACTIONS', 'true'],
    ['AWS_EXECUTION_ENV', 'AWS_Lambda_nodejs'],
    ['NEXTAUTH_URL', 'https://hzense.com'],
    [
      'HZENSE_RUNTIME_DATABASE_URL',
      env.HZENSE_RUNTIME_DATABASE_URL.replace('127.0.0.1', 'example.neon.tech'),
    ],
    [
      'HZENSE_AI_DATABASE_URL',
      env.HZENSE_AI_DATABASE_URL.replace('127.0.0.1', 'example.neon.tech'),
    ],
    ['DATABASE_URL', env.HZENSE_RUNTIME_DATABASE_URL],
  ]) {
    assert.equal(getLocalAdminSession(request(), { ...env, [key]: value }, now), null, key);
  }
});

test('local identity rejects cross-origin, DNS rebinding, forwarded authorities and unsafe requests without Origin', () => {
  const env = localEnvironment();
  for (const headers of [
    { host: 'localhost:3000' },
    { host: 'attacker.invalid:3000' },
    { host: '127.0.0.1:3001' },
    { origin: 'https://attacker.invalid' },
    { origin: 'http://localhost:3000' },
    { 'sec-fetch-site': 'cross-site' },
    { 'sec-fetch-site': 'same-site' },
    { 'x-forwarded-host': 'hzense.com' },
    { 'x-forwarded-proto': 'https' },
    { 'x-forwarded-port': '443' },
    { forwarded: 'host=hzense.com' },
  ]) {
    assert.equal(getLocalAdminSession(request(headers), env, now), null);
  }
  assert.equal(getLocalAdminSession(request({}, 'POST'), env, now), null);
  assert.ok(getLocalAdminSession(request({ origin: env.NEXTAUTH_URL }, 'POST'), env, now));
  assert.equal(
    getLocalAdminSession({ ...request(), url: 'https://hzense.com/admin' }, env, now),
    null,
  );
  assert.ok(getLocalAdminSession({ ...request(), url: 'http://localhost:3000/admin' }, env, now));
  assert.equal(getLocalAdminSession({ ...request(), url: 'not a URL' }, env, now), null);
});

async function loadServerAuth() {
  const entry = new URL('../lib/server/admin-auth.ts', import.meta.url);
  const adapters = {
    'server-only': '',
    'node:process':
      'export default {get env(){return globalThis.__localAdminAuthTest.environment}}',
    'next/headers':
      'export async function headers(){return globalThis.__localAdminAuthTest.headers}',
    'next/navigation': 'export function redirect(path){throw new Error(`redirect:${path}`)}',
    'next-auth': `export async function getServerSession(){const fixture=globalThis.__localAdminAuthTest;fixture.googleSessionCalls++;return fixture.googleSession}`,
    '../admin-auth-options':
      'export function createAdminAuthOptions(configuration){return {provider:"google",configuration}}',
  };
  const result = await build({
    stdin: {
      contents: await readFile(entry, 'utf8'),
      resolveDir: fileURLToPath(new URL('.', entry)),
      loader: 'ts',
    },
    bundle: true,
    write: false,
    platform: 'node',
    format: 'esm',
    plugins: [
      {
        name: 'isolated-server-auth-environment',
        setup(builder) {
          builder.onResolve({ filter: /.*/ }, ({ path }) =>
            Object.hasOwn(adapters, path) ? { path, namespace: 'fixture' } : undefined,
          );
          builder.onLoad({ filter: /.*/, namespace: 'fixture' }, ({ path }) => ({
            contents: adapters[path],
          }));
        },
      },
    ],
  });
  return import(
    `data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`
  );
}

test('server adapter skips login only for valid local requests and retains the production Google path', async () => {
  const fixture = {
    environment: localEnvironment(),
    headers: request().headers,
    googleSessionCalls: 0,
    googleSession: null,
  };
  globalThis.__localAdminAuthTest = fixture;
  try {
    const auth = await loadServerAuth();
    assert.equal(auth.getAdminAuthOptions(), null);
    assert.equal(auth.isAdminAuthConfigured(), true);
    assert.equal(auth.getAdminOrigin(), 'http://127.0.0.1:3000');
    assert.equal((await auth.getAdminSession()).user.id, 'local:developer');
    assert.equal(fixture.googleSessionCalls, 0);
    fixture.headers = request({ origin: 'https://attacker.invalid' }).headers;
    assert.equal(await auth.getAdminSession(), null);
    await assert.rejects(auth.requireAdminSession(), /redirect:\/admin\/login/);
    fixture.headers = request().headers;
    fixture.environment = { ...localEnvironment(), NODE_ENV: 'production' };
    assert.equal(auth.isAdminAuthConfigured(), false);
    assert.equal(auth.getAdminAuthOptions(), null);
    assert.equal(auth.getAdminOrigin(), null);
    assert.equal(await auth.getAdminSession(), null);
    assert.equal(fixture.googleSessionCalls, 0);

    // Synthetic values exist only in this isolated, fully stubbed test. Do not
    // retain provider-shaped client secrets as source-controlled fixtures.
    fixture.environment = {
      NODE_ENV: 'production',
      VERCEL_ENV: 'production',
      GOOGLE_CLIENT_ID: `${randomUUID()}.apps.googleusercontent.com`,
      GOOGLE_CLIENT_SECRET: randomBytes(32).toString('hex'),
      NEXTAUTH_SECRET: randomBytes(32).toString('hex'),
      NEXTAUTH_URL: 'https://hzense.com',
      HZENSE_ADMIN_EMAIL: 'admin.fixture@gmail.com',
    };
    assert.equal(auth.getAdminAuthOptions().provider, 'google');
    assert.equal(auth.isAdminAuthConfigured(), true);
    assert.equal(auth.getAdminOrigin(), 'https://hzense.com');
    assert.equal(await auth.getAdminSession(), null);
    assert.equal(fixture.googleSessionCalls, 1);
    const expires = new Date(Date.now() + 3600000).toISOString();
    fixture.googleSession = {
      user: { id: 'google:synthetic-account', email: 'admin.fixture@gmail.com' },
      authorizationExpiresAt: expires,
    };
    assert.deepEqual(await auth.getAdminSession(), { user: fixture.googleSession.user, expires });
    fixture.environment.HZENSE_LOCAL_DEVELOPMENT = '1';
    assert.equal(auth.getAdminAuthOptions(), null);
    assert.equal(auth.isAdminAuthConfigured(), false);
    assert.equal(await auth.getAdminSession(), null);
    assert.equal(fixture.googleSessionCalls, 2);
  } finally {
    delete globalThis.__localAdminAuthTest;
  }
});

test('local admin UI has no token form or misleading authenticated-account controls', async () => {
  const [buttons, login, home] = await Promise.all([
    readFile(new URL('../components/admin-auth-buttons.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../app/admin/login/page.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../app/admin/(protected)/page.tsx', import.meta.url), 'utf8'),
  ]);
  assert.doesNotMatch(buttons, /LocalSignInForm|local-login-token|一次性登录令牌/);
  assert.match(login, /if \(session\) redirect\('\/admin'\)/);
  assert.match(home, /本地开发后台/);
  assert.match(home, /无需登录/);
  assert.match(home, /!local \? <AdminSignOutButton \/>/);
  assert.match(home, /local \? '返回首页' : '返回网站'/);
});
