import { test, expect, type Page, type Route } from '@playwright/test';
import { bootCleanWorkbench } from './support/workbench';

// Narrow-viewport dial layout (Steam Deck class, 1280x800 and below).
//
// REPORT: "some dials were bunched up in one spot" on a Steam Deck. Root cause, measured: the board's
// grid template is built from `displayCols` (what fits the pane) while the arrangement can carry more
// columns than that. A widget placed at `grid-column: 9` in an 8-column template lands in an IMPLICIT
// column — CSS gives those zero width — so the trailing dials render on top of each other, separated by
// only the grid gap. A wide device-true page (the amp 'Ideal' row has ~12 controls) shows it best.
//
// The board already re-packs into the shown columns (packRows for device-authentic boards), but only
// when `displayCols < cols`; it does NOT fire when the arrangement simply does not fit. This spec pins
// the user-visible invariant instead: on a narrow viewport no two dials may overlap and none may sit
// outside the board.

const CAPS = {
  slotModel: 'grid', slotCount: 512, grid: { rows: 4, cols: 6 }, hasScenes: false, sceneCount: 0,
  hasChannels: false, channelNames: [], channelBlocks: [], supportsSave: true, gridRouting: true,
  gridCursorSelect: false, shuntBase: 1024, editorLayouts: true
};
const DEVICE = { model: 'FM3', modelByte: '0x11', modelId: 17, apiVersion: 2, capabilities: CAPS, firmware: null, port: 'mock' };
const DETECT = { connected: true, modelId: 17, name: 'FM3', short: 'FM3', gen: 3, supported: true, port: 'mock' };
const GRID = {
  model: 'FM3', name: 'MOCK LAYOUT', crcValid: true, rows: 4, cols: 6, scenes: [],
  cells: [{ row: 0, col: 0, effectId: 200, name: 'Drive 1', slug: 'Drive', isShunt: false, routeFlag: 0, fromRows: [] }]
};

const knob = (id: number, name: string) => ({ id, name, value: 0, norm: 0.5, min: 0, max: 10 });
const WIDE = Array.from({ length: 12 }, (_, i) => i); // the amp 'Ideal' row carries ~12 controls
const BLOCK_PARAMS = {
  block: 'Drive', slug: 'drive', page: 12,
  named: WIDE.map((i) => knob(i, `Knob ${i}`)),
  enums: [],
  type: { value: 3, name: 'FET Boost' },
  layout: {
    editorName: 'Drive', family: 'DRIVE', variantName: 'Type', variantValue: 'FET Boost',
    pages: [
      {
        name: 'Ideal',
        rows: [
          { section: 'parameters', controls: WIDE.map((i) => ({ label: `Knob ${i}`, paramName: `DRIVE_K${i}`, paramId: i, widget: 'knob', rawWidget: 'knob' })) },
          { section: 'parameters', controls: [
            { label: 'Low Cut', paramName: 'DRIVE_LOCUT', paramId: 3, widget: 'knob', rawWidget: 'knob' },
            { label: 'Level', paramName: 'DRIVE_LEVEL', paramId: 5, widget: 'knob', rawWidget: 'knob' },
            { label: 'High Cut', paramName: 'DRIVE_HICUT', paramId: 7, widget: 'knob', rawWidget: 'knob' }
          ] }
        ]
      }
    ]
  }
};

async function bootWideBoard(page: Page): Promise<void> {
  const json = (route: Route, body: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
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
  await page.locator('[data-idx="0,0"].cell.block').click();
  await page.locator('.boardwrap').waitFor({ state: 'visible' });
  await page.waitForTimeout(400);
}

interface Dial { x: number; y: number; w: number; h: number }

/** Every dial on the board, plus the board box, measured in page coordinates. */
async function dials(page: Page): Promise<{ dials: Dial[]; board: Dial }> {
  return page.evaluate(() => {
    const box = (el: Element) => { const r = el.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }; };
    const wrap = document.querySelector('.boardwrap') as HTMLElement;
    return { dials: [...document.querySelectorAll('.dialwrap')].map(box), board: box(wrap) };
  });
}

/** Overlapping dial pairs — the "bunched up in one spot" symptom. */
function overlaps(ds: Dial[]): string[] {
  const hit = (a: Dial, b: Dial) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
  const out: string[] = [];
  for (let i = 0; i < ds.length; i++) for (let j = i + 1; j < ds.length; j++) if (hit(ds[i]!, ds[j]!)) out.push(`${i}~${j}`);
  return out;
}

test.describe('narrow-viewport dial layout', () => {
  // 1280x800 is the reported device class (Steam Deck); 1440x900 is the desktop reference — the same
  // defect showed there too (the tail of a wide row collapsed), just with fewer dials affected.
  // Below ~1100px the app switches to the compact drawer profile, whose grid cell is not directly
  // clickable (different navigation path), so that layout is out of scope for this spec.
  for (const vp of [{ width: 1280, height: 800 }, { width: 1440, height: 900 }]) {
    test(`no dial overlaps or escapes the board at ${vp.width}x${vp.height}`, async ({ page }) => {
      await page.setViewportSize(vp);
      await bootWideBoard(page);

      const { dials: ds, board } = await dials(page);
      expect(ds.length, 'the wide page renders its dials').toBe(12);

      const bad = overlaps(ds);
      expect(bad, `overlapping dial pairs (bunched up): ${bad.join(', ')}`).toEqual([]);

      // Every dial must sit inside the board box — a placement beyond the grid template escapes it.
      const escaped = ds.map((d, i) => ({ i, right: d.x + d.w, bottom: d.y + d.h }))
        .filter((d) => d.right > board.x + board.w + 1 || d.bottom > board.y + board.h + 1);
      expect(escaped, `dials outside the board: ${escaped.map((e) => e.i).join(', ')}`).toEqual([]);
    });
  }
});
