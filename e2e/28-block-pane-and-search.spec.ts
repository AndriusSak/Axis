import { test, expect, type Page, type Route } from '@playwright/test';
import { bootCleanWorkbench } from './support/workbench';

/**
 * Block-pane UX (audit §3.6 items 1-2).
 *
 * 1. The block editor drawer was too short: at 1440×900 the card was 323px with 226px of chrome,
 *    leaving a 170px control area for a 471px Cab board — so the board scrolled and the lower cab
 *    slot's control was clipped. Opening a block now expands the drawer (desktop/tablet share one
 *    PR with the phone flow) and ControlSurface caps the cell to the pane height (fit-to-view), so
 *    the WHOLE device board is visible without scrolling.
 * 2. Control search rendered every match as a full 118×112 control card, so a short pane showed one
 *    match. Results are now a compact single-column list — many matches fit.
 *
 * Scope: 1280×800 (Steam Deck class) and 1440×900 (desktop). Below ~1100px the shell switches to the
 * compact drawer profile, whose grid cell is not directly clickable — out of scope here.
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

// ── Mock A: the real FM3 DynaCab Cab page, both slots (3-row board; M/S + mic graphs) ──
const states = (v: number) => ({ id: 0, name: '', value: v, options: [{ value: 0, label: '--' }, { value: 1, label: 'MUTE' }, { value: 2, label: 'SOLO' }] });
const muteEnum = (id: number, name: string, value = 0) => ({ ...states(value), id, name });
const muteBtn = (label: string, paramId: number, paramName: string) => ({ label, paramName, paramId, widget: 'button', rawWidget: 'btnSquare' });
const knobCtl = (label: string, paramId: number, rawWidget = 'knobMiniReadout') => ({ label, paramName: null, paramId, widget: 'knob', rawWidget });
const named = (id: number, name: string, norm = 0) => ({ id, name, value: norm * 10, norm, min: 0, max: 10 });
const enumNamed = (id: number, name: string, n = 3) => ({ id, name, value: 0, options: Array.from({ length: n }, (_, i) => ({ value: i, label: `OPT${i}` })) });

const CAB_PARAMS = {
  block: 'Cab', slug: 'cab', page: 12,
  named: [named(93, 'DynaCab1 Pos'), named(97, 'DynaCab1 Dist'), named(8, 'Level 1'), named(12, 'Pan 1'), named(94, 'DynaCab2 Pos'), named(98, 'DynaCab2 Dist'), named(9, 'Level 2'), named(13, 'Pan 2')],
  enums: [muteEnum(24, 'MUTE1'), muteEnum(25, 'MUTE2'), enumNamed(85, 'DYNACAB TYPE1', 45), enumNamed(89, 'DYNACAB MIC1', 4), enumNamed(86, 'DYNACAB TYPE2', 45), enumNamed(90, 'DYNACAB MIC2', 4)],
  type: { value: 1, name: 'DYNA-CAB' },
  layout: {
    editorName: 'Cab', family: 'CABINET', variantName: 'Mode', variantValue: 'DYNA-CAB',
    pages: [{
      name: 'Cab',
      rows: [{
        section: 'parameters',
        controls: [
          muteBtn('M', 65286, 'CABINET_BTN_MUTE1'), muteBtn('S', 65288, 'CABINET_BTN_SOLO1'),
          { label: 'DynaCab', paramName: 'CABINET_DYNACAB_R1', paramId: 93, widget: 'unknown', rawWidget: 'dynaCabControl' },
          knobCtl('Pan', 12), knobCtl('Distance', 97), knobCtl('Level', 8),
          muteBtn('M', 65287, 'CABINET_BTN_MUTE2'), muteBtn('S', 65289, 'CABINET_BTN_SOLO2'),
          { label: 'DynaCab', paramName: 'CABINET_DYNACAB_R2', paramId: 94, widget: 'unknown', rawWidget: 'dynaCabControl' },
          knobCtl('Pan', 13), knobCtl('Distance', 98), knobCtl('Level', 9)
        ]
      }]
    }]
  }
};

// ── Mock B: a wide 3-row board of 12 knobs + a couple of enums (plenty of search matches) ──
const odd = (id: number, name: string, norm = 0.5) => ({ id, name, value: norm * 10, norm, min: 0, max: 10 });
const rowOf = (ids: number[]) => ({ section: 'parameters', controls: ids.map((i) => ({ label: `Knob ${i}`, paramName: `DRIVE_K${i}`, paramId: i, widget: 'knob', rawWidget: 'knob' })) });
const DRIVE_PARAMS = {
  block: 'Drive', slug: 'drive', page: 12,
  named: Array.from({ length: 12 }, (_, i) => odd(i, `Knob ${i}`)),
  enums: [enumNamed(20, 'Mode', 3)],
  type: { value: 3, name: 'FET Boost' },
  layout: {
    editorName: 'Drive', family: 'DRIVE', variantName: 'Type', variantValue: 'FET Boost',
    pages: [{ name: 'Ideal', rows: [rowOf([0, 1, 2, 3]), rowOf([4, 5, 6, 7]), rowOf([8, 9, 10, 11])] }]
  }
};

async function bootBlock(
  page: Page,
  vp: { width: number; height: number },
  slug: string,
  name: string,
  params: unknown
): Promise<void> {
  await page.setViewportSize(vp);
  const json = (route: Route, body: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname.replace(/^\/api/, '');
    if (path === '/device') return json(route, DEVICE);
    if (path === '/device/detect') return json(route, DETECT);
    if (path === '/healthz') return json(route, { ok: true, api: { version: 2 }, device: 'FM3' });
    if (path === '/preset/grid') return json(route, GRID(slug, name));
    if (path === '/preset/blocks') return json(route, []);
    if (path === '/ports') return json(route, { chosen: null, override: null, profileOverride: null, ports: [] });
    if (/^\/preset\/blocks\/200\/params$/.test(path)) return json(route, params);
    return json(route, {});
  });
  await page.route('**/api/events', (route) => route.abort());
  await bootCleanWorkbench(page);
  await expect(page.locator('[data-idx="0,0"].cell.block')).toBeVisible();
  await page.locator('[data-idx="0,0"].cell.block').click();
  await expect(page.locator('.boardwrap')).toBeVisible();
  await page.waitForTimeout(400);
}

/** Visible rectangle (clipped by every scroll/clip ancestor and the viewport). */
const visibleRectFn = `
  (el) => {
    let r = el.getBoundingClientRect();
    let l = r.left, t = r.top, rr = r.right, b = r.bottom;
    for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
      const cs = getComputedStyle(p);
      if (cs.overflow === 'visible' && cs.overflowX === 'visible' && cs.overflowY === 'visible') continue;
      const pr = p.getBoundingClientRect();
      l = Math.max(l, pr.left); t = Math.max(t, pr.top);
      rr = Math.min(rr, pr.right); b = Math.min(b, pr.bottom);
    }
    l = Math.max(l, 0); t = Math.max(t, 0);
    rr = Math.min(rr, window.innerWidth); b = Math.min(b, window.innerHeight);
    return { w: Math.max(0, rr - l), h: Math.max(0, b - t) };
  }`;

// ── Mock C: a TALL board (6 rows x 6 knobs) — the Amp "Ideal" page shape. This is the case where a
// height-based cell cap BINDS. The 3-row Cab board never exercised it, which is exactly how the
// "everything shrunk" regression shipped: the cap clamped the cell to its 48px floor → 30px dials,
// the board at ~half the pane width (large empty gutter) AND it still scrolled. ──
const TALL_ROWS = 6;
const TALL_AMP = {
  block: 'Amp', slug: 'amp', page: 12,
  named: Array.from({ length: TALL_ROWS * 6 }, (_, i) => named(i, `Knob ${i}`)),
  enums: [],
  type: { value: 1, name: 'USA MK IV' },
  layout: {
    editorName: 'Amp', family: 'AMP', variantName: 'Type', variantValue: 'USA MK IV',
    pages: [{
      name: 'Ideal',
      rows: Array.from({ length: TALL_ROWS }, (_, r) => ({
        section: 'parameters',
        controls: [0, 1, 2, 3, 4, 5].map((c) => knobCtl(`Knob ${r * 6 + c}`, r * 6 + c))
      }))
    }]
  }
};

/**
 * The invariants that matter for the block board (replaces the old "the board must not scroll"
 * assertion — that is what drove the shrink-to-illegible regression):
 *  - dials stay READABLE (a legibility floor on the dial width),
 *  - the board FILLS the pane width (a shrunken cell leaves a dead gutter),
 *  - the editor footer stays REACHABLE by scrolling (the card is the scroll container).
 */
async function measureBoard(page: Page) {
  const m = await page.evaluate((visSrc) => {
    const visible = eval(visSrc) as (el: Element) => { w: number; h: number };
    const content = document.querySelector('.card .content') as HTMLElement;
    const card = document.querySelector('.card') as HTMLElement;
    const board = document.querySelector('.boardwrap') as HTMLElement;
    const paneW = content.clientWidth;
    const tpl = getComputedStyle(document.querySelector('.gridlayer') as HTMLElement).gridTemplateColumns;
    const cell = Math.round(parseFloat(tpl.split(' ')[0]));
    const dials = [...document.querySelectorAll('.dialwrap, .knob')].map((d) => d.getBoundingClientRect().width);
    return {
      paneW,
      boardW: Math.round(board.getBoundingClientRect().width),
      boardVisibleW: Math.round(visible(board).w),
      cell,
      dialMin: dials.length ? Math.round(Math.min(...dials)) : 0,
      dialCount: dials.length,
      // measured at the INITIAL scroll position (before any scrolling)
      fields: [...document.querySelectorAll('.selfield')].map((f) => {
        const v = visible(f);
        return { area: Math.round(v.w * v.h) };
      }),
      contentScroll: content.scrollHeight,
      contentClient: content.clientHeight
    };
  }, visibleRectFn);
  // Reachability of the footer: scroll the card to the end and re-measure.
  const foot = await page.evaluate(async () => {
    const card = document.querySelector('.card') as HTMLElement;
    card.scrollTop = card.scrollHeight;
    await new Promise((r) => setTimeout(r, 120));
    const btns = [...document.querySelectorAll('footer.foot button.act')];
    const vis = (el: Element) => {
      const b = el.getBoundingClientRect();
      const c = (document.querySelector('.card') as HTMLElement).getBoundingClientRect();
      return { w: Math.max(0, Math.min(b.right, c.right) - Math.max(b.left, c.left)), h: Math.max(0, Math.min(b.bottom, c.bottom) - Math.max(b.top, c.top)) };
    };
    return { footer: btns.map((b) => Math.round(vis(b).h)) };
  });
  return { ...m, ...foot };
}

test.describe('block board stays legible and fills the pane', () => {
  for (const vp of [{ width: 1280, height: 800 }, { width: 1440, height: 900 }]) {
    test(`Cab board legible + full width + footer reachable at ${vp.width}x${vp.height}`, async ({ page }) => {
      await bootBlock(page, vp, 'Cab', '4x12 Recto', CAB_PARAMS);
      const m = await measureBoard(page);
      // eslint-disable-next-line no-console
      console.log('BOARD CAB ' + vp.width + 'x' + vp.height + ' ' + JSON.stringify(m));

      // Readability floor: dials must not be shrunk into unreadable specks.
      expect(m.dialMin, `smallest dial ${m.dialMin}px`).toBeGreaterThanOrEqual(36);
      // The board fills the pane width (no dead gutter from a shrunken cell).
      expect(m.boardVisibleW, `board ${m.boardVisibleW}px of ${m.paneW}px pane`).toBeGreaterThanOrEqual(m.paneW * 0.9);
      // Both cab-slot M/S controls are REACHABLE with real area (a readable board is taller than a
      // short pane, so scrolling is expected — the invariant is reachability, not initial visibility).
      const reach = await page.evaluate(async () => {
        const card = document.querySelector('.card') as HTMLElement;
        const c = card.getBoundingClientRect();
        const out: number[] = [];
        for (const f of [...document.querySelectorAll('.selfield')]) {
          (f as HTMLElement).scrollIntoView({ block: 'center' });
          await new Promise((r) => setTimeout(r, 80));
          const b = f.getBoundingClientRect();
          const w = Math.max(0, Math.min(b.right, c.right) - Math.max(b.left, c.left));
          const h = Math.max(0, Math.min(b.bottom, c.bottom) - Math.max(b.top, c.top));
          out.push(Math.round(w * h));
        }
        return out;
      });
      expect(reach.length).toBe(2);
      for (const a of reach) expect(a, `M/S control reachable area ${a}`).toBeGreaterThan(200);
      // Footer actions are reachable (after scrolling the card to its end).
      for (const h of m.footer) expect(h).toBeGreaterThan(4);
    });

    test(`TALL board keeps dials legible + fills the pane at ${vp.width}x${vp.height}`, async ({ page }) => {
      await bootBlock(page, vp, 'Amp', 'USA MK IV', TALL_AMP);
      const m = await measureBoard(page);
      // eslint-disable-next-line no-console
      console.log('BOARD TALL ' + vp.width + 'x' + vp.height + ' ' + JSON.stringify(m));

      // The regression: a height-based cell cap clamped the cell to 48px and dials to ~30px here.
      expect(m.cell, `cell ${m.cell}px`).toBeGreaterThanOrEqual(60);
      expect(m.dialMin, `smallest dial ${m.dialMin}px`).toBeGreaterThanOrEqual(36);
      expect(m.boardVisibleW, `board ${m.boardVisibleW}px of ${m.paneW}px pane`).toBeGreaterThanOrEqual(m.paneW * 0.9);
      // A tall board may scroll — that is fine — but the footer must stay reachable.
      for (const h of m.footer) expect(h).toBeGreaterThan(4);
    });
  }
});

test.describe('control search results are compact', () => {
  for (const vp of [{ width: 1280, height: 800 }, { width: 1440, height: 900 }]) {
    test(`many matches are visible at once at ${vp.width}x${vp.height}`, async ({ page }) => {
      await bootBlock(page, vp, 'Drive', 'Drive 1', DRIVE_PARAMS);

      await page.locator('.csin').fill('knob');
      // 12 served knobs all match.
      await expect(page.locator('.cscount')).toHaveText('12 matches');
      await expect(page.locator('.resrow')).toHaveCount(12);

      const m = await page.evaluate((visSrc) => {
        const visible = eval(visSrc) as (el: Element) => { w: number; h: number };
        const rows = [...document.querySelectorAll('.resrow')] as HTMLElement[];
        return {
          rows: rows.length,
          rowHeights: rows.map((r) => Math.round(r.getBoundingClientRect().height)),
          visible: rows.filter((r) => { const v = visible(r); return v.h > 4 && v.w > 4; }).length
        };
      }, visibleRectFn);

      // eslint-disable-next-line no-console
      console.log('SEARCH ROWS ' + vp.width + 'x' + vp.height + ' ' + JSON.stringify(m));

      expect(m.rows).toBe(12);
      // Compact rows: each well under the old 112px full-card tile.
      for (const h of m.rowHeights) expect(h).toBeLessThanOrEqual(64);
      // The point of the fix: far more than one match is actually visible.
      expect(m.visible, `only ${m.visible} of ${m.rows} rows visible`).toBeGreaterThanOrEqual(6);
    });
  }
});
