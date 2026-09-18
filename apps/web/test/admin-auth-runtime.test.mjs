import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import process from 'node:process';
import { test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath, URL, URLSearchParams } from 'node:url';
import { encode } from 'next-auth/jwt';
import { chromium } from '@playwright/test';
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
      'AI browser pages hydrate safely on desktop and mobile',
      {
        skip: process.env.HZENSE_ADMIN_AUTH_BROWSER !== '1',
      },
      async () => {
        const browser = await chromium.launch();
        try {
          for (const [width, height] of [
            [1440, 1000],
            [390, 844],
          ]) {
            const context = await browser.newContext({ viewport: { width, height } });
            const cookie = await encryptedCookie(token);
            await context.addCookies([
              {
                name: 'next-auth.session-token',
                value: cookie.slice(cookie.indexOf('=') + 1),
                url: origin,
              },
            ]);
            await context.route('**/*', (route) =>
              route.request().url().startsWith(`${origin}/`) ? route.continue() : route.abort(),
            );
            const page = await context.newPage();
            const errors = [];
            page.on('pageerror', (error) => errors.push(error.message));
            for (const [path, title] of [
              ['/admin/ai', 'AI 连接与模型测试'],
              ['/admin/ai/profiles', '分阶段模型配置'],
            ]) {
              await page.goto(`${origin}${path}`);
              await page.getByRole('heading', { name: title, exact: true, level: 1 }).waitFor();
              assert.equal(await page.locator('form').getAttribute('method'), 'post');
              assert.equal(await page.locator('form button[type="submit"]').isDisabled(), true);
              assert.equal(
                await page.evaluate(
                  () =>
                    globalThis.document.documentElement.scrollWidth >
                    globalThis.document.documentElement.clientWidth,
                ),
                false,
              );
              await page.screenshot({
                path: `/tmp/hzense-ai-${path.endsWith('profiles') ? 'profiles' : 'connections'}-${width}.png`,
                fullPage: true,
              });
            }
            await page.goto(`${origin}/admin/ai`);
            const pending = {
              id: '00000000-0000-4000-8000-000000000001',
              connection_id: '00000000-0000-4000-8000-000000000002',
              connection_revision: 1,
              kind: 'connection',
              model_id: 'synthetic-model',
            };
            // A synthetic browser receipt tests navigation recovery, never a provider request.
            await page.evaluate(
              (receipt) =>
                globalThis.sessionStorage.setItem(
                  'hzense.ai.pending-probe.v1',
                  JSON.stringify(receipt),
                ),
              { version: 1, request: pending },
            );
            await page.reload();
            await page.getByText(`待确认测试：${pending.id}`, { exact: false }).waitFor();
            assert.equal(
              await page.getByRole('button', { name: '读取模型列表', exact: true }).isDisabled(),
              true,
            );
            assert.deepEqual(errors, []);
            await context.close();
          }
        } finally {
          await browser.close();
        }
      },
    );
    await t.test(
      'AI pages and APIs require real session; absent backend remains closed',
      async () => {
        const cookie = await encryptedCookie(token);
        for (const path of [
          '/admin/ai',
          '/admin/ai/profiles',
          '/admin/ai/tests/00000000-0000-4000-8000-000000000001',
        ]) {
          assert.equal((await request(path)).status, 307);
          const page = await request(path, { headers: { cookie } });
          assert.equal(page.status, 200);
          assert.match(page.headers.get('cache-control'), /no-store/);
          const html = await page.text();
          assert.match(html, /AI 后台尚未配置完成|测试记录暂不可用/);
          if (!path.includes('/tests/')) assert.match(html, /<form\b[^>]*method="post"/);
        }
        for (const path of [
          'connections',
          'profiles',
          'probes',
          'connections/00000000-0000-4000-8000-000000000001/history',
          'profiles/00000000-0000-4000-8000-000000000001/history',
          'probes/00000000-0000-4000-8000-000000000001',
        ]) {
          assert.equal((await request(`/api/admin/ai/${path}`)).status, 401);
          const response = await request(`/api/admin/ai/${path}`, { headers: { cookie } });
          assert.equal(response.status, 503);
          assert.deepEqual(await response.json(), { error: 'ai_not_configured' });
        }
        for (const path of ['connections', 'profiles', 'probes']) {
          const options = {
            method: 'POST',
            headers: { origin, cookie, 'content-type': 'application/json' },
            body: '{}',
          };
          const response = await request(`/api/admin/ai/${path}`, options);
          assert.equal(response.status, 503);
          assert.deepEqual(await response.json(), { error: 'ai_not_configured' });
          assert.equal(
            (
              await request(`/api/admin/ai/${path}`, {
                ...options,
                headers: { ...options.headers, origin: 'https://attacker.example' },
              })
            ).status,
            403,
          );
          assert.equal(
            (
              await request(`/api/admin/ai/${path}`, {
                ...options,
                headers: { origin, 'content-type': 'application/json' },
              })
            ).status,
            401,
          );
        }
      },
    );
    await t.test(
      'Signal workbench pages and GET APIs require a real session and a separate backend',
      async () => {
        const cookie = await encryptedCookie(token);
        for (const path of ['/admin/signals', '/admin/signals/synthetic-signal']) {
          const anonymous = await request(path);
          assert.equal(anonymous.status, 307);
          assert.equal(new URL(anonymous.headers.get('location'), origin).pathname, '/admin/login');
          const page = await request(path, { headers: { cookie } });
          assert.equal(page.status, 200);
          assert.match(page.headers.get('cache-control'), /no-store/);
        }
        for (const path of ['/api/admin/signals', '/api/admin/signals/synthetic-signal']) {
          for (const suffix of ['', '?unexpected=private-marker']) {
            const anonymous = await request(`${path}${suffix}`);
            assert.equal(anonymous.status, 401);
            assert.deepEqual(await anonymous.json(), { error: 'unauthorized' });
            assert.equal(anonymous.headers.get('cache-control'), 'private, no-store');
            assert.equal(anonymous.headers.get('x-robots-tag'), 'noindex, nofollow');
          }
          const unavailable = await request(path, { headers: { cookie } });
          assert.equal(unavailable.status, 503);
          assert.deepEqual(await unavailable.json(), { error: 'workbench_not_configured' });
          assert.equal(
            (await request(path, { headers: { cookie, origin: 'https://attacker.example' } }))
              .status,
            403,
          );
        }
      },
    );

    await t.test(
      'private generation pages and API are protected and disabled without independent configuration',
      async () => {
        const cookie = await encryptedCookie(token);
        for (const path of [
          '/admin/signal-generation',
          '/admin/signal-generation/11111111-1111-4111-8111-111111111111',
        ]) {
          assert.equal((await request(path)).status, 307);
          const page = await request(path, { headers: { cookie } });
          assert.equal(page.status, 200);
          assert.match(page.headers.get('cache-control'), /no-store/);
        }
        for (const method of ['GET', 'POST']) {
          const options =
            method === 'GET'
              ? {}
              : { method, headers: { origin, 'content-type': 'application/json' }, body: '{}' };
          assert.equal((await request('/api/admin/signal-generation', options)).status, 401);
          const response = await request('/api/admin/signal-generation', {
            ...options,
            headers: { ...options.headers, cookie },
          });
          assert.equal(response.status, 503);
          assert.deepEqual(await response.json(), { error: 'not_configured' });
          assert.match(response.headers.get('cache-control'), /no-store/);
        }
      },
    );
    await t.test(
      'generation preflight requires an administrator and stays safely unavailable without its own configuration',
      async () => {
        const path = '/api/admin/signal-generation/preflight';
        const options = {
          method: 'POST',
          headers: { origin, 'content-type': 'application/json' },
          body: '{}',
        };
        const anonymous = await request(path, options);
        assert.equal(anonymous.status, 401);
        assert.deepEqual(await anonymous.json(), { error: 'unauthorized' });
        assert.match(anonymous.headers.get('cache-control'), /no-store/);

        const cookie = await encryptedCookie(token);
        const response = await request(path, {
          ...options,
          headers: { ...options.headers, cookie },
        });
        assert.equal(response.status, 503);
        assert.deepEqual(await response.json(), {
          status: 'unavailable',
          checks: {
            configuration: false,
            connection: false,
            tls: false,
            identity: false,
            readOnly: false,
            permissions: false,
          },
          error: 'configuration_invalid',
        });
        assert.match(response.headers.get('cache-control'), /no-store/);
        assert.equal(response.headers.get('x-robots-tag'), 'noindex, nofollow');
      },
    );
    await t.test(
      'generation preflight rejects cross-site requests, input parameters and GET requests',
      async () => {
        const path = '/api/admin/signal-generation/preflight';
        const cookie = await encryptedCookie(token);
        const options = {
          method: 'POST',
          headers: { origin, cookie, 'content-type': 'application/json' },
          body: '{}',
        };
        for (const headers of [
          { ...options.headers, origin: 'https://attacker.example' },
          { cookie, 'content-type': 'application/json' },
          { ...options.headers, 'sec-fetch-site': 'cross-site' },
        ]) {
          const response = await request(path, { ...options, headers });
          assert.equal(response.status, 403);
          assert.deepEqual(await response.json(), { error: 'forbidden' });
          assert.match(response.headers.get('cache-control'), /no-store/);
        }
        for (const [suffix, body] of [
          ['?unexpected=synthetic-private-marker', '{}'],
          ['', '{"connectionString":"synthetic-private-marker"}'],
          ['', '[]'],
          ['', 'null'],
        ]) {
          const response = await request(`${path}${suffix}`, { ...options, body });
          assert.equal(response.status, 400);
          assert.deepEqual(await response.json(), { error: 'invalid_request' });
          assert.match(response.headers.get('cache-control'), /no-store/);
        }
        const get = await request(path, { headers: { cookie, origin } });
        assert.equal(get.status, 405);
      },
    );
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
        assert.match(html, /<form\b[^>]*method="post"/);
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
    await t.test(
      'Preview disables Signal workbench authentication even for the valid synthetic cookie',
      async () => {
        // Reuse the same canonical local origin, key and otherwise-valid claims;
        // only VERCEL_ENV changes. A different port would invalidate the origin
        // independently and would not prove the Preview deployment gate.
        child.kill('SIGTERM');
        await exited;
        const preview = spawn(process.execPath, child.spawnargs.slice(1), {
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
            VERCEL_ENV: 'preview',
          },
          stdio: ['ignore', 'pipe', 'pipe'],
        });
        let previewOutput = '';
        preview.stdout.on('data', (chunk) => {
          previewOutput += chunk;
        });
        preview.stderr.on('data', (chunk) => {
          previewOutput += chunk;
        });
        const previewExited = new Promise((resolve) => preview.once('exit', resolve));
        try {
          for (let count = 0; !previewOutput.includes('Ready in'); count++) {
            assert.equal(preview.exitCode, null, 'Synthetic Preview server failed to start');
            assert.ok(count < 200, 'Synthetic Preview server startup timed out');
            await delay(50);
          }
          const cookie = await encryptedCookie(token);
          for (const path of ['/admin/signals', '/admin/signals/synthetic-signal']) {
            const page = await request(path, { headers: { cookie } });
            assert.equal(page.status, 307);
            assert.equal(new URL(page.headers.get('location'), origin).pathname, '/admin/login');
          }
          for (const path of ['/api/admin/signals', '/api/admin/signals/synthetic-signal']) {
            const response = await request(path, { headers: { cookie } });
            assert.equal(response.status, 401);
            assert.deepEqual(await response.json(), { error: 'unauthorized' });
            assert.equal(response.headers.get('cache-control'), 'private, no-store');
          }
        } finally {
          if (preview.exitCode === null && preview.signalCode === null) preview.kill('SIGTERM');
          await previewExited;
        }
      },
    );
  },
);
