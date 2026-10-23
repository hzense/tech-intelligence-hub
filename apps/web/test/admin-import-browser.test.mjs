import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { Buffer } from 'node:buffer';
import { readFile } from 'node:fs/promises';
import { fileURLToPath, URL } from 'node:url';
import process from 'node:process';
import { build } from 'esbuild';
import { chromium, expect } from '@playwright/test';
const enabled = process.env.HZENSE_IMPORT_BROWSER_TEST === '1';
test(
  'actual import UI: unavailable state, private URL batch, processing and escaped output on desktop/mobile',
  { skip: !enabled },
  async (t) => {
    const compiled = await build({
      stdin: {
        contents: `import {createRoot} from 'react-dom/client';import {AdminImports} from './components/admin-imports';createRoot(document.getElementById('root')).render(<AdminImports configured={!location.search.includes('off')} recoveryBatchId={new URLSearchParams(location.search).get('batchId')??undefined} diagnostics={{enabled:!location.search.includes('off'),valid:true,issues:[]}} />);`,
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
    // Include the production reset: it removes native file-button borders and backgrounds.
    assets.set(
      '/preflight.css',
      await readFile(fileURLToPath(import.meta.resolve('tailwindcss/preflight.css'))),
    );
    const globals = await readFile(new URL('../app/globals.css', import.meta.url), 'utf8');
    assets.set('/globals.css', globals.replace(/^@import\s+['"]tailwindcss['"];\s*/m, ''));
    let batches = [];
    const commands = [];
    const server = createServer(async (req, res) => {
      if (assets.has(req.url)) {
        res.setHeader('Content-Type', req.url.endsWith('.css') ? 'text/css' : 'text/javascript');
        res.end(assets.get(req.url));
        return;
      }
      const requestUrl = new URL(req.url, 'http://localhost');
      if (requestUrl.pathname === '/api/admin/imports') {
        res.setHeader('Content-Type', 'application/json');
        if (req.method === 'GET') {
          const before = requestUrl.searchParams.get('before');
          const offset = before ? batches.findIndex((batch) => batch.id === before) + 1 : 0;
          const view = requestUrl.searchParams.get('view');
          const filtered = batches
            .slice(offset)
            .filter(
              (batch) => ['completed', 'cancelled'].includes(batch.status) === (view === 'history'),
            );
          res.end(JSON.stringify({ batches: filtered.slice(0, 50) }));
          return;
        }
        const chunks = [];
        for await (const chunk of req) chunks.push(chunk);
        const value = JSON.parse(Buffer.concat(chunks).toString());
        commands.push(value);
        if (value.action === 'detail') {
          if (value.batchId === '11111111-1111-1111-1111-111111111111') {
            res.end(JSON.stringify(batches[0]));
            return;
          }
          const batch = batches.find((entry) => entry.id === value.batchId);
          if (!batch) {
            res.statusCode = 404;
            res.end(JSON.stringify({ error: 'not_found' }));
          } else res.end(JSON.stringify(batch));
          return;
        }
        if (value.action === 'create') {
          batches = [
            {
              id: value.request.id,
              status: 'queued',
              cancelled: false,
              intent: value.request.intent,
              items: [
                {
                  id: '22222222-2222-4222-8222-222222222222',
                  kind: 'url',
                  status: 'queued',
                  declaration: { url: 'https://example.com/research' },
                },
              ],
            },
            ...batches,
          ];
          res.end(JSON.stringify(batches[0]));
          return;
        }
        if (value.action === 'run') {
          batches[0].status = 'completed';
          batches[0].items[0].status = 'completed';
          res.end('{}');
          return;
        }
        if (value.action === 'output') {
          res.end(
            JSON.stringify({
              classification: 'private',
              fragments: [
                { text: '<script>window.hacked=true</script>', locator: { paragraph: 1 } },
              ],
            }),
          );
          return;
        }
        if (value.action === 'delete') {
          batches = batches.filter((batch) => batch.id !== value.batchId);
          res.end('{}');
          return;
        }
        if (value.action === 'cancel') {
          const batch = batches.find((entry) => entry.id === value.batchId);
          batch.cancelled = true;
          batch.status = 'cancelled';
          res.end('{}');
          return;
        }
        res.statusCode = 400;
        res.end('{}');
        return;
      }
      res.setHeader('Content-Type', 'text/html');
      res.end(
        '<!doctype html><html lang="zh"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/preflight.css"><link rel="stylesheet" href="/globals.css"><link rel="stylesheet" href="/entry.css"><div id="root"></div><script type="module" src="/entry.js"></script></html>',
      );
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    t.after(() => new Promise((resolve) => server.close(resolve)));
    const origin = `http://127.0.0.1:${server.address().port}`;
    const browser = await chromium.launch();
    t.after(() => browser.close());
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.route('**/*', (route) =>
      route.request().url().startsWith(origin) ? route.continue() : route.abort(),
    );
    await page.goto(`${origin}/?off`);
    await expect(page.getByRole('heading', { name: '文档与链接批量导入' })).toBeVisible();
    await expect(page.getByRole('button', { name: '创建并上传' })).toBeDisabled();
    const fileInput = page.getByLabel('上传文档（最多 20 个，每个 25 MiB）');
    await expect(fileInput).toBeDisabled();
    await expect(fileInput).toHaveCSS('opacity', '0.5');
    await page.goto(origin);
    await expect(
      page.getByText('仅检查配置格式，不代表数据库认证、权限及解析验收已通过。'),
    ).not.toBeVisible();
    await page.getByText('配置详情', { exact: true }).click();
    await expect(
      page.getByText('仅检查配置格式，不代表数据库认证、权限及解析验收已通过。'),
    ).toBeVisible();
    await page.getByText('配置详情', { exact: true }).click();
    await expect(fileInput).toBeEnabled();
    for (const width of [1280, 390]) {
      await page.setViewportSize({ width, height: 844 });
      await page.mouse.move(0, 0);
      const buttonStyle = await fileInput.evaluate((input) => {
        const style = globalThis.getComputedStyle(input, '::file-selector-button');
        return {
          background: style.backgroundColor,
          border: style.borderTopWidth,
          minHeight: style.minHeight,
        };
      });
      assert.deepEqual(buttonStyle, {
        background: 'rgb(0, 71, 171)',
        border: '1px',
        minHeight: '44px',
      });
      await page.getByLabel('HTTPS 链接').focus();
      await page.keyboard.press('Shift+Tab');
      await expect(fileInput).toBeFocused();
      await expect(fileInput).toHaveCSS('outline-style', 'solid');
      const chooserEvent = page.waitForEvent('filechooser');
      if (width === 1280) await fileInput.click({ position: { x: 20, y: 20 } });
      else await fileInput.press('Enter');
      const chooser = await chooserEvent;
      assert.equal(chooser.isMultiple(), true);
      await chooser.setFiles([
        {
          name: 'sample-one.md',
          mimeType: 'text/markdown',
          buffer: Buffer.from('Synthetic sample one'),
        },
        {
          name: 'sample-two.txt',
          mimeType: 'text/plain',
          buffer: Buffer.from('Synthetic sample two'),
        },
      ]);
      await expect(
        page.getByText('已选择 2 个文件、0 个不重复链接。整个批次须通过检查才能提交。'),
      ).toBeVisible();
      assert.equal(
        await page.evaluate(
          () => globalThis.document.documentElement.scrollWidth <= globalThis.innerWidth,
        ),
        true,
      );
      assert.equal(commands.length, 0, 'Selecting files must not create a batch or upload');
      await fileInput.setInputFiles([]);
    }
    await page.setViewportSize({ width: 1280, height: 844 });
    await expect(page.getByLabel('后续意图')).toHaveCount(0);
    if (process.env.HZENSE_IMPORT_SCREENSHOTS === '1')
      await page.screenshot({ path: '/tmp/hzense-import-layout-desktop.png', fullPage: true });
    await page
      .getByLabel('HTTPS 链接')
      .fill('https://example.com/research\nhttps://example.com/research');
    await expect(
      page.getByText('已选择 0 个文件、1 个不重复链接。整个批次须通过检查才能提交。'),
    ).toBeVisible();
    await page.getByRole('button', { name: '创建并上传' }).click();
    await expect(page.getByRole('button', { name: '处理（使用已配置预算）' })).toBeVisible();
    assert.equal(commands[0].request.intent, 'preview');
    await page.getByRole('button', { name: '处理（使用已配置预算）' }).click();
    await expect(page.getByText('暂无当前任务。可新建导入，或查看历史记录。')).toBeVisible();
    await page.getByRole('button', { name: '历史记录', exact: true }).click();
    await expect(page.getByRole('button', { name: '历史记录', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(page.getByRole('button', { name: '取消未完成项' })).toHaveCount(0);
    await expect(page.getByRole('link', { name: '前往生成页选择资料' })).toHaveAttribute(
      'href',
      '/admin/signal-generation',
    );
    await page.getByRole('button', { name: '查看私有解析结果' }).click();
    await expect(page.getByRole('heading', { name: '私有解析结果' })).toBeVisible();
    await expect(page.getByRole('dialog')).toBeVisible();
    if (process.env.HZENSE_IMPORT_SCREENSHOTS === '1')
      await page.screenshot({ path: '/tmp/hzense-import-result-desktop.png' });
    await expect(page.getByRole('link', { name: '前往 AI 信号生成' })).toHaveAttribute(
      'href',
      '/admin/signal-generation',
    );
    await expect(
      page.getByText('<script>window.hacked=true</script>', { exact: true }),
    ).toBeVisible();
    assert.equal(await page.evaluate(() => globalThis.hacked), undefined);
    await page.setViewportSize({ width: 390, height: 844 });
    if (process.env.HZENSE_IMPORT_SCREENSHOTS === '1')
      await page.screenshot({ path: '/tmp/hzense-import-result-mobile.png' });
    assert.equal(
      await page.evaluate(
        () => globalThis.document.documentElement.scrollWidth <= globalThis.innerWidth,
      ),
      true,
    );
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).not.toBeVisible();
    await expect(page.getByRole('button', { name: '查看私有解析结果' })).toBeFocused();
    assert.equal(commands.filter((c) => c.action === 'run').length, 1);
    batches = Array.from({ length: 51 }, (_, index) => ({
      id: `batch-${index}`,
      status: 'failed',
      cancelled: false,
      intent: 'preview',
      items: [
        {
          id: `item-${index}`,
          kind: 'url',
          status: 'failed',
          fence: 5,
          declaration: { url: `https://example.com/research-${index}` },
        },
      ],
    }));
    await page.reload();
    await page.getByRole('button', { name: '更早批次' }).click();
    await expect(page.getByText('批次 batch-50', { exact: true })).toBeVisible();
    await expect(page.getByText('已达 5 次尝试上限，不能再次重试。')).toBeVisible();
    await expect(page.getByRole('button', { name: /重试/ })).toHaveCount(0);
    await page.getByRole('button', { name: '取消未完成项' }).click();
    await expect(page.getByText('本页暂无任务，可返回较新批次。')).toBeVisible();
    await expect(page.getByText('第 2 页')).toBeVisible();
    await page.getByRole('button', { name: '较新批次' }).click();
    await expect(page.getByText('批次 batch-0', { exact: true })).toBeVisible();
    await expect(page.getByText('第 1 页')).toBeVisible();
    await page.getByRole('button', { name: '历史记录', exact: true }).click();
    await expect(page.getByText('已取消', { exact: true })).toBeVisible();
    await expect(page.getByText('第 1 页')).toBeVisible();
    await expect(page.getByRole('button', { name: '更早批次' })).toBeDisabled();
    await page.getByRole('button', { name: '当前任务', exact: true }).click();
    await expect(page.getByText('批次 batch-0', { exact: true })).toBeVisible();
    batches = [
      {
        id: 'expired-batch',
        status: 'failed',
        cancelled: false,
        intent: 'preview',
        items: [
          {
            id: 'expired-original',
            kind: 'file',
            status: 'failed',
            fence: 1,
            error_code: 'source_unavailable',
            declaration: { name: 'expired.txt' },
          },
        ],
      },
    ];
    await page.reload();
    await expect(page.getByText('原件已过期或不存在，请新建批次重新导入。')).toBeVisible();
    await expect(page.getByRole('button', { name: '重新排队' })).toHaveCount(0);
    batches[0].items[0].error_code = 'worker_unavailable';
    await page.reload();
    await expect(page.getByRole('button', { name: '重新排队' })).toHaveCount(0);
    await expect(page.getByText('原件不保留，请新建批次重新导入。')).toBeVisible();
    batches = [
      {
        id: 'canonical',
        status: 'completed',
        cancelled: false,
        items: [{ id: 'one', status: 'completed', declaration: { name: '原始资料.txt' } }],
      },
      {
        id: 'duplicate',
        status: 'completed',
        cancelled: false,
        items: [
          {
            id: 'two',
            status: 'completed',
            duplicate_of: 'one',
            declaration: { name: '重复副本.txt' },
          },
        ],
      },
    ];
    await page.reload();
    await page.getByRole('button', { name: '历史记录', exact: true }).click();
    await expect(page.getByRole('heading', { name: '原始资料.txt', exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: '重复副本.txt', exact: true })).toHaveCount(0);
    await page.getByRole('checkbox', { name: /显示重复资料/ }).check();
    const duplicate = page
      .locator('section')
      .filter({ has: page.getByRole('heading', { name: '重复副本.txt', exact: true }) })
      .last();
    await expect(duplicate).toBeVisible();
    page.once('dialog', (dialog) => dialog.dismiss());
    await duplicate.getByRole('button', { name: '删除任务', exact: true }).click();
    await expect(duplicate).toBeVisible();
    page.once('dialog', (dialog) => dialog.accept());
    await duplicate.getByRole('button', { name: '删除任务', exact: true }).click();
    await expect(page.getByRole('heading', { name: '重复副本.txt', exact: true })).toHaveCount(0);
    await expect(page.getByRole('heading', { name: '原始资料.txt', exact: true })).toBeVisible();
    assert.equal(commands.filter((command) => command.action === 'delete').length, 1);

    const recoveryId = '3d6f8ed7-022c-9dcf-b52b-eea13542a727';
    const failedBatch = {
      id: recoveryId,
      status: 'failed',
      cancelled: false,
      items: [
        {
          id: '7868dc87-8180-49a3-b513-4d0daa4f1de0',
          kind: 'url',
          status: 'failed',
          error_code: 'fetch_failed',
          fetch_diagnostic: { reason: 'http_status', status: 403 },
          declaration: { url: 'https://example.com/older-blocked-source' },
        },
        {
          id: '7868dc87-8180-49a3-b513-4d0daa4f1de1',
          kind: 'url',
          status: 'failed',
          error_code: 'fetch_failed',
          declaration: { url: 'https://example.com/older-unknown-source' },
        },
      ],
    };
    batches = [
      ...Array.from({ length: 51 }, (_, index) => ({
        id: `newer-batch-${index}`,
        status: 'queued',
        cancelled: false,
        items: [
          {
            id: `newer-item-${index}`,
            kind: 'url',
            status: 'queued',
            declaration: { url: `https://example.com/newer-${index}` },
          },
        ],
      })),
      failedBatch,
    ];
    const beforeRecoveryCommands = commands.length;
    await page.goto(`${origin}/?batchId=${recoveryId}`);
    const recovery = page.getByRole('region', { name: '采集来源处理' });
    await expect(recovery).toBeVisible();
    await expect(
      recovery.getByText('https://example.com/older-blocked-source', { exact: true }),
    ).toBeVisible();
    await expect(recovery.getByText(/原文网站拒绝程序访问（HTTP 403）/)).toBeVisible();
    await expect(recovery.getByText(/该记录未保存具体 HTTP 或网络原因/)).toBeVisible();
    assert.deepEqual(commands.slice(beforeRecoveryCommands), [
      { action: 'detail', batchId: recoveryId },
    ]);
    await expect(page.getByText(`批次 ${recoveryId}`, { exact: true })).toHaveCount(0);
    await recovery.getByRole('link', { name: '导入替代来源或文档' }).click();
    await expect(page).toHaveURL(new RegExp('#import-new-batch$'));
    assert.equal(
      commands.length,
      beforeRecoveryCommands + 1,
      'Opening recovery never creates, retries, parses or calls AI',
    );
    await page.getByLabel('HTTPS 链接').fill('https://example.com/replacement-source');
    await page.getByRole('button', { name: '创建并上传' }).click();
    await expect(
      page.getByText('原件已接收。点击「处理」执行隔离解析；不会自动发布。'),
    ).toBeVisible();
    assert.equal(
      batches.find((entry) => entry.id === recoveryId),
      failedBatch,
    );
    assert.equal(
      failedBatch.status,
      'failed',
      'Original batch history is not rewritten by replacement import',
    );
    const recoveryWrites = commands
      .slice(beforeRecoveryCommands)
      .filter((command) => command.action !== 'detail');
    assert.equal(recoveryWrites.length, 1);
    assert.equal(recoveryWrites[0].action, 'create');
    assert.equal(recoveryWrites[0].request.intent, 'preview');

    failedBatch.items.forEach((item) => {
      item.status = 'unknown';
      delete item.error_code;
      delete item.fetch_diagnostic;
    });
    await page.goto(`${origin}/?batchId=${recoveryId}`);
    await expect(
      recovery.getByText('该资料尚未确认结束，请先核对原任务，不要为它重复导入或调用 AI。').first(),
    ).toBeVisible();
    await expect(recovery.getByRole('link', { name: '导入替代来源或文档' })).toHaveCount(0);

    await page.goto(`${origin}/?batchId=11111111-1111-1111-1111-111111111111`);
    await expect(page.getByText('无法读取原批次；可能已删除或不属于当前账号。')).toBeVisible();
    await expect(recovery.getByText('https://example.com/research', { exact: true })).toHaveCount(
      0,
    );

    const beforeMissing = commands.length;
    await page.goto(`${origin}/?batchId=00000000-0000-0000-0000-000000000000`);
    await expect(page.getByText('无法读取原批次；可能已删除或不属于当前账号。')).toBeVisible();
    await expect(page.getByRole('link', { name: '导入替代来源或文档' })).toHaveCount(0);
    assert.deepEqual(
      commands.slice(beforeMissing).map((command) => command.action),
      ['detail'],
    );
    const beforeInvalid = commands.length;
    await page.goto(`${origin}/?batchId=invalid`);
    await expect(page.getByRole('heading', { name: '文档与链接批量导入' })).toBeVisible();
    await expect(page.getByRole('region', { name: '采集来源处理' })).toHaveCount(0);
    assert.equal(commands.length, beforeInvalid);
    await page.goto(`${origin}/?off&batchId=${recoveryId}`);
    await expect(
      page.getByText('导入服务未就绪，暂不能读取原批次。请先完成配置，不会自动执行任何任务。'),
    ).toBeVisible();
    assert.equal(commands.length, beforeInvalid);
    assert.deepEqual(errors, []);
  },
);
