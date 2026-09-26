import { fileURLToPath } from 'node:url';
import { loadContent, type ContentEntry, type FrontMatter } from '@hzense/content';
import { expect, test, type Page } from '@playwright/test';

type DailyEntry = ContentEntry<Extract<FrontMatter, { type: 'daily' }>>;

async function getPublishedDailyEntries(): Promise<DailyEntry[]> {
  const entries = await loadContent({
    contentRoot: fileURLToPath(new URL('../../../content/', import.meta.url)),
    seedRoot: fileURLToPath(new URL('../../../data/seed/', import.meta.url)),
    taxonomyFile: fileURLToPath(new URL('../../../data/taxonomy/taxonomy.yaml', import.meta.url)),
  });
  return entries
    .filter(
      (entry): entry is DailyEntry =>
        entry.frontMatter.type === 'daily' && entry.frontMatter.status === 'published',
    )
    .sort((left, right) => right.frontMatter.date.localeCompare(left.frontMatter.date));
}

function expectedDailyLabel(entry: DailyEntry): string {
  return entry.frontMatter.edition === 'live' ? '正式简报' : '历史回顾样例';
}

async function expectDailyDetail(page: Page, entry: DailyEntry): Promise<void> {
  const detailHref = `/daily/${entry.frontMatter.date}`;
  await page.goto(detailHref);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(entry.frontMatter.title);
  await expect(page.locator('.article-meta')).toContainText(expectedDailyLabel(entry));
  const evidence = page.locator('.daily-evidence');
  await expect(evidence.locator('article')).toHaveCount(entry.frontMatter.signal_refs.length);
  for (const [index, signalId] of entry.frontMatter.signal_refs.entries()) {
    const card = evidence.locator('article').nth(index);
    await expect(card.locator('a[href^="/signals/"]')).toHaveAttribute(
      'href',
      `/signals/${signalId}`,
    );
    const sourceLink = card.locator('a[target="_blank"]');
    await expect(sourceLink).toHaveAttribute('href', /^https:\/\//);
    await expect(sourceLink).toHaveAttribute('rel', 'noopener noreferrer');
  }
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
    'href',
    `https://hzense.com${detailHref}`,
  );
}

async function getFirstDailyHref(page: Page): Promise<string> {
  const href = await page.locator('a.daily-list-feature').first().getAttribute('href');
  expect(href).toMatch(/^\/daily\/[^/]+$/);
  return href as string;
}

test('Radar homepage and historical Daily routes render with canonical metadata', async ({
  page,
}) => {
  const dailyEntries = await getPublishedDailyEntries();
  const latest = dailyEntries[0];
  if (!latest) throw new Error('Daily smoke tests require published content');
  await page.goto('/');
  await expect(page).toHaveTitle('雷达 · 当前技术态势');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('当前技术态势');
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', 'https://hzense.com');
  await expect(page.getByRole('heading', { level: 2, name: '近期信号 TOP 10' })).toBeVisible();
  if ((page.viewportSize()?.width ?? 0) > 700) {
    await expect(
      page
        .getByRole('navigation', { name: '主导航' })
        .getByRole('link', { name: '雷达', exact: true }),
    ).toHaveAttribute('href', '/');
  }

  await page.goto('/daily');
  await expect(page).toHaveTitle('每日简报 · HZense');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('值得带入今天的重要信号');
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
    'href',
    'https://hzense.com/daily',
  );
  await expect(page.locator('a.daily-list-feature')).toHaveCount(dailyEntries.length);
  await expect(page.locator('a.daily-list-feature').first().locator('.archive-label')).toHaveText(
    expectedDailyLabel(latest),
  );

  const detailHref = await getFirstDailyHref(page);
  expect(detailHref).toBe(`/daily/${latest.frontMatter.date}`);
  await expectDailyDetail(page, latest);
});

test('historical Daily examples retain their edition label and evidence', async ({ page }) => {
  const historical = (await getPublishedDailyEntries()).find(
    (entry) => entry.frontMatter.edition === 'historical_example',
  );
  if (!historical) throw new Error('Daily smoke tests require a published historical example');
  await page.goto('/daily');
  const card = page.locator(`a.daily-list-feature[href="/daily/${historical.frontMatter.date}"]`);
  await expect(card.locator('.archive-label')).toHaveText('历史回顾样例');
  await expectDailyDetail(page, historical);
});

test('metadata routes and custom 404 are available', async ({ page, request }) => {
  await page.goto('/daily');
  const detailHref = await getFirstDailyHref(page);

  const sitemapResponse = await request.get('/sitemap.xml');
  expect(sitemapResponse.ok()).toBeTruthy();
  expect(await sitemapResponse.text()).toContain(`https://hzense.com${detailHref}`);

  const robotsResponse = await request.get('/robots.txt');
  expect(robotsResponse.ok()).toBeTruthy();
  expect(await robotsResponse.text()).toContain('Sitemap: https://hzense.com/sitemap.xml');

  const response = await page.goto('/this-route-does-not-exist');
  expect(response?.status()).toBe(404);
  await expect(page.getByRole('heading', { level: 1 })).toContainText('这个页面还没有形成情报');
});

test('baseline security headers are returned', async ({ request }) => {
  const response = await request.get('/');
  expect(response.headers()['x-content-type-options']).toBe('nosniff');
  expect(response.headers()['x-frame-options']).toBe('DENY');
  expect(response.headers()['referrer-policy']).toBe('strict-origin-when-cross-origin');
  expect(response.headers()['permissions-policy']).toContain('camera=()');
});

test('legacy Insights index redirects to Topic insights', async ({ page }) => {
  await page.goto('/insights');
  await expect(page).toHaveURL(/\/topics$/);
  await expect(page).toHaveTitle('专题洞察 · HZense');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('从信号中形成判断');
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
    'href',
    'https://hzense.com/topics',
  );
});

test('Topics list and detail routes connect related intelligence', async ({ page, request }) => {
  await page.goto('/topics');
  await expect(page).toHaveTitle('专题洞察 · HZense');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('从信号中形成判断');
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
    'href',
    'https://hzense.com/topics',
  );

  const detailHref = await page.locator('a.topic-index-card').first().getAttribute('href');
  expect(detailHref).toMatch(/^\/topics\/[^/]+$/);

  const sitemapResponse = await request.get('/sitemap.xml');
  expect(await sitemapResponse.text()).toContain(`https://hzense.com${detailHref}`);

  await page.goto(detailHref as string);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(page.locator('header.article-header')).toBeVisible();
  await expect(page.locator('section.topic-related-section').first()).toBeVisible();
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
    'href',
    `https://hzense.com${detailHref}`,
  );
});

test('Weekly list and detail routes connect Daily and Topic evidence', async ({
  page,
  request,
}) => {
  await page.goto('/weekly');
  await expect(page).toHaveTitle('每周综述 · HZense');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('把一周变化连成趋势');
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
    'href',
    'https://hzense.com/weekly',
  );

  const detailHref = await page.locator('a.weekly-index-card').first().getAttribute('href');
  expect(detailHref).toMatch(/^\/weekly\/[^/]+$/);

  const sitemapResponse = await request.get('/sitemap.xml');
  expect(await sitemapResponse.text()).toContain(`https://hzense.com${detailHref}`);

  await page.goto(detailHref as string);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(page.locator('article.weekly-detail-body')).toBeVisible();
  await expect(page.locator('section.weekly-related-section')).toBeVisible();
  await expect(
    page.locator('section.weekly-related-section a[href^="/daily/"]').first(),
  ).toBeVisible();
  await expect(
    page.locator('section.weekly-related-section a[href^="/topics/"]').first(),
  ).toBeVisible();
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
    'href',
    `https://hzense.com${detailHref}`,
  );
});

test('Signals separate current publication from historical Seed archives', async ({
  page,
  request,
}) => {
  await page.goto('/signals');
  await expect(page).toHaveTitle('信号 · HZense');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('记录变化发生的时刻');
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
    'href',
    'https://hzense.com/signals',
  );
  await expect(
    page.getByRole('navigation', { name: '信号范围' }).getByRole('link', { name: '历史档案' }),
  ).toHaveAttribute('href', '/signals?archive=1');

  await page.goto('/signals?archive=1');
  const detailHref = await page
    .locator('main article h3 a[href^="/signals/"]')
    .first()
    .getAttribute('href');
  expect(detailHref).toMatch(/^\/signals\/[^/]+$/);
  const sitemapResponse = await request.get('/sitemap.xml');
  expect(await sitemapResponse.text()).toContain('https://hzense.com' + detailHref);
  await page.goto(detailHref as string);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(page.locator('article.signal-detail-body')).toBeVisible();
  await expect(page.locator('aside.signal-context-panel')).toBeVisible();
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
    'href',
    'https://hzense.com' + detailHref,
  );
});

test('Resources preserve historical entity details and show current scope separately', async ({
  page,
  request,
}) => {
  await page.goto('/resources');
  await expect(page).toHaveTitle('资源 · HZense');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('理解信号背后的参与者');
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
    'href',
    'https://hzense.com/resources',
  );
  await expect(
    page.getByRole('navigation', { name: '资源范围' }).getByRole('link', { name: '关键人物' }),
  ).toHaveAttribute('href', '/persons');

  await page.goto('/resources?archive=1&type=all');
  const detailHref = await page
    .locator('main section[aria-label="资源列表"] article h2 a[href^="/resources/"]')
    .first()
    .getAttribute('href');
  expect(detailHref).toMatch(/^\/resources\/[^/]+$/);
  const sitemapResponse = await request.get('/sitemap.xml');
  expect(await sitemapResponse.text()).toContain('https://hzense.com' + detailHref);
  await page.goto(detailHref as string);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(page.locator('main.article-main')).toBeVisible();
});

test('Radar is the homepage and does not invent an unsupported heat score', async ({
  page,
  request,
}) => {
  await page.goto('/radar');
  await expect(page).toHaveURL(/\/$/);
  await expect(page).toHaveTitle('雷达 · 当前技术态势');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('当前技术态势');
  await expect(page.getByRole('heading', { level: 2, name: '近期信号 TOP 10' })).toBeVisible();
  await expect(page.getByText('未评估', { exact: true })).toBeVisible();
  await expect(page.locator('nav.desktop-nav a[href="/"]')).toHaveAttribute('href', '/');
  expect(await page.locator('ol li').count()).toBeLessThanOrEqual(10);
  const sitemapResponse = await request.get('/sitemap.xml');
  expect(await sitemapResponse.text()).toContain('https://hzense.com');
  await page
    .getByRole('navigation', { name: '热点时间窗口' })
    .getByRole('link', { name: '24 小时' })
    .click();
  await expect(page).toHaveURL(/\/\?range=24h/);
  await expect(
    page.getByRole('navigation', { name: '热点时间窗口' }).getByRole('link', { name: '24 小时' }),
  ).toHaveAttribute('aria-current', 'page');
});

test('mobile navigation keeps every primary route reachable', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/signals');

  const desktopNavigation = page.getByRole('navigation', { name: '主导航' });
  const menuButton = page.locator('.mobile-menu-toggle');
  const mobileNavigation = page.getByRole('navigation', { name: '移动导航' });

  await expect(desktopNavigation).toBeHidden();
  await expect(menuButton).toBeVisible();
  await expect(menuButton).toHaveAttribute('aria-expanded', 'false');
  await expect(mobileNavigation).toBeHidden();

  await menuButton.click();
  await expect(menuButton).toHaveAttribute('aria-expanded', 'true');
  await expect(mobileNavigation).toBeVisible();
  await expect(mobileNavigation.getByRole('link', { name: '资源' })).toBeVisible();
  await expect(mobileNavigation.getByRole('link', { name: '雷达' })).toBeVisible();

  await mobileNavigation.getByRole('link', { name: '雷达' }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole('heading', { level: 1 })).toContainText('当前技术态势');
  await expect(menuButton).toHaveAttribute('aria-expanded', 'false');
  await expect(mobileNavigation).toBeHidden();
});

test('search finds and filters published intelligence', async ({ page }) => {
  await page.goto('/search');

  await expect(page.getByRole('heading', { level: 1, name: '搜索结构化科技情报。' })).toBeVisible();
  await page.getByRole('searchbox', { name: '关键词' }).fill('OpenAI');
  await page.getByRole('button', { name: '搜索' }).click();

  await expect(page).toHaveURL(/\/search\?q=OpenAI/);
  await expect(page.getByText(/条结果 · “OpenAI”/)).toBeVisible();
  await expect(page.getByRole('list', { name: '搜索结果' })).toBeVisible();
  await expect(page.getByRole('link', { name: /OpenAI/ }).first()).toBeVisible();

  await page
    .getByRole('navigation', { name: '搜索结果类型' })
    .getByRole('link', { name: '资源', exact: true })
    .click();
  await expect(page).toHaveURL(/type=resource/);
  await expect(page.getByRole('link', { name: /OpenAI/ }).first()).toBeVisible();
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
    'href',
    'https://hzense.com/search',
  );
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
});

test('search explains invalid queries without a server error and allows correction', async ({
  page,
}) => {
  const inputError = page.locator('#search-input-error');
  const tooManyTerms = Array.from({ length: 25 }, (_, i) => String.fromCharCode(97 + i)).join(' ');
  for (const [query, message] of [
    [tooManyTerms, '24 个不同关键词'],
    ['x'.repeat(121), '120 个字符'],
  ] as const) {
    const response = await page.goto(`/search?q=${encodeURIComponent(query)}`);
    expect(response?.status()).toBe(200);
    await expect(inputError).toContainText(message);
    await expect(inputError).toHaveAttribute('role', 'alert');
    await expect(page.getByRole('searchbox', { name: '关键词' })).toHaveAttribute(
      'aria-invalid',
      'true',
    );
    await expect(page.getByRole('list', { name: '搜索结果' })).toHaveCount(0);
  }
  await page.getByRole('searchbox', { name: '关键词' }).fill('OpenAI');
  await page.getByRole('button', { name: '搜索' }).click();
  await expect(inputError).toHaveCount(0);
  await expect(page.getByRole('list', { name: '搜索结果' })).toBeVisible();
});
