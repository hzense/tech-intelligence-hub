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
  await expect(page.getByRole('link', { name: '探索技术雷达' })).toHaveAttribute('href', '/radar');
  await expect(page.getByRole('link', { name: '打开技术雷达' })).toHaveAttribute('href', '/radar');
  if ((page.viewportSize()?.width ?? 0) > 700) {
    await expect(
      page
        .getByRole('navigation', { name: '主导航' })
        .getByRole('link', { name: '雷达', exact: true }),
    ).toHaveAttribute('href', '/radar');
  }

  await page.goto('/daily');
  await expect(page).toHaveTitle('每日简报 · HZense');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('值得带入今天的重要信号');
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
    'href',
    'https://hzense.com/daily',
  );
  await expect(page.locator('.archive-label').first()).toHaveText('历史回顾样例');

  const detailHref = await getFirstDailyHref(page);
  await page.goto(detailHref);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  const evidence = page.locator('.daily-evidence');
  const firstSourceLink = evidence.locator('a[target="_blank"]').first();
  await expect(evidence.locator('article')).toHaveCount(3);
  await expect(firstSourceLink).toHaveAttribute('href', /^https:\/\//);
  await expect(firstSourceLink).toHaveAttribute('target', '_blank');
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

test('Signals list and detail routes expose traceable seed intelligence', async ({
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

  const detailHref = await page.locator('a.signal-index-card').first().getAttribute('href');
  expect(detailHref).toMatch(/^\/signals\/[^/]+$/);

  const sitemapResponse = await request.get('/sitemap.xml');
  expect(await sitemapResponse.text()).toContain(`https://hzense.com${detailHref}`);

  await page.goto(detailHref as string);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(page.locator('article.signal-detail-body')).toBeVisible();
  await expect(page.locator('aside.signal-context-panel')).toBeVisible();
  await expect(page.locator('a.signal-source-link')).toHaveAttribute('href', /^https:\/\//);
  await expect(page.locator('a.signal-source-link')).toHaveAttribute('target', '_blank');
  await expect(page.locator('a.signal-source-link')).toHaveAttribute('rel', 'noopener noreferrer');
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

test('Radar visualizes and filters traceable technology assessments', async ({ page, request }) => {
  await page.goto('/radar');
  await expect(page).toHaveTitle('科技雷达 · HZense');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('看清技术所处的位置');
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
    'href',
    'https://hzense.com/radar',
  );
  const radarEntries = page.locator('.radar-entry-card');
  await expect(radarEntries.first()).toBeVisible();
  const unfilteredCount = await radarEntries.count();
  expect(unfilteredCount).toBeGreaterThan(0);
  await expect(radarEntries.locator('a[href^="/signals/"]').first()).toBeVisible();
  await expect(radarEntries.locator('a[href^="/resources/"]').first()).toBeVisible();
  await expect(radarEntries.locator('.radar-assessment')).toHaveCount(unfilteredCount);

  const evidenceShape = await radarEntries.evaluateAll((cards) =>
    cards.map((card) => ({
      evidenceSignals: [...card.querySelectorAll('.radar-scoring-evidence a[href^="/signals/"]')]
        .map((link) => link.getAttribute('href'))
        .filter((href): href is string => Boolean(href)),
      sourceLinks: [...card.querySelectorAll('a.radar-evidence-source')].map((link) => ({
        href: link.getAttribute('href'),
        rel: link.getAttribute('rel'),
        target: link.getAttribute('target'),
      })),
      relatedSignals: [...card.querySelectorAll('.radar-related-context a[href^="/signals/"]')]
        .map((link) => link.getAttribute('href'))
        .filter((href): href is string => Boolean(href)),
      reasoning: card.querySelector('.radar-assessment p')?.textContent?.trim() ?? '',
    })),
  );
  for (const entry of evidenceShape) {
    expect(entry.reasoning.length).toBeGreaterThan(0);
    expect(entry.evidenceSignals.length).toBeGreaterThan(0);
    expect(new Set(entry.evidenceSignals).size).toBe(entry.evidenceSignals.length);
    expect(entry.sourceLinks).toHaveLength(entry.evidenceSignals.length);
    expect(
      entry.sourceLinks.every(
        ({ href, rel, target }) =>
          href?.startsWith('https://') && rel === 'noopener noreferrer' && target === '_blank',
      ),
    ).toBeTruthy();
    expect(
      entry.relatedSignals.every((href) => !entry.evidenceSignals.includes(href)),
    ).toBeTruthy();
  }

  const evidenceHrefs = await radarEntries
    .locator('a.radar-topic-link, a[href^="/signals/"], a[href^="/resources/"]')
    .evaluateAll((links) => [
      ...new Set(
        links
          .map((link) => link.getAttribute('href'))
          .filter((href): href is string => Boolean(href)),
      ),
    ]);
  expect(evidenceHrefs.some((href) => href.startsWith('/topics/'))).toBeTruthy();
  expect(evidenceHrefs.some((href) => href.startsWith('/signals/'))).toBeTruthy();
  expect(evidenceHrefs.some((href) => href.startsWith('/resources/'))).toBeTruthy();
  for (const href of evidenceHrefs) {
    const response = await request.get(href);
    expect(response.ok(), `${href} returned ${response.status()}`).toBeTruthy();
  }

  const firstEvidenceSignalHref = evidenceShape[0]?.evidenceSignals[0];
  const firstEvidenceSourceHref = evidenceShape[0]?.sourceLinks[0]?.href;
  expect(firstEvidenceSignalHref).toBeTruthy();
  expect(firstEvidenceSourceHref).toMatch(/^https:\/\//);
  await page.goto(firstEvidenceSignalHref as string);
  await expect(page.locator('a.signal-source-link')).toHaveAttribute(
    'href',
    firstEvidenceSourceHref as string,
  );
  await page.goto('/radar');

  const radarMatrix = page.locator('.radar-matrix');
  const radarNodes = page.locator('.radar-node');
  if ((page.viewportSize()?.width ?? 0) <= 900) {
    await expect(radarMatrix).toBeHidden();
    await expect(page.getByRole('form', { name: '科技雷达筛选' })).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
      ),
    ).toBeFalsy();
  } else {
    await expect(radarMatrix).toBeVisible();
    await expect(radarNodes).toHaveCount(unfilteredCount);
    const nodeHrefs = await radarNodes.evaluateAll((nodes) =>
      nodes.map((node) => node.getAttribute('href')),
    );
    expect(nodeHrefs.every((href) => href?.startsWith('/topics/'))).toBeTruthy();

    const nodeBoxes = await radarNodes.evaluateAll((nodes) =>
      nodes.map((node) => {
        const box = node.getBoundingClientRect();
        return { top: box.top, right: box.right, bottom: box.bottom, left: box.left };
      }),
    );
    for (let leftIndex = 0; leftIndex < nodeBoxes.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < nodeBoxes.length; rightIndex += 1) {
        const leftBox = nodeBoxes[leftIndex];
        const rightBox = nodeBoxes[rightIndex];
        expect(leftBox && rightBox).toBeTruthy();
        if (!leftBox || !rightBox) continue;
        const horizontalOverlap =
          Math.min(leftBox.right, rightBox.right) - Math.max(leftBox.left, rightBox.left);
        const verticalOverlap =
          Math.min(leftBox.bottom, rightBox.bottom) - Math.max(leftBox.top, rightBox.top);
        expect(
          horizontalOverlap <= 1 || verticalOverlap <= 1,
          `Radar nodes ${leftIndex} and ${rightIndex} overlap`,
        ).toBeTruthy();
      }
    }
  }

  const sitemapResponse = await request.get('/sitemap.xml');
  expect(await sitemapResponse.text()).toContain('https://hzense.com/radar');

  await page.getByLabel('领域').selectOption('security');
  await page.getByLabel('成熟阶段').selectOption('emerging');
  await page.getByLabel('趋势').selectOption('growth');
  await page.getByRole('button', { name: '应用筛选' }).click();
  const filteredUrl = new URL(page.url());
  expect(filteredUrl.searchParams.get('domain')).toBe('security');
  expect(filteredUrl.searchParams.get('maturity')).toBe('emerging');
  expect(filteredUrl.searchParams.get('trend')).toBe('growth');
  await expect(page.getByLabel('领域')).toHaveValue('security');
  await expect(page.getByLabel('成熟阶段')).toHaveValue('emerging');
  await expect(page.getByLabel('趋势')).toHaveValue('growth');
  await expect(radarEntries.first()).toBeVisible();

  const filteredCount = await radarEntries.count();
  expect(filteredCount).toBeGreaterThan(0);
  expect(filteredCount).toBeLessThan(unfilteredCount);
  const filteredDomains = await radarEntries.locator('.radar-entry-heading span').allTextContents();
  expect(filteredDomains).toHaveLength(filteredCount);
  expect(filteredDomains.every((domain) => domain.trim() === '安全')).toBeTruthy();
  const filteredEntryText = await radarEntries.allTextContents();
  expect(
    filteredEntryText.every(
      (entryText) => entryText.includes('涌现期') && entryText.includes('上升'),
    ),
  ).toBeTruthy();

  await page.reload();
  await expect(page.getByLabel('领域')).toHaveValue('security');
  await expect(page.getByLabel('成熟阶段')).toHaveValue('emerging');
  await expect(page.getByLabel('趋势')).toHaveValue('growth');
  await expect(radarEntries).toHaveCount(filteredCount);

  await page.goto('/radar?domain=security&maturity=mature&trend=rapid_decline');
  await expect(
    page.getByRole('heading', { level: 2, name: '当前筛选条件下没有雷达条目。' }),
  ).toBeVisible();
  await expect(radarEntries).toHaveCount(0);
  await expect(radarMatrix).toHaveCount(0);
  await page.getByRole('link', { name: '查看全部雷达' }).click();
  await expect(page).toHaveURL(/\/radar$/);
  await expect(radarEntries.first()).toBeVisible();
});

test('mobile navigation keeps every primary route reachable', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');

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
  await expect(page).toHaveURL(/\/radar$/);
  await expect(page.getByRole('heading', { level: 1 })).toContainText('看清技术所处的位置');
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
