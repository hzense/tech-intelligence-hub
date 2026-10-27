import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { fileURLToPath, URL } from 'node:url';
import process from 'node:process';
import { build } from 'esbuild';
import { chromium, expect } from '@playwright/test';
import { buildSignalRadar } from '../lib/signal-radar-model.ts';

test(
  'radar range controls keep nodes, resources, signal lists and mobile layout consistent without fetching',
  { skip: process.env.HZENSE_RADAR_BROWSER_TEST !== '1' },
  async () => {
    const root = fileURLToPath(new URL('..', import.meta.url));
    const now = new Date('2026-10-27T12:00:00.000Z');
    const topics = [
      { id: 'ai', name: '人工智能', parentId: null },
      { id: 'models', name: '模型', parentId: 'ai' },
      { id: 'security', name: '信息安全', parentId: null },
      { id: 'privacy', name: '隐私保护', parentId: 'security' },
    ];
    const entry = (id, occurred_at, topic, entities) => ({
      id,
      title: `信号 ${id}`,
      summary: `可追溯的合成信号 ${id}`,
      occurred_at,
      captured_at: now.toISOString(),
      type: 'research',
      status: 'accepted',
      topics: [topic],
      entities,
      source_id: 'synthetic-source',
      source_url: 'https://example.com/synthetic',
      importance: 3,
      confidence: 0.8,
      novelty: 0.6,
    });
    const entries = [
      ...Array.from({ length: 10 }, (_, index) =>
        entry(`recent-${index}`, '2026-10-25T12:00:00.000Z', 'models', [
          'company-recent',
          `person-${index % 5}`,
        ]),
      ),
      ...Array.from({ length: 2 }, (_, index) =>
        entry(`month-${index}`, '2026-10-05T12:00:00.000Z', 'models', ['company-recent']),
      ),
      ...Array.from({ length: 6 }, (_, index) =>
        entry(
          `older-${index}`,
          index === 5 ? '2026-08-20T23:59:59.999Z' : '2026-08-20T00:00:00.000Z',
          'privacy',
          ['company-older'],
        ),
      ),
      ...Array.from({ length: 13 }, (_, index) =>
        entry(`ancient-${index}`, '2026-01-01T12:00:00.000Z', 'privacy', ['company-ancient']),
      ),
    ];
    const entities = [
      { id: 'company-recent', name: '近期公司', type: 'company' },
      { id: 'company-older', name: '八月公司', type: 'company' },
      { id: 'company-ancient', name: '年初公司', type: 'company' },
      ...Array.from({ length: 5 }, (_, index) => ({
        id: `person-${index}`,
        name: `研究者 ${index}`,
        type: 'person',
      })),
    ];
    const model = buildSignalRadar(entries, topics, { now, entities });
    const compiled = await build({
      stdin: {
        contents: `
          import {createRoot} from 'react-dom/client';
          import {SignalRadar} from './components/signal-radar';
          createRoot(document.getElementById('root')).render(<SignalRadar model={${JSON.stringify(model)}}/>);
        `,
        resolveDir: root,
        loader: 'tsx',
      },
      bundle: true,
      write: false,
      outfile: '/fixture/entry.js',
      platform: 'browser',
      format: 'esm',
      jsx: 'automatic',
      define: { 'process.env': '{}', 'process.env.NODE_ENV': '"production"' },
      logLevel: 'silent',
      plugins: [
        {
          name: 'fixture-link',
          setup(builder) {
            builder.onResolve({ filter: /^next\/link$/ }, () => ({
              path: 'link',
              namespace: 'fixture',
            }));
            builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({
              contents:
                "import React from 'react'; export default function Link({prefetch,...props}){return React.createElement('a',props)}",
              loader: 'js',
              resolveDir: root,
            }));
          },
        },
      ],
    });
    const assets = new Map(
      compiled.outputFiles.map((file) => [`/${file.path.split('/').at(-1)}`, file.contents]),
    );
    const server = createServer((request, response) => {
      response.setHeader(
        'Content-Type',
        assets.has(request.url)
          ? request.url.endsWith('.css')
            ? 'text/css'
            : 'text/javascript'
          : 'text/html',
      );
      response.end(
        assets.get(request.url) ??
          '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>*{box-sizing:border-box}body{margin:0}</style><link rel="stylesheet" href="/entry.css"><div id="root"></div><script type="module" src="/entry.js"></script>',
      );
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    let browser;
    try {
      browser = await chromium.launch({ headless: true });
      const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
      const errors = [];
      const requests = [];
      const blockedRequests = [];
      const origin = `http://127.0.0.1:${server.address().port}`;
      page.on('pageerror', (error) => errors.push(error.message));
      page.on('request', (request) => requests.push(request.url()));
      await page.route('**/*', (route) => {
        if (route.request().url().startsWith(`${origin}/`)) return route.continue();
        blockedRequests.push(route.request().url());
        return route.abort();
      });
      await page.goto(origin, { waitUntil: 'networkidle' });
      const initialRequestCount = requests.length;
      const range = page.getByLabel('时间范围', { exact: true });
      const status = page.getByRole('status').filter({ hasText: /^当前：/ });
      const signalList = page.locator('#radar-signal-list');
      const detailHeading = page.getByRole('heading', { level: 2 });
      const resourceButtons = page.getByRole('button', { name: /^资源第/ });
      await expect(range).toHaveValue('30');
      await expect(status).toHaveText('当前：近 30 日 · 12 条信号');
      await expect(resourceButtons).toHaveCount(5);
      await expect(resourceButtons.first()).toHaveAttribute(
        'aria-label',
        /公司 近期公司，近 30 日 12 条/,
      );
      await expect(page.getByRole('button', { name: /^信息安全，/ })).toHaveCount(0);
      await expect(page.getByRole('button', { name: /^模型分类，近 30 日 12 条/ })).toBeVisible();
      await expect(signalList.locator('li')).toHaveCount(8);
      await page.getByRole('button', { name: /^显示更多信号/ }).click();
      await expect(signalList.locator('li')).toHaveCount(12);

      await range.selectOption('7');
      await expect(status).toHaveText('当前：近 7 日 · 10 条信号');
      await expect(detailHeading).toHaveText('全部信号');
      await expect(signalList.locator('li')).toHaveCount(8);
      await expect(signalList.getByRole('link', { name: /^信号 month-/ })).toHaveCount(0);
      await expect(page.getByRole('button', { name: /^人工智能，近 7 日 10 条/ })).toBeVisible();

      await range.selectOption('90');
      await expect(status).toHaveText('当前：近 90 日 · 18 条信号');
      await expect(page.getByRole('button', { name: /^信息安全，近 90 日 6 条/ })).toBeVisible();
      await expect(resourceButtons.nth(1)).toHaveAttribute(
        'aria-label',
        /公司 八月公司，近 90 日 6 条/,
      );
      await resourceButtons.nth(1).click();
      await expect(detailHeading).toHaveText('八月公司');
      await expect(signalList.locator('li')).toHaveCount(6);
      await expect(
        signalList.getByRole('link', { name: '信号 older-5', exact: true }),
      ).toBeVisible();
      await expect(signalList.getByRole('link', { name: /^信号 recent-/ })).toHaveCount(0);
      await page.getByRole('button', { name: /^信息安全，/ }).click();
      await expect(
        page.getByRole('button', { name: /^隐私保护分类，近 90 日 6 条/ }),
      ).toBeVisible();

      await range.selectOption('all');
      await expect(status).toHaveText('当前：全部时间 · 31 条信号');
      await expect(detailHeading).toHaveText('全部信号');
      await expect(resourceButtons.first()).toHaveAttribute(
        'aria-label',
        /公司 年初公司，全部时间 13 条/,
      );
      await expect(page.getByText('前 30 日分布', { exact: true })).toHaveCount(0);
      await expect(page.getByText('前 90 日分布', { exact: true })).toHaveCount(0);
      await expect(page.getByText('全部时间不作上一时段对比。', { exact: false })).toBeVisible();

      await range.selectOption('custom');
      await page.getByLabel('开始日期', { exact: true }).fill('2026-08-20');
      await page.getByLabel('结束日期', { exact: true }).fill('2026-08-20');
      // Editing a range is a draft until explicitly applied.
      await expect(status).toHaveText('当前：全部时间 · 31 条信号');
      await page.getByRole('button', { name: '应用日期', exact: true }).click();
      await expect(status).toHaveText('当前：自定义时段 · 6 条信号');
      await expect(signalList.locator('li')).toHaveCount(6);
      await expect(
        signalList.getByRole('link', { name: '信号 older-5', exact: true }),
      ).toBeVisible();
      await expect(page.getByRole('button', { name: /^人工智能，/ })).toHaveCount(0);
      await expect(resourceButtons).toHaveCount(1);
      await expect(page.getByText('上一等长时段分布', { exact: true })).toBeVisible();
      await page.getByLabel('开始日期', { exact: true }).fill('2026-08-21');
      await page.getByRole('button', { name: '应用日期', exact: true }).click();
      await expect(page.getByRole('alert')).toHaveText('开始日期不能晚于结束日期。');
      await expect(status).toHaveText('当前：自定义时段 · 6 条信号');
      await expect(signalList.locator('li')).toHaveCount(6);

      await page.setViewportSize({ width: 390, height: 844 });
      await expect(page.getByLabel('开始日期', { exact: true })).toBeVisible();
      await expect(page.getByLabel('结束日期', { exact: true })).toBeVisible();
      await expect(page.getByRole('button', { name: '应用日期', exact: true })).toBeVisible();
      assert.equal(
        await page.evaluate('document.documentElement.scrollWidth <= window.innerWidth'),
        true,
        'mobile controls and radar must not overflow the page horizontally',
      );
      await page.getByLabel('开始日期', { exact: true }).fill('2026-02-01');
      await page.getByLabel('结束日期', { exact: true }).fill('2026-02-02');
      await page.getByRole('button', { name: '应用日期', exact: true }).click();
      await expect(status).toHaveText('当前：自定义时段 · 0 条信号');
      await expect(
        page.getByText('所选时间范围暂无公开信号，请扩大范围或选择全部时间。'),
      ).toBeVisible();
      await expect(resourceButtons).toHaveCount(0);
      await expect(signalList.locator('li')).toHaveCount(0);
      await range.selectOption('all');
      await expect(status).toHaveText('当前：全部时间 · 31 条信号');
      await expect(page.getByRole('alert')).toHaveCount(0);
      assert.equal(
        requests.length,
        initialRequestCount,
        'range changes must reuse loaded public data',
      );
      assert.deepEqual(blockedRequests, []);
      assert.deepEqual(errors, []);
    } finally {
      await browser?.close();
      server.closeAllConnections();
      await new Promise((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  },
);
