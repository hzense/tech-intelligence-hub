import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { Buffer } from 'node:buffer';
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
        contents: `import {createRoot} from 'react-dom/client';import {AdminImports} from './components/admin-imports';createRoot(document.getElementById('root')).render(<AdminImports configured={!location.search.includes('off')} />);`,
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
    let batches = [];
    const commands = [];
    const server = createServer(async (req, res) => {
      if (assets.has(req.url)) {
        res.setHeader('Content-Type', req.url.endsWith('.css') ? 'text/css' : 'text/javascript');
        res.end(assets.get(req.url));
        return;
      }
      if (req.url === '/api/admin/imports') {
        res.setHeader('Content-Type', 'application/json');
        if (req.method === 'GET') {
          res.end(JSON.stringify({ batches }));
          return;
        }
        const chunks = [];
        for await (const chunk of req) chunks.push(chunk);
        const value = JSON.parse(Buffer.concat(chunks).toString());
        commands.push(value);
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
        if (value.action === 'cancel') {
          batches[0].cancelled = true;
          batches[0].status = 'cancelled';
          res.end('{}');
          return;
        }
        res.statusCode = 400;
        res.end('{}');
        return;
      }
      res.setHeader('Content-Type', 'text/html');
      res.end(
        '<!doctype html><html lang="zh"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/entry.css"><div id="root"></div><script type="module" src="/entry.js"></script></html>',
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
    await page.goto(origin);
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
    await page.getByRole('button', { name: '查看私有解析结果' }).click();
    await expect(page.getByRole('heading', { name: '私有解析结果' })).toBeVisible();
    assert.equal(await page.evaluate(() => globalThis.hacked), undefined);
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(
      await page.evaluate(
        () => globalThis.document.documentElement.scrollWidth <= globalThis.innerWidth,
      ),
      true,
    );
    await page.getByRole('button', { name: '取消未完成项' }).click();
    await expect(page.getByRole('heading', { name: '已取消' })).toBeVisible();
    assert.equal(commands.filter((c) => c.action === 'run').length, 1);
    assert.deepEqual(errors, []);
  },
);
