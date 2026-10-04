import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { fileURLToPath, URL } from 'node:url';
import process from 'node:process';
import { build } from 'esbuild';
import { chromium, expect } from '@playwright/test';
const { structuredClone } = globalThis;
/* global document */

test(
  'publication metadata UI: manual completion, one-click publication, reread, withdrawal and same-key recovery',
  { skip: process.env.HZENSE_CANDIDATE_REVIEW_BROWSER_TEST !== '1' },
  async () => {
    const compiled = await build({
      stdin: {
        contents: `import {createRoot} from 'react-dom/client';import {EditorialPublicationEditor} from './components/editorial-publication-editor';createRoot(document.getElementById('root')).render(<EditorialPublicationEditor runId="11111111-1111-4111-8111-111111111111" candidateIndex={0}/>);`,
        resolveDir: fileURLToPath(new URL('..', import.meta.url)),
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
          name: 'standalone-link',
          setup(builder) {
            builder.onResolve({ filter: /^next\/link$/ }, () => ({
              path: 'link',
              namespace: 'fixture',
            }));
            builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({
              contents:
                "import React from 'react'; export default function Link({prefetch,...props}){return React.createElement('a',props)}",
              loader: 'js',
              resolveDir: fileURLToPath(new URL('..', import.meta.url)),
            }));
          },
        },
      ],
    });
    const assets = new Map(
      compiled.outputFiles.map((f) => [`/${f.path.split('/').at(-1)}`, f.contents]),
    );
    const server = createServer((req, res) => {
      if (assets.has(req.url)) {
        res.setHeader('Content-Type', req.url.endsWith('.css') ? 'text/css' : 'text/javascript');
        res.end(assets.get(req.url));
        return;
      }
      res.setHeader('Content-Type', 'text/html');
      res.end(
        '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/entry.css"><div id="root"></div><script type="module" src="/entry.js"></script>',
      );
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    let browser;
    try {
      browser = await chromium.launch({ headless: true });
      const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
      const errors = [];
      page.on('pageerror', (error) => errors.push(error.message));
      let data = {
        configured: true,
        materialHash: 'a'.repeat(64),
        revision: 0,
        action: null,
        content: {
          title: '测试信号标题',
          summary: '合成资料，不涉及生产发布或 AI 调用。',
          eventDate: null,
          signalType: null,
          organizations: [],
          persons: [],
          topics: [{ id: 'ai', title: '人工智能' }],
          sourceUrls: [],
        },
        topicOptions: [{ id: 'ai', title: '人工智能' }],
        sourceOptions: ['https://example.com/article?id=42'],
        warnings: [],
        requestId: null,
        publicId: null,
      };
      const posts = [];
      let unknown = false;
      let concurrentWithdraw = false;
      let historicalReceipt = null;
      let hangNext = false;
      let hangingRoute;
      await page.route('**/api/admin/editorial-signals**', async (route) => {
        if (route.request().method() === 'GET') {
          await route.fulfill({ json: data });
          return;
        }
        const body = route.request().postDataJSON();
        posts.push(body);
        if (hangNext) {
          hangNext = false;
          hangingRoute = route;
          return;
        }
        if (historicalReceipt?.requestId === body.requestId) {
          await route.fulfill({ json: historicalReceipt });
          return;
        }
        if (unknown) {
          unknown = false;
          await route.fulfill({ status: 503, json: { error: 'commit_unknown' } });
          return;
        }
        data = {
          ...data,
          revision: data.revision + 1,
          action: body.action,
          requestId: body.requestId,
          content: body.action === 'withdraw' ? data.content : body.content,
          publicId: body.action === 'publish' ? `editorial-${'b'.repeat(32)}` : null,
        };
        if (concurrentWithdraw) {
          concurrentWithdraw = false;
          historicalReceipt = {
            revision: data.revision,
            action: data.action,
            requestId: data.requestId,
            publicId: data.publicId,
            content: data.content,
          };
          data = {
            ...data,
            revision: data.revision + 1,
            action: 'withdraw',
            publicId: null,
            requestId: '33333333-3333-4333-8333-333333333333',
          };
          await route.fulfill({ status: 503, json: { error: 'commit_unknown' } });
          return;
        }
        await route.fulfill({
          json: {
            revision: data.revision,
            action: data.action,
            requestId: data.requestId,
            publicId: data.publicId,
            content: data.content,
          },
        });
      });
      await page.goto(`http://127.0.0.1:${server.address().port}`);
      await expect(page.getByRole('button', { name: '确认发布', exact: true }))
        .toBeDisabled()
        .catch(async (error) => {
          throw new Error(
            `${error.message}\n${errors.join('\n')}\n${await page.locator('body').innerText()}`,
          );
        });
      await expect(page.getByRole('checkbox', { name: '人工智能' })).toBeChecked();
      await page.getByRole('checkbox', { name: '人工智能' }).uncheck();
      await expect(page.getByRole('checkbox', { name: '人工智能' })).not.toBeChecked();
      await page.getByLabel('事件日期', { exact: true }).fill('2026-09-25');
      await page.getByLabel('事件类型', { exact: true }).selectOption('product');
      const sourceChoice = page.getByRole('checkbox', {
        name: '公开来源：https://example.com/article?id=42',
      });
      await expect(sourceChoice).not.toBeChecked();
      await sourceChoice.check();
      await page.getByLabel('组织', { exact: true }).fill('测试组织');
      await page.getByLabel('人物', { exact: true }).fill('测试人物');
      await page.getByLabel('领域', { exact: true }).fill('人工');
      await page.getByRole('checkbox', { name: '人工智能' }).check();
      await expect(page.getByRole('button', { name: '确认发布', exact: true })).toBeEnabled();
      await page.getByRole('button', { name: '确认发布', exact: true }).click();
      await expect(page.getByText('已确认发布。', { exact: true })).toBeVisible();
      assert.equal(posts.length, 1);
      assert.equal(posts[0].consent, true);
      assert.equal(posts[0].action, 'publish');
      assert.equal(posts[0].content.signalType, 'product');
      assert.deepEqual(posts[0].content.sourceUrls, ['https://example.com/article?id=42']);
      assert.deepEqual(posts[0].content.persons, ['测试人物']);
      await page.reload();
      await expect(page.getByRole('button', { name: '确认更新发布' })).toBeVisible();
      assert.deepEqual(errors, []);
      await page.screenshot({ path: '/tmp/hzense-editorial-before-withdraw.png', fullPage: true });
      // A local incomplete edit must not prevent withdrawing the saved public revision.
      await page
        .getByLabel('人物', { exact: true })
        .fill('', { timeout: 3000 })
        .catch(async (error) => {
          throw new Error(
            `${error.message}\n${errors.join('\n')}\n${await page.locator('body').innerText()}\n${await page.locator('label').allTextContents()}`,
          );
        });
      page.once('dialog', (dialog) => dialog.accept());
      await page.getByRole('button', { name: '撤回发布', exact: true }).click();
      await expect(page.getByText('已撤回发布。', { exact: true })).toBeVisible();
      assert.equal(posts.length, 2);
      await page.getByLabel('人物', { exact: true }).fill('再次确认人物');
      unknown = true;
      await page.getByRole('button', { name: '确认发布', exact: true }).click();
      await expect(page.getByRole('button', { name: '重试原请求' })).toBeVisible();
      await expect(page.getByLabel('人物', { exact: true })).toBeDisabled();
      await page.getByRole('button', { name: '核对已保存状态' }).click();
      await expect(
        page.getByText('尚未查到本次保存；可以重试原请求，不会重复创建记录。'),
      ).toBeVisible();
      await page.getByRole('button', { name: '重试原请求' }).click();
      await expect(page.getByText('已确认发布。', { exact: true })).toBeVisible();
      assert.deepEqual(posts[2], posts[3]);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= 390), true);
      await page.screenshot({ path: '/tmp/hzense-editorial-mobile.png', fullPage: true });
      await page.setViewportSize({ width: 1280, height: 900 });
      await page.screenshot({ path: '/tmp/hzense-editorial-desktop.png', fullPage: true });
      concurrentWithdraw = true;
      await page.getByRole('button', { name: '确认更新发布' }).click();
      await expect(page.getByRole('button', { name: '重试原请求' })).toBeEnabled();
      await page.getByRole('button', { name: '重试原请求' }).click();
      await expect(
        page.getByText('原请求已保存；已读取后续修订，请以当前状态为准。'),
      ).toBeVisible();
      await expect(page.getByRole('link', { name: '查看正式信号' })).toHaveCount(0);
      await expect(page.getByRole('button', { name: '确认发布', exact: true })).toBeEnabled();
      data.topicOptions = [{ id: 'new-ai', title: '新领域' }];
      await page.reload();
      await expect(page.getByRole('button', { name: '移除 人工智能' })).toBeVisible();
      await expect(page.getByRole('button', { name: '确认发布', exact: true })).toBeDisabled();
      await page.getByRole('button', { name: '移除 人工智能' }).click();
      await page.getByRole('checkbox', { name: '新领域' }).check();
      await expect(page.getByRole('button', { name: '确认发布', exact: true })).toBeEnabled();
      await page.clock.install();
      hangNext = true;
      await page.getByRole('button', { name: '确认发布', exact: true }).click();
      await expect.poll(() => Boolean(hangingRoute)).toBe(true);
      await page.clock.runFor(31_000);
      await expect(page.getByRole('button', { name: '重试原请求' })).toBeEnabled();
      await expect(page.getByRole('button', { name: '核对已保存状态' })).toBeEnabled();
      await hangingRoute.abort().catch(() => {});
      await page.clock.resume();
      data.configured = false;
      await page.reload();
      await expect(page.getByRole('button', { name: '确认发布', exact: true })).toBeDisabled();
      // New generation carries resource drafts through the same one-click publication.
      const generatedResources = [
        {
          type: 'company',
          name: 'Example, Inc.',
          introduction: '开发云工具的公司。',
          event_role: '发布新工具',
          evidence: [{ fragment_id: 'f1', quote: 'Example, Inc. 发布新工具。' }],
          entity_id: null,
        },
        {
          type: 'person',
          name: 'Alex Example',
          introduction: null,
          event_role: '介绍新工具',
          evidence: [{ fragment_id: 'f2', quote: 'Alex Example 介绍新工具。' }],
          entity_id: null,
        },
        {
          type: 'institution',
          name: '示例研究所',
          introduction: null,
          event_role: null,
          evidence: [{ fragment_id: 'f3', quote: '示例研究所参与测试。' }],
          entity_id: 'institution-existing',
        },
      ];
      data = {
        ...data,
        configured: true,
        resourcePublicationReady: true,
        revision: 0,
        action: null,
        requestId: null,
        publicId: null,
        content: {
          ...data.content,
          organizations: ['Example, Inc.', '示例研究所'],
          persons: ['Alex Example'],
          topics: data.topicOptions,
          sourceUrls: [],
          resources: generatedResources,
        },
        sourceOptions: ['https://example.com/article?id=42', 'https://example.com/person-evidence'],
        resourceSourceOptions: generatedResources.map((resource) => ({
          name: resource.name,
          type: resource.type,
          sourceUrls: [
            resource.type === 'person'
              ? 'https://example.com/person-evidence'
              : 'https://example.com/article?id=42',
          ],
        })),
        resourceOptions: [
          { type: 'company', name: 'Example, Inc.', matches: [], status: 'new' },
          {
            type: 'person',
            name: 'Alex Example',
            matches: [
              { id: 'person-alex-one', type: 'person', name: 'Alex Example' },
              { id: 'person-alex-two', type: 'person', name: 'Alex Example' },
            ],
            status: 'ambiguous',
          },
          {
            type: 'institution',
            name: '示例研究所',
            matches: [{ id: 'institution-existing', type: 'institution', name: '示例研究所' }],
            status: 'reuse',
          },
        ],
      };
      const resourceScenario = structuredClone(data);
      data.resourcePublicationReady = false;
      data.content.sourceUrls = [...data.sourceOptions];
      data.content.resources = data.content.resources.map((resource) => ({
        ...resource,
        entity_id: resource.type === 'person' ? 'person-alex-two' : resource.entity_id,
      }));
      await page.reload();
      await expect(
        page.getByRole('heading', { name: data.content.title, exact: true }),
      ).toBeVisible();
      await expect(page.getByText(/资源发布尚未启用。候选资料可正常核对并保存补充/)).toBeVisible();
      await expect(page.getByText('资料已就绪，等待启用资源发布', { exact: true })).toBeVisible();
      await expect(page.getByLabel('Alex Example 的资源身份')).toHaveValue('person-alex-two');
      await expect(page.getByRole('button', { name: '确认发布', exact: true })).toBeDisabled();
      await expect(page.getByRole('button', { name: '保存补充', exact: true })).toBeEnabled();
      const blockedPosts = posts.length;
      await page.getByRole('button', { name: '保存补充', exact: true }).click();
      await expect(page.getByText('补充信息已保存，尚未发布。', { exact: true })).toBeVisible();
      assert.equal(posts.length, blockedPosts + 1);
      assert.equal(posts.at(-1).action, 'draft');
      assert.equal(posts.at(-1).consent, false);
      // Missing capability evidence is not permission to publish either.
      delete data.resourcePublicationReady;
      await page.reload();
      await expect(page.getByRole('button', { name: '确认发布', exact: true })).toBeDisabled();
      await expect(page.getByRole('button', { name: '保存补充', exact: true })).toBeEnabled();
      data = resourceScenario;
      const previousPosts = posts.length;
      await page.reload();
      await expect(page.getByLabel('组织', { exact: true })).toHaveAttribute('readonly', '');
      await expect(page.getByLabel('人物', { exact: true })).toHaveAttribute('readonly', '');
      await expect(page.getByText('发布时新建资源', { exact: true })).toBeVisible();
      await expect(page.getByText('复用资源：示例研究所', { exact: true })).toBeVisible();
      await expect(page.getByRole('button', { name: '确认发布', exact: true })).toBeDisabled();
      await page
        .getByRole('checkbox', { name: '公开来源：https://example.com/article?id=42' })
        .check();
      await expect(page.getByRole('button', { name: '确认发布', exact: true })).toBeDisabled();
      await page.getByLabel('Alex Example 的资源身份').selectOption('person-alex-two');
      await expect(page.getByRole('button', { name: '确认发布', exact: true })).toBeDisabled();
      await expect(page.getByText(/待补充：.*Alex Example 的公开来源/)).toBeVisible();
      const personCard = page
        .locator('article')
        .filter({ has: page.getByRole('heading', { name: 'Alex Example · 人物' }) });
      await expect(
        personCard.getByRole('link', { name: 'https://example.com/person-evidence', exact: true }),
      ).toBeVisible();
      await expect(
        personCard.getByRole('link', { name: 'https://example.com/article?id=42', exact: true }),
      ).toHaveCount(0);
      await page
        .getByRole('checkbox', { name: '公开来源：https://example.com/person-evidence' })
        .check();
      await expect(page.getByRole('button', { name: '确认发布', exact: true })).toBeEnabled();
      await expect(personCard.getByText('已选择此资源的公开来源。', { exact: true })).toBeVisible();
      // Even a single name match needs an explicit selection if cleared. The
      // administrator can choose a separate identity instead of forcing a merge.
      await page.getByLabel('示例研究所 的资源身份').selectOption('');
      await expect(page.getByRole('button', { name: '确认发布', exact: true })).toBeDisabled();
      await expect(page.getByText(/待补充：.*示例研究所 的资源身份/)).toBeVisible();
      await page.getByLabel('示例研究所 的资源身份').selectOption('__new__');
      await expect(page.getByText('发布时新建独立身份', { exact: true })).toBeVisible();
      await expect(page.getByRole('button', { name: '确认发布', exact: true })).toBeEnabled();
      await page.locator('details').first().locator('summary').click();
      await expect(page.getByText('Example, Inc. 发布新工具。', { exact: true })).toBeVisible();
      await expect(page.getByRole('button', { name: '确认发布', exact: true })).toBeEnabled();
      await page.getByRole('button', { name: '确认发布', exact: true }).click();
      await expect(page.getByText('已确认发布。', { exact: true })).toBeVisible();
      assert.equal(posts.length, previousPosts + 1);
      const generatedPost = posts.at(-1);
      assert.equal(generatedPost.action, 'publish');
      assert.equal(generatedPost.consent, true);
      assert.deepEqual(generatedPost.content.organizations, ['Example, Inc.', '示例研究所']);
      assert.deepEqual(
        generatedPost.content.resources,
        generatedResources.map((resource) => ({
          ...resource,
          entity_id:
            resource.type === 'person'
              ? 'person-alex-two'
              : resource.type === 'institution'
                ? '__new__'
                : resource.entity_id,
        })),
      );
      assert.deepEqual(generatedPost.content.sourceUrls, [
        'https://example.com/article?id=42',
        'https://example.com/person-evidence',
      ]);
      data.content = {
        ...data.content,
        persons: [],
        resources: data.content.resources.filter((resource) => resource.type !== 'person'),
      };
      data.resourceOptions = data.resourceOptions.filter((option) => option.type !== 'person');
      await page.reload();
      await expect(page.getByText('原文未提取到可支持的人物', { exact: true })).toBeVisible();
      await expect(page.getByRole('button', { name: '确认更新发布', exact: true })).toBeEnabled();
      await page.setViewportSize({ width: 390, height: 844 });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= 390), true);
      data.resourceSourceOptions = [];
      await page.reload();
      await expect(page.getByRole('button', { name: '确认更新发布', exact: true })).toBeDisabled();
      await expect(
        page.getByText('没有可供公开的对应来源，请补充资料或核对来源状态后重新读取。').first(),
      ).toBeVisible();
      assert.deepEqual(errors, []);
    } finally {
      await browser?.close();
      await new Promise((resolve) => server.close(resolve));
    }
  },
);
