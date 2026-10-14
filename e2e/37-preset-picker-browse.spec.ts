import { test, expect, type Page, type Locator } from '@playwright/test';
import { bootCleanWorkbench } from './support/workbench';
import { installGridMock } from './support/gridMock';

/**
 * The preset picker's list cap (docs/axis-fm3edit-feature-parity-audit.md §5.1).
 *
 * Owner report: "Axis preset browser doesn't go beyond 299, it needs to be searched." The overlay
 * listed `slice(0, 300)` of the device's 512 slots and closed with "+212 more — type a number or name
 * to filter", so every slot past 299 was reachable ONLY by typing its number: the tail could not be
 * BROWSED. That is the same defect shape as the history panel's cap (rows past the cap unreachable),
 * so the cap now ships with a "Show all N presets" expander.
 *
 * This spec proves it in Chromium, not in a source regex: the rows really stop at 300 on open, the
 * expander really reveals all 512, the last slot really lands inside the list pane's own scroll box,
 * and a search whose match set exceeds the cap is expandable the same way.
 *
 * All /api traffic is mocked in-browser (installGridMock) — the dev :5056 backend is the operator's
 * LIVE FM3, and firing a row would LOAD A PRESET onto it, so this spec deliberately never clicks a
 * row.
 */

const SOFT_CAP = 300;
const SLOTS = 512;

/** Device-slot summaries the picker reads names from (`library.svelte.ts` `nameOfSlot`), shaped to
 *  pass its `summarySchema`. Without a device the slots are unnamed, so a NAME search could not match
 *  512 of them; this seeds names for the "a search can exceed the cap" case. */
function libraryFixture(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    number: i,
    name: `Amp Preset ${String(i).padStart(3, '0')}`,
    model: 'FM3',
    crcValid: true,
    crc: i,
    scenes: ['Scene 1'],
    blocks: [],
    models: {},
    amps: [],
  }));
}

async function openPicker(page: Page, seedLibrary = false): Promise<Locator> {
  await installGridMock(page);
  if (seedLibrary) {
    await page.addInitScript(
      (cache) => window.localStorage.setItem('axs.lib.cache', JSON.stringify(cache)),
      libraryFixture(SLOTS),
    );
  }
  await bootCleanWorkbench(page);
  // Workbench mode (VITE_AXIS_WORKBENCH=1, set by playwright.config) replaces the old TopBar with the
  // widget shell, so the picker opens from the preset WIDGET's main button, not `TopBar.svelte`'s .pset.
  await page.locator('.axis-preset .preset-main').click();
  const dialog = page.locator('.bg .card[role="dialog"]');
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('.title')).toHaveText('Presets');
  return dialog;
}

test.describe('preset picker — the slot list is browsable past the soft cap', () => {
  test('the list opens capped at 300 and the expander reveals all 512 slots', async ({ page }) => {
    const dialog = await openPicker(page);
    const rows = dialog.locator('.rowwrap');

    // The list opens on the capped first page (the perf intent of the upstream `slice(0, 300)`).
    await expect(dialog.locator('.section')).toHaveText('ALL PRESETS');
    await expect(rows).toHaveCount(SOFT_CAP);
    await expect(rows.nth(0).locator('.num')).toHaveText('000');
    await expect(rows.nth(SOFT_CAP - 1).locator('.num')).toHaveText('299');

    // ...and the cap is DISCLOSED with a control that reaches the rest, not a dead-end hint.
    const expander = dialog.locator('.showall');
    await expect(expander).toBeVisible();
    await expect(expander).toHaveText(`Show all ${SLOTS} presets`);
    await expect(dialog.locator('.morehint')).toContainText(`showing the first ${SOFT_CAP} of ${SLOTS}`);

    await expander.click();

    // Every slot is now rendered, and the disclosure is gone because nothing is hidden.
    await expect(rows).toHaveCount(SLOTS);
    await expect(rows.nth(SLOTS - 1).locator('.num')).toHaveText('511');
    await expect(dialog.locator('.showall')).toHaveCount(0);
    await expect(dialog.locator('.morehint')).toHaveCount(0);

    // VISIBILITY: the last slot is reachable by scrolling the list pane itself (the pane is what
    // clips — this is the assertion the old "nowhere to be seen" rows would fail).
    const pane = dialog.locator('.list');
    await rows.nth(SLOTS - 1).scrollIntoViewIfNeeded();
    const paneBox = (await pane.boundingBox())!;
    const rowBox = (await rows.nth(SLOTS - 1).boundingBox())!;
    expect(rowBox.y).toBeGreaterThanOrEqual(paneBox.y - 1);
    expect(rowBox.y + rowBox.height).toBeLessThanOrEqual(paneBox.y + paneBox.height + 1);
  });

  test('a search whose match set exceeds the cap is disclosed and expandable too', async ({ page }) => {
    const dialog = await openPicker(page, true);
    const rows = dialog.locator('.rowwrap');

    // Every seeded slot's name contains "amp", so the match set (512) is larger than the cap.
    await dialog.locator('input').fill('amp');
    await expect(dialog.locator('.section')).toHaveText(`${SLOTS} MATCHES`);
    await expect(rows).toHaveCount(SOFT_CAP);
    await expect(rows.nth(SOFT_CAP - 1).locator('.num')).toHaveText('299');
    await expect(dialog.locator('.showall')).toHaveText(`Show all ${SLOTS} presets`);

    await dialog.locator('.showall').click();
    await expect(rows).toHaveCount(SLOTS);
    await expect(rows.nth(SLOTS - 1).locator('.num')).toHaveText('511');

    // A number query still narrows to one slot, and the expander is not offered for a short list.
    await dialog.locator('input').fill('042');
    await expect(dialog.locator('.section')).toHaveText('1 MATCH');
    await expect(rows).toHaveCount(1);
    await expect(rows.nth(0).locator('.num')).toHaveText('042');
    await expect(dialog.locator('.showall')).toHaveCount(0);
  });
});
