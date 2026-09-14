import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import process from 'node:process';
import test from 'node:test';
import pg from 'pg';
import { chromium, expect } from '@playwright/test';
import { validateConnectionTarget } from '../../../packages/database/src/connection-policy.mjs';
import { startAiAdminBrowserFixture } from './fixtures/ai-admin-browser/server.mjs';
import { createAiBrowserDatabase } from './fixtures/ai-admin-browser/database.mjs';
const { fetch } = globalThis;

// This opt-in test exercises real components -> real HTTP handler/executor ->
// real store -> actual restricted PostgreSQL role. It deliberately does NOT
// claim to verify Google login, Next routing, Neon TLS or production deployment.
test(
  'configured AI components / HTTP / PostgreSQL round trip (test adapter, not Next production)',
  {
    skip: process.env.HZENSE_AI_BROWSER_PG_TEST !== '1',
    timeout: 120_000,
  },
  async (t) => {
    const adminUrl = process.env.MIGRATION_TEST_ADMIN_URL;
    const isolatedCluster = process.env.RUNTIME_READER_TEST_ISOLATED_CLUSTER;
    assert.equal(isolatedCluster, '1', 'Disposable PostgreSQL cluster required');
    validateConnectionTarget({ connectionString: adminUrl, profile: 'local-test' });
    const administrator = new pg.Client({ connectionString: adminUrl });
    await administrator.connect();
    const isolatedDatabases = [];
    let database;
    let server;
    let browser;
    let context;
    t.after(async () => {
      try {
        await context?.close();
        await browser?.close();
      } finally {
        try {
          await server?.close();
        } finally {
          try {
            await database?.close();
          } finally {
            try {
              for (const saved of isolatedDatabases) {
                await administrator.query(
                  `REVOKE CONNECT,CREATE,TEMPORARY ON DATABASE "${saved.name}" FROM PUBLIC`,
                );
                for (const privilege of saved.privileges)
                  await administrator.query(
                    `GRANT ${privilege} ON DATABASE "${saved.name}" TO PUBLIC`,
                  );
              }
            } finally {
              await administrator.end();
            }
          }
        }
      }
    });
    const otherPublicPrivileges = (
      await administrator.query(`SELECT d.datname AS name,
        array_agg(a.privilege_type ORDER BY a.privilege_type) AS privileges
        FROM pg_catalog.pg_database d
        CROSS JOIN LATERAL pg_catalog.aclexplode(
          COALESCE(d.datacl,pg_catalog.acldefault('d',d.datdba))) a
        WHERE d.datallowconn AND a.grantee=0 GROUP BY d.datname ORDER BY d.datname`)
    ).rows;
    for (const saved of otherPublicPrivileges) {
      assert.ok(
        ['postgres', 'template1'].includes(saved.name),
        'AI browser fixture refuses to modify unrelated database ACLs',
      );
      assert.ok(
        saved.privileges.every((privilege) =>
          ['CONNECT', 'CREATE', 'TEMPORARY'].includes(privilege),
        ),
        'Unexpected fixture database privilege',
      );
    }
    // A stock disposable PostgreSQL cluster exposes postgres/template1 to PUBLIC.
    // Isolate only these known databases; restore their effective grants even if
    // fixture creation fails. Production provisioning never normalizes these ACLs.
    for (const saved of otherPublicPrivileges) {
      isolatedDatabases.push(saved);
      await administrator.query(
        `REVOKE CONNECT,CREATE,TEMPORARY ON DATABASE "${saved.name}" FROM PUBLIC`,
      );
    }
    database = await createAiBrowserDatabase({ adminUrl, isolatedCluster });
    const keyring = { active: 'test', keys: { test: Buffer.alloc(32, 7).toString('base64') } };
    const secret = 'synthetic-browser-fixture-key';
    const providerCalls = [];
    server = await startAiAdminBrowserFixture({
      pool: database.pool,
      keyring,
      allowedHosts: ['example.com'],
      invoke: async (request) => {
        assert.equal(request.apiKey, secret);
        providerCalls.push({ kind: request.kind, revision: request.connection.revision });
        const result =
          request.kind === 'models'
            ? { models: [{ id: 'synthetic-model' }], count: 1, truncated: false }
            : request.kind === 'connection'
              ? { sentinel_matched: true }
              : { schema_valid: true, sentinel_matched: true };
        return {
          success: true,
          model_id: request.modelId ?? null,
          input_tokens: 1,
          output_tokens: 1,
          result,
        };
      },
    });
    browser = await chromium.launch({ headless: true });
    context = await browser.newContext();
    context.setDefaultTimeout(8_000);
    const blockedRequests = [];
    await context.route('**/*', async (route) => {
      if (route.request().url().startsWith(`${server.origin}/`)) await route.continue();
      else {
        blockedRequests.push(route.request().url());
        await route.abort();
      }
    });
    const [cookieName, cookieValue] = server.cookie.split('=');
    await context.addCookies([
      {
        name: cookieName,
        value: cookieValue,
        url: server.origin,
        httpOnly: true,
        sameSite: 'Strict',
      },
    ]);
    const page = await context.newPage();
    const pageErrors = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    let connection;
    let profile;
    let createProfileRequest;
    const responseFor = (target, resource, method) =>
      target.waitForResponse(
        (response) =>
          response.url() === `${server.origin}/api/admin/ai/${resource}` &&
          response.request().method() === method,
      );
    async function sendFromBrowser(target, resource, method, body) {
      return target.evaluate(
        async ({ resource, method, body }) => {
          const response = await fetch(`/api/admin/ai/${resource}`, {
            method,
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          });
          return { status: response.status, body: await response.json() };
        },
        { resource, method, body },
      );
    }
    async function runProbe(target, label) {
      const pending = responseFor(target, 'probes', 'POST');
      await target.getByRole('button', { name: label, exact: true }).click();
      const response = await pending;
      assert.equal(response.status(), 200);
      const value = await response.json();
      assert.equal(value.probe.status, 'succeeded');
      await expect(target.getByRole('button', { name: label, exact: true })).toBeEnabled();
      return { request: response.request().postDataJSON(), receipt: value.probe };
    }
    await t.test('test-session absence still reaches the real authentication denial', async () => {
      const response = await fetch(`${server.origin}/api/admin/ai/connections`);
      assert.equal(response.status, 401);
      assert.deepEqual(await response.json(), { error: 'unauthorized' });
      assert.equal(providerCalls.length, 0);
      assert.equal(
        (await database.pool.query('SELECT count(*)::integer AS count FROM public.ai_connections'))
          .rows[0].count,
        0,
      );
    });
    await t.test(
      'real connection form persists a masked encrypted connection through HTTP',
      async () => {
        await page.goto(`${server.origin}/admin/ai`);
        assert.deepEqual(pageErrors, []);
        await expect(
          page.getByRole('heading', { name: '新建 AI 连接', exact: true }),
        ).toBeVisible();
        await page.getByLabel('连接名称', { exact: true }).fill('Browser fixture connection');
        await page.getByLabel('接口基础地址', { exact: true }).fill('https://example.com/v1');
        await page.getByLabel('API Key', { exact: true }).fill(secret);
        await page.getByRole('checkbox', { name: /允许此连接/ }).check();
        await page.getByLabel('输入单价（USD／百万 token）', { exact: true }).fill('1');
        await page.getByLabel('输出单价（USD／百万 token）', { exact: true }).fill('1');
        const pending = responseFor(page, 'connections', 'POST');
        await page.getByRole('button', { name: '保存连接', exact: true }).click();
        const response = await pending;
        assert.equal(response.status(), 200);
        connection = (await response.json()).connection;
        assert.equal(connection.revision, 1);
        assert.equal(connection.has_key, true);
        assert.equal(JSON.stringify(connection).includes(secret), false);
        const row = (
          await database.pool.query(
            'SELECT encrypted_key,revision FROM public.ai_connections WHERE id=$1',
            [connection.id],
          )
        ).rows[0];
        assert.equal(row.revision, 1);
        assert.equal(typeof row.encrypted_key, 'object');
        assert.equal(JSON.stringify(row.encrypted_key).includes(secret), false);
        assert.equal(providerCalls.length, 0);
      },
    );
    await t.test(
      'UI model/probe controls persist proofs; same request replays, conflicting request fails',
      async () => {
        await runProbe(page, '读取模型列表');
        await expect(page.locator('#ai-model-choices option')).toHaveAttribute(
          'value',
          'synthetic-model',
        );
        await page
          .getByLabel('模型 ID（列表选择或手动输入）', { exact: true })
          .fill('synthetic-model');
        const { request, receipt } = await runProbe(page, '测试基础连接');
        await runProbe(page, '测试结构化输出');
        const calls = providerCalls.length;
        assert.deepEqual(await sendFromBrowser(page, 'probes', 'POST', request), {
          status: 200,
          body: { probe: receipt },
        });
        assert.deepEqual(
          await sendFromBrowser(page, 'probes', 'POST', { ...request, kind: 'structured_output' }),
          { status: 409, body: { error: 'request_id_conflict' } },
        );
        assert.equal(providerCalls.length, calls);
      },
    );
    await t.test(
      'Profile UI creates with client UUID and safely retries the same ID after a committed response is lost',
      async () => {
        await page.goto(`${server.origin}/admin/ai/profiles`);
        await page.getByLabel('配置名称', { exact: true }).fill('Browser fixture profile');
        for (const stage of ['extract', 'verify', 'analyze']) {
          await page.locator(`select[name="${stage}.connection"]`).selectOption(connection.id);
          await page.locator(`input[name="${stage}.model"]`).fill('synthetic-model');
          await page.locator(`textarea[name="${stage}.prompt"]`).fill(`Synthetic ${stage} prompt`);
        }
        server.dropNextSuccessfulResponse('save-profile');
        const first = page.waitForRequest(
          (request) =>
            request.url().endsWith('/api/admin/ai/profiles') && request.method() === 'POST',
        );
        await page.getByRole('button', { name: '保存为新修订', exact: true }).click();
        createProfileRequest = (await first).postDataJSON();
        assert.match(createProfileRequest.id, /^[a-f0-9-]{36}$/);
        assert.equal(Object.hasOwn(createProfileRequest, 'expected_revision'), false);
        await expect(page.getByRole('status')).toContainText(
          /未确认|Failed to fetch|NetworkError|Load failed/,
        );
        await expect(page.getByRole('button', { name: '保存为新修订', exact: true })).toBeEnabled();
        const retry = responseFor(page, 'profiles', 'POST');
        await page.getByRole('button', { name: '保存为新修订', exact: true }).click();
        const response = await retry;
        assert.deepEqual(response.request().postDataJSON(), createProfileRequest);
        assert.equal(response.status(), 200);
        profile = (await response.json()).profile;
        assert.equal(profile.id, createProfileRequest.id);
        assert.equal(profile.revision, 1);
        const rows = await database.pool.query(
          'SELECT revision FROM public.ai_profile_versions WHERE profile_id=$1',
          [profile.id],
        );
        assert.deepEqual(rows.rows, [{ revision: 1 }]);
        await expect(page.getByRole('status')).toContainText('已保存配置 r1');
      },
    );
    await t.test(
      'Profile UI editing advances CAS revision; original create replay cannot create another version',
      async () => {
        await page.getByLabel('配置名称', { exact: true }).fill('Browser edited profile');
        const pending = responseFor(page, 'profiles', 'POST');
        await page.getByRole('button', { name: '保存为新修订', exact: true }).click();
        const response = await pending;
        assert.equal(response.request().postDataJSON().expected_revision, 1);
        assert.equal(response.status(), 200);
        profile = (await response.json()).profile;
        assert.equal(profile.revision, 2);
        const replay = await sendFromBrowser(page, 'profiles', 'POST', createProfileRequest);
        assert.deepEqual(replay, { status: 409, body: { error: 'request_id_conflict' } });
        assert.deepEqual(
          await sendFromBrowser(page, 'profiles', 'POST', {
            ...createProfileRequest,
            name: 'Conflicting profile',
          }),
          { status: 409, body: { error: 'request_id_conflict' } },
        );
        assert.deepEqual(
          (
            await database.pool.query(
              'SELECT revision FROM public.ai_profile_versions WHERE profile_id=$1 ORDER BY revision',
              [profile.id],
            )
          ).rows,
          [{ revision: 1 }, { revision: 2 }],
        );
      },
    );
    await t.test(
      'refreshing Profile connections adopts a new tested connection revision without a page reload',
      async () => {
        const consolePage = await context.newPage();
        try {
          await consolePage.goto(`${server.origin}/admin/ai`);
          await consolePage.getByRole('button', { name: '编辑', exact: true }).click();
          await consolePage
            .getByLabel('连接名称', { exact: true })
            .fill('Browser connection revision two');
          const pending = responseFor(consolePage, 'connections', 'PATCH');
          await consolePage.getByRole('button', { name: '保存连接', exact: true }).click();
          const response = await pending;
          assert.equal(response.status(), 200);
          connection = (await response.json()).connection;
          assert.equal(connection.revision, 2);
          await page.getByRole('button', { name: '刷新状态', exact: true }).click();
          await expect(
            page.locator('select[name="extract.connection"] option:checked'),
          ).toContainText('r2');
          const unqualified = responseFor(page, 'profiles', 'POST');
          await page.getByRole('button', { name: '保存为新修订', exact: true }).click();
          const unqualifiedResponse = await unqualified;
          assert.equal(unqualifiedResponse.status(), 409);
          assert.deepEqual(await unqualifiedResponse.json(), { error: 'profile_not_ready' });
          for (const stage of Object.values(unqualifiedResponse.request().postDataJSON().stages))
            assert.equal(stage.connection_revision, 2);
          assert.equal(
            (
              await database.pool.query('SELECT revision FROM public.ai_profiles WHERE id=$1', [
                profile.id,
              ])
            ).rows[0].revision,
            2,
          );
          await consolePage
            .getByLabel('模型 ID（列表选择或手动输入）', { exact: true })
            .fill('synthetic-model');
          await runProbe(consolePage, '测试基础连接');
          await runProbe(consolePage, '测试结构化输出');
          await page.getByRole('button', { name: '刷新状态', exact: true }).click();
          await expect(
            page.locator('select[name="extract.connection"] option:checked'),
          ).toContainText('r2');
          const saved = responseFor(page, 'profiles', 'POST');
          await page.getByRole('button', { name: '保存为新修订', exact: true }).click();
          const savedResponse = await saved;
          assert.equal(savedResponse.status(), 200);
          const submitted = savedResponse.request().postDataJSON();
          assert.equal(submitted.expected_revision, 2);
          for (const stage of Object.values(submitted.stages))
            assert.equal(stage.connection_revision, 2);
          profile = (await savedResponse.json()).profile;
          assert.equal(profile.revision, 3);
          assert.equal(profile.readiness.ready, true);
          const stored = (
            await database.pool.query('SELECT stages FROM public.ai_profiles WHERE id=$1', [
              profile.id,
            ])
          ).rows[0].stages;
          for (const stage of Object.values(stored)) assert.equal(stage.connection_revision, 2);
        } finally {
          await consolePage.close();
        }
      },
    );
    assert.deepEqual(pageErrors, []);
    assert.deepEqual(blockedRequests, []);
    if (process.env.HZENSE_AI_BROWSER_SCREENSHOT)
      await page.screenshot({ path: process.env.HZENSE_AI_BROWSER_SCREENSHOT, fullPage: true });
  },
);
