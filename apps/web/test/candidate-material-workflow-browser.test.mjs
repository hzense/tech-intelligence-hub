import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { fileURLToPath, URL } from 'node:url';
import process from 'node:process';
import { build } from 'esbuild';
import { chromium, expect } from '@playwright/test';
/* global document, window */

// Actual client component with synthetic loopback responses. No AI, credentials,
// production data, database writes or publication are involved.
test(
  'material workflow: selection, same-key recovery, registration and mobile layout',
  {
    skip: process.env.HZENSE_CANDIDATE_REVIEW_BROWSER_TEST !== '1',
  },
  async () => {
    const compiled = await build({
      stdin: {
        contents: `import {createRoot} from 'react-dom/client';import {CandidateMaterialWorkflow} from './components/candidate-material-workflow';createRoot(document.getElementById('root')).render(<CandidateMaterialWorkflow runId="11111111-1111-4111-8111-111111111111" candidateIndex={0} materialHash={'a'.repeat(64)} onUpdated={async()=>{throw new Error('synthetic parent read failure')}} onRegistered={async()=>{document.getElementById('notice').textContent='parent refreshed';throw new Error('synthetic registration refresh failure')}}/>);`,
        resolveDir: fileURLToPath(new URL('..', import.meta.url)),
        loader: 'tsx',
      },
      bundle: true,
      write: false,
      outfile: '/fixture/entry.js',
      platform: 'browser',
      format: 'esm',
      jsx: 'automatic',
      define: { 'process.env.NODE_ENV': '"production"' },
      logLevel: 'silent',
    });
    const assets = new Map(
      compiled.outputFiles.map((file) => [`/${file.path.split('/').at(-1)}`, file.contents]),
    );
    const server = createServer((req, res) => {
      if (assets.has(req.url)) {
        res.setHeader('Content-Type', req.url.endsWith('.css') ? 'text/css' : 'text/javascript');
        res.end(assets.get(req.url));
        return;
      }
      res.setHeader('Content-Type', 'text/html');
      res.end(
        '<!doctype html><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/entry.css"><div id="root"></div><div id="notice"></div><script type="module" src="/entry.js"></script>',
      );
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    let browser;
    try {
      browser = await chromium.launch({ headless: true });
      const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
      const data = {
        configured: true,
        enabled: true,
        reviewEnabled: true,
        enrichmentEnabled: true,
        requests: [],
        sources: [1, 2, 3, 4].map((n) => ({
          batchId: `batch-${n}`,
          itemId: `item-${n}`,
          name: `官方来源 ${n}`,
          sourceUrl: `https://example.com/${n}`,
        })),
      };
      const commands = [];
      let inspectionFailure = true;
      let inspections = 0;
      let unknown = true;
      let needsManualIdentity = false;
      let manualConfirmation;
      const organizationReview = {
        contextHash: 'd'.repeat(64),
        organizations: [
          {
            name: 'Lab',
            truncated: false,
            evidence: [
              {
                id: 'e'.repeat(64),
                fragmentId: 'fragment-2',
                quote: 'Lab carries out independent research.',
                sourceUrl: 'https://example.com/about',
              },
            ],
          },
        ],
      };
      await page.route('**/api/admin/candidate-materials**', async (route) => {
        if (route.request().method() === 'GET') {
          await route.fulfill({ json: data });
          return;
        }
        assert.equal(route.request().method(), 'POST');
        assert.equal(route.request().headers()['content-type'], 'application/json');
        const body = route.request().postDataJSON();
        assert.deepEqual(Object.keys(body).sort(), ['action', 'request']);
        if (body.action === 'inspect') {
          inspections++;
          await route.fulfill(
            inspectionFailure
              ? { status: 413, json: { error: 'candidate_source_bundle_too_large' } }
              : { json: { sourceBytes: 52271, limitBytes: 200000, fragmentCount: 81 } },
          );
          return;
        }
        commands.push(body);
        if (body.action === 'enrich') {
          data.requests[0].enrichments = [
            {
              id: body.request.id,
              status: 'pending',
              reserved_microusd: '12300',
              charged_microusd: '0',
              result: null,
            },
          ];
          await route.fulfill({
            status: 202,
            json: { enrichment: data.requests[0].enrichments[0] },
          });
          return;
        }
        if (body.action === 'create' && unknown) {
          unknown = false;
          await route.fulfill({ status: 503, json: { error: 'commit_unknown' } });
          return;
        }
        if (body.action === 'create')
          data.requests = [
            {
              id: body.request.id,
              createdAt: '2026-09-24T10:00:00Z',
              fragmentCount: 2,
              reports: [],
            },
          ];
        if (body.action === 'confirm')
          data.requests[0].reports[0].stages = ['registered', 'verified'];
        if (body.action === 'prepare') {
          if (needsManualIdentity && !body.request.organizationConfirmation) {
            await route.fulfill({
              json: { ready: false, blockers: ['needs_organization_identity'], organizationReview },
            });
            return;
          }
          if (body.request.organizationConfirmation) {
            manualConfirmation = body.request.organizationConfirmation;
            needsManualIdentity = false;
          }
          await route.fulfill({ json: { ready: true } });
          return;
        }
        if (body.action === 'approve') {
          data.requests[0].proposals[0].approved = true;
          await route.fulfill({ json: { approved: true, dispatched: true } });
          return;
        }
        await route.fulfill({ json: { ok: true } });
      });
      await page.goto(`http://127.0.0.1:${server.address().port}`);
      const create = page.getByRole('button', {
        name: '确认建立补证请求（不调用 AI）',
        exact: true,
      });
      await expect(create).toBeDisabled();
      for (const n of [1, 2, 3])
        await page.getByRole('checkbox', { name: `官方来源 ${n}` }).check();
      await expect(page.getByRole('checkbox', { name: '官方来源 4' })).toBeDisabled();
      await create.click();
      await expect(
        page.getByText('补证资料包超过 200,000 字节上限', { exact: false }),
      ).toBeVisible();
      assert.equal(commands.length, 0);
      await expect(page.getByRole('checkbox', { name: '官方来源 1' })).toBeEnabled();
      inspectionFailure = false;
      await page.getByRole('button', { name: '检查资料容量（不保存、不调用 AI）' }).click();
      await expect(page.getByText('合并资料：52,271 / 200,000 字节，81 个片段。')).toBeVisible();
      assert.equal(commands.length, 0);
      await create.click();
      await expect(page.getByText('提交结果未知，请刷新核对', { exact: false })).toBeVisible();
      await expect(page.getByRole('checkbox', { name: '官方来源 1' })).toBeDisabled();
      await page.getByRole('button', { name: '使用原请求继续建立' }).click();
      const requests = page.getByRole('table', { name: '补证请求', exact: true });
      await expect(requests).toBeVisible();
      await expect(requests.getByRole('columnheader')).toHaveText([
        /补证材料/,
        /执行状态/,
        /创建时间/,
        /材料与结果/,
        '操作',
      ]);
      const requestDetails = page.getByRole('button', { name: '查看任务详情', exact: true });
      await expect(requestDetails).toHaveAttribute('aria-expanded', 'false');
      const commandsBeforeDetails = commands.length;
      await requestDetails.focus();
      await page.keyboard.press('Enter');
      await expect(page.getByRole('button', { name: '收起任务详情' })).toHaveAttribute(
        'aria-expanded',
        'true',
      );
      assert.equal(commands.length, commandsBeforeDetails);
      await expect(
        page.getByText('等待独立材料核验报告。尚未登记，也未获得公开许可。'),
      ).toBeVisible();
      assert.equal(commands[0].request.id, commands[1].request.id);
      await expect(
        page.getByText('补证请求已保存，等待独立材料核验；本操作未调用 AI、未公开资料。'),
      ).toBeVisible();
      await expect(
        page.getByText('补证记录已读取，但上方发布材料刷新失败', { exact: false }),
      ).toBeVisible();
      assert.deepEqual(commands[0], commands[1]);
      assert.equal(inspections, 3); // A pending write replay never rebuilds or re-inspects sources.
      const enrich = page.getByRole('button', { name: '确认启动 AI 补证补全（计费）' });
      data.reviewEnabled = false;
      await page.reload();
      await expect(enrich).toHaveCount(0);
      data.reviewEnabled = true;
      await page.reload();
      await requestDetails.click();
      await expect(enrich).toBeVisible();
      page.once('dialog', (dialog) => dialog.dismiss());
      await enrich.click();
      assert.equal(commands.filter((command) => command.action === 'enrich').length, 0);
      page.once('dialog', (dialog) => dialog.accept());
      await enrich.click();
      const enrichmentTasks = page.getByRole('table', { name: '补证 AI 补全任务', exact: true });
      await expect(enrichmentTasks).toBeVisible();
      await expect(
        enrichmentTasks.getByRole('cell', { name: '已排队', exact: true }),
      ).toBeVisible();
      await expect(enrichmentTasks).toContainText('预留 $0.0123');
      await expect(enrichmentTasks).toContainText('记账 $0.0000');
      await expect(page.getByText('补证 AI 补全任务已保存并排队', { exact: false })).toBeVisible();
      await expect(enrich).toHaveCount(0);
      assert.equal(commands.filter((command) => command.action === 'enrich').length, 1);
      assert.deepEqual(
        Object.keys(commands.find((command) => command.action === 'enrich').request).sort(),
        ['consent', 'id', 'requestId'],
      );
      const originalEnrichmentId = data.requests[0].enrichments[0].id;
      const retry = page.getByRole('button', { name: '确认重试 AI 补证补全（重新计费）' });
      for (const error_code of ['outcome_unknown', 'enrichment_unknown']) {
        Object.assign(data.requests[0].enrichments[0], { status: 'failed', error_code });
        await page.getByRole('button', { name: '刷新补证状态' }).click();
        await expect(retry).toHaveCount(0);
      }
      for (const error_code of ['dispatch_failed', 'enrichment_failed']) {
        Object.assign(data.requests[0].enrichments[0], { status: 'failed', error_code });
        await page.getByRole('button', { name: '刷新补证状态' }).click();
        await expect(retry).toBeVisible();
      }
      page.once('dialog', (dialog) => dialog.dismiss());
      await retry.click();
      assert.equal(commands.filter((command) => command.action === 'enrich').length, 1);
      page.once('dialog', (dialog) => dialog.accept());
      await retry.click();
      await expect(retry).toHaveCount(0);
      assert.notEqual(data.requests[0].enrichments[0].id, originalEnrichmentId);
      data.requests[0].enrichments[0] = {
        ...data.requests[0].enrichments[0],
        status: 'completed',
        result: {
          candidate: { persons: [{ name: 'Ada', role: 'researcher' }], organizations: ['Lab'] },
          materialHints: {
            organizations: [{ name: 'Lab', type: 'institution' }],
            topicIds: ['topic-ai'],
          },
        },
      };
      await page.getByRole('button', { name: '刷新补证状态' }).click();
      await expect(page.getByText('人物：Ada（researcher）')).not.toBeVisible();
      await enrichmentTasks.getByText('查看补全详情', { exact: true }).click();
      await expect(page.getByText('人物：Ada（researcher）')).toBeVisible();
      assert.equal(commands.filter((command) => command.action === 'enrich').length, 2);
      needsManualIdentity = true;
      await page.getByRole('button', { name: '准备核验材料（不调用 AI）' }).click();
      const manual = page.getByRole('region', { name: '手动确认组织类型', exact: true });
      await expect(manual).toBeVisible();
      const manualConfirm = manual.getByRole('button', {
        name: '确认组织类型并准备材料（不调用 AI）',
      });
      await expect(manualConfirm).toBeDisabled();
      await manual.getByLabel('组织类型 · Lab').selectOption('institution');
      await manual.getByLabel('原文依据 · Lab').selectOption('e'.repeat(64));
      await expect(
        manual.getByText('Lab carries out independent research.', { exact: true }),
      ).toBeVisible();
      await manual.getByRole('checkbox').check();
      await expect(manualConfirm).toBeEnabled();
      await manual.getByLabel('组织类型 · Lab').selectOption('company');
      await expect(manual.getByRole('checkbox')).not.toBeChecked();
      await expect(manualConfirm).toBeDisabled();
      await manual.getByLabel('组织类型 · Lab').selectOption('institution');
      await manual.getByRole('checkbox').check();
      await manualConfirm.click();
      await expect(manual).toHaveCount(0);
      assert.deepEqual(manualConfirmation, {
        contextHash: 'd'.repeat(64),
        consent: true,
        selections: [{ name: 'Lab', type: 'institution', evidenceId: 'e'.repeat(64) }],
      });
      assert.equal(commands.filter((command) => command.action === 'enrich').length, 2);
      data.requests[0].reports = [
        {
          id: 'report-1',
          planHash: 'b'.repeat(64),
          stages: [],
          plan: {
            candidate: {
              title: '合成登记方案',
              summary: '这是合成登记测试。',
              eventDate: '2026-09-24',
              claims: [{ text: 'Ada works at Lab.', evidenceId: 'evidence-1' }],
              persons: [{ entityId: 'person-ada', role: 'researcher' }],
              organizationIds: ['org-lab'],
            },
            entities: [
              { id: 'person-ada', name: 'Ada' },
              { id: 'org-lab', name: 'Lab' },
            ],
            topicIds: ['topic-ai'],
            evidence: [
              {
                id: 'evidence-1',
                excerpt: 'Ada works at Lab.',
                sourceUrl: 'https://example.com/1',
              },
            ],
          },
        },
      ];
      const preparedReport = data.requests[0].reports[0];
      data.requests[0].reports = [];
      data.requests[0].proposals = [
        {
          id: 'proposal-1',
          proposalHash: 'c'.repeat(64),
          plan: preparedReport.plan,
          dossier: {
            organizationConfirmation: {
              version: 'organization-confirmation-v1',
              contextHash: 'd'.repeat(64),
              confirmedBy: 'owner',
              selections: [
                {
                  name: 'Lab',
                  type: 'institution',
                  fragmentId: 'fragment-2',
                  quote: 'Lab carries out independent research.',
                  sourceUrl: 'https://example.com/about',
                },
              ],
            },
            eventDate: { value: '2026-09-24', quote: 'Ada works at Lab.' },
            statements: {
              sourceAuthenticity: '来源真实性已核对',
              usageRights: '我确认具有所列摘录的公开引用权限',
              entityIdentity: '实体身份已核对',
              eventRelevance: '事件关联已核对',
              claimSupport: '主张支持已核对',
              taxonomy: '分类已核对',
            },
          },
          approved: false,
          approvalExpiresAt: null,
        },
      ];
      await page.getByRole('button', { name: '刷新补证状态' }).click();
      await page.getByRole('button', { name: '准备核验材料（不调用 AI）' }).click();
      await expect(page.getByRole('region', { name: '已保存的组织类型人工确认' })).toBeVisible();
      await page.reload();
      await requestDetails.click();
      await expect(page.getByRole('region', { name: '已保存的组织类型人工确认' })).toContainText(
        'Lab carries out independent research.',
      );
      await expect(
        page.getByText('我确认具有所列摘录的公开引用权限', { exact: true }),
      ).toBeVisible();
      const approve = page.getByRole('button', {
        name: '我已核对以上内容，确认提交独立核验',
        exact: true,
      });
      page.once('dialog', (dialog) => dialog.dismiss());
      await approve.click();
      assert.equal(commands.filter((command) => command.action === 'approve').length, 0);
      page.once('dialog', (dialog) => dialog.accept());
      await approve.click();
      await expect(page.getByRole('status').filter({ hasText: '独立核验已提交' })).toBeVisible();
      const approvalCommand = commands.find((command) => command.action === 'approve');
      assert.deepEqual(Object.keys(approvalCommand.request).sort(), [
        'consent',
        'proposalHash',
        'proposalId',
        'requestId',
      ]);
      data.requests[0].reports = [preparedReport];
      await page.getByRole('button', { name: '刷新补证状态' }).click();
      await page.getByText('核对公开证据及来源', { exact: true }).click();
      await expect(
        page.locator('blockquote').getByText('Ada works at Lab.', { exact: true }),
      ).toBeVisible();
      await page.getByRole('button', { name: '确认登记材料（不发布）' }).click();
      await expect(page.getByText('已登记 / 已收到材料核验回执', { exact: true })).toBeVisible();
      await expect(page.locator('#notice')).toHaveText('parent refreshed');
      await expect(
        page.getByText('材料登记及核验回执已保存。仍需完成候选核验和发布确认。'),
      ).toBeVisible();
      await expect(
        page.getByText('补证记录已读取，但上方发布材料刷新失败', { exact: false }),
      ).toBeVisible();
      assert.equal(commands.filter((command) => command.action === 'confirm').length, 1);
      assert.deepEqual([...new Set(commands.map(({ action }) => action))].sort(), [
        'approve',
        'confirm',
        'create',
        'enrich',
        'prepare',
      ]);
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
        true,
      );
      const detailBounds = await page
        .getByRole('article', { name: '补证任务详情', exact: true })
        .boundingBox();
      assert.ok(detailBounds && detailBounds.x + detailBounds.width <= 390);
      const innerTableBounds = await page
        .getByRole('region', { name: '补证 AI 补全任务表格，可横向滚动', exact: true })
        .boundingBox();
      assert.ok(innerTableBounds && innerTableBounds.x + innerTableBounds.width <= 390);
      // Both list levels filter and sort loaded data without dispatching AI or writes.
      const originalRequest = data.requests[0];
      const originalTask = originalRequest.enrichments[0];
      originalTask.charged_microusd = '10000000';
      originalRequest.enrichments.push({
        ...originalTask,
        id: 'extra-enrichment-task',
        status: 'failed',
        charged_microusd: '900000',
        result: null,
      });
      data.requests.push({
        id: 'extra-request',
        createdAt: '2026-09-25T10:00:00Z',
        fragmentCount: 12,
        reports: [],
        enrichments: [],
      });
      await page.getByRole('button', { name: '刷新补证状态' }).click();
      const requestHeaders = requests.locator(':scope > tbody > tr > th');
      await expect(requestHeaders).toHaveCount(2);
      await expect(requestHeaders.first()).toContainText('extra-re');
      const requestsBeforeTableControls = commands.length;
      const createdHeader = requests.getByRole('button', { name: '创建时间', exact: true });
      await createdHeader.focus();
      await page.keyboard.press('Enter');
      await expect(requestHeaders.first()).toContainText(originalRequest.id.slice(0, 8));
      await expect(requests.getByRole('columnheader', { name: /创建时间/ })).toHaveAttribute(
        'aria-sort',
        'ascending',
      );
      await page
        .getByRole('combobox', { name: '补证请求状态', exact: true })
        .selectOption('登记与核验已完成');
      await expect(requestHeaders).toHaveCount(1);
      await page.getByLabel('搜索补证请求', { exact: true }).fill('不存在的补证请求');
      await expect(requests.getByText('没有匹配的已加载补证请求。')).toBeVisible();
      await page
        .getByRole('group', { name: '补证请求筛选', exact: true })
        .getByRole('button', { name: '重置筛选与排序' })
        .click();
      await expect(requestHeaders.first()).toContainText('extra-re');
      await expect(enrichmentTasks).toBeVisible();
      await enrichmentTasks.getByRole('button', { name: '费用', exact: true }).click();
      await expect(enrichmentTasks.getByRole('rowheader').first()).toContainText('extra-en');
      await enrichmentTasks.getByRole('button', { name: '费用', exact: true }).click();
      await expect(enrichmentTasks.getByRole('rowheader').first()).toContainText(
        originalTask.id.slice(0, 8),
      );
      await page
        .getByRole('combobox', { name: '补证 AI 补全任务状态', exact: true })
        .selectOption('completed');
      await page.getByLabel('搜索补证 AI 补全任务', { exact: true }).fill('Ada');
      await expect(enrichmentTasks.getByRole('rowheader')).toHaveCount(1);
      await page.getByLabel('搜索补证 AI 补全任务', { exact: true }).fill('不存在');
      await expect(enrichmentTasks.getByText('没有匹配的已加载任务。')).toBeVisible();
      await page
        .getByRole('group', { name: '补证 AI 补全任务筛选', exact: true })
        .getByRole('button', { name: '重置筛选与排序' })
        .click();
      await expect(enrichmentTasks.getByRole('rowheader')).toHaveCount(2);
      assert.equal(commands.length, requestsBeforeTableControls);
      const requestStatus = page.getByRole('combobox', { name: '补证请求状态', exact: true });
      await requestStatus.selectOption('补证材料已保存');
      await expect(requestHeaders).toHaveCount(1);
      // Refresh removes the final record in the selected state. The selector must
      // still show that state, not silently display "all" while filtering it out.
      data.requests[1].enrichments = [
        { ...originalTask, id: 'changed-state-task', status: 'pending', result: null },
      ];
      await page.getByRole('button', { name: '刷新补证状态' }).click();
      await expect(requestStatus).toHaveValue('补证材料已保存');
      await expect(requestStatus.locator('option:checked')).toHaveText('补证材料已保存');
      await expect(requests.getByText('没有匹配的已加载补证请求。')).toBeVisible();
      await page
        .getByRole('group', { name: '补证请求筛选', exact: true })
        .getByRole('button', { name: '重置筛选与排序' })
        .click();
      await expect(requestStatus).toHaveValue('all');
      await expect(requestHeaders).toHaveCount(2);
      await expect(requests.getByText('AI 补全：已排队', { exact: true })).toBeVisible();
      assert.equal(commands.length, requestsBeforeTableControls);
      data.enabled = false;
      await page.getByRole('button', { name: '刷新补证状态' }).click();
      await expect(page.getByText('写入未启用，只读查看已保存材料。')).toBeVisible();
      await expect(create).toBeDisabled();
    } finally {
      await browser?.close();
      await new Promise((resolve) => server.close(resolve));
    }
  },
);
