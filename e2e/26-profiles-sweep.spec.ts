import { test, expect, devices, type Page } from '@playwright/test';
import { bootCleanWorkbench, collapseRail, enterEditMode } from './support/workbench';
import { installGridMock } from './support/gridMock';
import { probeInvariants } from './support/geometry';

/**
 * 26 — PROFILE VARIANTS sweep.
 *
 * Playwright's config keeps the desktop project ≥1366px because below that the
 * workbench resolver switches to the TABLET profile (different seeded layout);
 * the phone profile is the mobile drawer/bottom-nav layout. This spec sweeps the
 * 7 seed pages at the tablet widths (1180, 1024) and under a phone emulation
 * (390x844, isMobile/hasTouch), plus the panel/grid widget zones.
 *
 * Page-content probes exclude the chrome (top/bottom bars, rail, ribbon): two
 * chrome reachability defects found on phone are pinned by their own tests below
 * and live in files owned by other workstreams (reported, not fixed).
 */

const PAGES = ['grid', 'library', 'fc', 'controllers', 'scenes', 'live', 'setup'];
const CHROME = '.aw-topbar, .aw-bottombar, .aw-rail, .aw-edit-ribbon';

async function goPage(page: Page, entry: string): Promise<void> {
  await collapseRail(page).catch(() => {});
  const direct = page.locator(`[data-nav-entry="${entry}"] button.axis-nav-entry`).first();
  if (await direct.isVisible().catch(() => false)) {
    await direct.click();
  } else {
    const burger = page.locator('.aw-mobile-menu');
    if (await burger.count()) await burger.click();
    await page.locator(`[data-nav-entry="${entry}"] button.axis-nav-entry`).first().click();
  }
  await page.waitForTimeout(350);
}

function assertPageContentClean(r: Awaited<ReturnType<typeof probeInvariants>>, label: string): void {
  expect(r.docScrollX, `${label}: sideways document scroll`).toBe(0);
  expect(r.overWide.map((o) => `${o.label} ${o.w}px`), `${label}: elements wider than the viewport`).toEqual([]);
  expect(r.collisions, `${label}: in-flow interactive collisions`).toEqual([]);
  expect(r.unreachable.map((o) => o.label), `${label}: unreachable controls`).toEqual([]);
}

test.describe('tablet widths (1180 / 1024)', () => {
  for (const w of [1180, 1024]) {
    for (const entry of PAGES) {
      test(`@${w} ${entry}: page renders with no layout defect`, async ({ page }) => {
        await page.setViewportSize({ width: w, height: 800 });
        await installGridMock(page);
        await bootCleanWorkbench(page);
        await page.waitForTimeout(400);
        await goPage(page, entry);
        const r = await probeInvariants(page, { root: '.aw-root', ignore: '.aw-rail, .aw-widget-zone[data-zone="rail"]' });
        assertPageContentClean(r, `@${w} ${entry}`);
      });
    }
  }
});

test.describe('phone emulation (390x844)', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3, userAgent: devices['iPhone 13'].userAgent });

  for (const entry of PAGES) {
    test(`phone ${entry}: page content renders with no layout defect`, async ({ page }) => {
      await installGridMock(page);
      await bootCleanWorkbench(page);
      await page.waitForTimeout(500);
      await goPage(page, entry);
      const r = await probeInvariants(page, { root: '.aw-frame', ignore: CHROME });
      assertPageContentClean(r, `phone ${entry}`);
    });
  }

  /**
   * On phone the persistent bottom nav carries nine entries; on a 390px bar the
   * row is wider than the bar. `NavigationHost.svelte` now shrinks the icon-only
   * entries so they fit at rest and makes the row touch-swipeable (scrollbar
   * hidden — the bar never paints one) for the edit-mode surplus, so every entry
   * stays inside the viewport and reachable.
   */
  test('phone: every bottom-nav entry is reachable', async ({ page }) => {
    await installGridMock(page);
    await bootCleanWorkbench(page);
    await page.waitForTimeout(500);

    const entries = page.locator('[data-zone-shell="bottom-nav"] [data-nav-entry]');
    const count = await entries.count();
    expect(count, 'nav entries rendered').toBeGreaterThan(0);

    // Clipping-aware: an entry whose visible area is zero with no scrollable
    // ancestor is unreachable (this catches Setup + Theme + Axis Cloud, which
    // sit inside the viewport but are clipped by the nav's own overflow:hidden).
    const r = await probeInvariants(page, { root: '[data-zone-shell="bottom-nav"]' });
    expect(r.unreachable.map((o) => o.label), 'unreachable nav entries').toEqual([]);

    const offscreen = await entries.evaluateAll((els) =>
      els
        .filter((e) => {
          const rect = e.getBoundingClientRect();
          return rect.width === 0 || rect.right <= 0 || rect.left >= window.innerWidth;
        })
        .map((e) => e.getAttribute('data-nav-entry'))
    );
    expect(offscreen, 'nav entries outside the viewport').toEqual([]);
  });

  /**
   * Phone edit mode: the widgets-only rail is no longer forced on phone (it is
   * suppressed when it carries no rail widgets, so `.aw-frame` keeps the full
   * 390px), the bottom-nav row swipes for its edit-mode surplus, and the bar's
   * widget zone swipes for its edit-mode surplus widgets — so no bottom-bar
   * control (nav entries, `+` add-page, scene chips) clips to zero visible area.
   */
  test('phone edit mode: no bottom-bar control is unreachable', async ({ page }) => {
    await installGridMock(page);
    await bootCleanWorkbench(page);
    await page.waitForTimeout(600);
    await enterEditMode(page);
    await page.waitForTimeout(400);
    const r = await probeInvariants(page, { root: '.aw-bottombar' });
    expect(r.unreachable.map((o) => o.label), 'unreachable controls in the phone edit-mode bottom bar').toEqual([]);
  });

  /**
   * On phone the bottom zone overflows, so its hidden widgets are reached through
   * the `⋯` chip menu. `WidgetZone.svelte` now opens that menu UPWARD from the
   * zone top (there is no room below the bottom bar) and right-anchored, so the
   * menu — and its "✥ Rearrange in Customize" action — stays inside the viewport.
   */
  test('phone: the overflow chip menu is reachable', async ({ page }) => {
    await installGridMock(page);
    await bootCleanWorkbench(page);
    await page.waitForTimeout(500);

    const chip = page.locator('.aw-overflow-chip');
    await expect(chip).toHaveCount(1);
    await chip.click();
    const menu = page.locator('.aw-overflow-menu');
    await expect(menu).toBeVisible();
    const b = (await menu.boundingBox())!;
    expect(b.y, 'overflow menu top vs viewport height').toBeLessThan(844);
    expect(b.y + b.height, 'overflow menu bottom vs viewport height').toBeLessThanOrEqual(844 + 0.5);
  });
});
