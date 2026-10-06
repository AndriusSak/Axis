import { test, expect, type Page } from '@playwright/test';
import { bootCleanWorkbench, enterEditMode, exitEditMode, collapseRail, regionTabs } from './support/workbench';
import { installGridMock } from './support/gridMock';

// Desktop nav-rail hover flyout must not cover the adjacent interactive chrome.
//
// MEASURED DEFECT (default desktop layout, 1440x900): the rail is an icon-only
// `aside.aw-rail` (58px, x=0) that reveals labels by expanding its inner layer
// (`.aw-rail-inner`, 200px) OVER the dock on hover (`.aw-rail-expanded`). The
// expanded layer is a DOM descendant of the rail, so it both (a) stayed open
// while the pointer was over it and (b) — being a plain overlay — painted over
// and intercepted pointer events on everything in the left 200px column: the
// pane-tab strip, the top bar's leading widgets, and the bottom bar's Customize
// control. Concretely, with the flyout open at 1440x900 the "Signal Grid" pane
// tab (box 86,66 69x20; centre 121,76) hit-tested via elementFromPoint(121,76)
// to a `button.axis-nav-entry` INSIDE the rail — the tab was unreachable
// without first moving the pointer away and waiting for the flyout to collapse.
//
// FIX (src/lib/workbench/svelte/WorkbenchHost.svelte, CSS only): keep the
// flyout VISUALLY (the rail still expands and reveals labels on hover, and the
// expanded entry keeps the rest-state 42px square so the icon never moves), but
// confine the rail's INTERACTIVE footprint to the fixed rail strip. The expanded
// inner layer is `pointer-events: none`; only the nav entries and rail widget
// hosts (which stay inside the strip) take pointer events. A pointer crossing
// the rail edge therefore leaves the rail, the flyout collapses, and the
// adjacent chrome is clickable. Rail width and icon layout are unchanged.

/** Resolve the main-region pane tab with the given label + hit-test its centre. */
async function tabInfo(page: Page, label: string) {
  return page.evaluate((text) => {
    const tab = [...document.querySelectorAll('.aw-tabstack[data-region="main"] .aw-pane-tab')].find(
      (t) => (t.textContent ?? '').trim() === text,
    ) as HTMLElement | undefined;
    if (!tab) return null;
    const r = tab.getBoundingClientRect();
    const cx = Math.round(r.left + r.width / 2);
    const cy = Math.round(r.top + r.height / 2);
    const hit = document.elementFromPoint(cx, cy) as HTMLElement | null;
    const rail = document.querySelector('.aw-rail');
    return {
      centre: [cx, cy],
      rect: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)],
      hitIsTab: !!hit && (hit === tab || tab.contains(hit)),
      hit: hit ? `${hit.tagName.toLowerCase()}.${hit.className.toString().split(/\s+/)[0]}` : 'null',
      hitInRail: !!hit && !!rail && rail.contains(hit),
      active: tab.classList.contains('active'),
    };
  }, label);
}

/** Wait until the rail's flyout is open AND fully expanded (the width transition
 *  is 160ms; the `aw-rail-expanded` class flips immediately, so a hit-test taken
 *  during the transition would pass vacuously). */
async function waitFlyoutOpen(page: Page): Promise<void> {
  await expect(page.locator('.aw-rail.aw-rail-expanded')).toHaveCount(1);
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const inner = document.querySelector('.aw-rail.aw-rail-expanded .aw-rail-inner') as HTMLElement | null;
          return inner ? Math.round(inner.getBoundingClientRect().width) : 0;
        }),
      { message: 'rail flyout expanded to its full width' },
    )
    .toBeGreaterThanOrEqual(190);
}

/** Drag the bottom "Block Editor" tab into main so main has two tabs. */
async function addSecondMainTab(page: Page): Promise<void> {
  await enterEditMode(page);
  const src = regionTabs(page, 'bottom').filter({ hasText: 'Block Editor' }).first();
  const sb = await src.boundingBox();
  const mb = await page.locator('.aw-tabstack[data-region="main"]').boundingBox();
  expect(sb && mb).toBeTruthy();
  const tx = mb!.x + mb!.width / 2;
  const ty = mb!.y + mb!.height / 2;
  await page.mouse.move(sb!.x + sb!.width / 2, sb!.y + sb!.height / 2);
  await page.mouse.down();
  await page.mouse.move(sb!.x + sb!.width / 2 + 8, sb!.y + sb!.height / 2 + 8);
  await page.mouse.move(tx, ty, { steps: 10 });
  await page.mouse.move(tx, ty, { steps: 4 });
  await page.mouse.up();
  await expect(regionTabs(page, 'main')).toHaveText([/Signal Grid/, /Block Editor/]);
  await exitEditMode(page);
}

test.describe('desktop rail hover flyout', () => {
  test('the pane-tab strip stays visible and clickable while the flyout is open', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await installGridMock(page);
    await bootCleanWorkbench(page);
    await page.waitForTimeout(400);

    // Two main tabs so a tab switch is observable; make Block Editor active so
    // Signal Grid is the inactive tab we will switch to.
    await addSecondMainTab(page);
    await regionTabs(page, 'main').filter({ hasText: 'Block Editor' }).click();
    await collapseRail(page);
    expect((await tabInfo(page, 'Signal Grid'))!.active, 'Signal Grid starts inactive').toBe(false);

    // 1. Hover a rail nav entry → the rail expands into its flyout.
    await page.locator('[data-nav-entry="scenes"] button.axis-nav-entry').hover();
    await waitFlyoutOpen(page);

    // 2. ACCEPTANCE: with the flyout open, the pane tab's centre must hit-test to
    //    the tab itself, not to a nav entry inside the rail.
    const sig = (await tabInfo(page, 'Signal Grid'))!;
    console.log('MEASURED tab', JSON.stringify(sig));
    expect(sig.hitIsTab, `elementFromPoint(${sig.centre}) = ${sig.hit} (rail=${sig.hitInRail})`).toBe(true);
    expect(sig.hitInRail, `hit is inside the rail subtree: ${sig.hit}`).toBe(false);
    // Non-vacuous: the flyout is still fully open right now.
    await waitFlyoutOpen(page);

    // The flyout must not cover the top bar's leading widget either (other
    // adjacent chrome that used to be trapped).
    const topLeftHit = await page.evaluate(() => {
      const w = document.querySelector('.aw-topbar [data-widget-host]') as HTMLElement | null;
      if (!w) return null;
      const r = w.getBoundingClientRect();
      const cx = Math.round(r.left + r.width / 2);
      const cy = Math.round(r.top + r.height / 2);
      const hit = document.elementFromPoint(cx, cy) as HTMLElement | null;
      const rail = document.querySelector('.aw-rail');
      return {
        centre: [cx, cy],
        widgetRect: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)],
        hitInRail: !!hit && !!rail && rail.contains(hit),
        hit: hit?.className.toString().split(/\s+/)[0] ?? 'null',
      };
    });
    console.log('MEASURED topbar widget', JSON.stringify(topLeftHit));
    expect(topLeftHit, 'top-bar leading widget exists').not.toBeNull();
    expect(topLeftHit!.hitInRail, `top-bar widget centre ${topLeftHit!.centre} hit inside rail (${topLeftHit!.hit})`).toBe(false);

    // 3. USABLE, not merely hit-testable: re-open the flyout, then click the tab
    //    at that exact point → the pane switches.
    await page.mouse.move(720, 20);
    await expect(page.locator('.aw-rail.aw-rail-expanded')).toHaveCount(0);
    await page.locator('[data-nav-entry="scenes"] button.axis-nav-entry').hover();
    await waitFlyoutOpen(page);
    await page.mouse.click(sig.centre[0], sig.centre[1]);
    await expect(page.locator('.aw-tabstack[data-region="main"] .aw-pane-tab.active')).toHaveText(/Signal Grid/);
  });

  test('control: the pane tab stays reachable at a narrow (tablet) viewport', async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 900 });
    await installGridMock(page);
    await bootCleanWorkbench(page);
    await page.waitForTimeout(400);

    // Below the 1366 desktop breakpoint the seeded layout uses bottom nav; the
    // overlay rail is not rendered. Assert the main pane tab is reachable so the
    // desktop fix can never regress the small-screen path.
    const hasRail = await page.locator('.aw-rail').count();
    const sig = (await tabInfo(page, 'Signal Grid'))!;
    console.log('MEASURED narrow', JSON.stringify({ hasRail, ...sig }));
    expect(sig.hitIsTab, `elementFromPoint(${sig.centre}) = ${sig.hit}`).toBe(true);
    expect(sig.hitInRail).toBe(false);
  });
});
