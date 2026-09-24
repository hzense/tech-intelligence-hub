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
        contents: `import {createRoot} from 'react-dom/client';import {CandidateMaterialWorkflow} from './components/candidate-material-workflow';createRoot(document.getElementById('root')).render(<CandidateMaterialWorkflow runId="11111111-1111-4111-8111-111111111111" candidateIndex={0} materialHash={'a'.repeat(64)} onRegistered={()=>{document.getElementById('notice').textContent='parent refreshed'}}/>);`,
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
        requests: [],
        sources: [1, 2, 3, 4].map((n) => ({
          batchId: `batch-${n}`,
          itemId: `item-${n}`,
          name: `官方来源 ${n}`,
          sourceUrl: `https://example.com/${n}`,
        })),
      };
      const commands = [];
      let unknown = true;
      await page.route('**/api/admin/candidate-materials**', async (route) => {
        if (route.request().method() === 'GET') {
          await route.fulfill({ json: data });
          return;
        }
        const body = route.request().postDataJSON();
        commands.push(body);
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
      await expect(page.getByRole('status')).toContainText('提交结果未知');
      await expect(page.getByRole('checkbox', { name: '官方来源 1' })).toBeDisabled();
      await page.getByRole('button', { name: '使用原请求继续建立' }).click();
      await expect(
        page.getByText('等待独立材料核验报告。尚未登记，也未获得公开许可。'),
      ).toBeVisible();
      assert.equal(commands[0].request.id, commands[1].request.id);
      assert.deepEqual(commands[0], commands[1]);
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
      await expect(page.getByRole('status')).toContainText('独立核验已提交');
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
      assert.equal(commands.filter((command) => command.action === 'confirm').length, 1);
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
        true,
      );
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
