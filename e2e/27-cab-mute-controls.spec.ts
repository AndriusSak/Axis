import { test, expect, type Page, type Route } from '@playwright/test';
import { bootCleanWorkbench } from './support/workbench';

/**
 * The Cab page's per-cab M / S controls.
 *
 * The device layout gives each cab slot an M and an S button carrying pseudo paramIds
 * (65286…65289; paramName CABINET_BTN_MUTE<n> / CABINET_BTN_SOLO<n>) that are never served as
 * parameters. The state they drive IS served: enum MUTE<n> with options '-- / MUTE / SOLO'. The board
 * builder re-resolves the pseudo-param by name, so each cab slot must render ONE working state
 * control — and clicking it must open the option list.
 *
 * Reproduces the reported "only Mute 1, and the dropdown does nothing" against a mocked backend.
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
  name: 'MOCK CAB MUTE',
  crcValid: true,
  rows: 4,
  cols: 6,
  scenes: [],
  cells: [{ row: 0, col: 0, effectId: 200, name: '4x12 Recto', slug: 'Cab', isShunt: false, routeFlag: 0, fromRows: [] }]
};

const states = (v: number) => ({ id: 0, name: '', value: v, options: [{ value: 0, label: '--' }, { value: 1, label: 'MUTE' }, { value: 2, label: 'SOLO' }] });
const muteEnum = (id: number, name: string, value = 0) => ({ ...states(value), id, name });

const muteBtn = (label: string, paramId: number, paramName: string) => ({
  label,
  paramName,
  paramId,
  widget: 'button',
  rawWidget: 'btnSquare'
});
const knobCtl = (label: string, paramId: number, rawWidget = 'knobMiniReadout') => ({ label, paramName: null, paramId, widget: 'knob', rawWidget });

const named = (id: number, name: string, norm = 0) => ({ id, name, value: norm * 10, norm, min: 0, max: 10 });
const enumNamed = (id: number, name: string, n = 3) => ({
  id,
  name,
  value: 0,
  options: Array.from({ length: n }, (_, i) => ({ value: i, label: `OPT${i}` }))
});

// The REAL FM3 DynaCab Cab page, both slots: the M/S pseudo-buttons, the mic graphs, the knobs that
// push them down the grid, and the two cab-slot type/mic dropdowns.
const BLOCK_PARAMS = {
  block: 'Cab',
  slug: 'cab',
  page: 12,
  named: [named(93, 'DynaCab1 Pos'), named(97, 'DynaCab1 Dist'), named(8, 'Level 1'), named(12, 'Pan 1'), named(94, 'DynaCab2 Pos'), named(98, 'DynaCab2 Dist'), named(9, 'Level 2'), named(13, 'Pan 2')],
  enums: [muteEnum(24, 'MUTE1'), muteEnum(25, 'MUTE2'), enumNamed(85, 'DYNACAB TYPE1', 45), enumNamed(89, 'DYNACAB MIC1', 4), enumNamed(86, 'DYNACAB TYPE2', 45), enumNamed(90, 'DYNACAB MIC2', 4)],
  type: { value: 1, name: 'DYNA-CAB' },
  layout: {
    editorName: 'Cab',
    family: 'CABINET',
    variantName: 'Mode',
    variantValue: 'DYNA-CAB',
    pages: [
      {
        name: 'Cab',
        rows: [
          {
            section: 'parameters',
            controls: [
              muteBtn('M', 65286, 'CABINET_BTN_MUTE1'),
              muteBtn('S', 65288, 'CABINET_BTN_SOLO1'),
              { label: 'DynaCab', paramName: 'CABINET_DYNACAB_R1', paramId: 93, widget: 'unknown', rawWidget: 'dynaCabControl' },
              knobCtl('Pan', 12),
              knobCtl('Distance', 97),
              knobCtl('Level', 8),
              muteBtn('M', 65287, 'CABINET_BTN_MUTE2'),
              muteBtn('S', 65289, 'CABINET_BTN_SOLO2'),
              { label: 'DynaCab', paramName: 'CABINET_DYNACAB_R2', paramId: 94, widget: 'unknown', rawWidget: 'dynaCabControl' },
              knobCtl('Pan', 13),
              knobCtl('Distance', 98),
              knobCtl('Level', 9)
            ]
          }
        ]
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

test.describe('Cab page M / S controls', () => {
  test('both cab slots get their state control', async ({ page }) => {
    await bootWithCab(page);
    await expect(page.locator('.seltop')).toHaveCount(2);
    await expect(page.locator('.seltop').first()).toHaveText(/MUTE1/);
    await expect(page.locator('.seltop').nth(1)).toHaveText(/MUTE2/);
  });

  test('clicking a state control opens its option list', async ({ page }) => {
    await bootWithCab(page);
    await page.locator('.selfield').first().click();
    await expect(page.locator('.selopt')).toHaveCount(3);
  });

  // The menu is positioned from the widget's GRID cell inside the board container, so a control in a
  // lower row puts the menu below the board — and the block-editor pane clips it. Then the click looks
  // like it "does nothing except highlight". Assert the menu lands inside the pane the user can see.
  test('the option list of a LOWER-row state control is visible (not clipped by the pane)', async ({ page }) => {
    await bootWithCab(page);
    const field = page.locator('.selfield').nth(1);
    await field.scrollIntoViewIfNeeded();
    await field.click();
    await expect(page.locator('.selopt')).toHaveCount(3);

    const geo = await page.evaluate(() => {
      const menu = document.querySelector('.selmenu') as HTMLElement | null;
      const bw = document.querySelector('.boardwrap');
      let pane: HTMLElement | null = null;
      for (let p = bw?.parentElement ?? null; p && p !== document.body; p = p.parentElement) {
        const s = getComputedStyle(p);
        if (s.overflowY === 'auto' || s.overflowY === 'scroll' || s.overflow === 'hidden') {
          pane = p;
          break;
        }
      }
      const r = menu?.getBoundingClientRect();
      const pr = pane?.getBoundingClientRect();
      const fr = (document.querySelectorAll('.selfield')[1] as HTMLElement | undefined)?.getBoundingClientRect();
      const br = bw?.getBoundingClientRect();
      return {
        paneH: pr ? Math.round(pr.height) : null,
        menu: r ? { t: Math.round(r.top), b: Math.round(r.bottom), h: Math.round(r.height) } : null,
        pane: pr ? { t: Math.round(pr.top), b: Math.round(pr.bottom) } : null,
        field: fr ? { t: Math.round(fr.top), b: Math.round(fr.bottom) } : null,
        board: br ? { t: Math.round(br.top), b: Math.round(br.bottom) } : null,
        menuStyle: menu?.getAttribute('style') ?? null,
        visibleH: r && pr ? Math.round(Math.max(0, Math.min(r.bottom, pr.bottom) - Math.max(r.top, pr.top))) : 0,
        visible: !!r && !!pr && r.top < pr.bottom && r.bottom > pr.top
      };
    });
    // eslint-disable-next-line no-console
    console.log('MENU GEO ' + JSON.stringify(geo));
    // Not merely "overlaps the pane": enough of the list must be on screen to actually pick an option.
    expect(geo.visibleH, `menu must be usable inside the pane: ${JSON.stringify(geo)}`).toBeGreaterThanOrEqual(56);
  });
});
