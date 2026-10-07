import { test, expect, type Page } from '@playwright/test';
import { bootCleanWorkbench, clickNav } from './support/workbench';
import { installGridMock } from './support/gridMock';

/**
 * R27 — real-browser coverage for the R23 §2.4 Manage Presets drag-and-drop reorder.
 *
 * R23 shipped the DnD reorder with ONLY sourceguard unit tests (they regex the .svelte source). This
 * spec proves, in Chromium, that the Manage Presets reorder surface exposes a real drag handle /
 * HTML5 DnD affordance AND that a genuine drag reorders the rows through the SAME planner the
 * 'Reorder…' button uses (the dry-run preview appears). All /api traffic is mocked in-browser.
 *
 * The preset list is seeded from the persisted library cache (`axs.lib.cache`) so the browser shows
 * two device slots without a device; the device caps are overridden so `canCopySlots` (backupDump +
 * versionStore + supportsSave) is satisfied — the exact gate the Reorder button checks.
 */

const CAPS = {
  slotModel: 'grid',
  slotCount: 512,
  grid: { rows: 4, cols: 6 },
  hasScenes: false,
  sceneCount: 0,
  hasChannels: false,
  channelNames: [],
  channelBlocks: [],
  supportsSave: true,
  gridRouting: true,
  gridCursorSelect: false,
  shuntBase: 1024,
  // Manage-Presets reorder needs the copy-by-store primitives → editor.canCopySlots.
  backupDump: true,
  versionStore: true
};
const DEVICE = { model: 'FM3', modelByte: '0x0A', modelId: 10, apiVersion: 2, capabilities: CAPS, firmware: null, port: 'mock' };

/** Two valid device-slot summaries (matches library.svelte.ts `summarySchema`). */
const CACHED_SUMMARIES = [
  {
    number: 0,
    name: 'Alpha',
    model: 'FM3',
    crcValid: true,
    crc: 111,
    scenes: ['Scene 1'],
    blocks: [{ effectId: 100, slug: 'peq', name: 'PEQ 1', instance: null }],
    models: {},
    amps: []
  },
  {
    number: 1,
    name: 'Beta',
    model: 'FM3',
    crcValid: true,
    crc: 222,
    scenes: ['Scene 1'],
    blocks: [{ effectId: 200, slug: 'drive', name: 'Drive 1', instance: null }],
    models: {},
    amps: []
  }
];

async function installReorderFixtures(page: Page): Promise<void> {
  await page.route('**/api/**', async (route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname.replace(/^\/api/, '');
    const json = (body: unknown) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    if (path === '/device' && req.method() === 'GET') return json(DEVICE);
    return route.fallback();
  });
  // Seed the persisted library cache so the browser shows the two device slots (no device scan).
  await page.addInitScript((cache) => window.localStorage.setItem('axs.lib.cache', JSON.stringify(cache)), CACHED_SUMMARIES);
}

/** Boot, open the Preset Browser page, mark every device slot and open the Reorder dialog. */
async function openReorderDialog(page: Page): Promise<void> {
  await installGridMock(page);
  await installReorderFixtures(page);
  await bootCleanWorkbench(page);

  await clickNav(page, 'library');
  await expect(page.locator('.axis-pb-full')).toHaveCount(1);

  const rows = page.locator('.preset-row');
  await expect(rows).toHaveCount(2);
  await rows.nth(0).locator('.checkbox').click();
  await rows.nth(1).locator('.checkbox').click();

  const reorderBtn = page.locator('.select-head .mp-act', { hasText: 'Reorder' });
  await expect(reorderBtn).toBeEnabled();
  await reorderBtn.click();

  const dialog = page.locator('.mp-pop[aria-label="Reorder selected presets"]');
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('.mp-row')).toHaveCount(2);
}

test.describe('R23 §2.4 — Manage Presets drag-and-drop reorder (browser)', () => {
  test('the reorder surface exposes a drag handle / DnD affordance and a real drag reorders the rows', async ({ page }) => {
    await openReorderDialog(page);

    const dialog = page.locator('.mp-pop[aria-label="Reorder selected presets"]');
    const rows = dialog.locator('.mp-row');

    // The DnD affordance: every row is draggable and carries a drag grip.
    await expect(rows).toHaveCount(2);
    await expect(dialog.locator('.mp-row[draggable="true"]')).toHaveCount(2);
    await expect(dialog.locator('.mp-grip')).toHaveCount(2);
    await expect(dialog.locator('.mp-grip').first()).toHaveAttribute('title', 'Drag to reorder');

    // Baseline content order: slot 000 (Alpha) then slot 001 (Beta).
    await expect(rows.locator('.mp-slot')).toHaveText(['000', '001']);

    // A genuine HTML5 drag of the first row onto the second reorders the content permutation.
    await rows.nth(0).dragTo(rows.nth(1));

    await expect(rows.locator('.mp-slot')).toHaveText(['001', '000']);
    // The drag path feeds the SAME dry-run planner → the preview is rebuilt.
    await expect(dialog.locator('.mp-status')).toContainText('Dry run: 2 slot(s) would be rewritten');
    await expect(dialog.locator('.mp-moves li')).toHaveText(['001 → 000 · Beta', '000 → 001 · Alpha']);
  });

  test("the existing 'Reorder…' flow still works: ↑/↓ then a dry-run preview appears", async ({ page }) => {
    await openReorderDialog(page);

    const dialog = page.locator('.mp-pop[aria-label="Reorder selected presets"]');
    const rows = dialog.locator('.mp-row');

    // No preview until asked for one.
    await expect(dialog.locator('.mp-moves')).toHaveCount(0);

    // Move the first row down, then run the dry run.
    await rows.nth(0).locator('button[aria-label="Move down"]').click();
    await dialog.getByRole('button', { name: 'Preview (dry run)' }).click();

    await expect(dialog.locator('.mp-status')).toContainText('Dry run: 2 slot(s) would be rewritten');
    await expect(dialog.locator('.mp-moves li')).toHaveText(['001 → 000 · Beta', '000 → 001 · Alpha']);
    // The confirm gate is present (the run stays gated behind an explicit confirm).
    await expect(dialog.locator('.mp-confirm')).toContainText('I understand this overwrites the 2 listed slot(s)');
  });
});
