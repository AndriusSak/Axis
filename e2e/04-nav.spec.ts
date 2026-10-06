import { test, expect } from '@playwright/test';
import { bootCleanWorkbench, clickNav, regionTabs } from './support/workbench';

test.describe('Navigation', () => {
  test('Setup docks a VirtualScreen panel and tints the entry active; a second click focuses (no duplicate)', async ({ page }) => {
    await bootCleanWorkbench(page);

    await clickNav(page, 'setup');

    // A Setup panel docks into the main stack and the nav entry goes active.
    await expect(regionTabs(page, 'main').filter({ hasText: 'Setup' })).toHaveCount(1);
    await expect(page.locator('[data-nav-entry="setup"][data-nav-active="true"]')).toHaveCount(1);

    // Clicking again focuses the existing panel — it must not add a second tab.
    await clickNav(page, 'setup');
    await expect(regionTabs(page, 'main').filter({ hasText: 'Setup' })).toHaveCount(1);
  });

  test('Scenes docks the Scene Manager panel', async ({ page }) => {
    await bootCleanWorkbench(page);

    await clickNav(page, 'scenes');
    await expect(regionTabs(page, 'main').filter({ hasText: 'Scenes' })).toHaveCount(1);
    // The panel body is the real Scene Manager (no device needed to render).
    await expect(page.locator('.aw-tabstack[data-region="main"] .aw-tabbody')).toContainText(/Scene/i);
  });

  test('active tint follows the selected section', async ({ page }) => {
    await bootCleanWorkbench(page);

    await clickNav(page, 'setup');
    await expect(page.locator('[data-nav-entry="setup"][data-nav-active="true"]')).toHaveCount(1);

    await clickNav(page, 'scenes');
    await expect(page.locator('[data-nav-entry="scenes"][data-nav-active="true"]')).toHaveCount(1);
    // Setup is no longer the active section.
    await expect(page.locator('[data-nav-entry="setup"][data-nav-active="true"]')).toHaveCount(0);
  });
});
