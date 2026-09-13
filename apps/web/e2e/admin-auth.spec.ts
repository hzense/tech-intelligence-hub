import { expect, test } from '@playwright/test';

test('anonymous administration is redirected and APIs fail closed', async ({ page, request }) => {
  await page.goto('/admin');
  await expect(page).toHaveURL(/\/admin\/login$/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('管理员登录');
  await expect(page.getByRole('button', { name: '使用 Google 登录' })).toBeVisible();
  await expect(page.locator('main')).not.toContainText('@gmail.com');
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    ),
  ).toBeFalsy();

  const session = await request.get('/api/admin/session');
  expect(session.status()).toBe(401);
  expect(await session.json()).toEqual({ error: 'unauthorized' });
  expect(session.headers()['cache-control']).toContain('no-store');
  expect(session.headers()['x-robots-tag']).toContain('noindex');
  const forged = await request.get('/api/admin/session', {
    headers: { Cookie: 'next-auth.session-token=forged; __Secure-next-auth.session-token=forged' },
  });
  expect(forged.status()).toBe(401);
  for (const path of [
    '/admin/ai',
    '/admin/ai/profiles',
    '/admin/ai/tests/00000000-0000-4000-8000-000000000001',
  ]) {
    await page.goto(path);
    await expect(page).toHaveURL(/\/admin\/login$/);
  }
  for (const path of ['connections', 'profiles', 'probes']) {
    const denied = await request.get(`/api/admin/ai/${path}`);
    expect(denied.status()).toBe(401);
    expect(denied.headers()['cache-control']).toContain('no-store');
    const write = await request.post(`/api/admin/ai/${path}`, { data: {} });
    expect(write.status()).toBe(401);
  }
  for (const operation of ['publish', 'withdraw']) {
    const denied = await request.post(`/api/admin/signals/${operation}`, { data: {} });
    expect(denied.status()).toBe(401);
    expect(await denied.json()).toEqual({ error: 'unauthorized' });
    expect(denied.headers()['cache-control']).toContain('no-store');
  }
  const loginResponse = await request.get('/admin/login');
  expect(loginResponse.headers()['cache-control']).toContain('no-store');
  expect(loginResponse.headers()['referrer-policy']).toBe('no-referrer');
});
