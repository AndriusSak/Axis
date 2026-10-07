import { test, expect } from '@playwright/test';
import { bootCleanWorkbench, clickNav } from './support/workbench';
import { installGridMock } from './support/gridMock';

/**
 * R27 — real-browser coverage for the R22 §2.11 batch-set rail entry.
 *
 * R21–R24 shipped this UI with ONLY sourceguard unit tests (which regex the .svelte source) — no
 * browser ever clicked the entry. This spec boots the gated workbench shell and proves, in Chromium:
 *   • the rail carries a `batchSet` ACTION nav entry (data-nav-entry="batchSet");
 *   • opening it docks the registered `axis.batchSet` panel in `main` (no dead entry);
 *   • the panel's DESTRUCTIVE-by-design warning is intact.
 *
 * `installGridMock` keeps every /api call inside the browser so no write can reach the operator's
 * live device; the panel itself needs no device data, so the assertions stay deterministic.
 */
test.describe('R22 §2.11 — batch-set rail entry (browser)', () => {
  test('the rail entry is present and opens the Batch Set panel with its destructive warning', async ({ page }) => {
    await installGridMock(page);
    await bootCleanWorkbench(page);

    // The ACTION entry is discoverable in the rail and labelled.
    const entry = page.locator('[data-nav-entry="batchSet"] button.axis-nav-entry');
    await expect(entry).toBeVisible();
    await expect(entry).toHaveAttribute('aria-label', 'Batch Set');

    await clickNav(page, 'batchSet');

    // Opening it docks the REGISTERED panel into `main` and activates its tab.
    await expect(
      page.locator('.aw-tabstack[data-region="main"] .aw-pane-tab').filter({ hasText: 'Batch Set Parameter' })
    ).toHaveCount(1);

    const panel = page.locator('.batch-set');
    await expect(panel).toBeVisible();
    await expect(panel.getByRole('heading', { name: 'Batch Set Parameter' })).toBeVisible();

    // The destructive-by-design warning is intact (role=alert) — the whole point of the panel.
    const warn = panel.locator('.warn[role="alert"]');
    await expect(warn).toBeVisible();
    await expect(warn).toContainText('Destructive.');
    await expect(warn).toContainText('overwrites');
    await expect(warn).toContainText('no undo');

    // With no block open the panel states the honest gate instead of silently allowing a blind write.
    await expect(panel.locator('.gate')).toContainText('blocked');

    // And the entry is a normal nav point: returning to Grid works.
    await clickNav(page, 'grid');
    await expect(page.locator('[data-nav-entry="grid"][data-nav-active="true"]')).toHaveCount(1);
    await expect(
      page.locator('.aw-tabstack[data-region="main"] .aw-pane-tab').filter({ hasText: 'Signal Grid' })
    ).toHaveCount(1);
  });
});
