import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { fileURLToPath, URL } from 'node:url';
import process from 'node:process';
import { build } from 'esbuild';
import { chromium, expect } from '@playwright/test';

const topic = (id, title = `测试专题 ${id}`) => ({ id: `topic-${id}`, title });
const report = (id, topicIds) => ({ id, topicIds, title: `测试报告 ${id}` });

test(
  'published topic catalog: populated filters, unique report counts, collapse and mobile keyboard use',
  { skip: process.env.HZENSE_TOPIC_CATALOG_BROWSER_TEST !== '1' },
  async (t) => {
    const root = fileURLToPath(new URL('..', import.meta.url));
    const compiled = await build({
      stdin: {
        contents: `import {createRoot} from 'react-dom/client';
          import {TopicInsightCatalog} from './components/topic-insight-catalog';
          const props=await (await fetch('/fixture-state')).json();
          props.reports=props.reports.map(report=>({...report,
            card:<article data-testid={'report-'+report.id}>
              <a href={'/topics/'+report.topicIds[0]+'/editions/'+report.id}>{report.title}</a>
            </article>}));
          createRoot(document.getElementById('root')).render(<TopicInsightCatalog {...props}/>);`,
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
    });
    const assets = new Map(
      compiled.outputFiles.map((file) => [`/${file.path.split('/').at(-1)}`, file.contents]),
    );
    const css = [...assets.keys()]
      .filter((path) => path.endsWith('.css'))
      .map((path) => `<link rel="stylesheet" href="${path}">`)
      .join('');
    const server = createServer((request, response) => {
      const asset = assets.get(request.url);
      response.setHeader(
        'Content-Type',
        asset ? (request.url.endsWith('.css') ? 'text/css' : 'text/javascript') : 'text/html',
      );
      response.end(
        asset ??
          `<!doctype html><html lang="zh-CN"><head><meta name="viewport" content="width=device-width,initial-scale=1">${css}</head><body><main id="root"></main><script type="module" src="/entry.js"></script></body></html>`,
      );
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const origin = `http://127.0.0.1:${server.address().port}`;
    const browser = await chromium.launch({ headless: true });
    t.after(async () => {
      await browser.close();
      await new Promise((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    });

    async function setup(subtest, props, viewport = { width: 1100, height: 820 }) {
      const page = await browser.newPage({ viewport });
      page.setDefaultTimeout(5_000);
      const errors = [];
      const unexpected = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await page.route('**/*', (route) => {
        const url = new URL(route.request().url());
        if (url.origin !== origin || url.pathname.startsWith('/api/')) {
          unexpected.push(`${route.request().method()} ${url.pathname}`);
          return route.abort();
        }
        return route.continue();
      });
      await page.route('**/fixture-state', (route) => route.fulfill({ json: props }));
      subtest.after(async () => {
        assert.deepEqual(errors, [], 'The catalog must render and filter without browser errors');
        assert.deepEqual(unexpected, [], 'Filtering must not make API or external requests');
        await page.close();
      });
      await page.goto(origin);
      // Empty catalogs can legitimately have no buttons or cards. This hook
      // only waits for the real React component to finish its initial render.
      await expect(page.locator('#root')).not.toBeEmpty();
      return page;
    }
    const topicButton = (page, title) => page.getByRole('button', { name: new RegExp(title) });
    const allButton = (page) => page.getByRole('button', { name: /^全部/ });
    const cards = (page) => page.locator('[data-testid^="report-"]');
    const toggle = (page) => page.locator('button[aria-expanded]');

    await t.test('zero reports never show categories from the topic taxonomy', async (subtest) => {
      const topics = [topic('ai', '人工智能'), topic('robotics', '机器人')];
      const page = await setup(subtest, { topics, reports: [] });
      await expect(cards(page)).toHaveCount(0);
      for (const entry of topics) await expect(topicButton(page, entry.title)).toHaveCount(0);
      await expect(toggle(page)).toHaveCount(0);
      assert.equal((await page.getByRole('button', { pressed: true }).count()) <= 1, true);
    });

    await t.test(
      'reports with no matching taxonomy do not invent empty topic filters',
      async (subtest) => {
        const topics = [topic('empty', '没有报告的专题')];
        const page = await setup(subtest, {
          topics,
          reports: [report('outside-taxonomy', ['topic-unlisted'])],
        });
        await expect(cards(page)).toHaveCount(1);
        await expect(topicButton(page, topics[0].title)).toHaveCount(0);
        await expect(toggle(page)).toHaveCount(0);
        await expect(page.getByRole('link', { name: '测试报告 outside-taxonomy' })).toHaveAttribute(
          'href',
          '/topics/topic-unlisted/editions/outside-taxonomy',
        );
      },
    );

    await t.test(
      'cross-topic reports count once in all and retain their canonical card links when filtered',
      async (subtest) => {
        const page = await setup(subtest, {
          topics: [topic('ai', '人工智能'), topic('security', '安全'), topic('empty', '空专题')],
          reports: [
            report('shared', ['topic-ai', 'topic-security', 'topic-ai']),
            report('ai-only', ['topic-ai']),
          ],
        });
        const ai = topicButton(page, '人工智能');
        const security = topicButton(page, '安全');
        await expect(allButton(page)).toHaveText(/\b2\b/);
        await expect(ai).toHaveText(/\b2\b/);
        await expect(security).toHaveText(/\b1\b/);
        await expect(topicButton(page, '空专题')).toHaveCount(0);
        await expect(cards(page)).toHaveCount(2);
        await expect(page.getByTestId('report-shared')).toHaveCount(1);
        await security.click();
        await expect(security).toHaveAttribute('aria-pressed', 'true');
        await expect(cards(page)).toHaveCount(1);
        await expect(page.getByTestId('report-shared')).toBeVisible();
        await expect(page.getByRole('link', { name: '测试报告 shared' })).toHaveAttribute(
          'href',
          '/topics/topic-ai/editions/shared',
        );
        await ai.click();
        await expect(cards(page)).toHaveCount(2);
        await expect(ai).toHaveAttribute('aria-pressed', 'true');
        await allButton(page).click();
        await expect(allButton(page)).toHaveAttribute('aria-pressed', 'true');
        await expect(page.getByRole('button', { pressed: true })).toHaveCount(1);
        await expect(cards(page)).toHaveCount(2);
      },
    );

    await t.test(
      'more than six topics expand and collapse while keeping the active topic visible',
      async (subtest) => {
        const topics = Array.from({ length: 9 }, (_, index) => topic(String(index + 1)));
        const page = await setup(subtest, {
          topics,
          reports: topics.map((entry) => report(entry.id, [entry.id])),
        });
        const initial = [];
        for (const entry of topics)
          if (await topicButton(page, entry.title).count()) initial.push(entry.id);
        assert.equal(initial.length, 6);
        await expect(allButton(page)).toHaveText(/\b9\b/);
        await expect(toggle(page)).toHaveAttribute('aria-expanded', 'false');
        await toggle(page).click();
        await expect(toggle(page)).toHaveAttribute('aria-expanded', 'true');
        for (const entry of topics) await expect(topicButton(page, entry.title)).toBeVisible();
        const selected = topics.find((entry) => !initial.includes(entry.id));
        assert.ok(selected);
        await topicButton(page, selected.title).click();
        await expect(cards(page)).toHaveCount(1);
        await toggle(page).click();
        await expect(toggle(page)).toHaveAttribute('aria-expanded', 'false');
        await expect(topicButton(page, selected.title)).toBeVisible();
        await expect(topicButton(page, selected.title)).toHaveAttribute('aria-pressed', 'true');
        let visibleTopics = 0;
        for (const entry of topics) visibleTopics += await topicButton(page, entry.title).count();
        assert.equal(
          visibleTopics,
          6,
          'Collapsed filters keep six topics, including the active one',
        );
        await expect(page.getByTestId(`report-${selected.id}`)).toBeVisible();
      },
    );

    await t.test(
      'mobile filters fit the viewport and support native keyboard activation',
      async (subtest) => {
        const topics = Array.from({ length: 8 }, (_, index) =>
          topic(String(index + 1), `人工智能跨领域技术研究 ${index + 1}`),
        );
        const page = await setup(
          subtest,
          {
            topics,
            reports: topics.map((entry) => report(entry.id, [entry.id])),
          },
          { width: 360, height: 780 },
        );
        const selected = topicButton(page, topics[0].title);
        await selected.focus();
        await expect(selected).toBeFocused();
        await page.keyboard.press('Enter');
        await expect(selected).toHaveAttribute('aria-pressed', 'true');
        await expect(cards(page)).toHaveCount(1);
        await toggle(page).focus();
        await page.keyboard.press('Space');
        await expect(toggle(page)).toHaveAttribute('aria-expanded', 'true');
        await expect(topicButton(page, topics.at(-1).title)).toBeVisible();
        await allButton(page).focus();
        await page.keyboard.press('Space');
        await expect(allButton(page)).toHaveAttribute('aria-pressed', 'true');
        await expect(cards(page)).toHaveCount(8);
        const width = await page.evaluate(() => ({
          viewport: globalThis.innerWidth,
          document: globalThis.document.documentElement.scrollWidth,
          body: globalThis.document.body.scrollWidth,
        }));
        assert.ok(
          width.document <= width.viewport + 1,
          `Document overflow: ${JSON.stringify(width)}`,
        );
        assert.ok(width.body <= width.viewport + 1, `Body overflow: ${JSON.stringify(width)}`);
      },
    );
  },
);
