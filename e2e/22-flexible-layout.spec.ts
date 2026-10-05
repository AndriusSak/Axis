import { test, expect, type Page } from '@playwright/test';
import { bootCleanWorkbench, clickNav } from './support/workbench';
import { installGridMock } from './support/gridMock';

// Responsive sweep: "the UI should be flexible and accommodate different screen sizes".
//
// Pinned invariant, across the app's breakpoints (1320 / 1180 / 1060 / 760 / 720 / 640 / 560):
// content that the layout cannot fit must still be REACHABLE — never clipped into a place the user
// can neither see nor scroll to. Two measured failures motivated this:
//
//   1) 1440x900, top bar: the three top zones were fitted JOINTLY against the topbar's own width
//      (1382px) while each zone is only 669px. `top.right` held 793px of widgets, top.left sat 236px
//      empty, the joint fit concluded "fits" (every widget stayed `size=default`, nothing shed), and
//      the zone overflowed. Because `top.right` is `justify-content: flex-end` with `overflow: hidden`,
//      the surplus spilled LEFT — where LTR `scrollWidth` never counts it — so the leading `axis.view`
//      chips were permanently clipped and unclickable.
//   2) 900x700 and below, preset browser: `.query-controls` (365px) overflowed `.query-bar` (256px) and
//      the panel's clip removed "⇄ Convert Preset…".
//
// The check is deliberately geometric: for every widget host / control button, its box must either lie
// inside the visible area of its clipping ancestor, or be reachable by scrolling one. A box that is
// merely "present in the DOM" does not count.

async function clipped(page: Page, selector: string, rootSelector: string): Promise<{ total: number; clipped: string[] }> {
  return page.evaluate(({ sel, rootSel }) => {
    const root = document.querySelector(rootSel);
    if (!root) return { total: 0, clipped: ['(no root)'] };
    const els = [...root.querySelectorAll(sel)] as HTMLElement[];
    const clipped: string[] = [];
    let total = 0;
    for (const el of els) {
      const r = el.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) continue; // not rendered at all (shed / hidden)
      total += 1;
      let l = r.left, t = r.top, rr = r.right, b = r.bottom;
      const scrollers: string[] = [];
      for (let p = el.parentElement; p && p !== root.parentElement; p = p.parentElement) {
        const cs = getComputedStyle(p);
        if (cs.overflow === 'visible' && cs.overflowX === 'visible' && cs.overflowY === 'visible') continue;
        const pr = p.getBoundingClientRect();
        // overflowing in the reachable direction can be scrolled to; overflowing out of an
        // `overflow: hidden` box cannot
        if (p.scrollWidth > p.clientWidth + 2 && (cs.overflowX === 'auto' || cs.overflowX === 'scroll')) {
          scrollers.push('x');
          continue;
        }
        if (p.scrollHeight > p.clientHeight + 2 && (cs.overflowY === 'auto' || cs.overflowY === 'scroll')) {
          scrollers.push('y');
          continue;
        }
        l = Math.max(l, pr.left); t = Math.max(t, pr.top);
        rr = Math.min(rr, pr.right); b = Math.min(b, pr.bottom);
      }
      const label = `${el.getAttribute('data-widget-type') ?? el.className.toString().split(/\s+/)[0]}`;
      const visible = Math.max(0, rr - l) * Math.max(0, b - t);
      if (visible < r.width * r.height - 1 && scrollers.length === 0) {
        clipped.push(`${label} (${Math.round(r.width)}x${Math.round(r.height)} at ${Math.round(r.left)},${Math.round(r.top)})`);
      }
    }
    return { total, clipped };
  }, { sel: selector, rootSel: rootSelector });
}

const WIDTHS = [1440, 1320, 1280, 1180, 1060, 900, 760, 640];

test.describe('flexible layout across screen sizes', () => {
  for (const w of WIDTHS) {
    test(`no widget or control is clipped out of reach at ${w}px`, async ({ page }) => {
      await page.setViewportSize({ width: w, height: w <= 760 ? 700 : 900 });
      await installGridMock(page);
      await bootCleanWorkbench(page);
      await page.waitForTimeout(500);

      // every bar widget host must be fully inside its zone's visible area
      const bars = await clipped(page, '[data-widget-host]', '.aw-root');
      expect(bars.clipped, `widget hosts clipped out of reach: ${bars.clipped.join(', ')}`).toEqual([]);

      // and so must the preset browser's query controls (the second measured failure)
      await clickNav(page, 'library');
      await page.waitForTimeout(500);
      const controls = await clipped(page, '.query-controls button, .query-controls select', '.axis-pb-full');
      expect(controls.total, 'query controls rendered').toBeGreaterThan(0);
      expect(controls.clipped, `query controls clipped out of reach: ${controls.clipped.join(', ')}`).toEqual([]);
    });
  }
});
