import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import process from 'node:process';
import { test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath, URL, URLSearchParams } from 'node:url';
import { encode } from 'next-auth/jwt';
import { ADMIN_AUTHORIZATION_VERSION } from '../lib/admin-auth-policy.ts';

// Opt-in built-server regression, never a production endpoint or login bypass.
// The isolated child receives only synthetic OAuth values and a random secret.
// No Google requests, real accounts, inherited DB URLs or deployment credentials.
test(
  'built Next.js server enforces administrator authentication',
  {
    skip: process.env.HZENSE_ADMIN_AUTH_INTEGRATION !== '1',
    timeout: 60_000,
  },
  async (t) => {
    const origin = 'http://127.0.0.1:3000';
    const secret = randomBytes(32).toString('hex');
    const email = 'admin.fixture@gmail.com';
    const clientId = '123456-runtime.apps.googleusercontent.com';
    const child = spawn(
      process.execPath,
      [
        fileURLToPath(new URL('../node_modules/next/dist/bin/next', import.meta.url)),
        'start',
        '--hostname',
        '127.0.0.1',
        '--port',
        '3000',
      ],
      {
        cwd: fileURLToPath(new URL('../', import.meta.url)),
        env: {
          PATH: process.env.PATH,
          NODE_ENV: 'production',
          NEXT_TELEMETRY_DISABLED: '1',
          NEXTAUTH_URL: origin,
          NEXTAUTH_SECRET: secret,
          GOOGLE_CLIENT_ID: clientId,
          GOOGLE_CLIENT_SECRET: 'GOCSPX-synthetic-runtime-fixture',
          HZENSE_ADMIN_EMAIL: email,
          HZENSE_SEARCH_MODE: 'in-process',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    let output = '';
    child.stdout.on('data', (chunk) => {
      output += chunk;
    });
    child.stderr.on('data', (chunk) => {
      output += chunk;
    });
    const exited = new Promise((resolve) => child.once('exit', resolve));
    t.after(async () => {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
      await exited;
    });
    for (let count = 0; !output.includes('Ready in'); count += 1) {
      assert.equal(
        child.exitCode,
        null,
        'isolated server failed to start; build first and keep port 3000 free',
      );
      assert.ok(count < 200, 'isolated server startup timed out');
      await delay(50);
    }

    const now = Math.floor(Date.now() / 1000);
    const token = {
      sub: '100000000000000000001',
      googleSub: '100000000000000000001',
      provider: 'google',
      email,
      emailVerified: true,
      adminAuthorizationVersion: ADMIN_AUTHORIZATION_VERSION,
      issuedAt: now,
      adminClientId: clientId,
      adminOrigin: origin,
    };
    const encryptedCookie = async (claims, options = {}) =>
      `next-auth.session-token=${await encode({ token: claims, secret, maxAge: 3600, ...options })}`;
    const request = (path, options = {}) =>
      globalThis.fetch(`${origin}${path}`, { redirect: 'manual', ...options });

    await t.test('anonymous page redirects; API returns no-store 401', async () => {
      const page = await request('/admin');
      assert.equal(page.status, 307);
      assert.equal(new URL(page.headers.get('location'), origin).pathname, '/admin/login');
      const api = await request('/api/admin/session');
      assert.equal(api.status, 401);
      assert.deepEqual(await api.json(), { error: 'unauthorized' });
      assert.match(api.headers.get('cache-control'), /no-store/);
    });
    await t.test(
      'valid encrypted synthetic session traverses the real guard and preserves expiration',
      async () => {
        const cookie = await encryptedCookie(token);
        const api = await request('/api/admin/session', { headers: { cookie } });
        assert.equal(api.status, 200);
        assert.deepEqual(await api.json(), {
          user: { id: `google:${token.sub}`, email },
          expires: new Date((now + 3600) * 1000).toISOString(),
        });
        const page = await request('/admin', { headers: { cookie } });
        assert.equal(page.status, 200);
        assert.match(await page.text(), /管理员身份已验证/);
        assert.match(page.headers.get('cache-control'), /no-store/);
      },
    );
    for (const [name, claims, signingOptions] of [
      ['other email', { ...token, email: 'outsider@gmail.com' }],
      ['unverified', { ...token, emailVerified: false }],
      ['wrong client', { ...token, adminClientId: 'different.apps.googleusercontent.com' }],
      ['wrong origin', { ...token, adminOrigin: 'https://hzense.com' }],
      ['email only', { email }],
      ['absolute expiration with fresh rolling JWT', { ...token, issuedAt: now - 3601 }],
      ['expired encrypted JWT', token, { maxAge: -100 }],
      ['different signing secret', token, { secret: randomBytes(32).toString('hex') }],
    ]) {
      await t.test(`real guard denies ${name}`, async () => {
        const cookie = await encryptedCookie(claims, signingOptions);
        const api = await request('/api/admin/session', { headers: { cookie } });
        assert.equal(api.status, 401);
        assert.equal((await request('/admin', { headers: { cookie } })).status, 307);
      });
    }
    await t.test('tampered cookie is denied', async () => {
      assert.equal(
        (
          await request('/api/admin/session', {
            headers: { cookie: 'next-auth.session-token=forged' },
          })
        ).status,
        401,
      );
    });
    await t.test(
      'publication routes authenticate before parsing or opening a database connection',
      async () => {
        for (const operation of ['publish', 'withdraw']) {
          const response = await request(`/api/admin/signals/${operation}`, {
            method: 'POST',
            headers: { origin, 'content-type': 'application/json' },
            body: '{}',
          });
          assert.equal(response.status, 401);
          assert.deepEqual(await response.json(), { error: 'unauthorized' });
          assert.match(response.headers.get('cache-control'), /no-store/);
          const cookie = await encryptedCookie(token);
          const crossSite = await request(`/api/admin/signals/${operation}`, {
            method: 'POST',
            headers: {
              cookie,
              origin: 'https://attacker.example',
              'content-type': 'application/json',
            },
            body: '{}',
          });
          assert.equal(crossSite.status, 403);
        }
      },
    );
    await t.test(
      'authenticated administrator sees disabled publication and cannot use absent Publisher credential',
      async () => {
        const cookie = await encryptedCookie(token);
        const page = await request('/admin', { headers: { cookie } });
        const html = await page.text();
        assert.match(html, /受限信号发布/);
        assert.match(html, /发布服务尚未配置/);
        const response = await request('/api/admin/signals/withdraw', {
          method: 'POST',
          headers: { origin, cookie, 'content-type': 'application/json' },
          body: JSON.stringify({
            request_key: 'synthetic-withdraw',
            signal_id: 'test-signal',
            target_version: 3,
            expected_revision: 1,
            reason_code: 'privacy',
          }),
        });
        assert.equal(response.status, 503);
        assert.deepEqual(await response.json(), { error: 'publisher_not_configured' });
      },
    );
    await t.test('cross-site or absent Origin cannot POST authentication actions', async () => {
      for (const originHeader of [undefined, 'https://attacker.example']) {
        const headers = originHeader ? { origin: originHeader } : {};
        const result = await request('/api/auth/signout', { method: 'POST', headers });
        assert.equal(result.status, 403);
      }
    });
    await t.test('same-origin POST without CSRF cannot sign out an existing session', async () => {
      const cookie = await encryptedCookie(token);
      const result = await request('/api/auth/signout', {
        method: 'POST',
        headers: { origin, cookie, 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ callbackUrl: '/admin/login', json: 'true' }),
      });
      assert.equal(result.status, 200);
      assert.match((await result.json()).url, /\/api\/auth\/signout\?csrf=true$/);
      assert.ok(
        !result.headers
          .getSetCookie()
          .some((value) => value.startsWith('next-auth.session-token=;')),
      );
    });
    await t.test(
      'real CSRF-protected signout clears the cookie and rejects external redirect',
      async () => {
        const csrf = await request('/api/auth/csrf');
        assert.equal(csrf.status, 200);
        const { csrfToken } = await csrf.json();
        const cookie = [
          await encryptedCookie(token),
          ...csrf.headers.getSetCookie().map((value) => value.split(';')[0]),
        ].join('; ');
        const result = await request('/api/auth/signout', {
          method: 'POST',
          headers: { origin, cookie, 'content-type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            csrfToken,
            callbackUrl: 'https://attacker.example',
            json: 'true',
          }),
        });
        assert.equal(result.status, 200);
        assert.equal((await result.json()).url, `${origin}/admin`);
        assert.ok(
          result.headers
            .getSetCookie()
            .some((value) => value.startsWith('next-auth.session-token=;')),
        );
      },
    );
  },
);
