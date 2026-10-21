import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { fileURLToPath, URL } from 'node:url';
import process from 'node:process';
import { build } from 'esbuild';
import { chromium, expect } from '@playwright/test';

const profileId = '11111111-1111-4111-8111-111111111111';
const configId = '22222222-2222-4222-8222-222222222222';
function fixture({ available = true, kind = 'source_collection', legacy = true } = {}) {
  const config = {
    name: '测试采集配置',
    kind,
    enabled: false,
    frequency: 'manual',
    sourceUrls: [],
    topicIds: kind === 'topic_insight' ? ['ai'] : [],
    profileId,
    profileRevision: 1,
    ...(kind === 'source_collection'
      ? { discovery: { keywords: [], lookbackDays: 2, maxSources: 5 } }
      : {}),
  };
  return {
    kind,
    configured: true,
    executionEnabled: true,
    loadError: false,
    localMode: true,
    localRealAiMode: true,
    profiles: [{ id: profileId, revision: 1, name: '合成验收模型', ready: true }],
    topics: [{ id: 'ai', name: '人工智能' }],
    initial: {
      configDeletionAvailable: true,
      automaticPublicationAvailable: available,
      configs: legacy ? [{ id: configId, revision: 1, enabled: false, config }] : [],
      runs:
        kind === 'source_collection'
          ? [
              {
                id: 'history',
                snapshot: { name: '历史任务', kind },
                status: 'completed',
                phase: 'done',
                created_at: '2026-10-21T00:00:00Z',
                charged_microusd: 0,
                result: null,
              },
            ]
          : [],
    },
  };
}

test(
  'automation publication settings: explicit authorization, safe defaults and snapshot-scoped triggers',
  { skip: process.env.HZENSE_AUTOMATION_BROWSER_TEST !== '1' },
  async (t) => {
    const root = fileURLToPath(new URL('..', import.meta.url));
    const compiled = await build({
      stdin: {
        contents: `import {createRoot} from 'react-dom/client';
          import {AdminAutomation} from './components/admin-automation';
          const props=await (await fetch('/fixture-state')).json();
          createRoot(document.getElementById('root')).render(<AdminAutomation {...props}/>);`,
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
    const origin = `http://127.0.0.1:${server.address().port}`;
    const browser = await chromium.launch({ headless: true });
    async function setup(options = {}) {
      const props = fixture(options);
      const posts = [];
      const unexpected = [];
      const errors = [];
      const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
      page.setDefaultTimeout(5_000);
      page.on('pageerror', (error) => errors.push(error.message));
      await page.route('**/*', (route) => {
        if (route.request().url().startsWith(`${origin}/`)) return route.continue();
        unexpected.push(route.request().url());
        return route.abort();
      });
      await page.route('**/fixture-state', (route) => route.fulfill({ json: props }));
      await page.route('**/api/**', async (route) => {
        if (new URL(route.request().url()).pathname !== '/api/admin/automation') {
          unexpected.push(route.request().url());
          return route.abort();
        }
        if (route.request().method() === 'GET') return route.fulfill({ json: props.initial });
        const body = route.request().postDataJSON();
        posts.push(body);
        if (body.action === 'save') {
          const next = {
            id: body.request.id,
            revision: body.request.expectedRevision + 1,
            config: body.request.config,
            enabled: body.request.config.enabled,
          };
          props.initial.configs = [
            ...props.initial.configs.filter((row) => row.id !== next.id),
            next,
          ];
          return route.fulfill({ json: { config: next } });
        }
        if (body.action === 'trigger')
          return route.fulfill({
            status: 503,
            json: { error: options.triggerError ?? 'dispatch_unknown' },
          });
        unexpected.push(body.action);
        return route.abort();
      });
      await page.goto(origin);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      return {
        page,
        props,
        posts,
        async close() {
          assert.deepEqual(errors, []);
          assert.deepEqual(unexpected, [], 'only mocked loopback APIs may be used');
          await page.close();
        },
      };
    }
    try {
      await t.test(
        'legacy configs default to manual and saving does not authorize publication',
        async () => {
          const f = await setup();
          const { page } = f;
          await expect(page.getByLabel('发布方式', { exact: true })).toHaveValue('manual');
          await expect(
            page.getByRole('cell', { name: '人工审核后发布', exact: true }),
          ).toBeVisible();
          await expect(page.getByText('任务快照：人工审核后发布', { exact: true })).toBeVisible();
          await page.getByRole('button', { name: '编辑', exact: true }).click();
          await expect(page.getByLabel('发布方式', { exact: true })).toHaveValue('manual');
          await page.getByRole('button', { name: '保存配置', exact: true }).click();
          await expect(page.getByText(/配置已保存为 r2/)).toBeVisible();
          assert.equal(f.posts.length, 1);
          assert.equal(f.posts[0].action, 'save');
          assert.equal(f.posts[0].request.config.publicationMode, 'manual');
          await f.close();
        },
      );
      await t.test(
        'automatic save requires separate confirmation, survives reload and can return to manual',
        async () => {
          const f = await setup({ legacy: false });
          const { page } = f;
          await page.getByLabel('配置名称', { exact: true }).fill('本地自动发布');
          await page.getByLabel('分阶段模型配置', { exact: true }).selectOption(profileId);
          await page.getByLabel('发布方式', { exact: true }).selectOption('automatic');
          assert.equal(f.posts.length, 0, 'selection alone does not save or publish');
          page.once('dialog', (dialog) => {
            assert.match(dialog.message(), /无需逐条审核/);
            assert.match(dialog.message(), /本地信号列表/);
            assert.match(dialog.message(), /本次仅保存配置，不立即启动采集、调用 AI 或发布/);
            return dialog.dismiss();
          });
          await page.getByRole('button', { name: '保存配置', exact: true }).click();
          assert.equal(f.posts.length, 0);
          page.once('dialog', (dialog) => dialog.accept());
          await page.getByRole('button', { name: '保存配置', exact: true }).click();
          await expect(page.getByText(/配置已保存为 r1/)).toBeVisible();
          assert.equal(f.posts.length, 1);
          assert.equal(f.posts[0].action, 'save');
          assert.equal(f.posts[0].request.config.publicationMode, 'automatic');
          assert.equal(f.posts[0].request.config.enabled, false);
          assert.equal(f.posts[0].request.config.frequency, 'manual');
          await page.reload();
          await expect(
            page.getByRole('cell', { name: '检查合格后自动发布', exact: true }),
          ).toBeVisible();
          await expect(page.getByText('任务快照：人工审核后发布', { exact: true })).toBeVisible();
          await page.getByRole('button', { name: '编辑', exact: true }).click();
          await expect(page.getByLabel('发布方式', { exact: true })).toHaveValue('automatic');
          await page.screenshot({
            path: '/tmp/hzense-automation-publication-mobile.png',
            fullPage: true,
          });
          assert.equal(
            await page.evaluate(() => globalThis.document.documentElement.scrollWidth <= 390),
            true,
          );
          await page.getByLabel('发布方式', { exact: true }).selectOption('manual');
          await page.getByRole('button', { name: '保存配置', exact: true }).click();
          await expect(page.getByText(/配置已保存为 r2/)).toBeVisible();
          assert.equal(f.posts.length, 2);
          assert.equal(f.posts[1].request.config.publicationMode, 'manual');
          assert.ok(f.posts.every((body) => body.action === 'save'));
          await page.getByRole('button', { name: '新建配置', exact: true }).click();
          await expect(page.getByLabel('发布方式', { exact: true })).toHaveValue('manual');
          await f.close();
        },
      );
      await t.test(
        'unavailable auto publication permits inactive storage but blocks execution',
        async () => {
          const f = await setup({ available: false });
          const { page } = f;
          await page.getByRole('button', { name: '编辑', exact: true }).click();
          await page.getByLabel('发布方式', { exact: true }).selectOption('automatic');
          await expect(page.getByText(/自动发布服务尚未就绪：仍可保存配置/)).toBeVisible();
          await expect(page.getByRole('button', { name: '保存配置', exact: true })).toBeEnabled();
          page.once('dialog', (dialog) => dialog.accept());
          await page.getByRole('button', { name: '保存配置', exact: true }).click();
          await expect(page.getByText(/配置已保存为 r2/)).toBeVisible();
          await expect(page.getByRole('button', { name: '立即运行', exact: true })).toBeDisabled();
          await expect(page.getByText('自动发布未就绪 · 不能运行', { exact: true })).toBeVisible();
          assert.equal(f.posts.length, 1);
          assert.equal(f.posts[0].action, 'save');
          f.props.initial.automaticPublicationAvailable = true;
          await page.getByRole('button', { name: '刷新列表', exact: true }).click();
          await expect(page.getByRole('button', { name: '立即运行', exact: true })).toBeEnabled();
          delete f.props.initial.automaticPublicationAvailable;
          await page.getByRole('button', { name: '刷新列表', exact: true }).click();
          await expect(page.getByRole('button', { name: '立即运行', exact: true })).toBeDisabled();
          assert.equal(f.posts.length, 1, 'readiness refresh never starts or publishes tasks');
          await f.close();
        },
      );
      await t.test(
        'trigger identity is reused only for the same revision and publication policy',
        async () => {
          const f = await setup();
          const { page } = f;
          async function trigger() {
            page.once('dialog', (dialog) => dialog.accept());
            await page.getByRole('button', { name: '立即运行', exact: true }).click();
            await expect(
              page.getByText('任务已保存，但派发结果未知；请先刷新核对。', { exact: true }),
            ).toBeVisible();
          }
          await trigger();
          await trigger();
          assert.equal(f.posts[0].request.requestId, f.posts[1].request.requestId);
          await page.getByRole('button', { name: '编辑', exact: true }).click();
          await page.getByLabel('发布方式', { exact: true }).selectOption('automatic');
          page.once('dialog', (dialog) => dialog.accept());
          await page.getByRole('button', { name: '保存配置', exact: true }).click();
          await expect(page.getByText(/配置已保存为 r2/)).toBeVisible();
          await trigger();
          const autoTrigger = f.posts.at(-1);
          assert.notEqual(autoTrigger.request.requestId, f.posts[0].request.requestId);
          assert.equal(autoTrigger.request.expectedRevision, 2);
          f.props.initial.configs[0].revision = 3;
          f.props.initial.configs[0].config.publicationMode = 'manual';
          await page.getByRole('button', { name: '刷新列表', exact: true }).click();
          await trigger();
          assert.notEqual(f.posts.at(-1).request.requestId, autoTrigger.request.requestId);
          assert.equal(f.posts.at(-1).request.expectedRevision, 3);
          await f.close();
        },
      );
      await t.test(
        'server readiness changes are explained without retrying a rejected run',
        async () => {
          const f = await setup({ triggerError: 'automatic_publication_unavailable' });
          const { page } = f;
          await page.getByRole('button', { name: '编辑', exact: true }).click();
          await page.getByLabel('发布方式', { exact: true }).selectOption('automatic');
          page.once('dialog', (dialog) => dialog.accept());
          await page.getByRole('button', { name: '保存配置', exact: true }).click();
          await expect(page.getByText(/配置已保存为 r2/)).toBeVisible();
          page.once('dialog', (dialog) => dialog.accept());
          await page.getByRole('button', { name: '立即运行', exact: true }).click();
          await expect(
            page
              .getByRole('status')
              .filter({ hasText: '自动发布服务尚未就绪。可以关闭定时并保存配置' }),
          ).toBeVisible();
          assert.equal(f.posts.filter((body) => body.action === 'trigger').length, 1);
          await f.close();
        },
      );
      await t.test(
        'automatic task results show generation facts without claiming publication status',
        async () => {
          const f = await setup();
          const generationId = '33333333-3333-4333-8333-333333333333';
          const row = f.props.initial.runs[0];
          row.snapshot.publicationMode = 'automatic';
          row.result = { generationIds: [generationId] };
          row.generationProgress = {
            total: 1,
            completed: 1,
            failed: 0,
            cancelled: 0,
            unknown: 0,
            unavailable: 0,
            pending: 0,
            running: 0,
            knownCandidates: 3,
            candidateCountComplete: true,
            active: false,
            readFailed: false,
            tasks: [
              {
                id: generationId,
                status: 'completed',
                progress_phase: 'completed',
                candidate_count: 3,
              },
            ],
          };
          await f.page.reload();
          await expect(
            f.page.getByText('任务快照：检查合格后自动发布', { exact: true }),
          ).toBeVisible();
          await expect(
            f.page.getByRole('cell', { name: '候选已生成', exact: false }),
          ).toBeVisible();
          await expect(f.page.getByText('已确认生成 3 条候选', { exact: false })).toBeVisible();
          await expect(f.page.getByText('已生成 3 条候选', { exact: true })).toBeVisible();
          await expect(
            f.page.getByRole('link', { name: `查看生成任务 · ${generationId}` }),
          ).toHaveAttribute('href', `/admin/signal-generation/${generationId}`);
          await expect(f.page.getByText('请以最新发布状态为准。', { exact: false })).toBeVisible();
          await expect(f.page.getByText(/私有候选|已发布|未发布/)).toHaveCount(0);
          assert.equal(f.posts.length, 0, 'reading result labels never publishes or calls AI');
          await f.close();
        },
      );
      await t.test(
        'topic insights do not expose or write signal automatic publication settings',
        async () => {
          const f = await setup({ kind: 'topic_insight' });
          await expect(f.page.getByLabel('发布方式', { exact: true })).toHaveCount(0);
          await f.page.getByRole('button', { name: '编辑', exact: true }).click();
          await f.page.getByRole('button', { name: '保存配置', exact: true }).click();
          await expect(f.page.getByText(/配置已保存为 r2/)).toBeVisible();
          assert.equal(f.posts.length, 1);
          assert.equal(f.posts[0].request.config.publicationMode, undefined);
          await f.close();
        },
      );
    } finally {
      await browser.close();
      await new Promise((resolve) => server.close(resolve));
    }
  },
);
