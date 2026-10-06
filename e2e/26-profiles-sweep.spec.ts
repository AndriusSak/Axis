import { test, expect, devices, type Page } from '@playwright/test';
import { bootCleanWorkbench, collapseRail } from './support/workbench';
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
   * FINDING (expected-to-fail): on phone the persistent bottom nav is
   * `.aw-nav[data-nav-mode='bottom'] { overflow: hidden }` while its 9 entries need
   * 408px in a 275px box (measured: entry rects 52..462, container clientWidth 275).
   * The trailing entries (Setup, Theme, Axis Cloud) clip to zero visible area and
   * cannot be reached — there is no scrollable ancestor (overflow is hidden, not
   * auto), so a real touch user cannot reach them. Root cause lives in
   * src/lib/workbench/svelte/NavigationHost.svelte — OWNED BY ANOTHER WORKSTREAM,
   * so this is reported, not fixed.
   */
  test('phone: every bottom-nav entry is reachable', async ({ page }) => {
    test.fail(true, 'NavigationHost.svelte owns .aw-nav[data-nav-mode=bottom]: overflow:hidden clips trailing nav entries with no scroll');
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
   * FINDING (expected-to-fail): the `⋯` overflow chip menu on phone opens
   * DOWNWARD from the bottom bar and lands entirely below the viewport (measured:
   * chip at 352,806 43x30; menu rect 352,852 270x159 with visibleH=0 against a
   * 390x844 viewport; its "✥ Rearrange in Customize" button at y≈966). Since the
   * bottom zone overflows on phone, the add-block palette / hidden widgets are
   * only reachable through this menu — which is itself unreachable. Root cause
   * lives in src/lib/workbench/svelte/WidgetZone.svelte (`.aw-overflow-menu`
   * placement) — OWNED BY ANOTHER WORKSTREAM, so reported, not fixed.
   */
  test('phone: the overflow chip menu is reachable', async ({ page }) => {
    test.fail(true, 'WidgetZone.svelte owns .aw-overflow-menu placement: it opens downward off the bottom of the phone viewport');
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
