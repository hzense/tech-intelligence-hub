import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { fileURLToPath, URL } from 'node:url';
import process from 'node:process';
import { build } from 'esbuild';
import { chromium, expect } from '@playwright/test';
import { buildSignalRadar } from '../lib/signal-radar-model.ts';

test(
  'radial cloud centers the hottest term and opens evidenced details only on demand without fetching',
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
      ...(id === 'recent-0' ? { analysis: '合成研判：部署效率仍需持续验证。' } : {}),
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
      { id: 'company-older', name: '八月研究机构', type: 'institution' },
      { id: 'company-ancient', name: '年初公司', type: 'company' },
      ...Array.from({ length: 5 }, (_, index) => ({
        id: `person-${index}`,
        name: `研究者 ${index}`,
        type: 'person',
      })),
    ];
    const model = buildSignalRadar(entries, topics, { now, entities });
    const filteredModel = buildSignalRadar(
      [
        entry('active', '2026-10-25T12:00:00.000Z', 'models', []),
        entry('cooled', '2026-09-15T12:00:00.000Z', 'privacy', []),
      ],
      topics,
      { now },
    );
    const denseTopics = [
      { id: 'dense', name: '技术观察', parentId: null },
      ...Array.from({ length: 28 }, (_, index) => ({
        id: `dense-${index}`,
        name: index === 0 ? '核心技术热点' : `技术方向 ${index}`,
        parentId: 'dense',
      })),
    ];
    const denseModel = buildSignalRadar(
      denseTopics
        .slice(1)
        .flatMap((topic, index) =>
          Array.from({ length: 29 - index }, (_, n) =>
            entry(`dense-${index}-${n}`, '2026-10-25T12:00:00.000Z', topic.id, []),
          ),
        ),
      denseTopics,
      { now },
    );
    const compiled = await build({
      stdin: {
        contents: `
          import {StrictMode} from 'react';
          import {createRoot} from 'react-dom/client';
          import {SignalRadar} from './components/signal-radar';
          const model = location.pathname === '/dense' ? ${JSON.stringify(denseModel)} : location.pathname === '/filtered' ? ${JSON.stringify(filteredModel)} : ${JSON.stringify(model)};
          createRoot(document.getElementById('root')).render(<StrictMode><SignalRadar model={model}/></StrictMode>);
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
      define: { 'process.env': '{}', 'process.env.NODE_ENV': '"development"' },
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
      const panel = page.locator('#radar-detail-panel');
      const detailHeading = panel.getByRole('heading', { level: 2 });
      const cloud = page.getByRole('group', { name: '技术热点词云', exact: true });
      const hotspot = (id) => cloud.locator(`button[data-hotspot-id="${id}"]`);
      const resource = (id) => panel.locator(`[data-resource-id="${id}"]`);
      const openSignals = async () => {
        if (!(await signalList.isVisible()))
          await panel.getByRole('button', { name: /^查看相关信号/ }).click();
        await expect(signalList).toBeVisible();
      };
      const closeDetails = async () => {
        await panel.getByRole('button', { name: '关闭详情', exact: true }).click();
        await expect(panel).toBeHidden();
      };
      const assertCloudFits = async (hottestId) => {
        await expect(cloud).toHaveAttribute('data-layout-ready', 'true');
        await expect(async () => {
          assert.equal(
            await page.evaluate('document.documentElement.scrollWidth <= window.innerWidth'),
            true,
            `time controls, cloud and detail must not overflow ${page.viewportSize().width}px viewport`,
          );
          const boxes = await cloud.locator('button[data-hotspot-id]').evaluateAll((nodes) =>
            nodes.map((node) => {
              const { left, right, top, bottom } = node.getBoundingClientRect();
              return { id: node.dataset.hotspotId, left, right, top, bottom };
            }),
          );
          const boundary = await cloud.boundingBox();
          for (let i = 0; i < boxes.length; i++) {
            const a = boxes[i];
            assert.ok(
              a.left >= boundary.x - 1 &&
                a.right <= boundary.x + boundary.width + 1 &&
                a.top >= boundary.y - 1 &&
                a.bottom <= boundary.y + boundary.height + 1,
              'hotspot must remain inside the cloud canvas',
            );
            for (let j = i + 1; j < boxes.length; j++) {
              const b = boxes[j];
              assert.ok(
                a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top,
                'hotspot words must not overlap',
              );
            }
          }
          if (hottestId) {
            const largest = boxes.find((box) => box.id === hottestId);
            assert.ok(largest, 'hottest word must be visible');
            assert.ok(
              Math.abs((largest.left + largest.right) / 2 - (boundary.x + boundary.width / 2)) < 3,
            );
            assert.ok(
              Math.abs((largest.top + largest.bottom) / 2 - (boundary.y + boundary.height / 2)) < 3,
            );
          }
        }).toPass({ timeout: 5000 });
      };
      await expect(page.getByRole('heading', { level: 1 })).toHaveText('技术热点词云');
      await expect(range).toHaveValue('30');
      await expect(status).toHaveText('当前：近 30 日 · 12 条信号');
      await expect(hotspot('models')).toBeVisible();
      await expect(hotspot('privacy')).toHaveCount(0);
      await expect(page.getByText('字号：所选时段信号量', { exact: true })).toBeVisible();
      await expect(hotspot('models')).not.toHaveAttribute('data-heat');
      await expect(panel).toBeHidden();
      await expect(page.getByRole('heading', { name: '相关组织', exact: true })).toHaveCount(0);
      await assertCloudFits('models');
      await hotspot('models').focus();
      await page.keyboard.press('Enter');
      await expect(panel).toBeVisible();
      await expect(detailHeading).toHaveText('模型');
      await expect(resource('company-recent')).toBeVisible();
      await expect(resource('company-older')).toHaveCount(0);
      await expect(panel.getByRole('heading', { name: '技术趋势研判', exact: true })).toBeVisible();
      await expect(
        panel.getByText('合成研判：部署效率仍需持续验证。', { exact: true }),
      ).toBeVisible();
      await expect(panel.getByRole('link', { name: /研究者 0/ })).toHaveAttribute(
        'href',
        '/persons/person-0',
      );
      // Native modal focus stays within details and Escape returns to the originating word.
      for (const key of ['Tab', 'Shift+Tab']) {
        for (let i = 0; i < 18; i++) {
          await page.keyboard.press(key);
          assert.equal(
            await panel.evaluate((node) => node.contains(node.ownerDocument.activeElement)),
            true,
            `${key} ${i + 1} left dialog: ${await panel.evaluate((node) => node.ownerDocument.activeElement?.outerHTML.slice(0, 160))}`,
          );
        }
      }
      await page.keyboard.press('Escape');
      await expect(panel).toBeHidden();
      await expect(hotspot('models')).toBeFocused();
      await hotspot('models').click();
      await expect(signalList).toBeHidden();
      await openSignals();
      await expect(signalList.locator('li')).toHaveCount(8);
      await panel.getByRole('button', { name: /^显示更多信号/ }).click();
      await expect(signalList.locator('li')).toHaveCount(12);
      await expect(
        signalList.getByRole('link', { name: '信号 recent-0', exact: true }),
      ).toHaveAttribute('href', '/signals/recent-0');
      await closeDetails();
      await expect(hotspot('models')).toBeFocused();
      await hotspot('models').click();
      await expect(panel).toBeVisible();
      await page.mouse.click(2, 2);
      await expect(panel).toBeHidden();
      await expect(hotspot('models')).toBeFocused();

      await range.selectOption('7');
      await expect(status).toHaveText('当前：近 7 日 · 10 条信号');
      await expect(panel).toBeHidden();
      await expect(hotspot('models')).toHaveAttribute('aria-label', /近 7 日 10 条/);
      await hotspot('models').click();
      await openSignals();
      await expect(signalList.locator('li')).toHaveCount(8);
      await expect(signalList.getByRole('link', { name: /^信号 month-/ })).toHaveCount(0);
      await closeDetails();

      await range.selectOption('90');
      await expect(status).toHaveText('当前：近 90 日 · 18 条信号');
      await expect(hotspot('privacy')).toHaveAttribute('aria-label', /近 90 日 6 条/);
      await assertCloudFits('models');
      await hotspot('privacy').focus();
      await page.keyboard.press('Enter');
      await expect(detailHeading).toHaveText('隐私保护');
      await expect(resource('company-older')).toBeVisible();
      await expect(resource('company-recent')).toHaveCount(0);
      await expect(resource('company-ancient')).toHaveCount(0);
      await expect(panel.getByRole('link', { name: /八月研究机构/ })).toHaveAttribute(
        'href',
        '/resources/company-older',
      );
      await openSignals();
      await expect(signalList.locator('li')).toHaveCount(6);
      await expect(
        signalList.getByRole('link', { name: '信号 older-5', exact: true }),
      ).toBeVisible();
      await expect(signalList.getByRole('link', { name: /^信号 recent-/ })).toHaveCount(0);
      await closeDetails();

      await range.selectOption('all');
      await expect(status).toHaveText('当前：全部时间 · 31 条信号');
      await assertCloudFits('privacy');
      await expect(hotspot('privacy')).toHaveAttribute('data-heat', 'peak');
      await expect(hotspot('models')).toHaveAttribute('data-heat', 'high');
      await expect(page.getByText('字号与颜色：累计信号量', { exact: true })).toBeVisible();
      await expect(page.getByText('按相对信号量分档，不表示升降温', { exact: true })).toBeVisible();
      await expect(page.getByText('字号：所选时段信号量', { exact: true })).toHaveCount(0);
      assert.notEqual(
        await hotspot('privacy').evaluate(
          (node) => node.ownerDocument.defaultView.getComputedStyle(node).color,
        ),
        await hotspot('models').evaluate(
          (node) => node.ownerDocument.defaultView.getComputedStyle(node).color,
        ),
        'all-time words with different heat levels need visibly different colors',
      );
      await hotspot('privacy').click();
      await expect(resource('company-ancient')).toBeVisible();
      // Other same-window resources may be collapsed but must belong to this hotspot.
      const moreOrganizations = panel.locator('summary').filter({ hasText: /^更多组织/ });
      if (await moreOrganizations.count()) await moreOrganizations.click();
      await expect(resource('company-older')).toBeVisible();
      await expect(resource('company-recent')).toHaveCount(0);
      await expect(panel.getByText('全部时间不作上一时段对比。', { exact: false })).toBeVisible();
      await closeDetails();
      await page.getByRole('button', { name: '全部信号', exact: true }).click();
      await expect(detailHeading).toHaveText('全部信号');
      await openSignals();
      await expect(signalList.locator('li')).toHaveCount(8);
      await closeDetails();

      await range.selectOption('custom');
      await page.getByLabel('开始日期', { exact: true }).fill('2026-08-20');
      await page.getByLabel('结束日期', { exact: true }).fill('2026-08-20');
      await expect(status).toHaveText('当前：全部时间 · 31 条信号');
      await page.getByRole('button', { name: '应用日期', exact: true }).click();
      await expect(status).toHaveText('当前：自定义时段 · 6 条信号');
      await expect(hotspot('privacy')).not.toHaveAttribute('data-heat');
      await expect(page.getByText('字号：所选时段信号量', { exact: true })).toBeVisible();
      await expect(page.getByText('字号与颜色：累计信号量', { exact: true })).toHaveCount(0);
      await expect(panel).toBeHidden();
      await expect(hotspot('models')).toHaveCount(0);
      await assertCloudFits('privacy');
      await hotspot('privacy').click();
      await expect(detailHeading).toHaveText('隐私保护');
      await expect(resource('company-older')).toBeVisible();
      await expect(resource('company-ancient')).toHaveCount(0);
      await openSignals();
      await expect(signalList.locator('li')).toHaveCount(6);
      await expect(
        signalList.getByRole('link', { name: '信号 older-5', exact: true }),
      ).toBeVisible();
      await closeDetails();
      await page.getByLabel('开始日期', { exact: true }).fill('2026-08-21');
      await page.getByRole('button', { name: '应用日期', exact: true }).click();
      await expect(page.getByRole('alert')).toHaveText('开始日期不能晚于结束日期。');
      await expect(status).toHaveText('当前：自定义时段 · 6 条信号');
      await expect(panel).toBeHidden();

      await page.setViewportSize({ width: 390, height: 844 });
      await expect(page.getByLabel('开始日期', { exact: true })).toBeVisible();
      await expect(page.getByLabel('结束日期', { exact: true })).toBeVisible();
      await expect(page.getByRole('button', { name: '应用日期', exact: true })).toBeVisible();
      await assertCloudFits('privacy');
      await page.getByLabel('开始日期', { exact: true }).fill('2026-02-01');
      await page.getByLabel('结束日期', { exact: true }).fill('2026-02-02');
      await page.getByRole('button', { name: '应用日期', exact: true }).click();
      await expect(status).toHaveText('当前：自定义时段 · 0 条信号');
      await expect(
        page.getByText('所选时间范围暂无公开信号，请扩大范围或选择全部时间。'),
      ).toBeVisible();
      await expect(cloud.locator('button[data-hotspot-id]')).toHaveCount(0);
      await expect(panel).toBeHidden();
      await range.selectOption('all');
      await expect(status).toHaveText('当前：全部时间 · 31 条信号');
      await expect(page.getByRole('alert')).toHaveCount(0);
      await page.setViewportSize({ width: 320, height: 844 });
      await assertCloudFits('privacy');
      await hotspot('models').click();
      await expect(detailHeading).toHaveText('模型');
      await expect(resource('company-recent')).toBeVisible();
      assert.equal(
        await panel.evaluate((node) => node.scrollWidth <= node.clientWidth),
        true,
        'modal must fit mobile viewport',
      );
      await closeDetails();
      assert.equal(
        requests.length,
        initialRequestCount,
        'selection and range changes must reuse loaded public data',
      );
      assert.deepEqual(blockedRequests, []);
      assert.deepEqual(errors, []);

      // A genuine many-word cloud must remain radial, centered and collision-free after resizing.
      await page.goto(`${origin}/dense`, { waitUntil: 'networkidle' });
      await page.setViewportSize({ width: 1440, height: 1000 });
      await expect(cloud.locator('button[data-hotspot-id]')).toHaveCount(28);
      await assertCloudFits('dense-0');
      await page.setViewportSize({ width: 390, height: 844 });
      await expect(cloud.locator('button[data-hotspot-id]')).toHaveCount(12);
      await assertCloudFits('dense-0');
      await page.getByRole('button', { name: /^显示全部热点/ }).click();
      await expect(cloud.locator('button[data-hotspot-id]')).toHaveCount(28);
      await assertCloudFits('dense-0');
      await page.setViewportSize({ width: 320, height: 844 });
      await expect(cloud.locator('button[data-hotspot-id]')).toHaveCount(28);
      await assertCloudFits('dense-0');
      await page.getByRole('button', { name: '收起更多热点', exact: true }).click();
      await expect(cloud.locator('button[data-hotspot-id]')).toHaveCount(12);
      await assertCloudFits('dense-0');
      await expect(panel).toBeHidden();
      await hotspot('dense-0').click();
      await expect(detailHeading).toHaveText('核心技术热点');
      await expect(panel.getByRole('heading', { name: '技术趋势研判', exact: true })).toBeVisible();
      await closeDetails();
      // Activity in the previous comparison window must not retain a current empty word.
      await page.goto(`${origin}/filtered`, { waitUntil: 'networkidle' });
      await expect(status).toHaveText('当前：近 30 日 · 1 条信号');
      await expect(hotspot('models')).toBeVisible();
      await expect(hotspot('privacy')).toHaveCount(0);
      await range.selectOption('all');
      await expect(status).toHaveText('当前：全部时间 · 2 条信号');
      await expect(hotspot('privacy')).toHaveAttribute('aria-label', /全部时间 1 条/);
      await range.selectOption('30');
      await expect(hotspot('privacy')).toHaveCount(0);
      await expect(hotspot('models')).not.toHaveAttribute('data-heat');
      await expect(page.getByText('字号：所选时段信号量', { exact: true })).toBeVisible();
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
