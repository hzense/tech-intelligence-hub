import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { Buffer } from 'node:buffer';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import process from 'node:process';
import { build } from 'esbuild';
import { chromium, expect } from '@playwright/test';
/* global document, window */

const enabled = process.env.HZENSE_CANDIDATE_REVIEW_BROWSER_TEST === '1';
const runId = '11111111-1111-4111-8111-111111111111';
const materialHash = 'a'.repeat(64);
// Actual React components + loopback synthetic API only. No real database, AI,
// publication or credential use; server receipts are deliberately fixture data.
test(
  'candidate review browser: responsive edit, persisted revisions, conflict and safe same-key retries',
  { skip: !enabled },
  async (t) => {
    const compiled = await build({
      stdin: {
        contents: `import {createRoot} from 'react-dom/client';import {CandidateReviewEditor} from './components/candidate-review-editor';import {CandidatePublicationActions} from './components/candidate-publication-actions';const props={runId:'${runId}',candidateIndex:0,materialHash:'${materialHash}'};createRoot(document.getElementById('root')).render(location.search.includes('publication')?<CandidatePublicationActions {...props}/>:<CandidateReviewEditor {...props} initialDraft={{title:'合成候选标题',summary:'用于本地验收的摘要。',eventDate:'2026-09-21'}}/>);`,
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
    });
    const assets = new Map(
      compiled.outputFiles.map((f) => [`/${f.path.split('/').at(-1)}`, f.contents]),
    );
    let reviews = [],
      configured = true,
      mode = 'normal';
    const commands = [],
      saved = new Map();
    const server = createServer(async (req, res) => {
      if (assets.has(req.url)) {
        res.setHeader('Content-Type', req.url.endsWith('.css') ? 'text/css' : 'text/javascript');
        res.end(assets.get(req.url));
        return;
      }
      if (req.url.startsWith('/api/admin/candidate-review')) {
        res.setHeader('Content-Type', 'application/json');
        if (req.method === 'GET') {
          res.end(
            JSON.stringify({
              configured,
              reviews,
              catalog: { people: [], organizations: [], topics: [], evidence: [] },
            }),
          );
          return;
        }
        const chunks = [];
        for await (const chunk of req) chunks.push(chunk);
        const body = JSON.parse(Buffer.concat(chunks).toString());
        commands.push(body);
        if (body.action === 'save') {
          if (mode === 'conflict') {
            res.statusCode = 409;
            res.end(JSON.stringify({ error: 'revision_conflict' }));
            return;
          }
          let record = saved.get(body.request.requestId);
          if (!record) {
            record = {
              ...body.request,
              revision: reviews.length + 1,
              material_hash: materialHash,
              created_at: '2026-09-21T12:00:00Z',
            };
            saved.set(body.request.requestId, record);
            reviews = [record, ...reviews];
          }
          res.end(JSON.stringify({ review: record }));
          return;
        }
        if (body.action === 'inspect') {
          res.end(
            JSON.stringify({
              readiness: {
                ready: false,
                status: 'published',
                blocked: ['合成历史发布回执；非生产数据。'],
                receipt: { publication_revision: 1 },
              },
            }),
          );
          return;
        }
        if (body.action === 'withdraw') {
          res.end(JSON.stringify({ outcome: 'apply', current_public: false }));
          return;
        }
        res.statusCode = 400;
        res.end(JSON.stringify({ error: 'fixture_action_not_allowed' }));
        return;
      }
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.end(
        '<!doctype html><html lang="zh"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/entry.css"><style>body{margin:0;padding:16px;font-family:system-ui;background:#f8fafc;color:#101d36}*{box-sizing:border-box}#root{max-width:1100px;margin:auto}button,input,textarea{font:inherit}</style><div id="root"></div><script type="module" src="/entry.js"></script></html>',
      );
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    t.after(() => new Promise((resolve) => server.close(resolve)));
    const browser = await chromium.launch();
    t.after(() => browser.close());
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    let dropNetwork = false;
    await page.route('**/api/admin/candidate-review', async (route) => {
      if (dropNetwork && route.request().method() === 'POST') {
        dropNetwork = false;
        await route.fetch(); // Synthetic server commits, but the client loses its response.
        await route.abort('failed');
      } else await route.continue();
    });
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('dialog', (dialog) => dialog.accept());
    const url = `http://127.0.0.1:${server.address().port}`;
    const artifacts = await mkdtemp(join(tmpdir(), 'hzense-review-browser-'));
    t.diagnostic(`Synthetic browser screenshots: ${artifacts}`);
    await page.goto(url);
    await expect(page.getByRole('button', { name: '保存草稿', exact: true })).toBeEnabled();
    await page
      .getByRole('textbox', { name: '标题（最多 80 字）', exact: true })
      .fill('人工补充标题');
    await page
      .getByRole('textbox', { name: '审核意见 / 补证要求', exact: true })
      .fill('来源还需补证。');
    await page.getByRole('button', { name: '保存草稿', exact: true }).click();
    await expect(page.getByRole('status')).toContainText('已保存 r1');
    await page.reload();
    await expect(
      page.getByRole('textbox', { name: '标题（最多 80 字）', exact: true }),
    ).toHaveValue('人工补充标题');
    await expect(
      page.getByRole('textbox', { name: '审核意见 / 补证要求', exact: true }),
    ).toHaveValue('来源还需补证。');
    await page.screenshot({ path: join(artifacts, 'desktop.png'), fullPage: true });
    mode = 'conflict';
    await page
      .getByRole('textbox', { name: '摘要（最多 500 字）', exact: true })
      .fill('冲突时必须保留的未保存文字。');
    await page.getByRole('button', { name: '保存草稿', exact: true }).click();
    await expect(page.getByRole('status')).toContainText('保存版本冲突');
    await expect(
      page.getByRole('textbox', { name: '摘要（最多 500 字）', exact: true }),
    ).toHaveValue('冲突时必须保留的未保存文字。');
    await expect(page.getByRole('button', { name: '保存草稿', exact: true })).toBeDisabled();
    mode = 'normal';
    await page.getByRole('button', { name: '加载最新保存版本', exact: true }).click();
    await expect(page.getByRole('button', { name: '保存草稿', exact: true })).toBeEnabled();
    await page
      .getByRole('textbox', { name: '摘要（最多 500 字）', exact: true })
      .fill('网络未知后用相同请求编号恢复。');
    dropNetwork = true;
    const before = commands.length;
    await page.getByRole('button', { name: '保存草稿', exact: true }).click();
    await expect(page.getByRole('button', { name: '保存草稿', exact: true })).toBeEnabled();
    await expect(
      page.getByRole('textbox', { name: '摘要（最多 500 字）', exact: true }),
    ).toHaveValue('网络未知后用相同请求编号恢复。');
    await page.getByRole('button', { name: '保存草稿', exact: true }).click();
    await expect(page.getByRole('status')).toContainText('已保存 r2');
    assert.equal(commands[before].request.requestId, commands[before + 1].request.requestId);
    assert.equal(reviews.length, 2);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.reload();
    await expect(
      page.getByRole('textbox', { name: '摘要（最多 500 字）', exact: true }),
    ).toHaveValue('网络未知后用相同请求编号恢复。');
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      true,
    );
    await page.screenshot({ path: join(artifacts, 'mobile.png'), fullPage: true });
    // New rejection must not prevent emergency withdrawal of the historical release.
    reviews = [
      { ...reviews[0], revision: 2, decision: 'rejected' },
      { ...reviews[1], revision: 1, decision: 'submit_verification' },
    ];
    configured = false;
    await page.goto(`${url}/?publication`);
    await page.getByRole('textbox', { name: /检查 \/ 撤回的原审核版本号/ }).fill('1');
    await page.getByRole('button', { name: '检查发布资格', exact: true }).click();
    await expect(page.getByRole('status')).toContainText('r1');
    assert.equal(commands.at(-1).action, 'inspect');
    assert.equal(commands.at(-1).request.expectedReviewRevision, 1);
    await expect(
      page.getByRole('button', { name: '转换为正式私有候选', exact: true }),
    ).toBeDisabled();
    await expect(page.getByRole('button', { name: '正式发布', exact: true })).toBeDisabled();
    await page
      .getByRole('textbox', { name: '当前发布版本号（以最新服务端回执为准）', exact: true })
      .fill('1');
    await page
      .getByRole('combobox', { name: '发布 / 撤回原因', exact: true })
      .selectOption('operator_request');
    await page.getByRole('button', { name: '撤回正式信号', exact: true }).click();
    await expect(page.getByRole('status')).toContainText('请求已成功返回');
    assert.equal(commands.at(-1).action, 'withdraw');
    assert.equal(commands.at(-1).request.expectedReviewRevision, 1);
    assert.deepEqual(errors, []);
  },
);
