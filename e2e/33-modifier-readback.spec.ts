import { test, expect, type Page } from '@playwright/test';
import { bootCleanWorkbench, clickNav } from './support/workbench';
import { installGridMock } from './support/gridMock';

/**
 * R27 — real-browser coverage for the R21 §3.2 modifier remainder.
 *
 * R21 shipped two surfaces with ONLY sourceguard unit tests (they regex the .svelte source):
 *   • the modifier editor's CURVE READ-BACK section (src/lib/ModifierEditorCore.svelte), and
 *   • the Controllers screen's MODIFIERS IN USE panel (src/lib/ModifierUsagePanel.svelte, mounted by
 *     VirtualScreen when the controllers virtual screen is active).
 *
 * This spec proves both in Chromium. The modifier editor only renders the read-back section when the
 * opened parameter already has a decoded modifier assignment, so the read path is fed from the mocked
 * `GET /preset/modifiers` (the same in-browser mock approach the rest of the suite uses). With no
 * device the served model/data carry no curve values, so the section must show its HONEST
 * pending-decode state — never a fabricated value.
 */

/** A served block-params DTO (GET /preset/blocks/:eid/params) with the four PEQ controls. */
function peqParams() {
  return {
    block: 'PEQ',
    slug: 'peq',
    page: 100,
    named: [
      { id: 1, name: 'Gain', value: 0.5, norm: 0.5, min: 0, max: 1 },
      { id: 2, name: 'Freq', value: 0.5, norm: 0.5, min: 0, max: 1 },
      { id: 3, name: 'Q', value: 0.5, norm: 0.5, min: 0, max: 1 },
      { id: 4, name: 'Level', value: 0.5, norm: 0.5, min: 0, max: 1 }
    ],
    enums: [],
    type: { value: 0, name: 'PEQ' }
  };
}

/** A served controllers virtual-effect params DTO (eid 2) — enough to leave the loading/error gate. */
function controllersParams() {
  return {
    block: 'Controllers',
    slug: 'controllers',
    page: 2,
    named: [{ id: 5, name: 'Controller A', value: 0, norm: 0.5, min: 0, max: 1 }],
    enums: [],
    type: null
  };
}

/**
 * The decoded modifier assignment the mock serves for the PEQ 1 "Gain" control (eid 100, param 1):
 * a pre-chain assignment that OWNS a slot (so the read-back is addressable) but whose curve values
 * are not served (no device) → the section must render in its pending state.
 */
const ASSIGNMENT = { source: 'LFO 1', target: 'PEQ 1', param: 1, targetEffectId: 100, slot: 1 };

interface ModFixtures {
  blockParams?: Record<number, unknown>;
  modifiers?: unknown[];
}

async function installModifierFixtures(page: Page, f: ModFixtures): Promise<void> {
  await page.route('**/api/**', async (route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname.replace(/^\/api/, '');
    const json = (body: unknown) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    const bp = path.match(/^\/preset\/blocks\/(\d+)\/params$/);
    if (bp && req.method() === 'GET' && f.blockParams?.[Number(bp[1])]) return json(f.blockParams[Number(bp[1])]);
    if (path === '/preset/modifiers' && req.method() === 'GET' && f.modifiers) return json({ modifiers: f.modifiers });
    return route.fallback();
  });
}

test.describe('R21 §3.2 — modifier CURVE READ-BACK + Controllers usage panel (browser)', () => {
  test('the modifier editor renders the CURVE READ-BACK section with its honest pending state', async ({ page }) => {
    await installGridMock(page);
    await installModifierFixtures(page, { blockParams: { 100: peqParams() }, modifiers: [ASSIGNMENT] });
    await bootCleanWorkbench(page);
    await expect(page.locator('.cell.block').first()).toBeVisible();

    // Open a block (PEQ 1, eid 100) — the block editor shows its controls with ∿ badges.
    await page.locator('[data-idx="0,0"]').click();
    // Target the ∿ badge of the exact "Gain" control (its label's parent is the control card).
    const badge = page.locator('.lbl:text-is("Gain")').locator('xpath=..').locator('.modbadge');
    await expect(badge).toHaveCount(1);
    await expect(badge).toBeVisible();

    // The ∿ badge opens the modifier editor (flyout presentation of ModifierEditorCore).
    await badge.click();
    const panel = page.locator('.panel.flyout.open[data-screen-label="Modifier Editor"]');
    await expect(panel).toBeVisible();

    // The opened parameter is recognised as ALREADY modulated (decoded assignment read-back).
    await expect(panel.locator('.existing')).toContainText('Already modulated by');
    await expect(panel.locator('.existing')).toContainText('LFO 1');
    await expect(panel.locator('.existing')).toContainText('slot 1');

    // The CURVE READ-BACK section is present…
    await expect(panel.locator('.divider b', { hasText: 'CURVE READ-BACK' })).toHaveCount(1);

    // …and shows the honest PENDING state — no live curve values were served, so no value is invented.
    await expect(panel.locator('.rbnote')).toContainText('pending decode');
    await expect(panel.locator('.rbgrid')).toHaveCount(0);
  });

  test('the Controllers screen shows the MODIFIERS IN USE panel with its honest empty state', async ({ page }) => {
    await installGridMock(page);
    // Serve the controllers virtual-effect params so the screen leaves its loading/error gate; serve
    // NO modifier assignments (gridMock's catch-all) → the panel must report the honest empty state.
    await installModifierFixtures(page, { blockParams: { 2: controllersParams() } });
    await bootCleanWorkbench(page);

    await clickNav(page, 'controllers');
    await expect(page.locator('.vscreen')).toHaveCount(1);
    await expect(page.locator('.vscreen .vhead h2')).toHaveText('Controllers');

    const usage = page.locator('.modusage');
    await expect(usage).toBeVisible();
    await expect(usage.locator('.mtitle')).toHaveText('MODIFIERS IN USE');
    await expect(usage.locator('.mcount')).toHaveText('0');

    // Honest empty state: no fabricated row, no claim of an unavailable server.
    await expect(usage.locator('.mempty')).toHaveText('No parameters have a modifier assigned in this preset.');
  });
});
