import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { fileURLToPath, URL } from 'node:url';
import process from 'node:process';
import { build } from 'esbuild';
import { chromium, expect } from '@playwright/test';
import { summarizeAutomationGenerations } from '../lib/automation-generation-status.ts';

test(
  'discovery UI saves without topics or URLs and explicitly converts legacy schedules',
  { skip: process.env.HZENSE_AUTOMATION_BROWSER_TEST !== '1' },
  async () => {
    const root = fileURLToPath(new URL('..', import.meta.url));
    const profileId = '11111111-1111-4111-8111-111111111111';
    const initial = {
      configDeletionAvailable: true,
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
      runs: [
        {
          id: 'history',
          snapshot: { name: '历史采集任务', kind: 'source_collection' },
          status: 'completed',
          phase: 'done',
          charged_microusd: 100000,
          cost_source: 'provider',
          created_at: '2026-10-02T00:00:00Z',
          result: null,
        },
      ],
    };
    const compiled = await build({
      stdin: {
        contents: `import {createRoot} from 'react-dom/client'; import {AdminAutomation} from './components/admin-automation'; const p=new URLSearchParams(location.search); createRoot(document.getElementById('root')).render(<AdminAutomation kind="source_collection" configured={!p.has('missingStorage')} executionEnabled={p.has('execute')} executionReadiness={{ready:false,checks:[{key:'storage',ready:true},{key:'generation',ready:false}]}} loadError={false} initial={{...${JSON.stringify(initial)},configDeletionAvailable:!p.has('legacySchema')}} profiles={[{id:'${profileId}',revision:1,name:'验收模型',ready:true}]} topics={[{id:'topic-ai',name:'人工智能'}]}/>);`,
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
      let deletionError = null;
      let gets = 0;
      let getFailure = false;
      let holdRefresh = false,
        releaseRefresh;
      page.on('pageerror', (error) => errors.push(error.message));
      await page.route('**/api/admin/automation', async (route) => {
        if (route.request().method() === 'GET') {
          gets++;
          if (getFailure) return route.fulfill({ status: 503, json: { error: 'unavailable' } });
          if (holdRefresh)
            await new Promise((resolve) => {
              releaseRefresh = resolve;
            });
          return route.fulfill({ json: initial });
        }
        const body = route.request().postDataJSON();
        posts.push(body);
        if (body.action === 'delete') {
          if (deletionError) return route.fulfill({ status: 409, json: { error: deletionError } });
          initial.configs = initial.configs.filter((config) => config.id !== body.request.id);
          return route.fulfill({
            json: {
              config: { id: body.request.id, revision: 2, deleted_at: '2026-10-02T10:00:00Z' },
            },
          });
        }
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
      await expect(page.getByText('配置存储已就绪', { exact: false })).toBeVisible();
      await expect(page.getByRole('button', { name: '立即运行', exact: true })).toBeDisabled();
      await expect(
        page.getByRole('checkbox', { name: '允许定时执行', exact: false }),
      ).toBeDisabled();
      await page.getByLabel('配置名称', { exact: true }).fill('芯片情报');
      await page.getByLabel('分阶段模型配置', { exact: true }).selectOption(profileId);
      await page.getByRole('button', { name: '保存配置', exact: true }).click();
      await expect(page.getByRole('status')).toContainText('保存配置不会启动任务');
      assert.equal(posts.length, 1);
      assert.deepEqual(posts[0].request.config.sourceUrls, []);
      assert.deepEqual(posts[0].request.config.topicIds, []);
      assert.deepEqual(posts[0].request.config.discovery, {
        keywords: [],
        lookbackDays: 2,
        maxSources: 5,
      });
      assert.equal(posts[0].request.config.enabled, false);
      await page.getByLabel('关注关键词', { exact: false }).fill('芯片，英伟达');
      await page.getByRole('button', { name: '保存配置', exact: true }).click();
      await expect(page.getByRole('status')).toContainText('r2');
      assert.deepEqual(posts[1].request.config.discovery.keywords, ['芯片', '英伟达']);
      await page.getByRole('button', { name: '编辑', exact: true }).click();
      await expect(page.getByText('此为旧固定网址配置', { exact: false })).toBeVisible();
      await expect(page.getByRole('checkbox', { name: '允许定时执行' })).not.toBeChecked();
      await expect(page.getByRole('button', { name: '保存配置', exact: true })).toBeEnabled();
      await expect(page.getByText('此旧配置包含领域限制', { exact: false })).toBeVisible();
      await page.getByRole('button', { name: '保存配置', exact: true }).click();
      await expect(page.getByRole('status')).toContainText('保存配置不会启动任务');
      assert.equal(posts.length, 3);
      assert.deepEqual(posts[2].request.config.topicIds, []);
      assert.equal(posts[2].request.config.enabled, false);
      await page.goto(`http://127.0.0.1:${server.address().port}/?execute=1`);
      await expect(page.getByRole('button', { name: '立即运行', exact: true })).toBeEnabled();
      await expect(
        page.getByRole('checkbox', { name: '允许定时执行', exact: false }),
      ).toBeEnabled();
      await page.goto(`http://127.0.0.1:${server.address().port}/?missingStorage=1`);
      await page.getByLabel('配置名称', { exact: true }).fill('未配置存储');
      await page.getByLabel('分阶段模型配置', { exact: true }).selectOption(profileId);
      await expect(page.getByRole('button', { name: '保存配置', exact: true })).toBeDisabled();
      await expect(page.getByText('配置存储尚未就绪', { exact: false })).toBeVisible();
      assert.equal(posts.length, 3);
      await page.goto(`http://127.0.0.1:${server.address().port}/?legacySchema=1`);
      await expect(page.getByRole('button', { name: '删除配置 旧网址任务' })).toBeDisabled();
      await expect(page.getByText('删除功能待完成数据库升级', { exact: false })).toBeVisible();
      await page.goto(`http://127.0.0.1:${server.address().port}`);
      const remove = page.getByRole('button', { name: '删除配置 旧网址任务' });
      await expect(remove).toBeEnabled(); // Execution is disabled, but safe deletion is independent.
      holdRefresh = true;
      await page.getByRole('button', { name: '刷新列表', exact: true }).click();
      await expect(remove).toBeDisabled();
      await expect.poll(() => typeof releaseRefresh).toBe('function');
      holdRefresh = false;
      releaseRefresh();
      await expect(remove).toBeEnabled();
      page.once('dialog', (dialog) => dialog.dismiss());
      await remove.click();
      assert.equal(posts.length, 3);
      for (const error of ['config_in_use', 'commit_unknown']) {
        deletionError = error;
        page.once('dialog', (dialog) => {
          assert.match(dialog.message(), /历史任务、结果和费用仍然保留/);
          return dialog.accept();
        });
        await remove.click();
        await expect(page.getByRole('status')).toContainText(
          error === 'config_in_use' ? '暂不能删除' : '提交结果未确认',
        );
        await expect(remove).toBeEnabled();
      }
      assert.equal(posts.length, 5); // Unknown results never automatically replay a deletion.
      deletionError = null;
      await page.getByRole('button', { name: '编辑', exact: true }).click();
      page.once('dialog', (dialog) => dialog.accept());
      await remove.click();
      await expect(page.getByRole('status')).toContainText('配置已删除');
      await expect(remove).toHaveCount(0);
      await expect(page.getByRole('heading', { name: '新建配置' })).toBeVisible();
      await expect(page.getByLabel('配置名称', { exact: true })).toHaveValue('');
      await expect(page.getByText('历史采集任务', { exact: true })).toBeVisible();
      await expect(
        page.getByRole('cell', { name: '$0.1000 provider', exact: false }),
      ).toBeVisible();
      assert.deepEqual(posts.at(-1), {
        action: 'delete',
        request: { id: 'legacy', expectedRevision: 1, consent: true },
      });
      assert.equal(posts.length, 6);
      // A completed parent only dispatched its children. Reads track actual
      // generation receipts, preserve unsaved form edits, and never call AI.
      const generationId = '22222222-2222-4222-8222-222222222222';
      const run = initial.runs[0];
      run.phase = 'candidate_tasks_queued';
      run.result = { generationIds: [generationId], failed: 0 };
      run.generationProgress = summarizeAutomationGenerations(run.result, [
        { id: generationId, status: 'pending', progress_phase: 'queued', candidate_count: null },
      ]);
      await page.getByRole('button', { name: '刷新列表', exact: true }).click();
      await expect(page.getByRole('cell', { name: '候选排队中', exact: false })).toBeVisible();
      await page.getByLabel('配置名称', { exact: true }).fill('保留未保存修改');
      await page.getByText('执行条件（配置检查，不调用 AI）', { exact: true }).click();
      await expect(page.getByText('信号生成服务：待配置', { exact: true })).toBeVisible();
      const beforeFailure = gets;
      getFailure = true;
      await expect.poll(() => gets, { timeout: 10000 }).toBeGreaterThan(beforeFailure);
      await expect(page.getByRole('alert')).toContainText('自动刷新失败');
      await expect(page.getByRole('cell', { name: '候选排队中', exact: false })).toBeVisible();
      getFailure = false;
      run.generationProgress = summarizeAutomationGenerations(run.result, [
        { id: generationId, status: 'completed', progress_phase: 'completed', candidate_count: 3 },
      ]);
      await expect(page.getByRole('cell', { name: '私有候选已生成', exact: false })).toBeVisible({
        timeout: 10000,
      });
      await expect(page.getByText('已生成 3 条私有候选', { exact: true })).toBeVisible();
      await expect(
        page.getByRole('link', { name: `查看私有候选任务 · ${generationId}` }),
      ).toHaveAttribute('href', `/admin/signal-generation/${generationId}`);
      await expect(page.getByRole('alert')).toHaveCount(0);
      await expect(page.getByLabel('配置名称', { exact: true })).toHaveValue('保留未保存修改');
      if (process.env.HZENSE_AUTOMATION_SCREENSHOT) {
        await page.setViewportSize({ width: 1440, height: 1080 });
        await page.screenshot({ path: process.env.HZENSE_AUTOMATION_SCREENSHOT, fullPage: true });
        await page.setViewportSize({ width: 390, height: 844 });
      }
      const completedGets = gets;
      await page.waitForTimeout(5500);
      assert.equal(gets, completedGets, 'finished tasks stop polling');
      run.generationProgress = summarizeAutomationGenerations(run.result, null);
      await page.getByRole('button', { name: '刷新列表', exact: true }).click();
      await expect(page.getByRole('cell', { name: '生成结果待核对', exact: false })).toBeVisible();
      await expect(page.getByRole('alert')).toContainText('关联候选状态暂时无法读取');
      await expect(page.getByText('每 5 秒自动读取任务状态', { exact: false })).toBeVisible();
      // A successful HTTP dashboard with a failed ancillary read is retryable,
      // unlike a confirmed hidden/missing row. Retry only GET, with a bound.
      const failedSummaryGets = gets;
      await expect.poll(() => gets, { timeout: 10000 }).toBe(failedSummaryGets + 1);
      getFailure = true; // Subsequent HTTP errors must count toward the same bound.
      await expect.poll(() => gets, { timeout: 20000 }).toBe(failedSummaryGets + 3);
      await expect(page.getByText('每 5 秒自动读取任务状态', { exact: false })).toHaveCount(0);
      await page.waitForTimeout(5500);
      assert.equal(gets, failedSummaryGets + 3);
      getFailure = false;
      run.generationProgress = summarizeAutomationGenerations(run.result, []);
      await page.getByRole('button', { name: '刷新列表', exact: true }).click();
      await expect(page.getByRole('alert')).toHaveCount(0);
      await expect(
        page.getByText('记录不可读取或已隐藏，请核对原任务', { exact: true }),
      ).toBeVisible();
      await expect(page.getByText('每 5 秒自动读取任务状态', { exact: false })).toHaveCount(0);
      assert.equal(posts.length, 6, 'polling and reconciliation do not POST or retry');
      assert.equal(
        posts.some((post) => ['trigger', 'publish'].includes(post.action)),
        false,
      );
      // A missing search counter stays unknown even when provider citations
      // allow discovery to complete. Reading that receipt never calls AI.
      delete run.generationProgress;
      run.status = 'completed';
      run.phase = 'done';
      run.result = {
        discovery: {
          articles: [
            { url: 'https://example.com/new', title: '新资料', publishedAt: '2026-10-02' },
          ],
          rejected: 0,
          duplicates: 0,
          searchRequests: null,
          searchEvidence: 'provider_url_citations',
        },
        discoveryDiagnostics: {
          version: 1,
          responseId: 'gen-citation-receipt',
          searchRequests: null,
          searchCountStatus: 'missing',
          finishReason: 'stop',
          choiceCount: 1,
          annotationCount: 1,
          providerError: false,
          providerErrorCode: null,
        },
      };
      const beforeCitationRefresh = gets;
      await page.getByRole('button', { name: '刷新列表', exact: true }).click();
      await expect.poll(() => gets).toBe(beforeCitationRefresh + 1);
      await expect(page.getByText('搜索次数未返回', { exact: false })).toBeVisible();
      await expect(page.getByText('已收到有效来源引用', { exact: false })).toBeVisible();
      await expect(page.getByText('实际检索 0 次', { exact: false })).toHaveCount(0);
      await expect(page.getByText('选中 1 篇原文', { exact: false })).toBeVisible();
      await page.getByText('查看检索诊断（脱敏）', { exact: true }).click();
      await expect(page.getByText('搜索回执：供应商未返回搜索次数', { exact: true })).toBeVisible();
      await expect(
        page.getByRole('cell', { name: '$0.1000 provider', exact: false }),
      ).toBeVisible();
      assert.equal(posts.length, 6, 'refreshing citation-backed discovery is read-only');

      // Historical results may omit both new fields. Absence is not zero and
      // must not be presented as evidence that valid citations were received.
      delete run.result.discovery.searchRequests;
      delete run.result.discovery.searchEvidence;
      delete run.result.discoveryDiagnostics;
      const beforeLegacyRefresh = gets;
      await page.getByRole('button', { name: '刷新列表', exact: true }).click();
      await expect.poll(() => gets).toBe(beforeLegacyRefresh + 1);
      await expect(page.getByText('搜索次数未返回', { exact: false })).toBeVisible();
      await expect(page.getByText('实际检索 0 次', { exact: false })).toHaveCount(0);
      await expect(page.getByText('已收到有效来源引用', { exact: false })).toHaveCount(0);
      await expect(page.getByText('查看检索诊断（脱敏）', { exact: true })).toHaveCount(0);

      for (const searchRequests of [2, 0]) {
        run.result.discovery.searchRequests = searchRequests;
        run.result.discovery.searchEvidence = 'search_count';
        const beforeKnownRefresh = gets;
        await page.getByRole('button', { name: '刷新列表', exact: true }).click();
        await expect.poll(() => gets).toBe(beforeKnownRefresh + 1);
        await expect(
          page.getByText(`实际检索 ${searchRequests} 次`, { exact: false }),
        ).toBeVisible();
        await expect(page.getByText('搜索次数未返回', { exact: false })).toHaveCount(0);
        await expect(page.getByText('已收到有效来源引用', { exact: false })).toHaveCount(0);
      }
      assert.equal(posts.length, 6, 'search receipt refreshes never create or retry a task');

      run.status = 'failed';
      run.phase = 'source_failed';
      run.result.sourceFailures = [
        {
          itemId: '11111111-1111-4111-8111-111111111111',
          phase: 'create_candidate',
          code: 'invalid_request',
          message: 'must-not-display-private-source-error',
          stack: 'must-not-display-private-stack',
        },
        {
          itemId: '22222222-2222-4222-8222-222222222222',
          phase: 'create_candidate',
          code: 'commit_unknown',
        },
        {
          itemId: 'must-not-display-private-id',
          phase: 'create_candidate',
          code: 'invalid_request',
        },
      ];
      const beforeSourceFailureRefresh = gets;
      await page.getByRole('button', { name: '刷新列表', exact: true }).click();
      await expect.poll(() => gets).toBe(beforeSourceFailureRefresh + 1);
      await page.getByText('查看来源处理失败原因（脱敏）', { exact: true }).click();
      await expect(
        page.getByText(
          '资料 11111111-1111-4111-8111-111111111111 · 创建候选任务：候选任务参数无效（invalid_request）',
          { exact: true },
        ),
      ).toBeVisible();
      for (const secret of [
        'must-not-display-private',
        'commit_unknown',
        '22222222-2222-4222-8222-222222222222',
      ]) {
        await expect(page.getByText(secret, { exact: false })).toHaveCount(0);
      }
      await expect(
        page.getByRole('cell', { name: '$0.1000 provider', exact: false }),
      ).toBeVisible();
      assert.equal(posts.length, 6, 'reading source refusals never creates or retries a task');

      delete run.result.sourceFailures;
      await page.getByRole('button', { name: '刷新列表', exact: true }).click();
      await expect(page.getByText('查看来源处理失败原因（脱敏）', { exact: true })).toHaveCount(0);

      // Failed discovery diagnostics are private structural readbacks, not a retry action.
      delete run.generationProgress;
      run.status = 'failed';
      run.phase = 'discovery_failed';
      run.error_code = 'discovery_search_unconfirmed';
      run.charged_microusd = 64200;
      run.result = {
        discoveryDiagnostics: {
          version: 1,
          responseId: 'gen-1790970223-AbCd01234567',
          searchRequests: null,
          searchCountStatus: 'missing',
          finishReason: 'stop',
          choiceCount: 1,
          annotationCount: 0,
          providerError: false,
          providerErrorCode: null,
          rawBody: 'must-not-display-private-body',
        },
      };
      await page.getByRole('button', { name: '刷新列表', exact: true }).click();
      await expect(page.getByRole('cell', { name: '采集失败', exact: false })).toBeVisible();
      await expect(page.getByText('资料或候选登记未完成', { exact: false })).toHaveCount(0);
      await page.getByText('查看检索诊断（脱敏）', { exact: true }).click();
      await expect(page.getByText('搜索回执：供应商未返回搜索次数', { exact: true })).toBeVisible();
      await expect(
        page.getByText('供应商响应 ID：gen-1790970223-AbCd01234567', { exact: true }),
      ).toBeVisible();
      await expect(
        page.getByRole('cell', { name: '$0.0642 provider', exact: false }),
      ).toBeVisible();
      await expect(page.getByText('must-not-display-private-body', { exact: false })).toHaveCount(
        0,
      );
      run.error_code = 'discovery_output_truncated';
      run.result.discoveryDiagnostics.finishReason = 'length';
      await page.getByRole('button', { name: '刷新列表', exact: true }).click();
      await expect(page.getByText('检索输出达到长度上限', { exact: false })).toBeVisible();
      await expect(page.getByText('结束原因：length', { exact: true })).toBeVisible();
      run.error_code = 'discovery_provider_error';
      run.result.discoveryDiagnostics.providerError = true;
      run.result.discoveryDiagnostics.providerErrorCode = 429;
      await page.getByRole('button', { name: '刷新列表', exact: true }).click();
      await expect(page.getByText('供应商返回错误结果', { exact: false })).toBeVisible();
      await expect(page.getByText('供应商错误：429', { exact: true })).toBeVisible();
      assert.equal(posts.length, 6, 'opening failure diagnostics never creates or retries a task');
      assert.deepEqual(errors, []);
    } finally {
      await browser?.close();
      await new Promise((resolve) => server.close(resolve));
    }
  },
);
