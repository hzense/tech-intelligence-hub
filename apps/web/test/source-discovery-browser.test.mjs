import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { fileURLToPath, URL } from 'node:url';
import process from 'node:process';
import { build } from 'esbuild';
import { chromium, expect } from '@playwright/test';

test(
  'discovery UI saves without topics or URLs and explicitly converts legacy schedules',
  { skip: process.env.HZENSE_AUTOMATION_BROWSER_TEST !== '1' },
  async () => {
    const root = fileURLToPath(new URL('..', import.meta.url));
    const profileId = '11111111-1111-4111-8111-111111111111';
    const initial = {
      configs: [
        {
          id: 'legacy',
          revision: 1,
          enabled: true,
          config: {
            name: '旧网址任务',
            kind: 'source_collection',
            frequency: 'daily',
            enabled: true,
            sourceUrls: ['https://example.com/old'],
            topicIds: ['topic-ai'],
            profileId,
            profileRevision: 1,
          },
        },
      ],
      runs: [],
    };
    const compiled = await build({
      stdin: {
        contents: `import {createRoot} from 'react-dom/client'; import {AdminAutomation} from './components/admin-automation'; createRoot(document.getElementById('root')).render(<AdminAutomation kind="source_collection" configured={true} loadError={false} initial={${JSON.stringify(initial)}} profiles={[{id:'${profileId}',revision:1,name:'验收模型',ready:true}]} topics={[{id:'topic-ai',name:'人工智能'}]}/>);`,
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
                "import React from 'react'; export default function Link(props){return React.createElement('a',props)}",
              loader: 'js',
              resolveDir: root,
            }));
          },
        },
      ],
    });
    const assets = new Map(
      compiled.outputFiles.map((f) => [`/${f.path.split('/').at(-1)}`, f.contents]),
    );
    const server = createServer((req, res) => {
      res.setHeader(
        'Content-Type',
        assets.has(req.url)
          ? req.url.endsWith('.css')
            ? 'text/css'
            : 'text/javascript'
          : 'text/html',
      );
      res.end(
        assets.get(req.url) ??
          '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/entry.css"><div id="root"></div><script type="module" src="/entry.js"></script>',
      );
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    let browser;
    try {
      browser = await chromium.launch({ headless: true });
      const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
      const errors = [],
        posts = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await page.route('**/api/admin/automation', async (route) => {
        if (route.request().method() === 'GET') return route.fulfill({ json: initial });
        const body = route.request().postDataJSON();
        posts.push(body);
        return route.fulfill({
          json: {
            config: {
              id: body.request.id,
              revision: body.request.expectedRevision + 1,
              config: body.request.config,
              enabled: body.request.config.enabled,
            },
          },
        });
      });
      await page.goto(`http://127.0.0.1:${server.address().port}`);
      await expect(page.getByText('无需指定领域或填写网址', { exact: false })).toBeVisible();
      await expect(page.locator('textarea')).toHaveCount(0);
      await expect(page.getByRole('checkbox', { name: '人工智能', exact: true })).toHaveCount(0);
      await page.getByLabel('配置名称', { exact: true }).fill('芯片情报');
      await page.getByLabel('分阶段模型配置', { exact: true }).selectOption(profileId);
      await page.getByLabel('关注关键词', { exact: false }).fill('芯片，英伟达');
      await page.getByRole('button', { name: '保存配置', exact: true }).click();
      await expect(page.getByRole('status')).toContainText('保存配置不会启动任务');
      assert.equal(posts.length, 1);
      assert.deepEqual(posts[0].request.config.sourceUrls, []);
      assert.deepEqual(posts[0].request.config.topicIds, []);
      assert.deepEqual(posts[0].request.config.discovery, {
        keywords: ['芯片', '英伟达'],
        lookbackDays: 2,
        maxSources: 5,
      });
      assert.equal(posts[0].request.config.enabled, false);
      await page.getByRole('button', { name: '编辑', exact: true }).click();
      await expect(page.getByText('此为旧固定网址配置', { exact: false })).toBeVisible();
      await expect(page.getByRole('checkbox', { name: '允许定时执行' })).not.toBeChecked();
      await expect(page.getByRole('button', { name: '保存配置', exact: true })).toBeEnabled();
      await expect(page.getByText('此旧配置包含领域限制', { exact: false })).toBeVisible();
      await page.getByRole('button', { name: '保存配置', exact: true }).click();
      await expect(page.getByRole('status')).toContainText('保存配置不会启动任务');
      assert.equal(posts.length, 2);
      assert.deepEqual(posts[1].request.config.topicIds, []);
      assert.equal(posts[1].request.config.enabled, false);
      assert.deepEqual(errors, []);
    } finally {
      await browser?.close();
      await new Promise((resolve) => server.close(resolve));
    }
  },
);
