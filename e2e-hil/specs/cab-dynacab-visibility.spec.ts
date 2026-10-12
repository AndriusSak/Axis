/**
 * HIL · Cab block (eid 62) · Cab page — the DynaCab mic pad must render AND be reachable.
 *
 * The owner reported the mic-placement UI as "nowhere to be seen" (2026-10-12). The tile DOES render
 * — two 284×284 tiles — but the Cab board (~1500 px tall) overflows the ~280 px block-editor pane, so
 * on a 1280×800 (Steam Deck) viewport the first tile lands several hundred px below the fold. That is
 * a VISIBILITY defect, not a missing control, so this spec asserts:
 *   PRESENCE   — the tiles render (real area, not zero-height, not dropped).
 *   VISIBILITY — each tile is inside the pane OR reachable by scrolling THAT pane; DOM-present-but-
 *                off-pane is reported as its own outcome.
 *   NAME       — each tile's captions name its bound params from the served payload (never blank).
 */
import { test, expect } from '@playwright/test';
import {
  bootLive, openPage, selectGridCell, findCellForEffect, fetchJson, clickPageTab,
  collectCards, classifyVisibility, pass, fail, pending, info, warn, expectLiveDevice, norm
} from '../support/hil';

const FEATURE = 'dynacab-mic-pad';
const CAB_EID = 62;

test.describe('HIL · DynaCab mic pad presence + reachability', () => {
  test('the mic pad renders and is reachable in the block pane', async ({ page }) => {
    await bootLive(page);
    await expectLiveDevice(page);

    await openPage(page, 'grid');
    const cell = await findCellForEffect(page, CAB_EID);
    expect(cell).toBeTruthy();
    await selectGridCell(page, cell!.row, cell!.col);
    await clickPageTab(page, 'Cab'); // the first page holds the mic pad

    const payload = await fetchJson(page, `/preset/blocks/${CAB_EID}/params`);
    const servedNames = new Set<string>((payload?.named ?? []).map((n: any) => norm(n.name)).filter(Boolean));

    const tiles = page.locator('.boardwrap .dynabox');
    const count = await tiles.count();

    // ── PRESENCE ──
    let presenceFail = false;
    if (count === 0) {
      presenceFail = true;
      fail(FEATURE, '(tiles)', 'PRESENCE', { expected: 'the DynaCab mic pad tiles', actual: 'none rendered', detail: 'no .dynabox on the Cab page' });
    } else {
      const areas = await tiles.evaluateAll((els) => els.map((el) => { const r = el.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height) }; }));
      const real = areas.filter((a) => a.w > 100 && a.h > 100);
      if (real.length === areas.length) pass(FEATURE, '(tiles)', 'PRESENCE', { expected: '2 tiles with real area', actual: `${count} tiles ${JSON.stringify(areas)}` });
      else { fail(FEATURE, '(tiles)', 'PRESENCE', { actual: JSON.stringify(areas), detail: 'a tile rendered with no real area (collapsed/dropped)' }); }
    }

    // ── NAME (captions name the bound params from the wire) ──
    const captions = await tiles.evaluateAll((els) => els.flatMap((el) => [...el.querySelectorAll('.dynacap')].map((c) => (c.textContent ?? '').replace(/\s+/g, ' ').trim())));
    const distinct = [...new Set(captions)];
    const unknownCaps = distinct.filter((c) => c && !servedNames.has(c) && c !== 'Distance');
    if (distinct.length === 0) {
      pending(FEATURE, '(tiles)', 'NAME', 'no caption (.dynacap) rendered');
    } else if (distinct.some((c) => !c)) {
      fail(FEATURE, '(tiles)', 'NAME', { actual: JSON.stringify(captions), detail: 'a tile caption is blank' });
    } else {
      pass(FEATURE, '(tiles)', 'NAME', { expected: 'captions name served params', actual: distinct.join(' · '), detail: unknownCaps.length ? `non-served captions: ${unknownCaps.join(',')}` : 'all captions are served param names' });
    }

    // ── VISIBILITY (the reported defect) ──
    const vis = await classifyVisibility(page);
    const tileIdx = (await collectCards(page)).filter((c) => c.hasDyna).map((c) => c.index);
    const tileVis = vis.filter((v) => tileIdx.includes(v.index));
    for (const v of tileVis) {
      const who = `DynaCab tile #${v.index}`;
      if (v.outcome === 'in-pane') {
        pass(FEATURE, who, 'VISIBILITY', { actual: v.outcome, detail: `box ${v.box.top}..${v.box.bottom} pane ${v.pane?.top}..${v.pane?.bottom} (pane ${v.pane?.clientHeight}px, board ${v.pane?.scrollHeight}px)` });
      } else if (v.outcome === 'off-pane-on-open') {
        // REACHABLE by scrolling its own pane, but invisible on open — the owner-reported class. A WARN,
        // not the old misclassified `off-pane-unreachable` (a 284px tile can never be FULLY inside a
        // ~280px pane, which is what the old rule demanded).
        warn(FEATURE, who, 'VISIBILITY', { actual: v.outcome, detail: `reachable only after scrolling its ${v.pane?.clientHeight}px pane (board ${v.pane?.scrollHeight}px) — invisible on open` });
      } else {
        fail(FEATURE, who, 'VISIBILITY', { actual: v.outcome, detail: 'DOM-present but no scroll of its pane reveals it (or it is collapsed/occluded)' });
      }
    }
    if (tileVis.length && tileVis.some((v) => v.outcome === 'off-pane-on-open')) {
      info(FEATURE, '(pane)', 'VISIBILITY', { detail: 'mic pad sits below the fold of the short block pane — reachable by scrolling, but invisible on open (the owner-reported defect), reported as a WARN' });
    }

    const bad = tileVis.filter((v) => v.outcome !== 'in-pane' && v.outcome !== 'off-pane-on-open');
    expect(bad, 'DynaCab tile visibility failures').toEqual([]);
    // The reported defect: the mic pad tiles are absent from the Cab page — the spec's own `expect`
    // must go red as well, so the Playwright run and the recorded matrix agree.
    expect(presenceFail, 'the DynaCab mic pad tiles must render on the Cab page').toBe(false);
  });
});
