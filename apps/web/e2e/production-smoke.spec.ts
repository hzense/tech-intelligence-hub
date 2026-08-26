import { expect, test, type Page } from '@playwright/test';

async function getFirstDailyHref(page: Page): Promise<string> {
  const href = await page.locator('a.daily-list-feature').first().getAttribute('href');
  expect(href).toMatch(/^\/daily\/[^/]+$/);
  return href as string;
}

test('home and Daily routes render with canonical metadata', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveTitle('HZense — 科技情报');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('感知科技的变化');
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', 'https://hzense.com');

  await page.goto('/daily');
  await expect(page).toHaveTitle('每日简报 · HZense');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('值得带入今天的重要信号');
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
    'href',
    'https://hzense.com/daily',
  );

  const detailHref = await getFirstDailyHref(page);
  await page.goto(detailHref);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
    'href',
    `https://hzense.com${detailHref}`,
  );
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

test('Insights list and detail routes render validated content', async ({ page, request }) => {
  await page.goto('/insights');
  await expect(page).toHaveTitle('洞察 · HZense');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('把信号转化为判断');
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
    'href',
    'https://hzense.com/insights',
  );

  const detailHref = await page.locator('a.insight-index-card').first().getAttribute('href');
  expect(detailHref).toMatch(/^\/insights\/[^/]+$/);

  const sitemapResponse = await request.get('/sitemap.xml');
  expect(await sitemapResponse.text()).toContain(`https://hzense.com${detailHref}`);

  await page.goto(detailHref as string);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  const article = page.locator('article.insight-detail-body');
  await expect(article).toBeVisible();
  await expect(article.locator('section.insight-section').first()).toBeVisible();
  await expect(article.getByRole('heading', { level: 2 }).first()).toBeVisible();
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
    'href',
    `https://hzense.com${detailHref}`,
  );
});

test('Topics list and detail routes connect related intelligence', async ({ page, request }) => {
  await page.goto('/topics');
  await expect(page).toHaveTitle('专题 · HZense');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('持续跟踪技术变化');
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
  await expect(page.locator('article.topic-overview')).toBeVisible();
  await expect(page.locator('aside.topic-metrics-panel')).toBeVisible();
  await expect(page.locator('section.topic-related-section')).toBeVisible();
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
    'href',
    `https://hzense.com${detailHref}`,
  );
});


test('Weekly list and detail routes connect Daily and Topic evidence', async ({ page, request }) => {
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
  await expect(page.locator('section.weekly-related-section a[href^="/daily/"]').first()).toBeVisible();
  await expect(page.locator('section.weekly-related-section a[href^="/topics/"]').first()).toBeVisible();
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
    'href',
    `https://hzense.com${detailHref}`,
  );
});


test('Signals list and detail routes expose traceable seed intelligence', async ({ page, request }) => {
  await page.goto('/signals');
  await expect(page).toHaveTitle('信号 · HZense');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('记录变化发生的时刻');
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
    'href',
    'https://hzense.com/signals',
  );

  const detailHref = await page.locator('a.signal-index-card').first().getAttribute('href');
  expect(detailHref).toMatch(/^\/signals\/[^/]+$/);

  const sitemapResponse = await request.get('/sitemap.xml');
  expect(await sitemapResponse.text()).toContain(`https://hzense.com${detailHref}`);

  await page.goto(detailHref as string);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(page.locator('article.signal-detail-body')).toBeVisible();
  await expect(page.locator('aside.signal-context-panel')).toBeVisible();
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
    'href',
    `https://hzense.com${detailHref}`,
  );
});


test('Resources list and detail routes connect entities, relations, and Signals', async ({
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

  const detailHref = await page.locator('a.resource-index-card').first().getAttribute('href');
  expect(detailHref).toMatch(/^\/resources\/[^/]+$/);

  const sitemapResponse = await request.get('/sitemap.xml');
  expect(await sitemapResponse.text()).toContain(`https://hzense.com${detailHref}`);

  await page.goto(detailHref as string);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(page.locator('.resource-detail-grid')).toBeVisible();
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
    'href',
    `https://hzense.com${detailHref}`,
  );
});
