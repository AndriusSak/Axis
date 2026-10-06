import { test, expect, type Page, type Route } from '@playwright/test';
import { bootCleanWorkbench } from './support/workbench';

/**
 * Number-view readout must not overlap the −/＋ stepper buttons.
 *
 * The `number` view of a continuous control renders `.numrow` = [−] `.kval.big` [＋]. `.kval` is
 * absolutely positioned (`inset: 0`) to centre a readout over a whole tile, so in `.numrow` it was
 * pulled out of the flex flow and centred over the ENTIRE tile — landing on top of both stepper
 * buttons. Reported from a Steam Deck on the Amp block's HEADROOM control. The fix puts the readout
 * back in the flow (see ControlSurface `.numrow .kval`).
 *
 * This guard measures the bounding boxes of the readout and BOTH steppers and asserts they do not
 * intersect, and that the readout stays inside its tile — at the Steam-Deck-class 1280×800 and the
 * desktop 1440×900. It covers BOTH render paths: the device board tile and the control-search row.
 */

const CAPS = { slotModel: 'grid', slotCount: 512, grid: { rows: 4, cols: 6 }, hasScenes: false, sceneCount: 0, hasChannels: false, channelNames: [], channelBlocks: [], supportsSave: true, gridRouting: true, gridCursorSelect: false, shuntBase: 1024, editorLayouts: true };
const DEVICE = { model: 'FM3', modelByte: '0x11', modelId: 17, apiVersion: 2, capabilities: CAPS, firmware: null, port: 'mock' };
const DETECT = { connected: true, modelId: 17, name: 'FM3', short: 'FM3', gen: 3, supported: true, port: 'mock' };
const GRID = (slug: string, name: string) => ({
  model: 'FM3',
  name: `MOCK ${name}`,
  crcValid: true,
  rows: 4,
  cols: 6,
  scenes: [],
  cells: [{ row: 0, col: 0, effectId: 200, name, slug, isShunt: false, routeFlag: 0, fromRows: [] }]
});

const named = (id: number, name: string, norm = 0.5) => ({ id, name, value: norm * 10, norm, min: 0, max: 10 });
const knobCtl = (label: string, paramId: number) => ({ label, paramName: null, paramId, widget: 'knob', rawWidget: 'knob' });
// A control the device serves with the number/readout widget hint → renders the `number` view.
const numCtl = (label: string, paramId: number) => ({ label, paramName: `AMP_${label.toUpperCase().replace(/\W+/g, '_')}`, paramId, widget: 'number', rawWidget: 'readout' });

const AMP_PARAMS = {
  block: 'Amp', slug: 'amp', page: 12,
  named: [named(5, 'Headroom', 0.7), named(1, 'Bass', 0.5), named(2, 'Mid', 0.5), named(3, 'Treble', 0.5)],
  enums: [],
  type: { value: 1, name: 'USA MK IV' },
  layout: {
    editorName: 'Amp', family: 'AMP', variantName: 'Type', variantValue: 'USA MK IV NUMBERVIEW',
    pages: [{
      name: 'Ideal',
      rows: [{ section: 'parameters', controls: [numCtl('Headroom', 5), knobCtl('Bass', 1), knobCtl('Mid', 2), knobCtl('Treble', 3)] }]
    }]
  }
};

async function bootBlock(page: Page, vp: { width: number; height: number }): Promise<void> {
  await page.setViewportSize(vp);
  // Deterministic board: a prior run must not leave a stale surface profile in localStorage.
  await page.addInitScript(() => {
    for (const k of Object.keys(window.localStorage)) {
      if (k.startsWith('axs.surface')) window.localStorage.removeItem(k);
    }
  });
  const json = (route: Route, body: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname.replace(/^\/api/, '');
    if (path === '/device') return json(route, DEVICE);
    if (path === '/device/detect') return json(route, DETECT);
    if (path === '/healthz') return json(route, { ok: true, api: { version: 2 }, device: 'FM3' });
    if (path === '/preset/grid') return json(route, GRID('amp', 'USA MK IV'));
    if (path === '/preset/blocks') return json(route, []);
    if (path === '/ports') return json(route, { chosen: null, override: null, profileOverride: null, ports: [] });
    if (/^\/preset\/blocks\/200\/params$/.test(path)) return json(route, AMP_PARAMS);
    return json(route, {});
  });
  await page.route('**/api/events', (route) => route.abort());
  await bootCleanWorkbench(page);
  await expect(page.locator('[data-idx="0,0"].cell.block')).toBeVisible();
  await page.locator('[data-idx="0,0"].cell.block').click();
  await expect(page.locator('.boardwrap')).toBeVisible();
  await page.waitForTimeout(400);
}

/** Measure the .numrow inside `scopeSel`: readout vs both steppers, and the readout vs its tile. */
async function measureNumRow(page: Page, scopeSel: string) {
  return page.evaluate((scope) => {
    const scopeEl = document.querySelector(scope) as HTMLElement | null;
    if (!scopeEl) return { error: 'no scope ' + scope };
    const row = scopeEl.querySelector('.numrow') as HTMLElement | null;
    if (!row) return { error: 'no .numrow in ' + scope };
    const steps = [...row.querySelectorAll('button.step')].map((b) => b.getBoundingClientRect());
    const readoutEl = row.querySelector('.kval') as HTMLElement | null;
    const tile = row.closest('.card') as HTMLElement | null;
    if (!readoutEl || !tile) return { error: 'missing readout or tile' };
    const r = readoutEl.getBoundingClientRect();
    const t = tile.getBoundingClientRect();
    const box = (x: DOMRect) => ({ l: Math.round(x.left), t: Math.round(x.top), r: Math.round(x.right), b: Math.round(x.bottom), w: Math.round(x.width), h: Math.round(x.height) });
    const inter = (a: DOMRect, b: DOMRect) => Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) * Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
    return {
      row: box(row.getBoundingClientRect()),
      readout: box(r),
      steps: steps.map(box),
      tile: box(t),
      overlapMinus: Math.round(inter(r, steps[0])),
      overlapPlus: Math.round(inter(r, steps[1])),
      // distance the readout pokes outside the tile (0 when fully inside)
      overflowLeft: Math.round(Math.max(0, t.left - r.left)),
      overflowRight: Math.round(Math.max(0, r.right - t.right))
    };
  }, scopeSel);
}

for (const vp of [{ width: 1280, height: 800 }, { width: 1440, height: 900 }]) {
  test.describe(`number view readout is in-flow, not over the steppers @ ${vp.width}x${vp.height}`, () => {
    test('device board tile: readout clears both steppers and stays in the tile', async ({ page }) => {
      await bootBlock(page, vp);
      const m = await measureNumRow(page, '.boardwrap');
      // eslint-disable-next-line no-console
      console.log('NUMROW BOARD ' + vp.width + 'x' + vp.height + ' ' + JSON.stringify(m));

      expect(m.error ?? null).toBeNull();
      expect(m.overlapMinus, `readout overlaps − by ${m.overlapMinus}px²`).toBe(0);
      expect(m.overlapPlus, `readout overlaps ＋ by ${m.overlapPlus}px²`).toBe(0);
      expect(m.overflowLeft, `readout pokes ${m.overflowLeft}px out the tile's left`).toBe(0);
      expect(m.overflowRight, `readout pokes ${m.overflowRight}px out the tile's right`).toBe(0);
    });

    test('control-search row: readout clears both steppers and stays in the tile', async ({ page }) => {
      await bootBlock(page, vp);
      await page.locator('.csin').fill('headroom');
      await expect(page.locator('.resrow')).toHaveCount(1);
      const m = await measureNumRow(page, '.resrow');
      // eslint-disable-next-line no-console
      console.log('NUMROW SEARCH ' + vp.width + 'x' + vp.height + ' ' + JSON.stringify(m));

      expect(m.error ?? null).toBeNull();
      expect(m.overlapMinus, `readout overlaps − by ${m.overlapMinus}px²`).toBe(0);
      expect(m.overlapPlus, `readout overlaps ＋ by ${m.overlapPlus}px²`).toBe(0);
      expect(m.overflowLeft, `readout pokes ${m.overflowLeft}px out the tile's left`).toBe(0);
      expect(m.overflowRight, `readout pokes ${m.overflowRight}px out the tile's right`).toBe(0);
    });
  });
}
