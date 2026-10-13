import { test, expect, type Page, type Route } from '@playwright/test';
import { bootCleanWorkbench } from './support/workbench';
import { readFileSync } from 'node:fs';

/**
 * The Cab block's mic-placement control, rendered from the REAL served payload.
 *
 * `e2e/23-dynacab-mic-graph.spec.ts` and `27-cab-mute-controls.spec.ts` drive the DynaCab tile over
 * HAND-BUILT toy layouts (4 and 12 controls, no separator, no group labels). The payload an FM3
 * actually serves is far bigger: `src/lib/cabBoard.fixture.json` is the live `GET
 * /preset/blocks/62/params` for Cab 1 of preset 410 (a `1x8 PRINCETONE` DynaCab cab) — 37 params, 23
 * enums, and ONE layout row of 30 controls split by the device's own `Seperator` into cab 1 / cab 2
 * bands. This spec pins the RENDER over that exact shape, because a band/header/width regression in
 * the builder is invisible to the toy mocks.
 *
 * It also pins the honest finding for the owner's "the mic placement UI is nowhere to be seen"
 * (2026-10-12): the tile IS drawn and is a real 2x2 control, but the Cab board is ~1500px tall in a
 * ~280px block-editor pane, so on a Steam Deck (1280x800) the tile lands ~450px below the fold and is
 * only visible after scrolling the pane. That is the documented block-pane height defect (handoff
 * `cab-mute-and-dynacab.md` REMOTE WORK item 2 / audit §3.6 item 2) — NOT a missing control. This
 * spec therefore asserts REACHABILITY (a scrollable pane reveals it), not "visible without scrolling".
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
  name: 'MOCK LAYOUT',
  crcValid: true,
  rows: 4,
  cols: 6,
  scenes: [],
  cells: [{ row: 0, col: 0, effectId: 200, name: '1x8 Princetone', slug: 'Cab', isShunt: false, routeFlag: 0, fromRows: [] }]
};

/** The live capture: byte-identical to review-2026-10-12/r16-state/cab-1x8-PRINCETONE-params.json. */
const REAL = JSON.parse(readFileSync(new URL('../src/lib/cabBoard.fixture.json', import.meta.url), 'utf8'));

async function bootWithRealCab(page: Page): Promise<void> {
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
    if (/^\/preset\/blocks\/200\/params$/.test(path)) return json(route, REAL);
    return json(route, {});
  });
  await page.route('**/api/events', (route) => route.abort());
  await bootCleanWorkbench(page);
  await expect(page.locator('[data-idx="0,0"].cell.block')).toBeVisible();
  await page.locator('[data-idx="0,0"].cell.block').click();
  await expect(page.locator('.boardwrap')).toBeVisible();
}

test.describe('Cab mic graph — real served layout (Cab 1, preset 410)', () => {
  test('the Cab page opens by default and renders BOTH cabs\u2019 mic graphs', async ({ page }) => {
    await bootWithRealCab(page);
    // The layout's pages become tabs; the block opens on the FIRST page ("Cab").
    await expect(page.locator('.tab.on')).toHaveText('Cab');
    await expect(page.locator('.grouphead')).toHaveText(['CAB 1', 'CAB 2']);
    // One 2x2 mic tile per cab slot, each bound to its own Position + Distance param.
    await expect(page.locator('.dynabox')).toHaveCount(2);
    const vals = page.locator('.dynabox .dynaval');
    await expect(vals.nth(0)).toContainText('DynaCab 1'); // cab 1 Position: param 93
    await expect(vals.nth(0)).toContainText('Distance'); // same cab's param 97
    await expect(vals.nth(1)).toContainText('DynaCab 2'); // param 94
    await expect(vals.nth(1)).toContainText('Distance'); // param 98
  });

  test('on a Steam Deck (1280x800) the tile is reachable by scrolling the pane', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await bootWithRealCab(page);

    // The tile exists with real area (not zero-height, not dropped)...
    const area = await page.locator('.dynabox').first().evaluate((el) => {
      const r = el.getBoundingClientRect();
      return { w: Math.round(r.width), h: Math.round(r.height) };
    });
    expect(area.w).toBeGreaterThan(100);
    expect(area.h).toBeGreaterThan(100);

    // ...and the block-editor pane that clips it actually scrolls to reveal it (the documented
    // "board taller than the pane" defect: the tile is below the fold on open).
    const reach = await page.evaluate(() => {
      const bw = document.querySelector('.boardwrap') as HTMLElement;
      let pane: HTMLElement | null = bw.parentElement;
      while (pane && !(getComputedStyle(pane).overflowY !== 'visible' && pane.scrollHeight > pane.clientHeight + 2))
        pane = pane.parentElement;
      const tile = document.querySelector('.dynabox') as HTMLElement | null;
      if (pane) pane.scrollTop = 600;
      const r = tile?.getBoundingClientRect();
      return { scrollable: !!pane, scrolled: pane?.scrollTop ?? 0, top: r ? Math.round(r.top) : null, bottom: r ? Math.round(r.bottom) : null, winH: window.innerHeight };
    });
    expect(reach.scrollable, 'the pane must scroll, or the tile is unreachable').toBe(true);
    expect(reach.scrolled, 'the pane took the scroll').toBeGreaterThan(0);
    expect(reach.top!, 'after scrolling the tile is on screen').toBeLessThan(reach.winH);
    expect(reach.bottom!, 'after scrolling the tile is on screen').toBeGreaterThan(0);
  });

  /**
   * The owner's decision, 2026-10-12: "mic graph can be first and knobs after".
   *
   * The served arrangement put the graph at the END of its column's line, which is what landed it ~450px
   * below the fold. The builder now hoists it to the head of its band (below that column's own label),
   * so this asserts the user-visible outcome, not the builder's internals: on open, with no scrolling,
   * the graph is on screen AND is the first content line of its column.
   */
  test('the mic graph leads its column and is visible WITHOUT scrolling (owner decision)', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await bootWithRealCab(page);
    const m = await page.evaluate(() => {
      const bw = document.querySelector('.boardwrap') as HTMLElement;
      let pane: HTMLElement | null = bw.parentElement;
      while (pane && !(getComputedStyle(pane).overflowY !== 'visible' && pane.scrollHeight > pane.clientHeight + 2))
        pane = pane.parentElement;
      const pr = pane!.getBoundingClientRect();
      const tile = document.querySelector('.dynabox') as HTMLElement;
      // Compare against the tile's own CARD, not the tile: the tile sits ~9px inside its card, so a card
      // sharing the tile's grid line (the knobs that flow to its right) would otherwise read as "above".
      const tileCard = tile.closest('.card') as HTMLElement;
      const tc = tileCard.getBoundingClientRect();
      const tr = tile.getBoundingClientRect();
      const cards = [...document.querySelectorAll('.boardwrap .card')]
        .filter((e) => e !== tileCard)
        .map((e) => e.getBoundingClientRect());
      return {
        paneTop: Math.round(pr.top),
        paneBottom: Math.round(pr.bottom),
        cardTop: Math.round(tc.top),
        cardBottom: Math.round(tc.bottom),
        tileTop: Math.round(tr.top),
        scrollTop: Math.round(pane!.scrollTop),
        cardsAboveGraph: cards.filter((r) => r.top < tc.top - 2).length
      };
    });
    expect(m.scrollTop, 'nothing was scrolled to reach the assertion').toBe(0);
    // Leading its column: no other card starts above the graph's card. (The column's own label sits
    // above it and is a .grouphead, not a .card — that is the intent: label, then the graph.)
    expect(m.cardsAboveGraph, 'the graph is the first card of its column').toBe(0);
    // On open, and with no scrolling: the graph's card begins inside the pane and is at least partly
    // visible. Demanding FULL visibility would be the mistake the HIL review flagged (a 284px tile can
    // never be fully inside a ~281px pane); the owner's complaint is that it was not on screen at all.
    expect(m.cardTop, 'the graph starts inside the visible pane').toBeGreaterThanOrEqual(m.paneTop - 1);
    expect(m.cardTop, 'the graph is on screen without scrolling').toBeLessThan(m.paneBottom);
    expect(m.tileTop, 'the tile itself begins inside the pane').toBeGreaterThanOrEqual(m.paneTop - 1);
  });

  /**
   * MEASURED on the live FM3, 2026-10-13: the group heading ("CAB 1") occupied a FULL control row —
   * 146px inside a 170px block-editor pane — so the heading filled the visible area and the mic graph,
   * correctly ordered first in its column, began exactly at the pane's bottom edge (top 501 vs pane
   * 331..501). A label must not eat a control row. After the fix the heading row is 22px, the board
   * dropped 1840 → 1182px, and the graph card sits at top 377 — on screen on open.
   */
  test('the group heading is a strip, and the graph is on screen on open', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await bootWithRealCab(page);
    const m = await page.evaluate(() => {
      const bw = document.querySelector('.boardwrap') as HTMLElement;
      let pane: HTMLElement | null = bw.parentElement;
      while (pane && !(getComputedStyle(pane).overflowY !== 'visible' && pane.scrollHeight > pane.clientHeight + 2))
        pane = pane.parentElement;
      const pr = pane!.getBoundingClientRect();
      const head = document.querySelector('.grouphead') as HTMLElement;
      const hr = head.getBoundingClientRect();
      const tile = document.querySelector('.dynabox') as HTMLElement;
      const card = tile.closest('.card') as HTMLElement;
      const cr = card.getBoundingClientRect();
      const rows = (getComputedStyle(document.querySelector('.gridlayer') as HTMLElement).gridTemplateRows || '')
        .split(' ')
        .map((s) => parseFloat(s));
      return {
        headH: Math.round(hr.height),
        firstRow: Math.round(rows[0] ?? -1),
        cardTop: Math.round(cr.top),
        paneTop: Math.round(pr.top),
        paneBottom: Math.round(pr.bottom)
      };
    });
    // A heading is a label, not a control: its row must be a strip, never a full cell.
    expect(m.headH, 'the group heading row is a strip, not a control row').toBeLessThan(40);
    expect(m.firstRow, 'the grid template gives the heading row the same strip height').toBeLessThan(40);
    // ...and that is what puts the mic graph on screen without scrolling.
    expect(m.cardTop, 'the graph is on screen on open').toBeLessThan(m.paneBottom);
    expect(m.cardTop, 'the graph starts inside the pane').toBeGreaterThanOrEqual(m.paneTop - 1);
  });
});
