import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import process from 'node:process';
import test from 'node:test';
import { fileURLToPath, URL } from 'node:url';
import { build } from 'esbuild';
import { chromium, expect } from '@playwright/test';
import {
  createSignalWorkbenchHandler,
  SignalWorkbenchConfigurationError,
} from '../lib/admin-signal-workbench-core.ts';

const directory = dirname(fileURLToPath(import.meta.url));
const { Request } = globalThis;
const time = '2026-09-15T00:00:00.000Z';
const hostileTitle = '<img src=x onerror="alert(1)"> private fixture';
const items = [
  {
    signal_id: 'signal-alpha',
    title: hostileTitle,
    type: 'research',
    occurred_at: time,
    latest_snapshot_version: 3,
    recorded_head: {
      content_version: 2,
      publication_revision: 1,
      status: 'published',
      occurred_at: time,
    },
    current_public_version: null,
  },
  {
    signal_id: 'signal-beta',
    title: 'Synthetic second signal',
    type: 'technology',
    occurred_at: time,
    latest_snapshot_version: 1,
    recorded_head: null,
    current_public_version: null,
  },
];
function detail(version = 3, sourceUrl = 'https://example.com/source') {
  return {
    signal_id: 'signal-alpha',
    latest_snapshot_version: 3,
    selected_version: version,
    snapshot: {
      version,
      title: version === 1 ? 'Historical snapshot one' : hostileTitle,
      type: 'research',
      occurred_at: time,
      date_precision: 'day',
      date_basis: 'Synthetic event date',
      captured_at: time,
      summary: 'Synthetic private summary',
      analysis: '<script>private-script-marker</script>',
      importance: 3,
      strength: 3,
      confidence: 0.8,
      novelty: 0.5,
      revision_reason: 'Synthetic revision',
      origin: 'manual',
      created_at: time,
    },
    recorded_head: items[0].recorded_head,
    current_public_version: null,
    versions: [3, 2, 1].map((value) => ({
      version: value,
      title: `Snapshot ${value}`,
      created_at: time,
      revision_reason: 'Synthetic revision',
      origin: 'manual',
      assembled_candidate: value === 2,
      publication_snapshot: value === 2,
    })),
    evidence: [
      {
        evidence_id: 'evidence-one',
        claim: '<b>Escaped claim</b>',
        relation: 'supports',
        verification_status: 'pending',
        source_id: 'source-one',
        source_name: 'Synthetic source',
        source_active: true,
        source_url: sourceUrl,
        captured_at: time,
        source_published_at: null,
      },
    ],
    people: [],
    organizations: [],
    topics: [],
    verifications: [],
    truncated: {
      versions: false,
      evidence: false,
      people: false,
      organizations: false,
      topics: false,
      verifications: false,
      text: false,
    },
    observed_at: time,
  };
}

// Real React UI plus the real HTTP authorization/parser, with synthetic DTOs.
// This fixture does not replace the separate real Next authentication or PG ACL tests.
export async function fixtureServer() {
  // Reuse the actual application theme and base styles. The standalone esbuild
  // fixture does not run Tailwind's Next/PostCSS pipeline; only remove that
  // external import, never duplicate or hard-code its theme variables here.
  const globals = await readFile(resolve(directory, '../app/globals.css'), 'utf8');
  const tailwindImport = /^@import\s+['"]tailwindcss['"];\s*/m;
  assert.match(globals, tailwindImport);
  const built = await build({
    stdin: {
      contents: `
      import { createRoot } from 'react-dom/client';
      import { AdminSignalWorkbenchList, AdminSignalWorkbenchDetail } from './components/admin-signal-workbench';
      const url = new URL(location.href);
      const isDetail = url.pathname !== '/admin/signals';
      const api = url.pathname.replace('/admin/signals', '/api/admin/signals') + url.search;
      const response = await fetch(api, {cache:'no-store'});
      const body = await response.json();
      const status = response.ok ? 'ready' : response.status === 404 ? 'not_found' : response.status === 400 ? 'invalid_request' : body.error === 'workbench_not_configured' ? 'not_configured' : body.error === 'workbench_incompatible_data' ? 'incompatible_data' : 'unavailable';
      const state = response.ok ? {status, data: body} : {status};
      createRoot(document.getElementById('root')).render(isDetail
        ? <AdminSignalWorkbenchDetail state={state} publicReadEnabled={false} />
        : <AdminSignalWorkbenchList state={state} query={url.searchParams.get('q') ?? ''} after={url.searchParams.get('after') ?? ''} publicReadEnabled={false} />);
    `,
      resolveDir: resolve(directory, '..'),
      loader: 'tsx',
      sourcefile: 'signal-workbench-fixture.tsx',
    },
    absWorkingDir: resolve(directory, '..'),
    bundle: true,
    write: false,
    platform: 'browser',
    format: 'esm',
    jsx: 'automatic',
    outfile: '/fixture/entry.js',
    define: { 'process.env': '{}', 'process.env.NODE_ENV': '"production"' },
    logLevel: 'silent',
  });
  const assets = new Map(
    built.outputFiles.map((file) => [`/__fixture/${file.path.split('/').at(-1)}`, file]),
  );
  assets.set('/__fixture/globals.css', {
    contents: Buffer.from(globals.replace(tailwindImport, '')),
  });
  const requests = [];
  const commands = [];
  const errors = [];
  let origin;
  let mode = 'ready';
  let sourceUrl = 'https://example.com/source';
  const server = createServer(async (incoming, outgoing) => {
    const url = new URL(incoming.url, origin);
    requests.push({ method: incoming.method, path: url.pathname, search: url.search });
    try {
      if (url.pathname.startsWith('/api/admin/signals')) {
        const handle = createSignalWorkbenchHandler({
          authenticate: async () =>
            incoming.headers.cookie === 'workbench_fixture=synthetic'
              ? { user: { id: 'synthetic-admin' } }
              : null,
          origin: () => origin,
          execute: async (operation, command) => {
            commands.push({ operation, command });
            if (mode === 'unavailable') throw new Error('PRIVATE_DATABASE_DIAGNOSTIC');
            if (mode === 'incompatible') throw { code: 'incompatible_data' };
            if (mode === 'not_configured') throw new SignalWorkbenchConfigurationError();
            if (operation === 'detail') {
              if (command.signal_id !== 'signal-alpha') throw { code: 'not_found' };
              return detail(command.version, sourceUrl);
            }
            const filtered =
              mode === 'empty'
                ? []
                : items.filter(
                    (row) =>
                      !command.q || row.title.toLowerCase().includes(command.q.toLowerCase()),
                  );
            const remaining = filtered.filter(
              (row) => !command.after || row.signal_id > command.after,
            );
            return {
              items: remaining.slice(0, 1),
              next_after: remaining.length > 1 ? remaining[0].signal_id : null,
              observed_at: time,
            };
          },
        });
        const id = url.pathname.slice('/api/admin/signals/'.length);
        const response = await handle(
          new Request(url, { method: incoming.method, headers: incoming.headers }),
          url.pathname === '/api/admin/signals' ? 'list' : 'detail',
          id || undefined,
        );
        if (response.status >= 400) errors.push({ path: url.pathname, status: response.status });
        outgoing.writeHead(response.status, Object.fromEntries(response.headers));
        outgoing.end(Buffer.from(await response.arrayBuffer()));
      } else if (assets.has(url.pathname)) {
        outgoing.writeHead(200, {
          'Content-Type': url.pathname.endsWith('.css') ? 'text/css' : 'text/javascript',
        });
        outgoing.end(assets.get(url.pathname).contents);
      } else if (url.pathname.startsWith('/admin/signals')) {
        outgoing.writeHead(200, {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'private, no-store',
        });
        outgoing.end(
          '<!doctype html><html lang="zh"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Synthetic workbench</title><link rel="stylesheet" href="/__fixture/globals.css"><link rel="stylesheet" href="/__fixture/entry.css"></head><body><div id="root">Loading synthetic fixture</div><script type="module" src="/__fixture/entry.js"></script></body></html>',
        );
      } else if (url.pathname === '/favicon.ico') outgoing.writeHead(204).end();
      else outgoing.writeHead(404).end();
    } catch {
      outgoing.writeHead(500).end('Synthetic fixture failed');
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
    commands,
    errors,
    setMode: (value) => {
      mode = value;
    },
    setSourceUrl: (value) => {
      sourceUrl = value;
    },
    close: async () => {
      server.closeAllConnections();
      await new Promise((accept, reject) =>
        server.close((error) => (error ? reject(error) : accept())),
      );
    },
  };
}

test(
  'read-only Signal workbench UI and HTTP boundary (synthetic DTOs)',
  { skip: process.env.HZENSE_SIGNAL_WORKBENCH_BROWSER_TEST !== '1', timeout: 60000 },
  async (t) => {
    const fixture = await fixtureServer();
    let browser;
    let context;
    t.after(async () => {
      try {
        await context?.close();
        await browser?.close();
      } finally {
        await fixture.close();
      }
    });
    browser = await chromium.launch({ headless: true });
    context = await browser.newContext();
    context.setDefaultTimeout(8000);
    const pageErrors = [];
    const consoleErrors = [];
    const external = [];
    await context.route('**/*', async (route) => {
      if (route.request().url().startsWith(`${fixture.origin}/`)) await route.continue();
      else {
        external.push(route.request().url());
        await route.abort();
      }
    });
    await context.addCookies([
      { name: 'workbench_fixture', value: 'synthetic', url: fixture.origin },
    ]);
    const page = await context.newPage();
    page.on('pageerror', (error) => pageErrors.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error')
        consoleErrors.push({ text: message.text(), url: message.location().url });
    });

    await t.test(
      'real application themes style controls and avoid desktop/mobile overflow',
      async () => {
        const brands = new Set();
        const backgrounds = new Set();
        for (const width of [1440, 390]) {
          await page.setViewportSize({ width, height: 900 });
          for (const path of ['/admin/signals', '/admin/signals/signal-alpha?version=1']) {
            await page.goto(`${fixture.origin}${path}`);
            await expect(page.locator('main')).toBeVisible();
            for (const theme of ['light', 'dark']) {
              await page.evaluate((value) => {
                globalThis.document.documentElement.dataset.theme = value;
              }, theme);
              const styles = await page.evaluate(() => {
                const root = globalThis.document.documentElement;
                const button = globalThis.document.querySelector('button');
                const getStyle = globalThis.getComputedStyle;
                return {
                  brand: getStyle(root).getPropertyValue('--brand').trim(),
                  page: getStyle(globalThis.document.body).backgroundColor,
                  background: button ? getStyle(button).backgroundColor : null,
                  color: button ? getStyle(button).color : null,
                  overflow: root.scrollWidth > root.clientWidth,
                };
              });
              assert.notEqual(styles.brand, '');
              brands.add(styles.brand);
              backgrounds.add(styles.page);
              assert.equal(styles.overflow, false, `${theme} ${width}px ${path} must not overflow`);
              if (path === '/admin/signals') {
                assert.notEqual(styles.background, 'rgba(0, 0, 0, 0)');
                assert.notEqual(styles.background, 'rgb(255, 255, 255)');
                assert.notEqual(styles.background, styles.color);
                await expect(page.getByRole('button', { name: '筛选', exact: true })).toBeVisible();
              }
            }
          }
        }
        assert.equal(brands.size, 2, 'Light and dark must use the real distinct brand tokens');
        assert.equal(backgrounds.size, 2, 'Light and dark must use distinct page surfaces');
        await page.setViewportSize({ width: 1440, height: 900 });
      },
    );

    await t.test('lists, filters and pages only through bounded GET requests', async () => {
      await page.goto(`${fixture.origin}/admin/signals`);
      await expect(page.getByRole('link', { name: hostileTitle, exact: true })).toBeVisible();
      await page.getByRole('link', { name: '下一页', exact: true }).click();
      await expect(page.getByText(items[1].title, { exact: true })).toBeVisible();
      assert.ok(
        fixture.commands.some(
          (row) => row.operation === 'list' && row.command.after === 'signal-alpha',
        ),
      );
      await page.getByLabel('筛选信号', { exact: true }).fill('second');
      await page.getByRole('button', { name: '筛选', exact: true }).click();
      await expect(page.getByText(items[1].title, { exact: true })).toBeVisible();
      assert.ok(
        fixture.commands.some(
          (row) => row.operation === 'list' && row.command.q === 'second' && !row.command.after,
        ),
      );
    });

    await t.test(
      'detail displays explicit version/history and escapes private text instead of executing markup',
      async () => {
        await page.goto(`${fixture.origin}/admin/signals/signal-alpha?version=1`);
        await expect(
          page.getByText('Historical snapshot one', { exact: true }).first(),
        ).toBeVisible();
        await expect(
          page.getByText('<script>private-script-marker</script>', { exact: true }),
        ).toBeVisible();
        await expect(page.locator('img[src="x"], script:not([src])')).toHaveCount(0);
        assert.ok(
          fixture.commands.some((row) => row.operation === 'detail' && row.command.version === 1),
        );
        await expect(
          page.getByRole('link', { name: 'Synthetic source（打开来源）', exact: true }),
        ).toHaveAttribute('href', 'https://example.com/source');
        await expect(page.locator('a[href="/signals/signal-alpha"]')).toHaveCount(0);
      },
    );

    await t.test(
      'unsafe source destinations never become clickable or expose embedded secrets',
      async () => {
        for (const unsafe of [
          'javascript:alert(1)',
          'https://user:private-url-marker@example.com/source',
          'https://example.com/source?token=private-url-marker',
          'https://example.com/source#private-url-marker',
        ]) {
          fixture.setSourceUrl(unsafe);
          await page.goto(`${fixture.origin}/admin/signals/signal-alpha`);
          await expect(page.getByText('无可安全打开的来源链接', { exact: true })).toBeVisible();
          assert.equal(
            (await page.locator('body').innerText()).includes('private-url-marker'),
            false,
          );
          await expect(
            page.locator('a[href^="javascript:"], a[href*="private-url-marker"]'),
          ).toHaveCount(0);
        }
        fixture.setSourceUrl('https://example.com/source');
      },
    );

    await t.test(
      'empty, invalid, missing and unavailable states never fall back to a previous Signal',
      async () => {
        fixture.setMode('empty');
        await page.goto(`${fixture.origin}/admin/signals`);
        await expect(page.getByLabel('筛选信号', { exact: true })).toBeVisible();
        await expect(page.getByText(hostileTitle, { exact: true })).toHaveCount(0);
        fixture.setMode('ready');
        for (const path of ['/admin/signals?limit=0', '/admin/signals/not-found']) {
          await page.goto(`${fixture.origin}${path}`);
          await expect(page.locator('main')).toBeVisible();
          await expect(page.getByText(hostileTitle, { exact: true })).toHaveCount(0);
        }
        fixture.setMode('unavailable');
        await page.goto(`${fixture.origin}/admin/signals`);
        await expect(page.locator('main')).toBeVisible();
        assert.equal(
          (await page.locator('body').innerText()).includes('PRIVATE_DATABASE_DIAGNOSTIC'),
          false,
        );
        await expect(page.getByText(hostileTitle, { exact: true })).toHaveCount(0);
      },
    );

    await t.test(
      'missing backend and incompatible identifiers remain explicit safe failure states',
      async () => {
        for (const [mode, title] of [
          ['not_configured', '信号工作台尚未配置'],
          ['incompatible', '信号标识与站内规范不兼容'],
        ]) {
          fixture.setMode(mode);
          await page.goto(`${fixture.origin}/admin/signals`);
          await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible();
          await expect(page.getByText(hostileTitle, { exact: true })).toHaveCount(0);
        }
      },
    );

    assert.deepEqual(pageErrors, []);
    assert.deepEqual(fixture.errors, [
      { path: '/api/admin/signals', status: 400 },
      { path: '/api/admin/signals/not-found', status: 404 },
      { path: '/api/admin/signals', status: 503 },
      { path: '/api/admin/signals', status: 503 },
      { path: '/api/admin/signals', status: 503 },
    ]);
    const expectedErrors = consoleErrors.filter((error) =>
      fixture.errors.some(
        (expected) =>
          error.url.startsWith(`${fixture.origin}${expected.path}`) &&
          error.text.startsWith(
            `Failed to load resource: the server responded with a status of ${expected.status}`,
          ),
      ),
    );
    assert.deepEqual(
      consoleErrors.filter((error) => !expectedErrors.includes(error)),
      [],
    );
    assert.ok(expectedErrors.length <= fixture.errors.length);
    assert.deepEqual(external, []);
    assert.equal(
      fixture.requests.some((request) => request.method !== 'GET'),
      false,
    );
  },
);
