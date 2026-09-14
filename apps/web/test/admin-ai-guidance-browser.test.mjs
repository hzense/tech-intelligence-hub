import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { createServer } from 'node:http';
import { dirname, resolve } from 'node:path';
import process from 'node:process';
import test from 'node:test';
import { fileURLToPath, URL } from 'node:url';
import { build } from 'esbuild';
import { chromium, expect } from '@playwright/test';

const { fetch, structuredClone } = globalThis;
const directory = dirname(fileURLToPath(import.meta.url));
const gatewayBase = 'https://ai-gateway.vercel.sh/v1';
const openrouterBase = 'https://openrouter.ai/api/v1';
const syntheticKey = 'synthetic-guidance-fixture-key';
const replacementKey = 'synthetic-guidance-replacement-key';
const savedConnection = {
  id: '12345678-1234-4123-8123-123456789abc',
  revision: 1,
  name: 'Synthetic saved connection',
  protocol: 'openai-compatible',
  base_url: gatewayBase,
  enabled: false,
  settings: {
    timeout_ms: 10000,
    max_concurrency: 1,
    daily_budget_microusd: 1000000,
    input_price_microusd_per_million: 2000000,
    output_price_microusd_per_million: 3000000,
  },
  has_key: true,
  key_mask: '••••••••',
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
};

// Real AdminAiConsole and its fetch calls, but an entirely synthetic, loopback-only
// HTTP adapter. This does not verify Next routing, authentication, persistence,
// encryption, DNS, production allowlists, or provider compatibility/paid calls.
async function startGuidanceFixture() {
  const compiled = await build({
    stdin: {
      contents: `
        import { createRoot } from 'react-dom/client';
        import { AdminAiConsole } from './components/admin-ai-console';
        const response = await fetch('/__fixture/bootstrap');
        if (!response.ok) throw new Error('Synthetic bootstrap failed');
        const data = await response.json();
        createRoot(document.getElementById('root')).render(
          <AdminAiConsole initialConnections={data.connections} initialProbes={[]}
            configured available allowedHosts={data.allowedHosts} />
        );
      `,
      resolveDir: resolve(directory, '..'),
      sourcefile: 'guidance-fixture.tsx',
      loader: 'tsx',
    },
    absWorkingDir: resolve(directory, '..'),
    outfile: '/fixture/entry.js',
    bundle: true,
    write: false,
    platform: 'browser',
    format: 'esm',
    jsx: 'automatic',
    define: { 'process.env': '{}', 'process.env.NODE_ENV': '"production"' },
    logLevel: 'silent',
  });
  const assets = new Map(
    compiled.outputFiles.map((file) => [`/__fixture/${file.path.split('/').at(-1)}`, file]),
  );
  let origin;
  let connections = [];
  let allowedHosts = [];
  let failNextCreate = false;
  let failedCreateResponses = 0;
  const writes = [];
  const requests = [];
  const server = createServer(async (incoming, outgoing) => {
    try {
      const url = new URL(incoming.url, origin);
      requests.push({ method: incoming.method, path: url.pathname });
      const json = (value) => {
        outgoing.writeHead(200, {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-store',
        });
        outgoing.end(JSON.stringify(value));
      };
      if (url.pathname === '/__fixture/bootstrap') {
        json({ connections, allowedHosts });
      } else if (url.pathname === '/api/admin/ai/connections') {
        if (incoming.method === 'GET') {
          json({ connections });
          return;
        }
        if (!['POST', 'PATCH'].includes(incoming.method)) {
          outgoing.writeHead(405).end();
          return;
        }
        const chunks = [];
        for await (const chunk of incoming) chunks.push(chunk);
        const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        writes.push({ method: incoming.method, body });
        if (incoming.method === 'POST' && failNextCreate) {
          failNextCreate = false;
          failedCreateResponses += 1;
          outgoing.writeHead(503, {
            'Content-Type': 'application/json',
            'Cache-Control': 'no-store',
          });
          outgoing.end('{"error":"database_unavailable"}');
          return;
        }
        const previous = connections.find((item) => item.id === body.id);
        const suppliedFields = Object.fromEntries(
          ['name', 'protocol', 'base_url', 'enabled', 'settings']
            .filter((key) => Object.hasOwn(body, key))
            .map((key) => [key, body[key]]),
        );
        const connection = {
          ...savedConnection,
          ...previous,
          ...suppliedFields,
          id: body.id,
          revision: previous ? previous.revision + 1 : 1,
        };
        connections = [...connections.filter((item) => item.id !== body.id), connection];
        json({ connection });
      } else if (url.pathname === '/api/admin/ai/probes' && incoming.method === 'GET') {
        json({ probes: [] });
      } else if (assets.has(url.pathname)) {
        outgoing.writeHead(200, {
          'Content-Type': url.pathname.endsWith('.css') ? 'text/css' : 'text/javascript',
        });
        outgoing.end(assets.get(url.pathname).contents);
      } else if (url.pathname === '/admin/ai') {
        outgoing.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        outgoing.end(
          '<!doctype html><html lang="zh"><head><meta charset="utf-8"><link rel="stylesheet" href="/__fixture/entry.css"><title>Synthetic AI guidance fixture</title></head><body><h1>Local component guidance fixture</h1><main id="root">Loading synthetic fixture</main><script type="module" src="/__fixture/entry.js"></script></body></html>',
        );
      } else if (url.pathname === '/favicon.ico') {
        outgoing.writeHead(204).end();
      } else {
        outgoing.writeHead(404).end();
      }
    } catch {
      if (!outgoing.headersSent) outgoing.writeHead(500);
      outgoing.end('Synthetic fixture failure');
    }
  });
  await new Promise((accept, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', accept);
  });
  origin = `http://127.0.0.1:${server.address().port}`;
  return {
    origin,
    writes,
    requests,
    get failedCreateResponses() {
      return failedCreateResponses;
    },
    failNextConnectionCreate() {
      failNextCreate = true;
    },
    reset(data = {}) {
      connections = structuredClone(data.connections ?? []);
      allowedHosts = data.allowedHosts ?? ['ai-gateway.vercel.sh', 'openrouter.ai'];
      writes.length = 0;
      failNextCreate = false;
    },
    async close() {
      server.closeAllConnections();
      await new Promise((accept, reject) =>
        server.close((error) => (error ? reject(error) : accept())),
      );
    },
  };
}

test(
  'AI provider guidance in real components (synthetic HTTP; no database or provider)',
  { skip: process.env.HZENSE_AI_GUIDANCE_BROWSER_TEST !== '1', timeout: 120_000 },
  async (t) => {
    let fixture;
    let browser;
    let context;
    t.after(async () => {
      try {
        await context?.close();
        await browser?.close();
      } finally {
        await fixture?.close();
      }
    });
    fixture = await startGuidanceFixture();
    browser = await chromium.launch({ headless: true });
    context = await browser.newContext();
    context.setDefaultTimeout(8_000);
    const blockedRequests = [];
    await context.route('**/*', async (route) => {
      if (route.request().url().startsWith(`${fixture.origin}/`)) await route.continue();
      else {
        blockedRequests.push(route.request().url());
        await route.abort();
      }
    });
    const page = await context.newPage();
    const pageErrors = [];
    const consoleErrors = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error')
        consoleErrors.push({ text: message.text(), url: message.location().url });
    });
    const preset = () => page.getByRole('combobox', { name: '供应商预设', exact: true });
    const baseUrl = () => page.getByLabel('接口基础地址', { exact: true });
    const apiKey = () => page.getByLabel('API Key', { exact: true });
    const editKey = () => page.getByLabel('替换 API Key（不替换则留空）', { exact: true });
    const save = () => page.getByRole('button', { name: '保存连接', exact: true });
    async function mount(data) {
      fixture.reset(data);
      await page.goto(`${fixture.origin}/admin/ai`);
      await expect(page.getByRole('heading', { name: '新建 AI 连接', exact: true })).toBeVisible();
      await expect(preset()).toBeVisible();
      await expect(save()).toBeVisible();
    }
    async function fillNew() {
      await page.getByLabel('连接名称', { exact: true }).fill('Synthetic new connection');
      await apiKey().fill(syntheticKey);
      await page.getByLabel('每日估算预算（USD）', { exact: true }).fill('7');
      await page.getByLabel('输入单价（USD／百万 token）', { exact: true }).fill('2');
      await page.getByLabel('输出单价（USD／百万 token）', { exact: true }).fill('3');
    }
    async function expectNoWrites() {
      // A loopback read is a barrier after any earlier browser fetch submission.
      await page.evaluate(() => fetch('/__fixture/bootstrap').then((response) => response.json()));
      assert.equal(fixture.writes.length, 0);
    }
    async function expectSubmitted(method) {
      const response = page.waitForResponse(
        (item) =>
          item.url() === `${fixture.origin}/api/admin/ai/connections` &&
          item.request().method() === method,
      );
      await save().click();
      assert.equal((await response).status(), 200);
      await expect(page.getByRole('status').filter({ hasText: '连接已保存' })).toBeVisible();
      return fixture.writes.at(-1).body;
    }

    await t.test(
      'presets do not submit and preserve non-secret fields; endpoint changes clear keys',
      async () => {
        await mount();
        await fillNew();
        await preset().selectOption('openrouter');
        await expect(baseUrl()).toHaveValue(openrouterBase);
        await expect(apiKey()).toHaveValue('');
        await expect(page.getByLabel('连接名称', { exact: true })).toHaveValue(
          'Synthetic new connection',
        );
        await expect(page.getByLabel('每日估算预算（USD）', { exact: true })).toHaveValue('7');
        await expect(page.getByLabel('输入单价（USD／百万 token）', { exact: true })).toHaveValue(
          '2',
        );
        await expect(page.getByLabel('输出单价（USD／百万 token）', { exact: true })).toHaveValue(
          '3',
        );
        await apiKey().fill(syntheticKey);
        await preset().selectOption('openrouter');
        await expect(apiKey()).toHaveValue(syntheticKey);
        await preset().selectOption('custom');
        await expect(baseUrl()).toHaveValue(openrouterBase);
        await expect(apiKey()).toHaveValue(syntheticKey);
        await expectNoWrites();
      },
    );

    await t.test(
      'unapproved provider is explained and blocked before any HTTP mutation',
      async () => {
        await mount({ allowedHosts: ['ai-gateway.vercel.sh'] });
        await fillNew();
        await preset().selectOption('openrouter');
        await apiKey().fill(syntheticKey);
        await expect(page.locator('#ai-endpoint-guidance')).toContainText(
          'HZENSE_AI_ALLOWED_HOSTS',
        );
        await expect(page.locator('#ai-endpoint-guidance')).toContainText('重新部署');
        // Exercise the React guard as well as native form constraints.
        await page.locator('form').dispatchEvent('submit');
        await expectNoWrites();
        assert.equal((await page.locator('body').innerText()).includes(syntheticKey), false);
      },
    );

    await t.test(
      'URL diagnostics never echo credentials, query values, fragments or API keys',
      async () => {
        await mount();
        await fillNew();
        const markers = [
          'diagnostic-user',
          'diagnostic-password',
          'diagnostic-query',
          'diagnostic-fragment',
        ];
        await baseUrl().fill(
          `https://${markers[0]}:${markers[1]}@openrouter.ai/api/v1?api_key=${markers[2]}#${markers[3]}`,
        );
        await apiKey().fill(syntheticKey);
        await page.locator('form').dispatchEvent('submit');
        await expectNoWrites();
        const rendered = await page.locator('body').innerText();
        for (const marker of [...markers, syntheticKey])
          assert.equal(rendered.includes(marker), false);
        await expect(page.locator('#ai-endpoint-guidance')).not.toHaveText('');
      },
    );

    await t.test(
      'known request endpoint is corrected only by an explicit click, without submitting',
      async () => {
        await mount();
        await fillNew();
        const fullEndpoint = `${openrouterBase}/chat/completions`;
        await baseUrl().fill(fullEndpoint);
        await apiKey().fill(syntheticKey);
        const fix = page.getByRole('button', { name: '使用建议的基础地址', exact: true });
        await expect(fix).toBeVisible();
        await expect(baseUrl()).toHaveValue(fullEndpoint);
        await expectNoWrites();
        await fix.click();
        await expect(baseUrl()).toHaveValue(openrouterBase);
        await expect(apiKey()).toHaveValue('');
        await expectNoWrites();
        await apiKey().fill(replacementKey);
        const body = await expectSubmitted('POST');
        assert.equal(body.base_url, openrouterBase);
        assert.equal(body.api_key, replacementKey);
        assert.equal(body.name, 'Synthetic new connection');
        assert.equal(body.settings.daily_budget_microusd, 7000000);
      },
    );

    await t.test(
      'editing an endpoint clears replacement key and cannot reuse the stored key',
      async () => {
        await mount({ connections: [savedConnection] });
        await page.getByRole('button', { name: '编辑', exact: true }).click();
        await expect(editKey()).toHaveValue('');
        await editKey().fill(syntheticKey);
        await preset().selectOption('openrouter');
        await expect(baseUrl()).toHaveValue(openrouterBase);
        await expect(editKey()).toHaveValue('');
        await page.locator('form').dispatchEvent('submit');
        await expectNoWrites();
        await editKey().fill(replacementKey);
        const body = await expectSubmitted('PATCH');
        assert.equal(body.id, savedConnection.id);
        assert.equal(body.expected_revision, savedConnection.revision);
        assert.equal(body.base_url, openrouterBase);
        assert.equal(body.api_key, replacementKey);
      },
    );

    await t.test(
      'unchanged legacy endpoint is omitted from PATCH and preserves the stored address',
      async () => {
        const storedBaseUrl = `${openrouterBase}/`;
        await mount({ connections: [{ ...savedConnection, base_url: storedBaseUrl }] });
        await page.getByRole('button', { name: '编辑', exact: true }).click();
        await expect(baseUrl()).toHaveValue(storedBaseUrl);
        await expect(editKey()).toHaveValue('');
        await page.getByLabel('连接名称', { exact: true }).fill('Updated synthetic name');
        const body = await expectSubmitted('PATCH');
        assert.equal(Object.hasOwn(body, 'base_url'), false);
        assert.equal(Object.hasOwn(body, 'api_key'), false);
        assert.equal(body.name, 'Updated synthetic name');
        await expect(baseUrl()).toHaveValue(storedBaseUrl);
      },
    );

    await t.test(
      'legacy stored trailing slash is not normalized past the endpoint/key guard',
      async () => {
        await mount({ connections: [{ ...savedConnection, base_url: `${openrouterBase}/` }] });
        await page.getByRole('button', { name: '编辑', exact: true }).click();
        await editKey().fill(syntheticKey);
        await preset().selectOption('openrouter');
        await expect(baseUrl()).toHaveValue(openrouterBase);
        await expect(editKey()).toHaveValue('');
        await page.locator('form').dispatchEvent('submit');
        await expectNoWrites();
        await editKey().fill(replacementKey);
        const body = await expectSubmitted('PATCH');
        assert.equal(body.base_url, openrouterBase);
        assert.equal(body.api_key, replacementKey);
      },
    );

    await t.test(
      'same-endpoint preset changes preserve the create request ID after an unknown save outcome',
      async () => {
        await mount();
        await fillNew();
        fixture.failNextConnectionCreate();
        const response = page.waitForResponse(
          (item) =>
            item.url() === `${fixture.origin}/api/admin/ai/connections` &&
            item.request().method() === 'POST',
        );
        await save().click();
        assert.equal((await response).status(), 503);
        await expect(page.getByRole('status').filter({ hasText: '操作结果未确认' })).toBeVisible();
        assert.equal(fixture.writes.length, 1);
        const originalId = fixture.writes[0].body.id;
        assert.match(originalId, /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/);
        await preset().selectOption('custom');
        await expect(baseUrl()).toHaveValue(gatewayBase);
        await preset().selectOption('vercel-ai-gateway');
        await expect(baseUrl()).toHaveValue(gatewayBase);
        await expect(apiKey()).toHaveValue(syntheticKey);
        assert.equal(fixture.writes.length, 1);
        const retry = await expectSubmitted('POST');
        assert.equal(fixture.writes.length, 2);
        assert.equal(retry.id, originalId);
      },
    );

    await t.test(
      'new/edit transitions reset endpoint and key state without submitting',
      async () => {
        await mount({ connections: [savedConnection] });
        await fillNew();
        await preset().selectOption('openrouter');
        await apiKey().fill(syntheticKey);
        await page.getByRole('button', { name: '编辑', exact: true }).click();
        await expect(baseUrl()).toHaveValue(gatewayBase);
        await expect(editKey()).toHaveValue('');
        await expect(page.getByLabel('连接名称', { exact: true })).toHaveValue(
          savedConnection.name,
        );
        await editKey().fill(replacementKey);
        await page.getByRole('button', { name: '新建连接', exact: true }).click();
        await expect(baseUrl()).toHaveValue(gatewayBase);
        await expect(apiKey()).toHaveValue('');
        await expect(page.getByLabel('连接名称', { exact: true })).toHaveValue('');
        await expectNoWrites();
      },
    );

    assert.deepEqual(pageErrors, []);
    // Chromium may log the one intentional synthetic 503 used by the retry test.
    const expectedFailureLogs = consoleErrors.filter(
      (error) =>
        error.url === `${fixture.origin}/api/admin/ai/connections` &&
        /^Failed to load resource: the server responded with a status of 503\b/.test(error.text),
    );
    assert.deepEqual(
      consoleErrors.filter((error) => !expectedFailureLogs.includes(error)),
      [],
    );
    assert.equal(fixture.failedCreateResponses, 1);
    assert.ok(expectedFailureLogs.length <= fixture.failedCreateResponses);
    assert.deepEqual(blockedRequests, []);
    assert.equal(
      fixture.requests.some(
        (request) => request.path === '/api/admin/ai/probes' && request.method !== 'GET',
      ),
      false,
    );
  },
);
