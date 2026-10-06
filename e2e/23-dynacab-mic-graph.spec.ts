import { test, expect, type Page, type Route } from '@playwright/test';
import { bootCleanWorkbench } from './support/workbench';

/**
 * DynaCab mic graph (FM3-Edit parity).
 *
 * The FM3's own editor layout gives the Cab block (fw > 6.03) a dedicated `dynaCabControl` widget
 * bound to the cab's Position parameter — one tile that drives BOTH mic params: the cone face runs
 * down the left with CAP at the top and EDGE at the bottom (so VERTICAL = Position), and the mic's
 * HORIZONTAL standoff from the cone is the same cab's Distance (`CABINET_DYNACAB_Z<n>`, the layout's
 * sibling control). This drives the real render against a fully MOCKED backend (one Cab block whose
 * params carry that v2 layout) so nothing touches the operator's live FM3.
 *
 * Pre-change this rendered as a plain knob (the layout's explicit Position knob was de-duped away),
 * so there was no visual at all — that is the regression this spec pins.
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

// A Cab block whose display name resolves to the Cab pack (grid.ts uses the cell's slug).
const GRID = {
  model: 'FM3',
  name: 'MOCK LAYOUT',
  crcValid: true,
  rows: 4,
  cols: 6,
  scenes: [],
  cells: [{ row: 0, col: 0, effectId: 200, name: '4x12 Recto', slug: 'Cab', isShunt: false, routeFlag: 0, fromRows: [] }]
};

const knob = (id: number, name: string, norm = 0) => ({ id, name, value: norm * 10, norm, min: 0, max: 10 });

// Cab block params + the device-authentic DynaCab layout: the `dynaCabControl` (paramId 93) plus the
// layout's own explicit Position knob for the SAME param (which the board must de-dupe), a Distance
// knob (97) and the Mic dropdown (89).
const BLOCK_PARAMS = {
  block: 'Cab',
  slug: 'cab',
  page: 12,
  named: [knob(93, 'DynaCab1 Pos'), knob(97, 'DynaCab1 Dist')],
  enums: [
    { id: 89, name: 'Mic', value: 0, options: [{ value: 0, label: 'Dynamic 1' }, { value: 1, label: 'Ribbon' }, { value: 2, label: 'Condenser' }] }
  ],
  type: { value: 0, name: '4x12 Recto' },
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
              { label: 'Mic', paramName: 'CABINET_DYNACAB_MIC1', paramId: 89, widget: 'dropdown', rawWidget: 'dropdownCabDyna' },
              { label: 'DynaCab', paramName: 'CABINET_DYNACAB_R1', paramId: 93, widget: 'unknown', rawWidget: 'dynaCabControl' },
              { label: 'Position', paramName: 'CABINET_DYNACAB_R1', paramId: 93, widget: 'knob', rawWidget: 'knobMiniReadout' },
              { label: 'Distance', paramName: 'CABINET_DYNACAB_Z1', paramId: 97, widget: 'knob', rawWidget: 'knobMiniReadout' }
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

test.describe('Cab DynaCab mic graph', () => {
  test('renders the device dynaCabControl as a speaker/mic graph, not a knob', async ({ page }) => {
    await bootWithCab(page);

    const graph = page.locator('.dynabox');
    await expect(graph).toBeVisible();

    // The cone + the mic glyph are drawn.
    await expect(graph.locator('svg')).toBeVisible();
    await expect(graph.locator('svg text', { hasText: 'CAP' })).toBeVisible();
    await expect(graph.locator('svg text', { hasText: 'EDGE' })).toBeVisible();

    // The graph takes a 2×2 tile (the layout places it over the Position param; a 1×1 dial would be
    // unreadable). Its grid item carries the inline `grid-column: <x> / span 2`.
    const gridCol = await graph.evaluate((el) => (el.parentElement!.parentElement as HTMLElement).style.gridColumn);
    expect(gridCol).toContain('span 2');

    // The layout lists Position twice (the graph + an explicit knob) — the board de-dupes, so exactly
    // one control binds param 93, and it is the graph.
    const posControls = await page.locator('.boardwrap .card', { has: page.locator('.dynabox') }).count();
    expect(posControls).toBe(1);

    // The cone's EDGE label and the value readout must sit INSIDE the tile (never spilling out of the
    // card), and the tile itself must be reachable — the board is taller than the block-editor pane, so
    // it has to be reachable by scrolling that pane, not clipped with no way to scroll.
    const ok = await graph.evaluate((el) => {
      const card = el.parentElement!.getBoundingClientRect();
      const parts = [el.querySelector('.dynasvg text:last-of-type'), el.querySelector('.dynanum')].filter(Boolean) as Element[];
      const inside = parts.every((p) => { const r = p.getBoundingClientRect(); return r.top >= card.top - 1 && r.bottom <= card.bottom + 1; });
      const bw = document.querySelector('.boardwrap') as HTMLElement | null;
      let reachable = false;
      for (let p = bw?.parentElement ?? null; p && p !== document.body; p = p.parentElement) {
        const s = getComputedStyle(p);
        if ((s.overflowY === 'auto' || s.overflowY === 'scroll') && p.scrollHeight > p.clientHeight + 2) { reachable = true; break; }
      }
      const r = bw?.getBoundingClientRect();
      return { inside, reachable: reachable || (!!r && r.bottom <= window.innerHeight + 1) };
    });
    expect(ok.inside, 'EDGE label + readout inside the tile').toBe(true);
    expect(ok.reachable, 'tile reachable (fits the pane or the pane scrolls)').toBe(true);
  });

  test('dragging DOWN the tile raises Position (CAP at the top → EDGE at the bottom)', async ({ page }) => {
    await bootWithCab(page);

    const graph = page.locator('.dynabox');
    const posVal = () => page.locator('.dynaval .dynanum').first().innerText();
    const before = await posVal();

    const box = (await graph.boundingBox())!;
    // Press at the top of the tile (CAP) then drag to the bottom (EDGE), keeping x constant.
    await page.mouse.move(box.x + box.width / 2, box.y + 4);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height - 4, { steps: 8 });
    await page.mouse.up();

    const after = await posVal();
    expect(parseFloat(after)).toBeGreaterThan(parseFloat(before));
    expect(parseFloat(after)).toBeGreaterThan(8); // ~0.9 of the 0..10 range
  });

  test('dragging RIGHT in the SAME tile raises Distance', async ({ page }) => {
    await bootWithCab(page);

    // The tile carries both readouts — Position first, then the bound Distance.
    await expect(page.locator('.dynaval')).toContainText('Distance');
    const graph = page.locator('.dynabox');
    const distVal = () => page.locator('.dynaval .dynanum').nth(1).innerText();
    const before = await distVal();

    const box = (await graph.boundingBox())!;
    // Press at the cone end then drag away from it, keeping y constant (Position untouched).
    await page.mouse.move(box.x + 4, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width - 4, box.y + box.height / 2, { steps: 8 });
    await page.mouse.up();

    const after = await distVal();
    expect(parseFloat(after)).toBeGreaterThan(parseFloat(before));
    expect(parseFloat(after)).toBeGreaterThan(8); // driven to the far end of the range
  });
});
