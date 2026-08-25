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
  await expect(page.getByText('研判', { exact: true })).toBeVisible();
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
    'href',
    `https://hzense.com${detailHref}`,
  );
});
