import { test, expect, type Page, type Route } from '@playwright/test';
import { bootCleanWorkbench } from './support/workbench';

/**
 * The top bar's View widget (Basic / Advanced).
 *
 * It sets `editor.globalMode`, whose documented contract is "blocks OPEN on Ideal / Advanced". That
 * contract used to be honoured by the classic block editor's Ideal/Advanced tab strip; when
 * `ControlSurface` replaced it with device-authentic ("Default") pages, nothing read the value any
 * more — the toggle flipped state, showed a success toast, and changed nothing on screen.
 *
 * It is now wired to the board model: Basic opens a block on its FIRST page, Advanced on the
 * full-parameter sweep ("More", else the last page). These tests pin both halves — the open-on choice
 * and the immediate effect when the toggle is used with a block already open.
 *
 * Fully MOCKED backend (one Cab block with two board pages), so nothing touches a live FM3.
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
  editorLayouts: true
};
const DEVICE = { model: 'FM3', modelByte: '0x11', modelId: 17, apiVersion: 2, capabilities: CAPS, firmware: null, port: 'mock' };
const DETECT = { connected: true, modelId: 17, name: 'FM3', short: 'FM3', gen: 3, supported: true, port: 'mock' };

const GRID = {
  model: 'FM3',
  name: 'MOCK VIEW MODE',
  crcValid: true,
  rows: 4,
  cols: 6,
  scenes: [],
  cells: [{ row: 0, col: 0, effectId: 200, name: '4x12 Recto', slug: 'Cab', isShunt: false, routeFlag: 0, fromRows: [] }]
};

const knob = (id: number, name: string, norm = 0) => ({ id, name, value: norm * 10, norm, min: 0, max: 10 });

// Param 12 is deliberately NOT referenced by the layout, so the builder sweeps it onto a trailing
// "More" page — that sweep page is what Advanced opens on.
const BLOCK_PARAMS = {
  block: 'Cab',
  slug: 'cab',
  page: 12,
  named: [knob(93, 'DynaCab1 Pos'), knob(12, 'Pan')],
  enums: [],
  type: { value: 1, name: 'DYNA-CAB' },
  layout: {
    editorName: 'Cab',
    family: 'CABINET',
    variantName: 'Mode',
    variantValue: 'DYNA-CAB',
    pages: [
      {
        name: 'Cab',
        rows: [{ section: 'parameters', controls: [{ label: 'DynaCab', paramName: 'CABINET_DYNACAB_R1', paramId: 93, widget: 'unknown', rawWidget: 'dynaCabControl' }] }]
      }
    ]
  }
};

async function bootWithCab(page: Page): Promise<void> {
  const json = (route: Route, body: unknown, status = 200) =>
    route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname.replace(/^\/api/, '');
    if (path === '/device') return json(route, DEVICE);
    if (path === '/device/detect') return json(route, DETECT);
    if (path === '/healthz') return json(route, { ok: true, api: { version: 2 }, device: 'FM3' });
    if (path === '/preset/grid') return json(route, GRID);
    if (path === '/preset/blocks') return json(route, []);
    if (path === '/ports') return json(route, { chosen: null, override: null, profileOverride: null, ports: [] });
    if (/^\/preset\/blocks\/200\/params$/.test(path)) return json(route, BLOCK_PARAMS);
    return json(route, {});
  });
  await page.route('**/api/events', (route) => route.abort());

  await bootCleanWorkbench(page);
  await expect(page.locator('[data-idx="0,0"].cell.block')).toBeVisible();
  await page.locator('[data-idx="0,0"].cell.block').click();
  await expect(page.locator('.boardwrap')).toBeVisible();
}

const viewChip = (page: Page, label: string) => page.locator('.aw-topbar button.pill-chip', { hasText: new RegExp(`^${label}$`) });
const openPage = (page: Page) => page.locator('button.tab.on');

/**
 * Set the View mode through the widget. The top bar's fit pass may shrink the widget to `mini`, where
 * it renders ONE chip showing the current mode ('Basic' / 'Adv') instead of two ('Basic' / 'Advanced'),
 * so drive whichever shape is on screen.
 */
async function setView(page: Page, mode: 'basic' | 'advanced'): Promise<void> {
  const advanced = page.locator('.aw-topbar button.pill-chip', { hasText: /^(Advanced|Adv)$/ });
  const basic = page.locator('.aw-topbar button.pill-chip', { hasText: /^Basic$/ });
  if ((await advanced.count()) > 0) {
    await (mode === 'advanced' ? advanced.first() : basic.first()).click();
    return;
  }
  const chip = page.locator('.aw-topbar button.pill-chip').first(); // mini: one toggling chip
  for (let i = 0; i < 2; i++) {
    const label = (await chip.innerText()).trim();
    const isBasic = label === 'Basic';
    if ((mode === 'basic') === isBasic) return;
    await chip.click();
  }
}

test.describe('View widget — Basic / Advanced', () => {
  test('Basic (default) opens the block on its first page', async ({ page }) => {
    await bootWithCab(page);
    await expect(openPage(page)).toHaveText('Cab');
    await expect(viewChip(page, 'Basic')).toHaveClass(/on/);
  });

  test('the block has a second board page (the unreferenced-param sweep)', async ({ page }) => {
    await bootWithCab(page);
    await expect(page.locator('button.tab')).toHaveCount(2);
  });

  test('switching to Advanced moves the open block to the sweep page', async ({ page }) => {
    await bootWithCab(page);
    await setView(page, 'advanced');
    await expect(openPage(page)).toHaveText('More');
  });

  test('switching back to Basic returns the block to its first page', async ({ page }) => {
    await bootWithCab(page);
    await setView(page, 'advanced');
    await expect(openPage(page)).toHaveText('More');
    await setView(page, 'basic');
    await expect(openPage(page)).toHaveText('Cab');
  });

  test('a manual tab click is not fought by the toggle', async ({ page }) => {
    await bootWithCab(page);
    await page.locator('button.tab', { hasText: 'More' }).click();
    await expect(openPage(page)).toHaveText('More');
    // No further mode change → nothing should snap the page back.
    await page.waitForTimeout(300);
    await expect(openPage(page)).toHaveText('More');
  });
});
