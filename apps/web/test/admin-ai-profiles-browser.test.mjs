import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { createServer } from 'node:http';
import { dirname, resolve } from 'node:path';
import process from 'node:process';
import test from 'node:test';
import { fileURLToPath, URL } from 'node:url';
import { build } from 'esbuild';
import { chromium, expect } from '@playwright/test';
import {
  aiProfileDefaultPrompts,
  aiProfileDefaultTemperature,
} from '../lib/admin-ai-profile-defaults.ts';

const { structuredClone } = globalThis;
const directory = dirname(fileURLToPath(import.meta.url));
const stageLabels = { extract: '信号提取', verify: '独立核验', analyze: '专题分析' };
const modelLabel = '模型 ID（搜索、选择或手动输入）';
const connectionA = {
  id: '12345678-1234-4123-8123-123456789abc',
  revision: 1,
  name: 'Synthetic connection A',
  protocol: 'openai-compatible',
  base_url: 'https://example.com/v1',
  enabled: true,
  has_key: true,
  key_mask: '••••••••',
  settings: {
    timeout_ms: 10000,
    max_concurrency: 1,
    daily_budget_microusd: 1000000,
    input_price_microusd_per_million: 0,
    output_price_microusd_per_million: 0,
  },
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
};
const connectionB = {
  ...connectionA,
  id: '22345678-1234-4123-8123-123456789abc',
  name: 'Synthetic connection B',
};
const modelsA = ['~provider/alpha-latest', 'provider/alpha-fixed'];
const modelsB = ['~provider/beta-latest'];
const modelsFor = (id) => (id === connectionA.id ? modelsA : modelsB);

function modelReceipt(connection = connectionA, extra = {}) {
  return {
    id: '32345678-1234-4123-8123-123456789abc',
    connection_id: connection.id,
    connection_revision: connection.revision,
    kind: 'models',
    model_id: null,
    status: 'succeeded',
    result: {
      models: modelsFor(connection.id).map((id) => ({ id })),
      count: modelsFor(connection.id).length,
      truncated: false,
    },
    created_at: new Date().toISOString(),
    reserved_microusd: 0,
    charged_microusd: 0,
    ...extra,
  };
}

const historicalProfile = {
  id: '42345678-1234-4123-8123-123456789abc',
  name: 'Historical synthetic profile',
  revision: 4,
  stages: Object.fromEntries(
    Object.keys(stageLabels).map((stage, index) => [
      stage,
      {
        connection_id: connectionA.id,
        connection_revision: 1,
        model_id: modelsA[0],
        prompt: `Historical ${stage} prompt: preserve exactly.`,
        temperature: [0, 1.2, 2][index],
        max_output_tokens: 2048,
        require_tools: false,
      },
    ]),
  ),
  readiness: { ready: true, reasons: [] },
};

// Actual Profiles component and HTTP calls; the adapter supplies only synthetic
// receipts and explicitly simulated readiness. It is not provider, auth, Next,
// encryption or database verification (the separate PostgreSQL suite covers DB).
async function startProfilesFixture() {
  const compiled = await build({
    stdin: {
      contents: `
        import { createRoot } from 'react-dom/client';
        import { AdminAiProfiles } from './components/admin-ai-profiles';
        const response = await fetch('/__fixture/bootstrap');
        if (!response.ok) throw new Error('Synthetic bootstrap failed');
        const data = await response.json();
        if (data.storageUnavailable) Object.defineProperty(globalThis, 'sessionStorage', {
          configurable: true, get() { throw new Error('Synthetic storage unavailable'); }
        });
        if (data.storageWriteUnavailable) Object.defineProperty(Storage.prototype, 'setItem', {
          configurable: true, value() { throw new Error('Synthetic storage write unavailable'); }
        });
        createRoot(document.getElementById('root')).render(
          <AdminAiProfiles connections={data.connections} initialProfiles={data.profiles}
            initialProbes={data.probes} configured available />
        );
      `,
      resolveDir: resolve(directory, '..'),
      sourcefile: 'profiles-fixture.tsx',
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
  let state;
  const requests = [];
  const allRequests = [];
  const expectedHttpErrors = [];
  const held = [];
  const server = createServer(async (incoming, outgoing) => {
    try {
      const url = new URL(incoming.url, origin);
      const request = { method: incoming.method, path: url.pathname };
      if (incoming.method !== 'GET') {
        const chunks = [];
        for await (const chunk of incoming) chunks.push(chunk);
        request.body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      }
      requests.push(request);
      allRequests.push(request);
      const json = (value, status = 200) => {
        if (status >= 400) expectedHttpErrors.push({ path: url.pathname, status });
        outgoing.writeHead(status, {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-store',
        });
        outgoing.end(JSON.stringify(value));
      };
      if (url.pathname === '/__fixture/bootstrap') {
        json(state);
      } else if (url.pathname === '/api/admin/ai/connections' && incoming.method === 'GET') {
        json({ connections: state.connections });
      } else if (url.pathname === '/api/admin/ai/profiles') {
        if (incoming.method === 'GET') json({ profiles: state.profiles });
        else if (incoming.method === 'POST') {
          if (!state.profileReady) {
            json({ error: 'profile_not_ready' }, 409);
            return;
          }
          const previous = state.profiles.find((row) => row.id === request.body.id);
          const profile = {
            ...request.body,
            revision: previous ? previous.revision + 1 : 1,
            readiness: { ready: true, reasons: [] },
          };
          delete profile.expected_revision;
          state.profiles = [...state.profiles.filter((row) => row.id !== profile.id), profile];
          json({ profile });
        } else outgoing.writeHead(405).end();
      } else if (url.pathname === '/api/admin/ai/probes') {
        if (incoming.method === 'GET') json({ probes: state.probes });
        else if (incoming.method === 'POST') {
          const connection = state.connections.find((row) => row.id === request.body.connection_id);
          const receipt = modelReceipt(connection, {
            ...request.body,
            status: state.probeStatus,
            ...(state.probeStatus === 'succeeded' ? {} : { result: null }),
          });
          state.probes = [...state.probes.filter((row) => row.id !== receipt.id), receipt];
          const respond = () => json({ probe: { ...receipt, ...state.responseOverride } });
          if (state.holdModels) held.push(respond);
          else respond();
        } else outgoing.writeHead(405).end();
      } else if (url.pathname.startsWith('/api/admin/ai/probes/') && incoming.method === 'GET') {
        const probe = state.probes.find((row) => row.id === url.pathname.split('/').at(-1));
        if (probe) json({ probe });
        else json({ error: 'not_found' }, 404);
      } else if (url.pathname.endsWith('/history') && incoming.method === 'GET') {
        json({
          history: state.profiles.map((profile) => ({
            revision: profile.revision,
            snapshot: profile,
          })),
        });
      } else if (assets.has(url.pathname)) {
        outgoing.writeHead(200, {
          'Content-Type': url.pathname.endsWith('.css') ? 'text/css' : 'text/javascript',
        });
        outgoing.end(assets.get(url.pathname).contents);
      } else if (url.pathname === '/admin/ai/profiles') {
        outgoing.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        outgoing.end(
          '<!doctype html><html lang="zh"><head><meta charset="utf-8"><link rel="stylesheet" href="/__fixture/entry.css"><title>Synthetic Profiles fixture</title></head><body><h1>Local Profiles component fixture</h1><main id="root">Loading fixture</main><script type="module" src="/__fixture/entry.js"></script></body></html>',
        );
      } else if (url.pathname === '/favicon.ico') outgoing.writeHead(204).end();
      else outgoing.writeHead(404).end();
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
    requests,
    allRequests,
    expectedHttpErrors,
    get profiles() {
      return state.profiles;
    },
    reset(data = {}) {
      assert.equal(held.length, 0, 'Complete synthetic held responses before resetting');
      state = {
        connections: structuredClone([connectionA, connectionB]),
        profiles: [],
        probes: [],
        probeStatus: 'succeeded',
        profileReady: false,
        storageUnavailable: false,
        holdModels: false,
        ...structuredClone(data),
      };
      requests.length = 0;
    },
    resolveProbe(id, status = 'succeeded') {
      state.probes = state.probes.map((probe) =>
        probe.id === id
          ? modelReceipt(
              state.connections.find((row) => row.id === probe.connection_id),
              {
                ...probe,
                status,
                result: {
                  models: modelsFor(probe.connection_id).map((model) => ({ id: model })),
                  count: modelsFor(probe.connection_id).length,
                  truncated: false,
                },
              },
            )
          : probe,
      );
    },
    replaceConnections(connections) {
      state.connections = structuredClone(connections);
    },
    seedProbe(probe) {
      state.probes = [structuredClone(probe), ...state.probes.filter((row) => row.id !== probe.id)];
    },
    releaseModels() {
      for (const respond of held.splice(0)) respond();
    },
    async close() {
      for (const respond of held.splice(0)) respond();
      server.closeAllConnections();
      await new Promise((accept, reject) =>
        server.close((error) => (error ? reject(error) : accept())),
      );
    },
  };
}

test(
  'Profiles model discovery and defaults in real components (synthetic HTTP only)',
  { skip: process.env.HZENSE_AI_GUIDANCE_BROWSER_TEST !== '1', timeout: 120_000 },
  async (t) => {
    let fixture;
    let browser;
    let context;
    let page;
    const pageErrors = [];
    const consoleErrors = [];
    const blockedRequests = [];
    t.after(async () => {
      try {
        await context?.close();
        await browser?.close();
      } finally {
        await fixture?.close();
      }
    });
    fixture = await startProfilesFixture();
    browser = await chromium.launch({ headless: true });
    async function mount(data = {}) {
      await context?.close();
      fixture.reset(data);
      context = await browser.newContext();
      context.setDefaultTimeout(8_000);
      await context.route('**/*', async (route) => {
        if (route.request().url().startsWith(`${fixture.origin}/`)) await route.continue();
        else {
          blockedRequests.push(route.request().url());
          await route.abort();
        }
      });
      page = await context.newPage();
      page.on('pageerror', (error) => pageErrors.push(error.message));
      page.on('console', (message) => {
        if (message.type() === 'error')
          consoleErrors.push({ text: message.text(), url: message.location().url });
      });
      await page.goto(`${fixture.origin}/admin/ai/profiles`);
      await expect(
        page.getByRole('heading', { name: '新建分阶段配置', exact: true }),
      ).toBeVisible();
    }
    const group = (stage) => page.getByRole('group', { name: stageLabels[stage], exact: true });
    const model = (stage) => group(stage).getByRole('combobox', { name: modelLabel, exact: true });
    const connection = (stage) => group(stage).locator(`select[name="${stage}.connection"]`);
    const prompt = (stage) => group(stage).locator(`textarea[name="${stage}.prompt"]`);
    const posts = (path = 'probes') =>
      fixture.requests.filter(
        (request) => request.method === 'POST' && request.path === `/api/admin/ai/${path}`,
      );
    async function barrier() {
      await page.evaluate(() =>
        globalThis.fetch('/__fixture/bootstrap').then((response) => response.json()),
      );
    }
    async function choose(stage, id) {
      await group(stage).getByRole('button', { name: '展开模型列表', exact: true }).click();
      await group(stage).getByRole('option', { name: id, exact: true }).click();
      await expect(model(stage)).toHaveValue(id);
    }

    await t.test(
      'new stages have distinct default prompts, no temperature controls and independent accessible pickers',
      async () => {
        await mount({ probes: [modelReceipt()] });
        const inputIds = [];
        const listIds = [];
        for (const stage of Object.keys(stageLabels)) {
          await expect(model(stage)).toHaveCount(1);
          await expect(model(stage)).toHaveAttribute('name', `${stage}.model`);
          await expect(prompt(stage)).toHaveValue(aiProfileDefaultPrompts[stage]);
          await expect(
            group(stage).getByRole('spinbutton', { name: '输出 token 上限' }),
          ).toHaveValue(stage === 'extract' ? '8192' : '2048');
          inputIds.push(await model(stage).getAttribute('id'));
          await connection(stage).selectOption(connectionA.id);
          await group(stage).getByRole('button', { name: '展开模型列表', exact: true }).click();
          const list = group(stage).getByRole('listbox', { name: '可选模型', exact: true });
          listIds.push(await list.getAttribute('id'));
          await expect(model(stage)).toHaveAttribute('aria-controls', listIds.at(-1));
          await expect(list.getByRole('option')).toHaveText(modelsA);
          await group(stage).getByRole('option', { name: modelsA[0], exact: true }).click();
        }
        assert.equal(new Set(inputIds).size, 3);
        assert.equal(new Set(listIds).size, 3);
        await expect(
          page.locator('input[name$=".temperature"], select[name$=".model"], datalist'),
        ).toHaveCount(0);
        await expect(page.getByLabel(/温度/)).toHaveCount(0);
        await barrier();
        assert.equal(posts().length, 0);
        assert.equal(posts('profiles').length, 0);
      },
    );

    await t.test(
      'uncached selection makes one models-only request shared by all three stages',
      async () => {
        await mount();
        await barrier();
        assert.equal(posts().length, 0);
        await connection('extract').selectOption(connectionA.id);
        await expect.poll(() => posts().length).toBe(1);
        await choose('extract', modelsA[0]);
        for (const stage of ['verify', 'analyze']) {
          await connection(stage).selectOption(connectionA.id);
          await choose(stage, modelsA[0]);
        }
        await barrier();
        assert.equal(posts().length, 1);
        assert.deepEqual(Object.keys(posts()[0].body).sort(), [
          'connection_id',
          'connection_revision',
          'id',
          'kind',
        ]);
        assert.equal(posts()[0].body.kind, 'models');
        assert.equal(posts()[0].body.connection_id, connectionA.id);
        assert.equal(posts()[0].body.connection_revision, 1);
        assert.match(posts()[0].body.id, /^[a-f0-9-]{36}$/);
        assert.equal(posts('profiles').length, 0);
      },
    );

    await t.test(
      'an in-flight list read persists its ID first and blocks competing stage changes',
      async () => {
        await mount({ holdModels: true });
        try {
          await connection('extract').selectOption(connectionA.id);
          await expect.poll(() => posts().length).toBe(1);
          const pending = await page.evaluate(() =>
            JSON.parse(globalThis.sessionStorage.getItem('hzense.ai.pending-probe.v1')),
          );
          assert.equal(pending.version, 1);
          assert.deepEqual(pending.request, posts()[0].body);
          for (const stage of Object.keys(stageLabels)) {
            await expect(connection(stage)).toBeDisabled();
            await expect(model(stage)).toBeDisabled();
          }
          await expect(
            page.getByRole('button', { name: '保存为新修订', exact: true }),
          ).toBeDisabled();
        } finally {
          fixture.releaseModels();
        }
        await choose('extract', modelsA[0]);
        await connection('verify').selectOption(connectionA.id);
        await choose('verify', modelsA[1]);
        await barrier();
        assert.equal(posts().length, 1);
      },
    );

    await t.test(
      'changing connections clears only that model and cannot display another connection list',
      async () => {
        await mount({
          probes: [
            modelReceipt(),
            modelReceipt(connectionB, { id: '52345678-1234-4123-8123-123456789abc' }),
          ],
        });
        await connection('extract').selectOption(connectionA.id);
        await choose('extract', modelsA[0]);
        await connection('verify').selectOption(connectionA.id);
        await choose('verify', modelsA[1]);
        await prompt('extract').fill('User-authored prompt must survive connection selection.');
        await connection('extract').selectOption(connectionB.id);
        await expect(model('extract')).toHaveValue('');
        await expect(model('verify')).toHaveValue(modelsA[1]);
        await expect(prompt('extract')).toHaveValue(
          'User-authored prompt must survive connection selection.',
        );
        await group('extract').getByRole('button', { name: '展开模型列表', exact: true }).click();
        await expect(group('extract').getByRole('listbox').getByRole('option')).toHaveText(modelsB);
        await model('extract').fill('~provider/manual-beta');
        await expect(model('extract')).toHaveValue('~provider/manual-beta');
        await expect(group('extract').getByRole('listbox').getByRole('option')).toHaveCount(0);
        await barrier();
        assert.equal(posts().length, 0);
      },
    );

    await t.test(
      'a mismatched revision cache is not reused and refreshed models never run capability tests',
      async () => {
        await mount({
          connections: [{ ...connectionA, revision: 2 }, connectionB],
          probes: [modelReceipt()],
        });
        await connection('extract').selectOption(connectionA.id);
        await expect.poll(() => posts().length).toBe(1);
        await choose('extract', modelsA[0]);
        assert.equal(posts()[0].body.connection_revision, 2);
        await barrier();
        assert.equal(posts().length, 1);
      },
    );

    await t.test(
      'refreshing connection revisions invalidates only affected stage models without automatic POST',
      async () => {
        await mount({
          probes: [
            modelReceipt(),
            modelReceipt(connectionB, { id: '52345678-1234-4123-8123-123456789abc' }),
          ],
        });
        await connection('extract').selectOption(connectionA.id);
        await choose('extract', modelsA[0]);
        await connection('verify').selectOption(connectionB.id);
        await choose('verify', modelsB[0]);
        await prompt('extract').fill('Unsaved prompt survives revision refresh.');
        fixture.replaceConnections([{ ...connectionA, revision: 2 }, connectionB]);
        await page.getByRole('button', { name: '刷新状态', exact: true }).click();
        await expect(model('extract')).toHaveValue('');
        await expect(model('verify')).toHaveValue(modelsB[0]);
        await expect(prompt('extract')).toHaveValue('Unsaved prompt survives revision refresh.');
        await group('extract').getByRole('button', { name: '展开模型列表', exact: true }).click();
        await expect(group('extract').getByRole('listbox').getByRole('option')).toHaveCount(0);
        await barrier();
        assert.equal(posts().length, 0);
        await group('extract')
          .getByRole('button', { name: '重新读取模型列表', exact: true })
          .click();
        await expect.poll(() => posts().length).toBe(1);
        assert.equal(posts()[0].body.connection_revision, 2);
        await choose('extract', modelsA[0]);
        fixture.replaceConnections([connectionB]);
        await page.getByRole('button', { name: '刷新状态', exact: true }).click();
        await expect(connection('extract')).toHaveValue('');
        await expect(model('extract')).toHaveValue('');
        await expect(model('extract')).toBeDisabled();
        await expect(model('verify')).toHaveValue(modelsB[0]);
        await barrier();
        assert.equal(posts().length, 1);
      },
    );

    await t.test(
      'unknown discovery retains its original ID and recovers only through receipt GET',
      async () => {
        await mount({ probeStatus: 'unknown' });
        await connection('extract').selectOption(connectionA.id);
        await expect.poll(() => posts().length).toBe(1);
        const original = posts()[0].body;
        const query = page.getByRole('button', { name: '查询原编号', exact: true });
        await expect(query).toBeVisible();
        await model('extract').fill('~provider/manual-while-unknown');
        await connection('verify').selectOption(connectionB.id);
        await expect(
          group('verify').getByRole('button', { name: '重新读取模型列表', exact: true }),
        ).toBeDisabled();
        await query.click();
        await barrier();
        assert.equal(posts().length, 1);
        assert.ok(
          fixture.requests.some(
            (request) =>
              request.method === 'GET' && request.path === `/api/admin/ai/probes/${original.id}`,
          ),
        );
        fixture.resolveProbe(original.id);
        await page.reload();
        await expect(
          page.getByRole('heading', { name: '新建分阶段配置', exact: true }),
        ).toBeVisible();
        await barrier();
        assert.equal(posts().length, 1, 'Reload never generates a replacement request ID');
        await query.click();
        await connection('extract').selectOption(connectionA.id);
        await choose('extract', modelsA[0]);
        await connection('verify').selectOption(connectionA.id);
        await choose('verify', modelsA[0]);
        await barrier();
        assert.equal(posts().length, 1);
        assert.equal(posts()[0].body.id, original.id);
      },
    );

    await t.test(
      'mismatched receipts cannot release the original pending ID or populate the current catalogue',
      async () => {
        for (const responseOverride of [
          { id: '62345678-1234-4123-8123-123456789abc' },
          { connection_id: connectionB.id },
          { connection_revision: 99 },
          { kind: 'connection' },
          { status: 'invalid-terminal-status' },
        ]) {
          await mount({ responseOverride });
          await connection('extract').selectOption(connectionA.id);
          await expect.poll(() => posts().length).toBe(1);
          await expect(connection('extract')).toBeEnabled();
          const original = posts()[0].body;
          const pending = await page.evaluate(() =>
            JSON.parse(globalThis.sessionStorage.getItem('hzense.ai.pending-probe.v1')),
          );
          assert.deepEqual(pending.request, original);
          await group('extract').getByRole('button', { name: '展开模型列表', exact: true }).click();
          await expect(group('extract').getByRole('listbox').getByRole('option')).toHaveCount(0);
          await page.getByRole('button', { name: '查询原编号', exact: true }).click();
          await expect(page.getByRole('button', { name: '查询原编号', exact: true })).toHaveCount(
            0,
          );
          await choose('extract', modelsA[0]);
          await barrier();
          assert.equal(posts().length, 1);
        }
      },
    );

    await t.test('a late response for X cannot remove a newer pending request Y', async () => {
      await mount({ holdModels: true });
      const newer = {
        id: '72345678-1234-4123-8123-123456789abc',
        connection_id: connectionB.id,
        connection_revision: 1,
        kind: 'models',
      };
      try {
        await connection('extract').selectOption(connectionA.id);
        await expect.poll(() => posts().length).toBe(1);
        assert.notEqual(posts()[0].body.id, newer.id);
        // Another view using this tab's shared pending slot has already recovered
        // X and started Y; X's older component callback has not returned yet.
        await page.evaluate((request) => {
          globalThis.sessionStorage.setItem(
            'hzense.ai.pending-probe.v1',
            JSON.stringify({ version: 1, request }),
          );
          globalThis.dispatchEvent(new globalThis.Event('storage'));
        }, newer);
        fixture.seedProbe(modelReceipt(connectionB, { ...newer, status: 'unknown', result: null }));
      } finally {
        fixture.releaseModels();
      }
      await expect(connection('extract')).toBeEnabled();
      const pending = await page.evaluate(() =>
        JSON.parse(globalThis.sessionStorage.getItem('hzense.ai.pending-probe.v1')),
      );
      assert.deepEqual(pending.request, newer);
      await connection('verify').selectOption(connectionB.id);
      await expect(
        group('verify').getByRole('button', { name: '重新读取模型列表', exact: true }),
      ).toBeDisabled();
      fixture.resolveProbe(newer.id);
      await page.getByRole('button', { name: '查询原编号', exact: true }).click();
      await choose('verify', modelsB[0]);
      await barrier();
      assert.equal(posts().length, 1);
      assert.ok(
        fixture.requests.some(
          (request) =>
            request.method === 'GET' && request.path === `/api/admin/ai/probes/${newer.id}`,
        ),
      );
    });

    await t.test(
      'failed discovery does not automatically issue a new ID and retains manual fallback',
      async () => {
        await mount({ probeStatus: 'failed' });
        await connection('extract').selectOption(connectionA.id);
        await expect.poll(() => posts().length).toBe(1);
        await model('extract').fill('~provider/manual-after-failure');
        await expect(model('extract')).toHaveValue('~provider/manual-after-failure');
        await connection('verify').selectOption(connectionA.id);
        await model('verify').fill('provider/another-manual');
        await barrier();
        assert.equal(posts().length, 1);
        const originalId = posts()[0].body.id;
        await group('extract')
          .getByRole('button', { name: '重新读取模型列表', exact: true })
          .click();
        await expect.poll(() => posts().length).toBe(2);
        assert.notEqual(
          posts()[1].body.id,
          originalId,
          'Only explicit completed-failure retry creates a new ID',
        );
      },
    );

    await t.test(
      'unavailable session storage prevents automatic probe POST without hiding default prompts',
      async () => {
        await mount({ storageUnavailable: true });
        await connection('extract').selectOption(connectionA.id);
        await expect(prompt('extract')).toHaveValue(aiProfileDefaultPrompts.extract);
        await barrier();
        assert.equal(posts().length, 0);
        assert.equal(posts('profiles').length, 0);
        await expect(page.getByText(/会话存储/).first()).toBeVisible();
      },
    );

    await t.test(
      'session storage write failure prevents POST even when reading storage succeeds',
      async () => {
        await mount({ storageWriteUnavailable: true });
        await connection('extract').selectOption(connectionA.id);
        await barrier();
        assert.equal(posts().length, 0);
        await expect(prompt('extract')).toHaveValue(aiProfileDefaultPrompts.extract);
        await model('extract').fill('provider/manual-storage-fallback');
        await expect(model('extract')).toHaveValue('provider/manual-storage-fallback');
        assert.equal(posts('profiles').length, 0);
      },
    );

    await t.test(
      'old capability proofs show an advisory without marking the profile unavailable',
      async () => {
        await mount({
          profiles: [
            {
              ...historicalProfile,
              readiness: {
                ready: true,
                reasons: [],
                warnings: ['extract:connection_test_old'],
              },
            },
          ],
          probes: [modelReceipt()],
        });
        await expect(page.getByText('测试证明有效', { exact: true })).toBeVisible();
        await expect(
          page.getByRole('status').filter({ hasText: '部分能力测试已超过 24 小时' }),
        ).toBeVisible();
        await expect(page.getByRole('button', { name: '编辑新修订', exact: true })).toBeEnabled();
        assert.equal(posts().length, 0);
      },
    );

    await t.test(
      'typing and selecting with Enter never implicitly submit a complete Profile form',
      async () => {
        await mount({ probes: [modelReceipt()], profileReady: true });
        await page.getByLabel('配置名称', { exact: true }).fill('Synthetic complete form');
        for (const stage of Object.keys(stageLabels)) {
          await connection(stage).selectOption(connectionA.id);
          await choose(stage, modelsA[0]);
        }
        await model('extract').fill('ALPHA');
        await model('extract').press('Enter');
        await expect(model('extract')).toHaveValue('ALPHA');
        await model('extract').press('ArrowDown');
        await model('extract').press('Enter');
        await expect(model('extract')).toHaveValue(modelsA[0]);
        await model('verify').fill('~provider/manual-no-match');
        await model('verify').press('Enter');
        await expect(model('verify')).toHaveValue('~provider/manual-no-match');
        await barrier();
        assert.equal(posts('profiles').length, 0);
        assert.equal(posts().length, 0);
      },
    );

    await t.test(
      'saving new defaults posts temperature 0.7 and remains subject to server readiness',
      async () => {
        await mount({ probes: [modelReceipt()] });
        await page.getByLabel('配置名称', { exact: true }).fill('Synthetic unqualified profile');
        for (const stage of Object.keys(stageLabels)) {
          await connection(stage).selectOption(connectionA.id);
          await choose(stage, modelsA[0]);
        }
        const response = page.waitForResponse(
          (item) =>
            item.url().endsWith('/api/admin/ai/profiles') && item.request().method() === 'POST',
        );
        await page.getByRole('button', { name: '保存为新修订', exact: true }).click();
        assert.equal((await response).status(), 409);
        await expect(page.getByRole('status').filter({ hasText: /结构化输出测试/ })).toBeVisible();
        for (const [stage, value] of Object.entries(posts('profiles')[0].body.stages)) {
          assert.equal(value.prompt, aiProfileDefaultPrompts[stage]);
          assert.equal(value.temperature, aiProfileDefaultTemperature);
          assert.equal(value.temperature, 0.7);
          assert.equal(value.model_id, modelsA[0]);
        }
        assert.equal(fixture.profiles.length, 0);
        assert.equal(posts().length, 0);
      },
    );

    await t.test(
      'editing preserves historical prompts and temperatures until an explicit new revision save',
      async () => {
        await mount({
          profiles: [historicalProfile],
          probes: [modelReceipt()],
          profileReady: true,
        });
        await page.getByRole('button', { name: '编辑新修订', exact: true }).click();
        for (const stage of Object.keys(stageLabels)) {
          await expect(prompt(stage)).toHaveValue(historicalProfile.stages[stage].prompt);
          await expect(
            group(stage).getByRole('spinbutton', { name: '输出 token 上限' }),
          ).toHaveValue('2048');
          await expect(model(stage)).toHaveValue(modelsA[0]);
        }
        await barrier();
        assert.deepEqual(fixture.profiles, [historicalProfile]);
        assert.equal(posts('profiles').length, 0);
        await prompt('extract').fill('User revised historical extract prompt.');
        await page.getByRole('button', { name: '刷新状态', exact: true }).click();
        await expect(prompt('extract')).toHaveValue('User revised historical extract prompt.');
        const response = page.waitForResponse(
          (item) =>
            item.url().endsWith('/api/admin/ai/profiles') && item.request().method() === 'POST',
        );
        await page.getByRole('button', { name: '保存为新修订', exact: true }).click();
        assert.equal((await response).status(), 200);
        const request = posts('profiles')[0].body;
        assert.equal(request.id, historicalProfile.id);
        assert.equal(request.expected_revision, historicalProfile.revision);
        for (const stage of Object.keys(stageLabels)) {
          assert.equal(request.stages[stage].temperature, 0.7);
          assert.equal(request.stages[stage].max_output_tokens, 2048);
          assert.equal(
            request.stages[stage].prompt,
            stage === 'extract'
              ? 'User revised historical extract prompt.'
              : historicalProfile.stages[stage].prompt,
          );
        }
        assert.equal(posts().length, 0);
      },
    );

    assert.deepEqual(pageErrors, []);
    assert.deepEqual(blockedRequests, []);
    assert.deepEqual(fixture.expectedHttpErrors, [{ path: '/api/admin/ai/profiles', status: 409 }]);
    assert.ok(
      fixture.allRequests
        .filter((request) => request.method === 'POST' && request.path === '/api/admin/ai/probes')
        .every(
          (request) => request.body.kind === 'models' && !Object.hasOwn(request.body, 'model_id'),
        ),
    );
    const allowedConsoleErrors = consoleErrors.filter((error) =>
      fixture.expectedHttpErrors.some(
        (expected) =>
          error.url === `${fixture.origin}${expected.path}` &&
          error.text.startsWith(
            `Failed to load resource: the server responded with a status of ${expected.status}`,
          ),
      ),
    );
    assert.deepEqual(
      consoleErrors.filter((error) => !allowedConsoleErrors.includes(error)),
      [],
    );
    assert.ok(allowedConsoleErrors.length <= fixture.expectedHttpErrors.length);
  },
);
