import { test, expect, type Page } from '@playwright/test';
import { bootCleanWorkbench } from './support/workbench';
import { installGridMock } from './support/gridMock';

// Touch-target ergonomics for the workbench top bar (Steam Deck class, 1280x800).
//
// MEASURED PROBLEM: the top bar's small controls are far below the ~44px touch-target guidance —
//   button.preset-arrow 24x36, button.preset-main 134x36, button.num-chip 21x22.
// A Steam Deck is a touchscreen, so these need a larger HIT AREA. The fix must NOT move or resize the
// visible box (desktop density is pinned), so it is scoped to `@media (pointer: coarse)` and enlarges
// the hit area with a transparent `::after` overlay on a `position:relative` button.
//
// This spec is deliberately non-vacuous on both ends:
//   1. It first asserts the emulation actually reports `(pointer: coarse)` — otherwise it proves nothing.
//   2. COARSE: a point 6px OUTSIDE each control's visible box, on its horizontal centre, must resolve
//      (via document.elementFromPoint) to the control or a descendant — i.e. the hit area is genuinely
//      enlarged. RED before the fix: those points resolve to something else.
//   3. DESKTOP (`pointer: fine`): the SAME points must NOT resolve to the control, and the visible
//      boxes must equal today's recorded sizes — i.e. desktop density is untouched.

const VIEWPORT = { width: 1280, height: 800 };

// Today's visible boxes (measured at 1280x800; the fix must not change them).
const DESKTOP_BOXES: Record<string, { w: number; h: number }> = {
  'preset-arrow': { w: 24, h: 36 },
  'preset-main': { w: 134, h: 36 },
  'num-chip': { w: 21, h: 22 },
};

const TARGET_SELECTOR = 'button.preset-arrow, button.preset-main, button.num-chip';

interface Probe {
  cls: string;
  w: number;
  h: number;
  x: number;
  y: number;
  hitTag: string | null;
  hitCls: string | null;
  isTarget: boolean;
  /** Effective hit box, measured by walking outward from the centre with elementFromPoint. */
  eff: { left: number; right: number; top: number; bottom: number };
  effW: number;
  effH: number;
}

async function bootTopBar(page: Page): Promise<void> {
  await page.setViewportSize(VIEWPORT);
  await installGridMock(page);
  await bootCleanWorkbench(page);
  await page.waitForTimeout(400);
}

/** For every target: its visible box, whether the point 6px above its top (at its centre) hits it,
 *  and its measured effective hit box. */
async function probeTargets(page: Page): Promise<Probe[]> {
  return page.evaluate((sel) => {
    const belongs = (el: Element, x: number, y: number): boolean => {
      const hit = document.elementFromPoint(x, y);
      return hit === el || (hit != null && el.contains(hit));
    };
    const targets = [...document.querySelectorAll(sel)] as HTMLElement[];
    return targets.map((el) => {
      const r = el.getBoundingClientRect();
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      // 6px above the top edge, horizontal centre — OUTSIDE the visible box.
      const hit = document.elementFromPoint(cx, r.top - 6);
      const scan = (dx: number, dy: number): number => {
        let d = 0;
        while (d < 220 && belongs(el, cx + dx * (d + 1), cy + dy * (d + 1))) d += 1;
        return d;
      };
      const eff = {
        left: Math.round(cx - scan(-1, 0)),
        right: Math.round(cx + scan(1, 0)),
        top: Math.round(cy - scan(0, -1)),
        bottom: Math.round(cy + scan(0, 1)),
      };
      return {
        cls: el.className.split(/\s+/)[0] ?? '',
        w: Math.round(r.width),
        h: Math.round(r.height),
        x: Math.round(r.x),
        y: Math.round(r.y),
        hitTag: hit ? hit.tagName : null,
        hitCls: hit ? (hit as HTMLElement).className.split(/\s+/)[0] ?? '' : null,
        isTarget: belongs(el, cx, r.top - 6),
        eff,
        effW: eff.right - eff.left,
        effH: eff.bottom - eff.top,
      };
    });
  }, TARGET_SELECTOR);
}

test.describe('touch targets — coarse pointer', () => {
  // hasTouch:true is what makes Chromium report `(pointer: coarse)` here; `isMobile` is not needed
  // (checked separately) and would otherwise perturb the layout via the mobile viewport meta.
  test.use({ hasTouch: true });

  test('small top-bar controls have an enlarged hit area on a touch device', async ({ page }) => {
    await bootTopBar(page);

    // Guard 1: the emulation must actually be coarse, else the assertions below are vacuous.
    const coarse = await page.evaluate(() => matchMedia('(pointer: coarse)').matches);
    expect(coarse, 'emulation must report (pointer: coarse)').toBe(true);

    const probes = await probeTargets(page);
    expect(probes.length, 'top-bar targets rendered').toBeGreaterThan(0);
    const byClass = probes.reduce<Record<string, number>>((m, p) => ((m[p.cls] = (m[p.cls] ?? 0) + 1), m), {});
    expect(byClass['preset-arrow'], 'both preset arrows present').toBe(2);
    expect(byClass['preset-main'], 'preset selector present').toBe(1);
    expect(byClass['num-chip'], 'scene chips present').toBeGreaterThan(0);

    const diag = probes.map(
      (p) => `${p.cls} box ${p.w}x${p.h} eff ${p.effW}x${p.effH} (${p.eff.left},${p.eff.top})-(${p.eff.right},${p.eff.bottom})`,
    );
    // eslint-disable-next-line no-console
    console.log('COARSE EFFECTIVE HIT BOXES:\n' + diag.join('\n'));

    const misses = probes
      .filter((p) => !p.isTarget)
      .map((p) => `${p.cls} @${p.x},${p.y} 6px-above hit ${p.hitTag}.${p.hitCls}`);
    expect(misses, `coarse: 6px-above point did not resolve to the control: ${misses.join('; ')}`).toEqual([]);

    // Every fixed control must gain at least ~6px of hit area on every vertical side.
    const short = probes.filter((p) => p.y - p.eff.top < 6 || p.eff.bottom - (p.y + p.h) < 6);
    expect(short, `coarse: hit area not enlarged by >=6px: ${short.map((p) => p.cls).join(', ')}`).toEqual([]);
  });
});

test.describe('touch targets — desktop density untouched (fine pointer)', () => {
  test('the same outside points miss, and the visible boxes are unchanged', async ({ page }) => {
    await bootTopBar(page);

    // Guard: this profile must be fine, else the "unchanged" control proves nothing.
    const state = await page.evaluate(() => ({
      coarse: matchMedia('(pointer: coarse)').matches,
      fine: matchMedia('(pointer: fine)').matches,
    }));
    expect(state.coarse, 'desktop profile must NOT be coarse').toBe(false);
    expect(state.fine, 'desktop profile must be fine').toBe(true);

    const probes = await probeTargets(page);
    expect(probes.length, 'top-bar targets rendered').toBeGreaterThan(0);

    // The 6px-above point must resolve to something OTHER than the control (no enlarged hit area).
    const hits = probes
      .filter((p) => p.isTarget)
      .map((p) => `${p.cls} @${p.x},${p.y} resolved to the control`);
    expect(hits, `desktop: an outside point wrongly hit the control: ${hits.join('; ')}`).toEqual([]);

    // The visible boxes must equal today's recorded sizes (density untouched).
    for (const p of probes) {
      const expected = DESKTOP_BOXES[p.cls];
      if (!expected) continue;
      expect({ w: p.w, h: p.h }, `desktop visible box for ${p.cls}`).toEqual(expected);
    }
  });
});
