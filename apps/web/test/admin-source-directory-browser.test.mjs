import test from 'node:test';
import process from 'node:process';
import { fileURLToPath, URL } from 'node:url';
import { build } from 'esbuild';
import { expect, chromium } from '@playwright/test';

test(
  'source directory filters, sorts and opens only the selected site references',
  {
    skip: process.env.HZENSE_SOURCE_DIRECTORY_BROWSER_TEST !== '1',
  },
  async (t) => {
    const { outputFiles } = await build({
      stdin: {
        contents: `
        import { createRoot } from 'react-dom/client';
        import { AdminSourceDirectory } from './components/admin-source-directory';
        import { buildSourceDirectory } from './lib/source-directory';
        const registry = [
          { id: 'research', name: '研究实验室', type: 'research_lab', active: true, allowed_hosts: ['research.org'] },
          { id: 'weekly', name: '每周通讯', type: 'newsletter', active: false, allowed_hosts: ['bulletin.weekly.net', 'partners.research.org'] },
        ];
        const signals = [
          { id: 'signal-one', title: '实验进展', date: '2026-11-18', topicIds: ['topic-language-models'], sources: [{ url: 'https://lab.research.org/post/1' }] },
          { id: 'signal-two', title: '论文发表', date: '2026-11-19', topicIds: ['topic-semiconductors'], sources: [{ url: 'https://news.research.org/post/2' }, { url: 'https://press.com/story' }] },
          { id: 'signal-three', title: '主题待识别的信号', date: '2026-11-20', topicIds: [], sources: [{ url: 'https://research.org/post/3' }] },
        ];
        const topics = [
          { id: 'topic-artificial-intelligence', name: '人工智能', parentId: null },
          { id: 'topic-language-models', name: '语言模型', parentId: 'topic-artificial-intelligence' },
          { id: 'topic-semiconductors', name: '半导体', parentId: null },
          { id: 'topic-robotics', name: '机器人', parentId: null },
        ];
        createRoot(document.getElementById('root')).render(<AdminSourceDirectory directory={buildSourceDirectory(registry, signals, topics)}/>);
      `,
        resolveDir: fileURLToPath(new URL('..', import.meta.url)),
        loader: 'tsx',
      },
      outfile: 'directory.js',
      platform: 'browser',
      format: 'esm',
      jsx: 'automatic',
      bundle: true,
      write: false,
      define: { 'process.env': '{}', 'process.env.NODE_ENV': '"production"' },
    });
    const browser = await chromium.launch();
    t.after(() => browser.close());
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await page.route('http://127.0.0.1/**', (route) => {
      const filename = new URL(route.request().url()).pathname.slice(1);
      const file = outputFiles.find((entry) => entry.path.endsWith('/' + filename));
      if (file)
        return route.fulfill({
          body: file.text,
          contentType: filename.endsWith('.js') ? 'text/javascript' : 'text/css',
        });
      return route.fulfill({
        contentType: 'text/html',
        body: '<meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/directory.css"><main id="root"></main><script type="module" src="/directory.js"></script>',
      });
    });
    await page.goto('http://127.0.0.1');

    const table = page.getByRole('table', { name: '信源站点' });
    const rows = table.getByRole('rowheader');
    await expect(rows).toHaveText(['▸research.org', '▸press.com', 'weekly.net']);
    await expect(table.getByRole('link')).toHaveCount(0);
    await table.getByRole('button', { name: '查看 research.org 的引用明细' }).press('Enter');
    await expect(table.getByRole('link', { name: '实验进展' })).toHaveAttribute(
      'href',
      '/signals/signal-one',
    );
    const original = table.getByRole('link', { name: 'https://lab.research.org/post/1' });
    await expect(original).toHaveAttribute('target', '_blank');
    await expect(original).toHaveAttribute('rel', 'noopener noreferrer');
    await table.getByRole('button', { name: '收起 research.org 的引用明细' }).click();
    await expect(table.getByRole('link')).toHaveCount(0);

    const status = page.getByRole('combobox', { name: '信源状态' });
    await status.selectOption('registered');
    await expect(rows).toHaveCount(2);
    await status.selectOption('uncited');
    await expect(rows).toHaveText(['weekly.net']);
    await expect(table.getByText('行业通讯 · 已停用')).toBeVisible();
    await status.selectOption('unregistered');
    await expect(rows).toHaveText(['▸press.com']);
    await page.getByRole('button', { name: '重置筛选与排序' }).click();
    const search = page.getByRole('searchbox', { name: '搜索信源' });
    await search.fill('bulletin.weekly.net');
    await expect(rows).toHaveText(['weekly.net']);
    await search.fill('partners.research.org');
    await expect(rows).toHaveText(['▸research.org']);
    await search.fill('lab.research.org 研究实验室');
    await expect(rows).toHaveText(['▸research.org']);
    await search.fill('没有该站点');
    await expect(table.getByText('没有符合当前条件的信源。')).toBeVisible();
    await search.fill('');
    await table.getByRole('button', { name: '关联信号数' }).click();
    await expect(rows.first()).toHaveText('weekly.net');

    const fields = page.getByRole('group', { name: '按一级领域查看' });
    await fields.getByRole('button', { name: '人工智能，1 个站点' }).click();
    await expect(rows).toHaveText(['▸research.org']);
    const site = table.getByRole('row', { name: /research\.org/ });
    await expect(site.getByRole('listitem')).toHaveText(['人工智能', '半导体', '待归类']);
    await expect(site.getByRole('cell').nth(2)).toHaveText('1');
    await expect(site.getByRole('cell').nth(3)).toHaveText('1');
    await expect(site.getByRole('cell').last()).toHaveText('2026-11-18');
    await site.getByRole('button').click();
    await expect(table.getByRole('link', { name: '实验进展' })).toBeVisible();
    await expect(table.getByRole('link', { name: '论文发表' })).toHaveCount(0);
    await status.selectOption('unregistered');
    await expect(rows).toHaveCount(0);
    await fields.getByRole('button', { name: '半导体，2 个站点' }).click();
    await expect(rows).toHaveText(['▸press.com']);
    await search.fill('press.com');
    await expect(page.getByRole('status')).toHaveText('半导体 · 显示 1 / 2 个站点');
    await page.getByRole('button', { name: '重置筛选与排序' }).click();
    await expect(
      fields.getByRole('button', { name: '全部站点，3 个站点', pressed: true }),
    ).toBeVisible();
    await expect(rows).toHaveText(['▸research.org', '▸press.com', 'weekly.net']);
    await fields.getByRole('button', { name: '待归类，1 个站点' }).click();
    await expect(rows).toHaveText(['▸research.org']);
    await fields.getByRole('button', { name: '无引用，1 个站点' }).click();
    await expect(rows).toHaveText(['weekly.net']);
    await fields.getByRole('button', { name: '机器人，0 个站点' }).click();
    await expect(rows).toHaveCount(0);
  },
);
