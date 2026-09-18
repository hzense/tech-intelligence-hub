import test from 'node:test';
import assert from 'node:assert/strict';
import process from 'node:process';
import { chromium, expect } from '@playwright/test';
import { startAdminControlsFixture } from './fixtures/admin-controls/server.mjs';

test(
  'admin action controls remain visible, accessible and read-only across pages/themes/viewports',
  {
    skip: process.env.HZENSE_IMPORT_BROWSER_TEST !== '1',
    timeout: 60000,
  },
  async (t) => {
    const fixture = await startAdminControlsFixture();
    t.after(fixture.close);
    const browser = await chromium.launch();
    t.after(() => browser.close());
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.route('**/*', (route) =>
      route.request().url().startsWith(fixture.origin) ? route.continue() : route.abort(),
    );
    for (const width of [1280, 390]) {
      await page.setViewportSize({ width, height: 844 });
      for (const theme of ['light', 'dark']) {
        for (const path of [
          '/imports',
          '/generation',
          '/preflight',
          '/signals',
          '/signal-detail',
          '/ai',
          '/auth',
          '/publication',
        ]) {
          await page.goto(`${fixture.origin}${path}?theme=${theme}`);
          await expect(page.locator('button, a').first()).toBeVisible();
          const controls = await page.locator('button, a').all();
          for (const control of controls) {
            const style = await control.evaluate((node) => {
              const css = globalThis.getComputedStyle(node);
              return {
                height: node.getBoundingClientRect().height,
                border: parseFloat(css.borderTopWidth),
                background: css.backgroundColor,
                decoration: css.textDecorationLine,
                tag: node.tagName,
              };
            });
            assert.ok(style.height >= 44, `${path}: hit target must be at least 44px`);
            assert.ok(style.border >= 1, `${path}: visible border`);
            assert.notEqual(style.background, 'rgba(0, 0, 0, 0)', `${path}: visible background`);
            if (style.tag === 'A')
              assert.equal(style.decoration, 'none', `${path}: action link is button-styled`);
          }
          assert.equal(
            await page.evaluate(
              () => globalThis.document.documentElement.scrollWidth <= globalThis.innerWidth,
            ),
            true,
            `${path}: no horizontal overflow`,
          );
          const enabledControl = page.locator('a, button:enabled').first();
          if (await enabledControl.count()) {
            await enabledControl.focus();
            await expect(enabledControl).toBeFocused();
            await expect(enabledControl).toHaveCSS('outline-style', 'solid');
          }
          if (path === '/imports')
            await expect(page.getByRole('button', { name: '创建并上传' })).toBeDisabled();
          if (path === '/generation')
            await expect(page.getByRole('button', { name: '手动刷新列表' })).toBeDisabled();
        }
      }
    }
    // Navigation stays a real link and works by keyboard; no button-wrapped anchors.
    await page.goto(`${fixture.origin}/imports`);
    const back = page.getByRole('link', { name: '返回管理后台' });
    await expect(back).toHaveAttribute('href', '/admin');
    await expect(page.locator('a button, button a')).toHaveCount(0);
    await back.focus();
    await back.press('Enter');
    await expect(page).toHaveURL(`${fixture.origin}/admin`);
    assert.deepEqual(fixture.writes, [], 'Rendering/navigation must not trigger operations');
    assert.deepEqual(errors, []);
  },
);
