import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { fileURLToPath, URL } from 'node:url';
import process from 'node:process';
import { build } from 'esbuild';
import { chromium, expect } from '@playwright/test';

const profileId = '11111111-1111-4111-8111-111111111111';
const configId = '22222222-2222-4222-8222-222222222222';
function fixture({
  available = true,
  kind = 'source_collection',
  legacy = true,
  localMode = true,
  localRealAiMode = true,
  localSchedulingAvailable,
  executionEnabled = true,
  profileReady = true,
  insightLeafTopicIds = ['ai'],
  insightTopicsLoadError = false,
} = {}) {
  const config = {
    name: kind === 'topic_insight' ? '测试专题配置' : '测试采集配置',
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
    executionEnabled,
    executionReadiness: {
      ready: executionEnabled,
      checks: [
        { key: 'storage', ready: true },
        { key: 'execution', ready: executionEnabled },
        { key: 'budget', ready: true },
      ],
    },
    loadError: false,
    localMode,
    localRealAiMode,
    profiles: [{ id: profileId, revision: 1, name: '合成验收模型', ready: profileReady }],
    topics: [{ id: 'ai', name: '人工智能' }],
    insightLeafTopicIds,
    insightTopicsLoadError,
    initial: {
      configDeletionAvailable: true,
      automaticPublicationAvailable: available,
      ...(localSchedulingAvailable === undefined ? {} : { localSchedulingAvailable }),
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
  'automation configuration: explicit authorization, local schedules and snapshot-scoped publication',
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
      const details = new Map();
      const detailReads = [];
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
        if (route.request().method() === 'GET') {
          const id = new URL(route.request().url()).searchParams.get('id');
          if (id) detailReads.push(id);
          return route.fulfill({
            json: id
              ? { run: details.get(id) ?? props.initial.runs.find((row) => row.id === id) }
              : props.initial,
          });
        }
        const body = route.request().postDataJSON();
        posts.push(body);
        if (body.action === 'save') {
          const next = {
            id: body.request.id,
            revision: body.request.expectedRevision + 1,
            config: body.request.config,
            enabled: body.request.config.enabled,
            next_run_at: body.request.config.enabled
              ? body.request.config.frequency === 'weekly'
                ? '2026-10-26T00:00:00Z'
                : '2026-10-23T00:00:00Z'
              : null,
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
        if (body.action === 'publish') {
          props.initial.runs.find((row) => row.id === body.id).publication_status = body.confirm
            ? 'published'
            : 'withdrawn';
          return route.fulfill({ json: { ok: true } });
        }
        unexpected.push(body.action);
        return route.abort();
      });
      await page.goto(origin);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      return {
        page,
        props,
        posts,
        details,
        detailReads,
        async close() {
          assert.deepEqual(errors, []);
          assert.deepEqual(unexpected, [], 'only mocked loopback APIs may be used');
          await page.close();
        },
      };
    }
    try {
      await t.test(
        'available local schedules stay off until explicit save and retain manual publication',
        async () => {
          const f = await setup({ localSchedulingAvailable: true, legacy: false });
          const { page } = f;
          const frequency = page.getByLabel('执行频率', { exact: true });
          const enabled = page.getByRole('checkbox', { name: '允许定时执行（可能产生费用）' });
          await expect(frequency).toBeEnabled();
          await expect(frequency).toHaveValue('daily');
          await expect(enabled).not.toBeChecked();
          await expect(page.getByText(/计算机和本地开发服务须保持运行/)).toBeVisible();
          await expect(page.getByText(/恢复后不会逐日补跑/)).toBeVisible();
          await page.getByLabel('配置名称', { exact: true }).fill('本地定时采集');
          await page.getByLabel('分阶段模型配置', { exact: true }).selectOption(profileId);
          await enabled.check();
          assert.equal(f.posts.length, 0, 'editing does not persist or start the schedule');
          await page.getByRole('button', { name: '保存配置', exact: true }).click();
          await expect(
            page.getByText(/将从下一个计划时点执行；本次保存不会立即启动任务/),
          ).toBeVisible();
          assert.equal(f.posts.length, 1);
          assert.equal(f.posts[0].action, 'save');
          assert.equal(f.posts[0].request.config.enabled, true);
          assert.equal(f.posts[0].request.config.frequency, 'daily');
          assert.equal(f.posts[0].request.config.publicationMode, 'manual');
          await expect(page.getByRole('cell', { name: '本地定时开启', exact: true })).toBeVisible();
          await expect(
            page.getByText('下次计划：2026/10/23 00:00:00 UTC', { exact: true }),
          ).toBeVisible();
          await page.reload();
          await expect(enabled).not.toBeChecked();
          await page.getByRole('button', { name: '编辑', exact: true }).click();
          await expect(enabled).toBeChecked();
          await expect(frequency).toHaveValue('daily');
          await frequency.selectOption('weekly');
          await page.getByRole('button', { name: '保存配置', exact: true }).click();
          await expect(page.getByText(/配置已保存为 r2/)).toBeVisible();
          assert.equal(f.posts[1].request.config.frequency, 'weekly');
          assert.equal(f.posts[1].request.config.enabled, true);
          await expect(
            page.getByText('下次计划：2026/10/26 00:00:00 UTC', { exact: true }),
          ).toBeVisible();
          await page.screenshot({
            path: '/tmp/hzense-local-scheduling-mobile.png',
            fullPage: true,
          });
          assert.equal(
            await page.evaluate(() => globalThis.document.documentElement.scrollWidth <= 390),
            true,
          );
          await frequency.selectOption('manual');
          await expect(enabled).not.toBeChecked();
          await expect(enabled).toBeDisabled();
          await page.getByRole('button', { name: '保存配置', exact: true }).click();
          await expect(page.getByText(/配置已保存为 r3/)).toBeVisible();
          assert.equal(f.posts[2].request.config.enabled, false);
          assert.equal(f.posts[2].request.config.frequency, 'manual');
          await expect(page.getByText(/^下次计划：/)).toHaveCount(0);
          await expect(page.getByRole('cell', { name: '本地定时关闭', exact: true })).toBeVisible();
          await expect(page.getByRole('button', { name: '立即运行', exact: true })).toBeEnabled();
          assert.ok(
            f.posts.every((body) => body.action === 'save'),
            'saving never triggers a run',
          );
          await f.close();
        },
      );
      await t.test(
        'local scheduling readiness is refreshed without enabling existing configs',
        async () => {
          const f = await setup({ localSchedulingAvailable: false });
          const frequency = f.page.getByLabel('执行频率', { exact: true });
          const enabled = f.page.getByRole('checkbox', { name: '允许定时执行（可能产生费用）' });
          await expect(frequency).toBeDisabled();
          await expect(enabled).toBeDisabled();
          f.props.initial.localSchedulingAvailable = true;
          await f.page.getByRole('button', { name: '刷新列表', exact: true }).click();
          await expect(frequency).toBeEnabled();
          await expect(frequency).toHaveValue('manual');
          await expect(enabled).not.toBeChecked();
          await expect(
            f.page.getByRole('cell', { name: '本地定时关闭', exact: true }),
          ).toBeVisible();
          delete f.props.initial.localSchedulingAvailable;
          await f.page.getByRole('button', { name: '刷新列表', exact: true }).click();
          await expect(frequency).toBeDisabled();
          await expect(enabled).toBeDisabled();
          assert.equal(f.posts.length, 0, 'readiness changes never write or run existing configs');
          await f.close();
        },
      );
      for (const [name, options] of [
        ['missing capability', {}],
        ['disabled capability', { localSchedulingAvailable: false }],
        ['mock AI', { localSchedulingAvailable: true, localRealAiMode: false }],
        [
          'mock topic insights',
          { localSchedulingAvailable: true, kind: 'topic_insight', localRealAiMode: false },
        ],
      ]) {
        await t.test(`local schedule controls stay disabled for ${name}`, async () => {
          const f = await setup(options);
          await expect(f.page.getByLabel('执行频率', { exact: true })).toBeDisabled();
          await expect(f.page.getByLabel('执行频率', { exact: true })).toHaveValue('manual');
          const enabled = f.page.getByRole('checkbox', { name: '允许定时执行（可能产生费用）' });
          await expect(enabled).toBeDisabled();
          await expect(enabled).not.toBeChecked();
          assert.equal(f.posts.length, 0);
          await f.close();
        });
      }
      await t.test(
        'real local topic schedules require explicit opt in and stay private',
        async () => {
          const f = await setup({
            kind: 'topic_insight',
            localSchedulingAvailable: true,
            legacy: false,
          });
          const { page } = f;
          const enabled = page.getByRole('checkbox', { name: '允许定时执行（可能产生费用）' });
          await expect(page.getByRole('heading', { level: 1 })).toHaveText('专题洞察配置');
          await expect(page.getByText(/本地专题洞察：使用所选配置的“分析”模型/)).toBeVisible();
          await expect(page.getByText(/近 30 天内所选专题的 2–100 条/)).toBeVisible();
          await expect(page.getByText(/专题没有额外日额度/)).toBeVisible();
          await expect(page.getByText(/联网搜索、获取原文|本地真实采集|采集预算/)).toHaveCount(0);
          await expect(page.getByLabel('执行频率', { exact: true })).toHaveValue('weekly');
          await expect(page.getByLabel('发布方式', { exact: true })).toHaveCount(0);
          await expect(enabled).not.toBeChecked();
          await expect(enabled).toBeDisabled();
          await page.getByLabel('配置名称', { exact: true }).fill('本地每周洞察');
          await page.getByLabel('分阶段模型配置', { exact: true }).selectOption(profileId);
          await page.getByRole('checkbox', { name: '人工智能', exact: true }).check();
          await enabled.check();
          assert.equal(f.posts.length, 0);
          await page.getByRole('button', { name: '保存配置', exact: true }).click();
          await expect(page.getByText(/配置已保存为 r1/)).toBeVisible();
          assert.deepEqual(
            f.posts.map((body) => body.action),
            ['save'],
          );
          assert.equal(f.posts[0].request.config.enabled, true);
          assert.equal(f.posts[0].request.config.frequency, 'weekly');
          assert.equal(f.posts[0].request.config.publicationMode, undefined);
          await expect(page.getByRole('cell', { name: '本地定时开启', exact: true })).toBeVisible();
          await page.reload();
          await expect(enabled).not.toBeChecked();
          await page.getByRole('button', { name: '编辑', exact: true }).click();
          await expect(enabled).toBeChecked();
          await expect(page.getByRole('button', { name: '立即运行', exact: true })).toBeEnabled();
          page.once('dialog', (dialog) => {
            assert.match(dialog.message(), /近 30 天.*2–100 条当前公开信号/);
            assert.match(dialog.message(), /须阅读并单独确认后才在本地公开/);
            assert.doesNotMatch(dialog.message(), /联网搜索|获取原文|导入/);
            return dialog.accept();
          });
          await page.getByRole('button', { name: '立即运行', exact: true }).click();
          await expect(
            page.getByText('任务已保存，但派发结果未知；请先刷新核对。', { exact: true }),
          ).toBeVisible();
          assert.deepEqual(
            f.posts.map((body) => body.action),
            ['save', 'trigger'],
          );
          await page.screenshot({
            path: '/tmp/hzense-local-topic-insight-mobile.png',
            fullPage: true,
          });
          assert.equal(
            await page.evaluate(() => globalThis.document.documentElement.scrollWidth <= 390),
            true,
          );
          await f.close();
        },
      );
      for (const [name, options] of [
        ['mock mode', { localRealAiMode: false }],
        ['unready model', { profileReady: false }],
        ['execution unavailable', { executionEnabled: false }],
      ]) {
        await t.test(`local topic execution stays disabled for ${name}`, async () => {
          const f = await setup({
            kind: 'topic_insight',
            localSchedulingAvailable: true,
            ...options,
          });
          await expect(
            f.page.getByRole('button', { name: '立即运行', exact: true }),
          ).toBeDisabled();
          await f.page.getByRole('button', { name: '编辑', exact: true }).click();
          await expect(
            f.page.getByRole('checkbox', { name: '允许定时执行（可能产生费用）' }),
          ).toBeDisabled();
          await expect(f.page.getByRole('button', { name: '保存配置', exact: true })).toBeEnabled();
          assert.equal(f.posts.length, 0);
          await f.close();
        });
      }
      await t.test(
        'mock local topic mode can review, publish and withdraw an existing report without AI',
        async () => {
          const f = await setup({
            kind: 'topic_insight',
            localRealAiMode: false,
            executionEnabled: false,
          });
          f.props.initial.runs = [
            {
              id: 'topic-history',
              snapshot: { name: '已有专题报告', kind: 'topic_insight' },
              status: 'completed',
              phase: 'completed',
              publication_status: 'private',
              created_at: '2026-10-29T00:00:00Z',
              charged_microusd: 1000,
              result: {
                kind: 'topic_insight',
                topicIds: ['ai'],
                report: {
                  title: '既有真实报告',
                  summary: '此前已生成的专题报告',
                  sections: [
                    {
                      heading: '证据',
                      body: '引用当前公开信号。',
                      signalIds: ['signal-one', 'signal-two'],
                    },
                  ],
                  uncertainties: ['仍需持续观察。'],
                },
              },
            },
          ];
          const existingReport = f.props.initial.runs[0];
          f.details.set(existingReport.id, { ...existingReport });
          existingReport.result = { generationIds: [], failed: null, discovery: null };
          await f.page.reload();
          await expect(f.page.getByText(/可阅读已有报告，并人工确认公开或撤回/)).toBeVisible();
          await expect(
            f.page.getByRole('button', { name: '确认公开', exact: true }),
          ).toBeDisabled();
          await f.page.getByRole('button', { name: '阅读私有报告', exact: true }).click();
          await expect(
            f.page.getByRole('heading', { name: '既有真实报告', exact: true }),
          ).toBeVisible();
          const topicLabels = f.page.getByLabel(/^所属专题：/);
          await expect(
            topicLabels.getByRole('link', { name: '人工智能', exact: true }),
          ).toHaveAttribute('href', '/topics/ai');
          await expect(topicLabels.getByRole('link')).toHaveCount(1);
          await expect(topicLabels).not.toContainText('跨领域');
          await expect(
            f.page.getByRole('link', { name: 'signal-one', exact: true }),
          ).toHaveAttribute('href', '/signals/signal-one');
          assert.equal(f.posts.length, 0);
          await expect(f.page.getByRole('button', { name: '确认公开', exact: true })).toBeEnabled();
          f.page.once('dialog', (dialog) => dialog.accept());
          await f.page.getByRole('button', { name: '确认公开', exact: true }).click();
          await expect(f.page.getByText('专题洞察已确认公开。', { exact: true })).toBeVisible();
          await expect(f.page.getByRole('button', { name: '撤回', exact: true })).toBeEnabled();
          f.page.once('dialog', (dialog) => dialog.accept());
          await f.page.getByRole('button', { name: '撤回', exact: true }).click();
          await expect(f.page.getByText('专题洞察已撤回。', { exact: true })).toBeVisible();
          assert.deepEqual(
            f.posts.map(({ action, confirm }) => ({ action, confirm })),
            [
              { action: 'publish', confirm: true },
              { action: 'publish', confirm: false },
            ],
          );
          await f.close();
        },
      );
      await t.test('production schedule controls do not require the local capability', async () => {
        const f = await setup({
          localMode: false,
          localRealAiMode: false,
          localSchedulingAvailable: false,
        });
        const frequency = f.page.getByLabel('执行频率', { exact: true });
        const enabled = f.page.getByRole('checkbox', { name: '允许定时执行（可能产生费用）' });
        await expect(frequency).toBeEnabled();
        await expect(enabled).toBeEnabled();
        await expect(frequency).toHaveValue('daily');
        await expect(enabled).not.toBeChecked();
        await expect(f.page.getByText(/计算机和本地开发服务须保持运行/)).toHaveCount(0);
        assert.equal(f.posts.length, 0);
        await f.close();
      });
      await t.test(
        'unknown topic results can be reviewed from detail without publication',
        async () => {
          const f = await setup({ kind: 'topic_insight', legacy: false });
          const summary = {
            id: 'unknown-topic-with-result',
            snapshot: { name: '报告提交待核对', kind: 'topic_insight' },
            status: 'unknown',
            phase: 'outcome_unknown',
            error_code: 'outcome_unknown',
            publication_status: 'private',
            created_at: '2026-10-29T00:00:00Z',
            charged_microusd: 1200,
            cost_source: 'provider',
            result: { generationIds: [], failed: null, discovery: null },
          };
          f.props.initial.runs = [
            summary,
            {
              ...summary,
              id: 'unknown-topic-without-result',
              snapshot: { name: '调用结果待核对', kind: 'topic_insight' },
              result: null,
            },
          ];
          f.details.set(summary.id, {
            ...summary,
            result: {
              kind: 'topic_insight',
              report: {
                title: '仅详情返回的待核对报告',
                summary: '模型输出已保留，任务完成写入尚未确认。',
                sections: [
                  { heading: '证据', body: '需核对任务后再作判断。', signalIds: ['signal-one'] },
                ],
              },
            },
          });
          await f.page.reload();
          await expect(
            f.page.getByRole('button', { name: '查看待核对结果', exact: true }),
          ).toHaveCount(1);
          await expect(
            f.page.getByRole('heading', { name: '仅详情返回的待核对报告', exact: true }),
          ).toHaveCount(0);
          await expect(f.page.getByRole('button', { name: '确认公开', exact: true })).toHaveCount(
            0,
          );
          await expect(f.page.getByRole('button', { name: '撤回', exact: true })).toHaveCount(0);
          const empty = f.page.getByRole('row').filter({ hasText: '调用结果待核对' });
          await expect(empty.getByRole('button')).toHaveCount(0);
          assert.deepEqual(f.detailReads, []);
          await f.page.getByRole('button', { name: '查看待核对结果', exact: true }).click();
          await expect(
            f.page.getByRole('heading', { name: '仅详情返回的待核对报告', exact: true }),
          ).toBeVisible();
          await expect(
            f.page.getByText('已保留结果供核对；任务结果仍未知，不能公开，请勿重复生成。', {
              exact: true,
            }),
          ).toBeVisible();
          await expect(
            f.page.getByRole('link', { name: 'signal-one', exact: true }),
          ).toHaveAttribute('href', '/signals/signal-one');
          assert.deepEqual(f.detailReads, [summary.id]);
          assert.deepEqual(f.posts, []);
          await f.close();
        },
      );
      await t.test(
        'topic provider diagnostics explain failures without claiming zero cost',
        async () => {
          const diagnostics = [
            ['insight_output_truncated', '专题报告达到输出长度上限'],
            ['insight_structured_output_invalid', '不符合报告结构要求'],
            ['invalid_insight_citation', '信号引用未通过校验'],
            ['invalid_insight', '专题报告内容未通过校验'],
            ['insight_unexpected_tool_call', '不支持的工具调用'],
            ['insight_sensitive_output', '未通过敏感信息检查'],
            ['insight_provider_timeout', '专题模型响应超时'],
          ];
          const f = await setup({ kind: 'topic_insight', legacy: false });
          f.props.initial.runs = diagnostics.map(([error_code], index) => ({
            id: `topic-diagnostic-${index}`,
            snapshot: { name: `专题诊断 ${index + 1}`, kind: 'topic_insight' },
            status: 'failed',
            phase: 'failed',
            error_code,
            publication_status: 'private',
            created_at: '2026-10-29T00:00:00Z',
            charged_microusd: 1200,
            cost_source: 'provider',
            result: null,
          }));
          await f.page.reload();
          for (const [index, [, explanation]] of diagnostics.entries()) {
            const row = f.page.getByRole('row').filter({ hasText: `专题诊断 ${index + 1}` });
            await expect(row).toContainText(explanation);
            await expect(row).toContainText('供应商回执');
            await expect(row).toContainText('$0.0012');
            await expect(row).not.toContainText('未调用 AI');
            await expect(row).not.toContainText('未计费');
            await expect(
              row.getByRole('button', { name: '查看失败详情', exact: true }),
            ).toHaveCount(1);
            await expect(row.getByRole('button', { name: '确认公开', exact: true })).toHaveCount(0);
          }
          const truncated = f.page.getByRole('row').filter({ hasText: '专题诊断 1' });
          await expect(truncated).toContainText('“分析”的输出上限调整为 8192');
          await expect(truncated).toContainText('保存并选择新修订');
          await expect(truncated).toContainText('系统不会自动重试');
          assert.deepEqual(f.posts, []);
          await f.close();
        },
      );
      for (const status of ['unknown', 'failed']) {
        await t.test(
          `${status} topic diagnostic-only details are readable without claiming a report`,
          async () => {
            const f = await setup({ kind: 'topic_insight', legacy: false });
            const summary = {
              id: `${status}-diagnostic-only`,
              snapshot: { name: '结构校验待核对', kind: 'topic_insight' },
              status,
              phase: status,
              error_code: status === 'unknown' ? 'outcome_unknown' : 'invalid_insight',
              publication_status: 'private',
              created_at: '2026-10-29T00:00:00Z',
              charged_microusd: 2263,
              cost_source: 'provider',
              result: { generationIds: [], failed: null, discovery: null },
            };
            const detail = {
              ...summary,
              result: {
                providerDiagnostic: {
                  code: 'invalid_insight',
                  finishReason: 'stop',
                  field: 'uncertainties.item',
                  reason: 'empty',
                  raw: 'UNSAFE_PROVIDER_BODY',
                },
              },
            };
            f.props.initial.runs = [summary];
            f.details.set(summary.id, detail);
            await f.page.reload();
            await expect(
              f.page.getByRole('heading', { name: '专题分析诊断', exact: true }),
            ).toHaveCount(0);
            await expect(f.page.getByText(/已保留报告/)).toHaveCount(0);
            assert.deepEqual(f.detailReads, []);
            await f.page
              .getByRole('button', {
                name: status === 'unknown' ? '查看待核对结果' : '查看失败详情',
                exact: true,
              })
              .click();
            await expect(
              f.page.getByRole('heading', { name: '专题分析诊断', exact: true }),
            ).toBeVisible();
            await expect(f.page.getByText('问题字段：不确定性条目', { exact: true })).toBeVisible();
            await expect(f.page.getByText('校验原因：内容为空', { exact: true })).toBeVisible();
            await expect(f.page.getByText('供应商结束标记：stop', { exact: true })).toBeVisible();
            await expect(
              f.page.getByText('本次结果未保存合格报告，不能公开。', { exact: true }),
            ).toBeVisible();
            await expect(f.page.getByText(/报告结构不可用|UNSAFE_PROVIDER_BODY/)).toHaveCount(0);
            await expect(f.page.getByRole('button', { name: '确认公开', exact: true })).toHaveCount(
              0,
            );
            await expect(f.page.getByRole('button', { name: '撤回', exact: true })).toHaveCount(0);
            detail.result.providerDiagnostic.field = '__proto__';
            detail.result.providerDiagnostic.reason = 'constructor';
            detail.result.providerDiagnostic.finishReason = 'UNSAFE_FINISH_REASON';
            await f.page.getByRole('button', { name: '刷新详情', exact: true }).click();
            await expect(f.page.getByText(/^问题字段：|^校验原因：|^供应商结束标记：/)).toHaveCount(
              0,
            );
            await expect(f.page.getByText(/UNSAFE_PROVIDER_BODY|UNSAFE_FINISH_REASON/)).toHaveCount(
              0,
            );
            assert.deepEqual(f.detailReads, [summary.id, summary.id]);
            assert.deepEqual(f.posts, []);
            await f.close();
          },
        );
      }
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
      await t.test('new insight configs offer only available leaf topics', async () => {
        const f = await setup({
          kind: 'topic_insight',
          legacy: false,
          insightLeafTopicIds: ['language-models'],
        });
        f.props.topics = [
          { id: 'ai', name: '人工智能' },
          { id: 'language-models', name: '语言模型' },
        ];
        await f.page.reload();
        await expect(f.page.getByRole('checkbox', { name: '人工智能', exact: true })).toHaveCount(
          0,
        );
        await expect(f.page.getByRole('checkbox', { name: '语言模型', exact: true })).toBeVisible();
        await f.page.getByLabel('配置名称', { exact: true }).fill('语言模型观察');
        await f.page.getByLabel('分阶段模型配置', { exact: true }).selectOption(profileId);
        await expect(f.page.getByRole('button', { name: '保存配置', exact: true })).toBeDisabled();
        await f.page.getByRole('checkbox', { name: '语言模型', exact: true }).check();
        await f.page.getByRole('button', { name: '保存配置', exact: true }).click();
        await expect(f.page.getByText(/配置已保存为 r1/)).toBeVisible();
        assert.deepEqual(
          f.posts.map((body) => body.action),
          ['save'],
        );
        assert.deepEqual(f.posts[0].request.config.topicIds, ['language-models']);
        assert.equal(f.posts[0].request.config.enabled, false);
        await f.close();
      });
      await t.test(
        'legacy parent schedules can only be stopped exactly or revised with explicit leaf selection',
        async () => {
          const f = await setup({
            kind: 'topic_insight',
            insightLeafTopicIds: ['language-models'],
            localSchedulingAvailable: true,
            profileReady: false,
          });
          f.props.topics = [
            { id: 'ai', name: '人工智能' },
            { id: 'language-models', name: '语言模型' },
          ];
          const row = f.props.initial.configs[0];
          row.enabled = true;
          row.config.enabled = true;
          row.config.frequency = 'weekly';
          const originalConfig = globalThis.structuredClone(row.config);
          await f.page.reload();
          await expect(
            f.page.getByRole('button', { name: '立即运行', exact: true }),
          ).toBeDisabled();
          await f.page.getByRole('button', { name: '编辑', exact: true }).click();
          await expect(f.page.getByText(/原范围需细分：人工智能/)).toBeVisible();
          await expect(f.page.getByRole('checkbox', { name: '人工智能', exact: true })).toHaveCount(
            0,
          );
          await f.page.getByLabel('配置名称', { exact: true }).fill('不能随停用保存的改名');
          await expect(
            f.page.getByRole('button', { name: '保存配置', exact: true }),
          ).toBeDisabled();
          await f.page.getByRole('button', { name: '停用定时', exact: true }).click();
          await expect(f.page.getByText(/定时已停用，原专题范围和历史报告保留/)).toBeVisible();
          assert.deepEqual(f.posts[0].request.config, { ...originalConfig, enabled: false });
          assert.equal(f.posts[0].request.expectedRevision, 1);
          await expect(f.page.getByRole('button', { name: '停用定时', exact: true })).toHaveCount(
            0,
          );
          await expect(
            f.page.getByRole('button', { name: '保存配置', exact: true }),
          ).toBeDisabled();
          await f.page.getByRole('button', { name: '清除旧范围并重新选择', exact: true }).click();
          await expect(
            f.page.getByRole('checkbox', { name: '允许定时执行（可能产生费用）' }),
          ).not.toBeChecked();
          await expect(
            f.page.getByRole('button', { name: '保存配置', exact: true }),
          ).toBeDisabled();
          await f.page.getByRole('checkbox', { name: '语言模型', exact: true }).check();
          await f.page.getByRole('button', { name: '保存配置', exact: true }).click();
          await expect(f.page.getByText(/配置已保存为 r3/)).toBeVisible();
          assert.deepEqual(f.posts[1].request.config.topicIds, ['language-models']);
          assert.equal(f.posts[1].request.expectedRevision, 2);
          assert.equal(f.posts[1].request.config.enabled, false);
          assert.deepEqual(
            f.posts.map((body) => body.action),
            ['save', 'save'],
          );
          await f.close();
        },
      );
      await t.test(
        'failed leaf directory reads block edits and execution without treating parents as leaves',
        async () => {
          const f = await setup({
            kind: 'topic_insight',
            insightTopicsLoadError: true,
            localSchedulingAvailable: true,
          });
          await expect(f.page.getByRole('alert')).toContainText('最细分专题目录读取失败');
          await expect(f.page.getByRole('checkbox', { name: '人工智能', exact: true })).toHaveCount(
            0,
          );
          await expect(
            f.page.getByRole('button', { name: '立即运行', exact: true }),
          ).toBeDisabled();
          await f.page.getByRole('button', { name: '编辑', exact: true }).click();
          await expect(
            f.page.getByRole('button', { name: '保存配置', exact: true }),
          ).toBeDisabled();
          await expect(
            f.page.getByRole('button', { name: '删除配置 测试专题配置', exact: true }),
          ).toBeEnabled();
          f.props.insightTopicsLoadError = false;
          delete f.props.insightLeafTopicIds;
          await f.page.reload();
          await expect(f.page.getByRole('alert')).toContainText('最细分专题目录读取失败');
          await expect(
            f.page.getByRole('button', { name: '立即运行', exact: true }),
          ).toBeDisabled();
          assert.deepEqual(f.posts, []);
          await f.close();
        },
      );
      await t.test(
        'existing parent reports keep their original label and are never relabeled as a leaf',
        async () => {
          const f = await setup({
            kind: 'topic_insight',
            insightLeafTopicIds: ['language-models'],
          });
          f.props.topics = [
            { id: 'ai', name: '人工智能' },
            { id: 'language-models', name: '语言模型' },
          ];
          f.props.initial.runs = [
            {
              id: 'parent-report',
              snapshot: {
                name: '旧父级范围报告',
                kind: 'topic_insight',
                topicIds: ['language-models'],
              },
              status: 'completed',
              phase: 'ready_for_review',
              publication_status: 'private',
              created_at: '2026-10-29T00:00:00Z',
              charged_microusd: 1200,
              cost_source: 'provider',
              result: {
                topicIds: ['ai', 'topic-unknown'],
                report: {
                  title: '旧报告',
                  summary: '原范围保持不变。',
                  sections: [],
                  uncertainties: [],
                },
              },
            },
          ];
          await f.page.reload();
          await f.page.getByRole('button', { name: '阅读私有报告', exact: true }).click();
          const labels = f.page.getByLabel(/^原生成范围（待细分）：/);
          await expect(labels).toContainText('人工智能');
          await expect(labels.getByText('topic-unknown', { exact: true })).toBeVisible();
          await expect(labels.getByRole('link')).toHaveCount(1);
          await expect(labels).not.toContainText('语言模型');
          await expect(
            f.page.getByRole('button', { name: '确认公开', exact: true }),
          ).toBeDisabled();
          await expect(f.page.getByText(/报告原范围需细分或专题归属未确认/)).toBeVisible();
          assert.deepEqual(f.posts, []);
          await f.close();
        },
      );
      for (const [scenario, options, topicIds, message] of [
        ['parent result despite a leaf snapshot', {}, ['ai'], /报告原范围需细分或专题归属未确认/],
        [
          'missing result topic IDs despite a leaf snapshot',
          {},
          undefined,
          /报告原范围需细分或专题归属未确认/,
        ],
        [
          'unavailable leaf directory',
          { insightTopicsLoadError: true },
          ['language-models'],
          /最细分专题目录未就绪，暂不能确认公开/,
        ],
      ]) {
        await t.test(`publication blocks ${scenario} while preserving withdrawal`, async () => {
          const f = await setup({
            kind: 'topic_insight',
            insightLeafTopicIds: ['language-models'],
            ...options,
          });
          const row = {
            id: 'publication-scope',
            snapshot: { name: '历史报告', kind: 'topic_insight', topicIds: ['language-models'] },
            status: 'completed',
            phase: 'ready_for_review',
            publication_status: 'private',
            created_at: '2026-10-29T00:00:00Z',
            charged_microusd: 1200,
            cost_source: 'provider',
            result: { generationIds: [], failed: null, discovery: null },
          };
          f.props.initial.runs = [row];
          f.details.set(row.id, {
            ...row,
            result: {
              topicIds,
              report: {
                title: '旧报告',
                summary: '保留原始范围。',
                sections: [],
                uncertainties: [],
              },
            },
          });
          await f.page.reload();
          await expect(
            f.page.getByRole('button', { name: '确认公开', exact: true }),
          ).toBeDisabled();
          await f.page.getByRole('button', { name: '阅读私有报告', exact: true }).click();
          await expect(
            f.page.getByRole('button', { name: '确认公开', exact: true }),
          ).toBeDisabled();
          await expect(f.page.getByText(message)).toBeVisible();
          assert.deepEqual(f.detailReads, [row.id]);
          assert.deepEqual(f.posts, []);
          row.publication_status = 'published';
          await f.page.reload();
          await expect(f.page.getByRole('button', { name: '撤回', exact: true })).toBeEnabled();
          f.page.once('dialog', (dialog) => dialog.accept());
          await f.page.getByRole('button', { name: '撤回', exact: true }).click();
          await expect(f.page.getByText('专题洞察已撤回。', { exact: true })).toBeVisible();
          assert.deepEqual(f.posts, [{ action: 'publish', id: row.id, confirm: false }]);
          await f.close();
        });
      }
    } finally {
      await browser.close();
      await new Promise((resolve) => server.close(resolve));
    }
  },
);
