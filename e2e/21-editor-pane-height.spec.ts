import { test, expect, type Page, type Route } from '@playwright/test';
import { bootCleanWorkbench } from './support/workbench';

// The block editor must stay usable in a short pane.
//
// MEASURED DEFECT (default seeded layout, grid page, block selected, at BOTH 1280x800 and 1440x900):
// the editor card stacks header (65px) + GridMap (204px, `flex: none`) + tab strip (52px) + the dial
// board (`.content`, `flex: 1; min-height: 0`) + footer (65px) = 386px of fixed sections inside a 323px
// pane. The only flexible child is the board, so it collapsed to 32px (`scrollHeight` 334 vs `clientHeight`
// 32) and the card — `overflow: hidden` — clipped the footer: Mute / Scene Ignore / Engaged / Remove were
// unreachable, and every dial had ZERO visible height. The auxiliary GRID MAP was taking 204px while the
// primary content was invisible.
//
// Invariants pinned here: the board keeps a usable height, and the editor's own footer actions stay
// reachable. The map is allowed to yield (it is a collapsible auxiliary view).

const CAPS = { slotModel: 'grid', slotCount: 512, grid: { rows: 4, cols: 6 }, hasScenes: false, sceneCount: 0, hasChannels: false, channelNames: [], channelBlocks: [], supportsSave: true, gridRouting: true, gridCursorSelect: false, shuntBase: 1024, editorLayouts: true };
const DEVICE = { model: 'FM3', modelByte: '0x11', modelId: 17, apiVersion: 2, capabilities: CAPS, firmware: null, port: 'mock' };
const DETECT = { connected: true, modelId: 17, name: 'FM3', short: 'FM3', gen: 3, supported: true, port: 'mock' };
const GRID = { model: 'FM3', name: 'MOCK', crcValid: true, rows: 4, cols: 6, scenes: [], cells: [{ row: 0, col: 0, effectId: 200, name: 'Drive 1', slug: 'Drive', isShunt: false, routeFlag: 0, fromRows: [] }] };
const knob = (id: number, name: string) => ({ id, name, value: 0, norm: 0.5, min: 0, max: 10 });
const WIDE = Array.from({ length: 12 }, (_, i) => i);
const BLOCK_PARAMS = {
  block: 'Drive', slug: 'drive', page: 12, named: WIDE.map((i) => knob(i, `Knob ${i}`)), enums: [], type: { value: 3, name: 'FET Boost' },
  layout: { editorName: 'Drive', family: 'DRIVE', variantName: 'Type', variantValue: 'FET Boost', pages: [{ name: 'Ideal', rows: [{ section: 'parameters', controls: WIDE.map((i) => ({ label: `Knob ${i}`, paramName: `DRIVE_K${i}`, paramId: i, widget: 'knob', rawWidget: 'knob' })) }] }] }
};

async function bootEditor(page: Page, vp: { width: number; height: number }): Promise<void> {
  await page.setViewportSize(vp);
  const json = (route: Route, body: unknown) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
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
  await page.waitForTimeout(500);
}

test.describe('block editor in a short pane', () => {
  for (const vp of [{ width: 1280, height: 800 }, { width: 1440, height: 900 }]) {
    test(`board stays usable and the editor footer stays reachable at ${vp.width}x${vp.height}`, async ({ page }) => {
      await bootEditor(page, vp);

      const m = await page.evaluate(() => {
        // visible rect = box clipped by every scrollable/clipping ancestor and the viewport
        const visible = (el: Element) => {
          const r = el.getBoundingClientRect();
          let l = r.left, t = r.top, rr = r.right, b = r.bottom;
          for (let p = el.parentElement; p; p = p.parentElement) {
            const cs = getComputedStyle(p);
            if (cs.overflow === 'visible' && cs.overflowX === 'visible' && cs.overflowY === 'visible') continue;
            const pr = p.getBoundingClientRect();
            l = Math.max(l, pr.left); t = Math.max(t, pr.top);
            rr = Math.min(rr, pr.right); b = Math.min(b, pr.bottom);
          }
          l = Math.max(l, 0); t = Math.max(t, 0);
          rr = Math.min(rr, window.innerWidth); b = Math.min(b, window.innerHeight);
          return { w: Math.max(0, rr - l), h: Math.max(0, b - t) };
        };
        const board = document.querySelector('.boardwrap') as HTMLElement;
        const scroller = board.closest('.content') as HTMLElement;
        const dials = [...document.querySelectorAll('.dialwrap')];
        const footerBtns = [...document.querySelectorAll('footer.foot button.act')];
        const map = document.querySelector('.map') as HTMLElement | null;
        const mapBox = map ? map.getBoundingClientRect() : null;
        return {
          scrollerClientH: scroller.clientHeight,
          scrollerScrollH: scroller.scrollHeight,
          dialCount: dials.length,
          dialsVisible: dials.filter((d) => visible(d).h > 4).length,
          footer: footerBtns.map((b) => ({ label: (b.textContent || '').trim(), visibleH: Math.round(visible(b).h) })),
          mapHeight: mapBox ? Math.round(mapBox.height) : null,
          cardScrollH: (document.querySelector('.card') as HTMLElement).scrollHeight,
          cardClientH: (document.querySelector('.card') as HTMLElement).clientHeight
        };
      });

      // the board's scroller must give the board a usable height (a dial row is ~150px)
      expect(m.scrollerClientH, `board scroller height (scrollH=${m.scrollerScrollH})`).toBeGreaterThanOrEqual(150);
      // and the board must actually be visible, not clipped away by the card
      expect(m.dialsVisible, `dials with visible pixels (of ${m.dialCount})`).toBeGreaterThan(0);
      // the editor's own actions must stay reachable. In a pane this short the card legitimately
      // scrolls, so "reachable" means: scroll it to the end and the actions are then visible.
      expect(m.footer.length, 'editor footer actions exist').toBeGreaterThan(0);
      const afterScroll = await page.evaluate(() => {
        const visible = (el: Element) => {
          const r = el.getBoundingClientRect();
          let l = r.left, t = r.top, rr = r.right, b = r.bottom;
          for (let p = el.parentElement; p; p = p.parentElement) {
            const cs = getComputedStyle(p);
            if (cs.overflow === 'visible' && cs.overflowX === 'visible' && cs.overflowY === 'visible') continue;
            const pr = p.getBoundingClientRect();
            l = Math.max(l, pr.left); t = Math.max(t, pr.top);
            rr = Math.min(rr, pr.right); b = Math.min(b, pr.bottom);
          }
          l = Math.max(l, 0); t = Math.max(t, 0);
          rr = Math.min(rr, window.innerWidth); b = Math.min(b, window.innerHeight);
          return { w: Math.max(0, rr - l), h: Math.max(0, b - t) };
        };
        const card = document.querySelector('.card') as HTMLElement;
        card.scrollTop = card.scrollHeight; // reach for the bottom of the editor
        return {
          cardOverflowY: getComputedStyle(card).overflowY,
          footer: [...document.querySelectorAll('footer.foot button.act')].map((b) => ({ label: (b.textContent || '').trim(), visibleH: Math.round(visible(b).h) }))
        };
      });
      expect(afterScroll.cardOverflowY, 'the card scrolls rather than clipping').toBe('auto');
      const stillClipped = afterScroll.footer.filter((f) => f.visibleH <= 4).map((f) => f.label);
      expect(stillClipped, `editor footer actions unreachable even after scrolling: ${stillClipped.join(', ')}`).toEqual([]);
    });
  }
});
