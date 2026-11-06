import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import process from 'node:process';
import test from 'node:test';
import { fileURLToPath, URL } from 'node:url';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { build } from 'esbuild';
import { chromium, expect } from '@playwright/test';

const web = fileURLToPath(new URL('../', import.meta.url));
const compiled = await build({
  entryPoints: [fileURLToPath(new URL('../components/admin-neon-usage.tsx', import.meta.url))],
  bundle: true,
  jsx: 'automatic',
  write: false,
  platform: 'node',
  format: 'cjs',
  packages: 'external',
  loader: { '.module.css': 'empty' },
});
const module = { exports: {} };
new Function('require', 'module', 'exports', compiled.outputFiles[0].text)(
  createRequire(import.meta.url),
  module,
  module.exports,
);

function dashboard(overrides = {}) {
  return {
    configured: true,
    missing: [],
    available: true,
    error: null,
    sampledAt: '2026-11-02T18:00:00.000Z',
    stale: false,
    projectId: 'synthetic-project',
    timezone: 'Europe/Berlin',
    totalBytes: 360_690_000,
    quotaBytes: 5_000_000_000,
    quotaPercent: 7.2138,
    alert: 'none',
    periodStart: '2026-11-01T00:00:00.000Z',
    periodEnd: '2026-12-01T00:00:00.000Z',
    historyDays: 60,
    costSampledAt: '2026-11-02T18:00:00.000Z',
    costs: {
      status: 'estimated',
      plan: 'launch',
      from: '2026-11-01T00:00:00.000Z',
      through: '2026-11-02T00:00:00.000Z',
      totalMicrousd: 2_467_700,
      items: [
        { kind: 'compute', microusd: 2_400_000 },
        { kind: 'storage', microusd: 51_000 },
        { kind: 'history', microusd: 12_000 },
        { kind: 'snapshots', microusd: 3_000 },
        { kind: 'publicTransfer', microusd: 400 },
        { kind: 'privateTransfer', microusd: 300 },
        { kind: 'branches', microusd: 1_000 },
      ],
      reason: null,
      pricingVersion: '2026-11-02',
    },
    aiCosts: {
      sampledAt: '2026-11-02T18:00:00.000Z',
      day: '2026-11-02',
      month: '2026-11',
      status: 'available',
      today: { chargedMicrousd: 1_500_000, unsettledMicrousd: 500_000 },
      monthToDate: { chargedMicrousd: 15_000_000, unsettledMicrousd: 750_000 },
      items: ['generation', 'enrichment', 'collection', 'insight', 'probe'].map((kind, index) => ({
        kind,
        scope: kind === 'probe' ? 'site' : 'owner',
        status: 'available',
        today: {
          chargedMicrousd: (index + 1) * 100_000,
          unsettledMicrousd: index === 0 ? 500_000 : 0,
        },
        monthToDate: {
          chargedMicrousd: (index + 1) * 1_000_000,
          unsettledMicrousd: index === 0 ? 750_000 : 0,
        },
      })),
    },
    days: Array.from({ length: 30 }, (_, index) => {
      const date = new Date(Date.UTC(2026, 9, 4 + index)).toISOString().slice(0, 10);
      if (index === 27) return { date, bytes: 0, status: 'estimated', samples: 24 };
      if (index === 28) return { date, bytes: 14_200_000, status: 'estimated', samples: 24 };
      if (index === 29) return { date, bytes: null, status: 'partial', samples: 4 };
      return { date, bytes: null, status: 'missing', samples: 0 };
    }),
    ...overrides,
  };
}
const render = (value) =>
  renderToStaticMarkup(createElement(module.exports.AdminNeonUsage, { initialDashboard: value }));

test('usage dashboard distinguishes missing data, partial estimates, and observed zero', () => {
  const html = render(dashboard());
  assert.match(html, /<h1>运营仪表盘<\/h1>/);
  assert.match(html, /360\.69 MB/);
  assert.match(html, /<dt>今日流量<\/dt><dd>待结算<\/dd>/);
  assert.match(html, /<dt>昨日流量估算<\/dt><dd>14\.20 MB<\/dd>/);
  assert.match(html, /<dt>账期剩余额度<\/dt><dd>4\.64 GB<\/dd>/);
  assert.match(html, /<td>暂无数据<\/td><td>0<\/td><td><span[^>]*>缺少采样<\/span><\/td>/);
  assert.match(html, /<td>0 B<\/td><td>24<\/td><td><span[^>]*>估算<\/span><\/td>/);
  assert.match(html, /<td>暂无数据<\/td><td>4<\/td><td><span[^>]*>待结算<\/span><\/td>/);
  assert.match(html, /2026\/11\/02 19:00/);
  assert.match(html, /采样时间不是供应商计费时间/);
  assert.match(html, /不能作为官方账单/);
  assert.match(html, /不是本机 PostgreSQL 流量/);
  assert.match(html, /历史记录保留 60 天/);
});

test('observed daily increments show their actual coverage instead of pending settlement', () => {
  const value = dashboard();
  Object.assign(value.days.at(-1), {
    bytes: 20,
    status: 'partial',
    from: '2026-11-02T10:00:00.000Z',
    through: '2026-11-02T11:00:00.000Z',
  });
  const html = render(value);
  assert.match(html, /<dt>今日流量<\/dt><dd>20 B<\/dd>/);
  assert.match(html, /采样区间：2026\/11\/02 11:00 — 2026\/11\/02 12:00/);
  assert.match(html, /部分时段/);
});

test('unconfigured dashboard explains missing setup and disables sampling, without inventing usage', () => {
  const html = render(
    dashboard({
      configured: false,
      available: false,
      missing: ['HZENSE_NEON_API_KEY'],
      sampledAt: null,
      totalBytes: null,
      quotaBytes: null,
      quotaPercent: null,
      costs: null,
      costSampledAt: null,
      days: dashboard().days.map((day) => ({ ...day, bytes: null, status: 'missing', samples: 0 })),
    }),
  );
  assert.match(html, /监控尚未配置完成/);
  assert.match(html, /HZENSE_NEON_API_KEY/);
  assert.match(html, /<button[^>]*disabled=""[^>]*>立即采样<\/button>/);
  assert.match(html, /首次采样建立基线/);
  assert.doesNotMatch(html, />0 B</);
});

test('quota cards distinguish unset quota, missing usage, and an actual overage', () => {
  const unset = render(dashboard({ quotaBytes: null, quotaPercent: null }));
  assert.match(unset, /<dt>账期剩余额度<\/dt><dd>未设置<\/dd>/);
  assert.match(unset, /额度未设置/);
  const missing = render(dashboard({ totalBytes: null, quotaPercent: null }));
  assert.match(missing, /<dt>账期剩余额度<\/dt><dd>暂无数据<\/dd>/);
  const overage = render(
    dashboard({ totalBytes: 5_500_000_000, quotaPercent: 110, alert: 'critical' }),
  );
  assert.match(overage, /<dt>账期剩余额度<\/dt><dd>0 B<\/dd>/);
  assert.match(overage, /已超出 500\.00 MB/);
  assert.match(overage, /110\.0%/);
});

test('stale snapshots and quota notices remain explicit while unknown errors are sanitized', () => {
  const html = render(
    dashboard({
      stale: true,
      available: false,
      error: 'raw-secret-must-never-display',
      alert: 'critical',
      quotaPercent: 91.2,
    }),
  );
  assert.match(html, /最近采样已过期/);
  assert.match(html, /流量额度预警/);
  assert.match(html, /91\.2/);
  assert.match(html, /360\.69 MB/);
  assert.doesNotMatch(html, /raw-secret-must-never-display/);
});

function costMarkup(overrides = {}) {
  const html = render(dashboard(overrides));
  const section = html.match(
    /<section[^>]*aria-labelledby="usage-cost-title"[\s\S]*?<\/section>/,
  )?.[0];
  assert.ok(section, 'database cost section is present');
  return section;
}

test('database cost panel shows completed UTC coverage, seven priced categories, and small amounts', () => {
  const html = costMarkup();
  assert.match(html, /数据库费用/);
  assert.match(html, /已完成日费用估算/);
  assert.match(html, /Launch/);
  assert.match(html, /\$2\.47/);
  for (const label of [
    '计算',
    '存储',
    '历史保留',
    '快照',
    '公网出站',
    '私网传输（双向）',
    '额外分支',
  ]) {
    assert.match(html, new RegExp(`<dt>${label}</dt>`));
  }
  assert.match(html, /\$0\.0004/);
  assert.match(html, /费用覆盖：2026\/11\/01 00:00.*2026\/11\/02 00:00.*UTC/);
  assert.match(html, /费用采样：2026\/11\/02 19:00/);
  assert.match(html, /不含 Functions、Auth、税费、折扣及组织级最低消费，不是官方账单/);
  assert.match(html, /单价版本：2026-11-02/);
  const tiny = costMarkup({
    costs: { ...dashboard().costs, totalMicrousd: 10, items: [{ kind: 'compute', microusd: 10 }] },
  });
  assert.match(tiny, /&lt; \$0\.0001/);
  assert.doesNotMatch(tiny, /\$0\.00(?:<|$)/);
});

test('missing or unavailable costs never appear as free and do not hide the traffic dashboard', () => {
  for (const costs of [
    null,
    { ...dashboard().costs, status: 'unavailable', totalMicrousd: null, reason: 'missing_org' },
    {
      ...dashboard().costs,
      status: 'unavailable',
      totalMicrousd: null,
      reason: 'raw-secret-value',
    },
  ]) {
    const html = costMarkup({ costs, costSampledAt: null });
    assert.match(html, /暂不可用/);
    assert.doesNotMatch(html, /\$0\.00/);
    assert.doesNotMatch(html, /\$2\.47/);
    assert.doesNotMatch(html, /raw-secret-value/);
    const fullPage = render(dashboard({ costs, costSampledAt: null }));
    assert.match(fullPage, /360\.69 MB/);
    assert.match(fullPage, /每日流量趋势/);
  }
  assert.match(
    costMarkup({ costs: { ...dashboard().costs, status: 'unavailable', reason: 'missing_org' } }),
    /项目未返回可用组织信息/,
  );
});

test('zero cost is shown only for a valid estimate or a confirmed current Free plan', () => {
  const free = costMarkup({
    costs: { ...dashboard().costs, status: 'free', plan: 'free', totalMicrousd: 0, items: [] },
  });
  assert.match(free, /当前 Free 套餐/);
  assert.match(free, /\$0\.00/);
  assert.match(free, /仅说明当前套餐，不代表历史账期账单/);
  assert.doesNotMatch(free, /费用覆盖/);
  const zero = costMarkup({
    costs: {
      ...dashboard().costs,
      totalMicrousd: 0,
      items: dashboard().costs.items.map((item) => ({ ...item, microusd: 0 })),
    },
  });
  assert.match(zero, /已完成日费用估算/);
  assert.match(zero, /\$0\.00/);
  const unconfirmed = costMarkup({
    costs: { ...dashboard().costs, status: 'free', plan: null, totalMicrousd: 0, items: [] },
  });
  assert.match(unconfirmed, /暂不可用/);
  assert.doesNotMatch(unconfirmed, /\$0\.00/);
});

async function startFixture(initial) {
  const browserBuild = await build({
    stdin: {
      contents: `
        import { createRoot } from 'react-dom/client';
        import { AdminNeonUsage } from './components/admin-neon-usage';
        const data = await (await fetch('/bootstrap')).json();
        createRoot(document.getElementById('root')).render(<AdminNeonUsage initialDashboard={data} />);
      `,
      resolveDir: web,
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
  });
  const assets = new Map(
    browserBuild.outputFiles.map((file) => [`/${file.path.split('/').at(-1)}`, file.contents]),
  );
  const globals = await readFile(new URL('../app/globals.css', import.meta.url), 'utf8');
  assets.set('/globals.css', globals.replace(/^@import\s+['"]tailwindcss['"];\s*/m, ''));
  assets.set(
    '/preflight.css',
    await readFile(fileURLToPath(import.meta.resolve('tailwindcss/preflight.css'))),
  );
  const requests = [];
  const server = createServer((request, response) => {
    const url = new URL(request.url, 'http://localhost');
    if (url.pathname === '/bootstrap') {
      response.setHeader('Content-Type', 'application/json');
      response.end(JSON.stringify(initial));
      return;
    }
    if (url.pathname === '/api/admin/neon-usage') {
      requests.push(request.method);
      response.setHeader('Content-Type', 'application/json');
      response.setHeader('Cache-Control', 'no-store');
      if (request.method === 'POST') {
        response.statusCode = 503;
        response.end(JSON.stringify({ error: 'synthetic-secret-not-a-safe-code' }));
      } else {
        response.end(JSON.stringify({ ...initial, totalBytes: 400_000_000 }));
      }
      return;
    }
    if (assets.has(url.pathname)) {
      response.setHeader(
        'Content-Type',
        url.pathname.endsWith('.css') ? 'text/css' : 'text/javascript',
      );
      response.end(assets.get(url.pathname));
      return;
    }
    response.setHeader('Content-Type', 'text/html');
    response.end(
      `<!doctype html><html lang="zh"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/preflight.css"><link rel="stylesheet" href="/globals.css"><link rel="stylesheet" href="/entry.css"><main style="max-width:1200px;margin:auto;padding:16px"><div id="root"></div></main><script type="module" src="/entry.js"></script></html>`,
    );
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    origin: `http://127.0.0.1:${server.address().port}`,
    requests,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

test(
  'dashboard ranges stay local, explicit requests preserve values on failure, and layouts fit mobile',
  {
    skip: process.env.HZENSE_NEON_USAGE_BROWSER_TEST !== '1',
    timeout: 60000,
  },
  async (t) => {
    const fixture = await startFixture(dashboard());
    t.after(fixture.close);
    const browser = await chromium.launch();
    t.after(() => browser.close());
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.route('**/*', (route) =>
      route.request().url().startsWith(fixture.origin) ? route.continue() : route.abort(),
    );
    await page.goto(fixture.origin);
    await expect(page.getByRole('heading', { name: '运营仪表盘', level: 1 })).toBeVisible();
    await expect(page.getByRole('button', { name: '立即采样' })).toBeVisible();
    assert.deepEqual(fixture.requests, [], 'Opening the dashboard must not sample or poll');
    const aiCosts = page.getByRole('region', { name: 'AI 调用费用', exact: true });
    await expect(aiCosts.getByText('$1.50', { exact: true })).toBeVisible();
    await expect(aiCosts.getByRole('table').locator('tbody tr')).toHaveCount(5);
    await aiCosts.getByText('AI 费用口径', { exact: true }).click();
    await expect(aiCosts.getByText(/真实调用，不含模拟/)).toBeVisible();
    await aiCosts.getByText('AI 费用口径', { exact: true }).click();
    const costs = page.getByRole('region', { name: '数据库费用', exact: true });
    await expect(costs.getByText('$2.47', { exact: false })).toBeVisible();
    await expect(costs.locator('dl[aria-label="数据库费用明细"] dt')).toHaveCount(7);
    await costs.getByText('费用口径与单价说明', { exact: true }).click();
    await expect(costs.getByText(/不含 Functions、Auth/)).toBeVisible();
    await costs.getByText('费用口径与单价说明', { exact: true }).click();
    const chart = page.getByRole('img', { name: /^每日估算流量柱状图/ });
    const table = page.getByRole('table', { name: '每日流量明细（Europe/Berlin）' });
    const metrics = page.locator('dl[aria-label="Neon 流量概览"]');
    await expect(metrics.locator('dt')).toHaveCount(4);
    for (const [label, value] of [
      ['本账期累计', '360.69 MB'],
      ['今日流量', '待结算'],
      ['昨日流量估算', '14.20 MB'],
      ['账期剩余额度', '4.64 GB'],
    ]) {
      const card = metrics.locator(':scope > div').filter({ hasText: label });
      await expect(card.locator('dd').first()).toHaveText(value);
    }
    for (const width of [1440, 390, 320]) {
      await page.setViewportSize({ width, height: 1000 });
      await expect(table).toBeVisible();
      for (const range of [7, 30]) {
        await page.getByRole('button', { name: `近 ${range} 天`, exact: true }).click();
        await expect(
          page.getByRole('button', { name: `近 ${range} 天`, exact: true }),
        ).toHaveAttribute('aria-pressed', 'true');
        await expect(chart.locator(':scope > div[title]')).toHaveCount(range);
        await expect(table.locator('tbody tr')).toHaveCount(range);
        await expect(table.locator('tbody tr').first()).toContainText('2026-11-02');
        await expect(table.locator('tbody tr').last()).toContainText(
          range === 7 ? '2026-10-27' : '2026-10-04',
        );
        assert.equal(
          await page.evaluate(
            () => globalThis.document.documentElement.scrollWidth <= globalThis.innerWidth,
          ),
          true,
          `no page overflow for ${range} days at ${width}px`,
        );
        const visibleTicks = await chart.locator('span').evaluateAll((nodes) =>
          nodes
            .filter(
              (node) =>
                /^\d{2}$/.test(node.textContent ?? '') &&
                globalThis.getComputedStyle(node).visibility === 'visible',
            )
            .map((node) => {
              const text = globalThis.document.createRange();
              text.selectNodeContents(node);
              const rects = [...text.getClientRects()];
              return { lines: rects.length, left: rects[0]?.left, right: rects[0]?.right };
            }),
        );
        assert.ok(visibleTicks.length >= 6, `visible date ticks for ${range} days at ${width}px`);
        if (range === 7) assert.equal(visibleTicks.length, 7);
        for (const [index, tick] of visibleTicks.entries()) {
          assert.equal(tick.lines, 1, `date tick remains on one line at ${width}px`);
          assert.ok(tick.left >= 0 && tick.right <= width);
          if (index > 0)
            assert.ok(
              tick.left >= visibleTicks[index - 1].right,
              `date ticks do not overlap for ${range} days at ${width}px`,
            );
        }
      }
      for (const button of await page.getByRole('button').all()) {
        const box = await button.boundingBox();
        assert.ok(box.height >= 44);
      }
      if (width !== 320) {
        await page.screenshot({ path: `/tmp/hzense-neon-dashboard-${width}.png`, fullPage: true });
      }
    }
    assert.deepEqual(fixture.requests, [], 'Range changes and resizing must not fetch or sample');
    await page.getByRole('button', { name: '刷新记录' }).click();
    await expect(page.getByText('400.00 MB', { exact: true })).toBeVisible();
    assert.deepEqual(fixture.requests, ['GET']);
    await page.getByRole('button', { name: '立即采样' }).click();
    await expect(page.getByRole('alert')).toContainText('本次操作未确认完成');
    await expect(page.getByText('400.00 MB', { exact: true })).toBeVisible();
    await expect(costs.getByText('$2.47', { exact: false })).toBeVisible();
    await expect(page.locator('body')).not.toContainText('synthetic-secret');
    assert.deepEqual(fixture.requests, ['GET', 'POST']);
    await page.getByRole('button', { name: '刷新记录' }).focus();
    await expect(page.getByRole('button', { name: '刷新记录' })).toBeFocused();
    assert.deepEqual(
      fixture.requests,
      ['GET', 'POST'],
      'Resizing and reading must not issue extra requests',
    );
    assert.deepEqual(errors, []);
  },
);
