import { expect, test } from '@playwright/test';

test('Radar homepage renders with canonical metadata', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveTitle('技术演进雷达');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('技术演进雷达');
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', 'https://hzense.com');
  const radar = page.locator('[aria-label="可点击的领域、分类和资源雷达"]');
  const detail = page.locator('#radar-detail-panel');
  await expect(radar).toBeVisible();
  await expect(page.locator('footer.site-footer')).toHaveCount(0);
  await expect(page.getByRole('heading', { level: 2, name: '最近发生的信号' })).toHaveCount(0);
  const category = radar.locator('button[aria-label*="分类，近 30 日"]').first();
  const categoryName = await category.locator('strong').innerText();
  await category.click();
  await expect(detail.getByRole('heading', { level: 2 })).toHaveText(categoryName);
  const resource = radar.locator('button[data-kind]').first();
  const resourceName = await resource.locator('strong').innerText();
  await resource.click();
  await expect(detail.getByRole('heading', { level: 2 })).toHaveText(resourceName);
  await expect(radar.locator('button[aria-label*="分类，近 30 日"]')).toHaveCount(0);
  await expect(detail.locator('a[href^="/signals/"]').first()).toBeVisible();
  if ((page.viewportSize()?.width ?? 0) <= 620) {
    const viewport = page.locator('[class*="plotViewport"]');
    await expect(page.getByText('左右滑动雷达，点击节点查看关联信号。')).toBeVisible();
    expect(await viewport.evaluate((node) => node.scrollWidth > node.clientWidth)).toBe(true);
    expect(await viewport.evaluate((node) => node.scrollLeft)).toBeGreaterThan(0);
  }
  if ((page.viewportSize()?.width ?? 0) > 700) {
    await expect(
      page
        .getByRole('navigation', { name: '主导航' })
        .getByRole('link', { name: '雷达', exact: true }),
    ).toHaveAttribute('href', '/');
    await expect(
      page.getByRole('link', { name: '前往 HZense GitHub 代码仓库（在新窗口打开）' }),
    ).toHaveAttribute('href', 'https://github.com/hzense/tech-intelligence-hub');
  }
});

test('metadata routes and custom 404 are available', async ({ page, request }) => {
  const sitemapResponse = await request.get('/sitemap.xml');
  expect(sitemapResponse.ok()).toBeTruthy();
  const sitemap = await sitemapResponse.text();
  expect(sitemap).toContain('https://hzense.com/signals');
  expect(sitemap).not.toContain('https://hzense.com/daily');
  expect(sitemap).not.toContain('https://hzense.com/weekly');
  for (const retiredPath of ['/daily', '/daily/2026-09-12', '/weekly', '/weekly/2024-W25']) {
    expect((await request.get(retiredPath)).status()).toBe(404);
  }

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
  await expect(page.getByRole('heading', { level: 1 })).toContainText('理解变化');
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
    'href',
    'https://hzense.com/topics',
  );
});

test('Topics list and detail routes connect related intelligence', async ({ page, request }) => {
  await page.goto('/topics');
  await expect(page).toHaveTitle('专题洞察 · HZense');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('理解变化');
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
    'href',
    'https://hzense.com/topics',
  );
  await expect(page.getByRole('heading', { level: 2, name: '洞察报告' })).toBeVisible();
  await expect(page.getByRole('heading', { level: 2, name: '跟踪专题' })).toBeVisible();

  const detailHref = await page
    .locator('section[aria-labelledby="topics-heading"] a[href^="/topics/"]')
    .first()
    .getAttribute('href');
  expect(detailHref).toMatch(/^\/topics\/[^/]+$/);

  const sitemapResponse = await request.get('/sitemap.xml');
  expect(await sitemapResponse.text()).toContain(`https://hzense.com${detailHref}`);

  await page.goto(detailHref as string);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(page.getByRole('heading', { level: 2, name: '专题报告' })).toBeVisible();
  await expect(page.getByRole('heading', { level: 2, name: '关联信号' })).toBeVisible();
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
    'href',
    `https://hzense.com${detailHref}`,
  );
});

test('Signals show one chronological card stream with reachable detail pages', async ({
  page,
  request,
}) => {
  await page.goto('/signals');
  await expect(page).toHaveTitle('信号 · HZense');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('每一个变化，都有迹可循。');
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
    'href',
    'https://hzense.com/signals',
  );
  await expect(page.getByRole('heading', { level: 2, name: '全部信号' })).toBeVisible();
  await expect(page.getByRole('navigation', { name: '信号范围' })).toHaveCount(0);
  await expect(page.locator('main form')).toHaveCount(0);
  const signalCards = page.locator('section[aria-label="信号列表"] article');
  expect(await signalCards.count()).toBeGreaterThan(0);
  const dates = await signalCards
    .locator('time')
    .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('datetime') ?? ''));
  expect(dates).toEqual([...dates].sort((left, right) => right.localeCompare(left)));
  const detailHref = await page
    .locator('section[aria-label="信号列表"] article h3 a[href^="/signals/"]')
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

test('Resources show organization and person cards with linked trend details', async ({
  page,
  request,
}) => {
  await page.goto('/resources');
  await expect(page).toHaveTitle('资源 · HZense');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('把参与者放回技术变化中。');
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
    'href',
    'https://hzense.com/resources',
  );
  await expect(page.getByRole('heading', { level: 2, name: '相关组织' })).toBeVisible();
  await expect(page.getByRole('heading', { level: 2, name: '关键人物' })).toBeVisible();
  await expect(
    page.getByRole('navigation', { name: '跳转到资源类型' }).getByRole('link', { name: /人物/ }),
  ).toHaveAttribute('href', '#people');

  const detailHref = await page
    .locator('section#organizations a[href^="/resources/"]')
    .first()
    .getAttribute('href');
  expect(detailHref).toMatch(/^\/resources\/[^/]+$/);
  const personHref = await page
    .locator('section#people a[href^="/persons/"]')
    .first()
    .getAttribute('href');
  expect(personHref).toMatch(/^\/persons\/[^/]+$/);
  const sitemapResponse = await request.get('/sitemap.xml');
  const sitemap = await sitemapResponse.text();
  expect(sitemap).toContain('https://hzense.com' + detailHref);
  expect(sitemap).toContain('https://hzense.com' + personHref);
  await page.goto(detailHref as string);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(page.locator('main.article-main')).toBeVisible();
  await expect(page.getByRole('heading', { level: 2, name: '技术发展趋势观察' })).toBeVisible();
  await expect(page.getByRole('heading', { level: 2, name: /关联信号/ })).toBeVisible();
  await expect(page.getByRole('heading', { level: 2, name: /关联洞察/ })).toBeVisible();
  await page.goto(personHref as string);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(page.getByRole('heading', { level: 2, name: '技术发展趋势观察' })).toBeVisible();
});

test('legacy Radar route redirects home and explains observed heat', async ({ page, request }) => {
  await page.goto('/radar');
  await expect(page).toHaveURL(/\/$/);
  await expect(page).toHaveTitle('技术演进雷达');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('技术演进雷达');
  await expect(page.getByText(/不是全行业实时热度/)).toBeVisible();
  await expect(page.locator('nav.desktop-nav a[href="/"]')).toHaveAttribute('href', '/');
  expect(await page.locator('main ol li').count()).toBeLessThanOrEqual(8);
  const sitemapResponse = await request.get('/sitemap.xml');
  expect(await sitemapResponse.text()).toContain('https://hzense.com');
  await expect(page.getByRole('navigation', { name: '热点时间窗口' })).toHaveCount(0);
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
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('技术演进雷达');
  await expect(menuButton).toHaveAttribute('aria-expanded', 'false');
  await expect(mobileNavigation).toBeHidden();
  await menuButton.click();
  await expect(
    page.locator('#mobile-menu').getByRole('link', {
      name: '前往 HZense GitHub 代码仓库（在新窗口打开）',
    }),
  ).toHaveAttribute('href', 'https://github.com/hzense/tech-intelligence-hub');
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
