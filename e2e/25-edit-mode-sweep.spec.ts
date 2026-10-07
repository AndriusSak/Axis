import { test, expect, type Page } from '@playwright/test';
import { bootCleanWorkbench, enterEditMode, exitEditMode, collapseRail, WORKBENCH_DOC_KEY } from './support/workbench';
import { installGridMock } from './support/gridMock';
import { probeInvariants } from './support/geometry';

/**
 * 25 — EDIT / ARRANGE MODE + overlay surfaces sweep.
 *
 * Surfaces: the edit ribbon, the widget drag/tap surfaces (via the widget context
 * menu), the customize drawers (Pages/Widgets/Layouts), the add-block palette, the
 * `⋯` overflow chip menu, and the profile-preview frame.
 *
 * Invariants (clipping-aware, see support/geometry.ts): sideways document scroll,
 * over-wide elements, in-flow collisions between interactive elements, and content
 * whose visible area is zero with no scrollable ancestor (unreachable).
 *
 * The collapsed nav rail is excluded from the root probes: its icon-only labels are
 * deliberately clipped at rest (owned by another workstream; documented behaviour).
 */

const WIDTHS = [1440, 1280, 900];
const CHROME = '.aw-rail, .aw-widget-zone[data-zone="rail"]';

async function bootEdit(page: Page, width: number): Promise<void> {
  await page.setViewportSize({ width, height: 900 });
  await installGridMock(page);
  await bootCleanWorkbench(page);
  await page.waitForTimeout(300);
  await enterEditMode(page);
  await page.waitForTimeout(250);
}

/** Duplicate a source widget N times into a zone to force the overflow chip. */
async function forceZoneOverflow(page: Page, zone: string, n: number): Promise<void> {
  await page.evaluate(
    ({ key, zone, n }) => {
      const doc = JSON.parse(window.localStorage.getItem(key) as string);
      const layout = Object.values(doc.layouts as Record<string, { widgets: Record<string, unknown> }>)[0]!;
      const src = layout.widgets['axis.widget.view'];
      for (let i = 0; i < n; i++) layout.widgets[`axis.widget.probe${i}`] = { ...(src as object), id: `axis.widget.probe${i}`, zone, order: 100 + i };
      window.localStorage.setItem(key, JSON.stringify(doc));
    },
    { key: WORKBENCH_DOC_KEY, zone, n }
  );
  await page.reload();
  await page.waitForSelector('.aw-root');
  await page.waitForTimeout(350);
}

async function assertInsideViewport(page: Page, box: { x: number; y: number; width: number; height: number } | null, what: string): Promise<void> {
  expect(box, `${what} box`).not.toBeNull();
  const vp = page.viewportSize()!;
  expect(box!.x, `${what} left`).toBeGreaterThanOrEqual(0);
  expect(box!.y, `${what} top`).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width, `${what} right vs ${vp.width}`).toBeLessThanOrEqual(vp.width + 0.5);
  expect(box!.y + box!.height, `${what} bottom vs ${vp.height}`).toBeLessThanOrEqual(vp.height + 0.5);
}

for (const w of WIDTHS) {
  test(`edit mode @${w}: no sideways scroll, over-wide element, collision or unreachable control`, async ({ page }) => {
    await bootEdit(page, w);
    const r = await probeInvariants(page, { root: '.aw-root', ignore: CHROME });
    expect(r.docScrollX, 'sideways document scroll').toBe(0);
    expect(r.overWide.map((o) => `${o.label} ${o.w}px`), 'elements wider than the viewport').toEqual([]);
    expect(r.collisions, 'in-flow interactive collisions').toEqual([]);
    expect(r.unreachable.map((o) => o.label), 'unreachable interactive controls').toEqual([]);
  });

  test(`edit ribbon @${w}: every action is reachable and unclipped`, async ({ page }) => {
    await bootEdit(page, w);
    const r = await probeInvariants(page, { root: '.aw-edit-ribbon' });
    expect(r.unreachable.map((o) => o.label), 'unreachable ribbon actions').toEqual([]);
    expect(r.overWide.map((o) => o.label), 'over-wide ribbon actions').toEqual([]);
    expect(r.clippedText, 'clipped ribbon labels').toEqual([]);
    // sanity: the ribbon actually rendered its actions
    const count = await page.locator('.aw-edit-ribbon button').count();
    expect(count, 'ribbon buttons rendered').toBeGreaterThan(4);
  });

  test(`widget context menu @${w}: opens inside the viewport with reachable items`, async ({ page }) => {
    await bootEdit(page, w);
    for (const id of ['axis.widget.preset', 'axis.widget.save']) {
      const host = page.locator(`[data-widget="${id}"]`);
      test.skip((await host.count()) === 0, `${id} not seeded at ${w}`);
      await host.click({ force: true });
      const menu = page.locator('.aw-context-menu[role="menu"]');
      await expect(menu).toBeVisible();
      await assertInsideViewport(page, await menu.boundingBox(), `${id} menu`);
      const r = await probeInvariants(page, { root: '.aw-context-menu' });
      expect(r.unreachable.map((o) => o.label), `${id} menu unreachable items`).toEqual([]);
      expect(r.overWide.map((o) => o.label), `${id} menu over-wide`).toEqual([]);
      await page.keyboard.press('Escape');
      await expect(menu).toHaveCount(0);
    }
  });

  test(`customize drawers @${w}: no clipped or unreachable controls`, async ({ page }) => {
    await bootEdit(page, w);
    await collapseRail(page);
    const vp = page.viewportSize()!;
    // The drawers slide in from the right; wait for the transition to settle
    // before reading geometry (boundingBox during the slide reports them off-screen).
    const settled = async (sel: string) => {
      const d = page.locator(sel);
      await expect(d).toBeVisible();
      await expect.poll(async () => {
        const b = await d.boundingBox();
        return b ? Math.round(b.x + b.width) : Number.POSITIVE_INFINITY;
      }, { message: `${sel} settles inside the viewport` }).toBeLessThanOrEqual(vp.width + 1);
    };

    await page.getByRole('button', { name: /◳ Pages/ }).click();
    await settled('.aw-lib-drawer');
    const lib = page.locator('.aw-lib-drawer');
    await assertInsideViewport(page, await lib.boundingBox(), 'library drawer');
    const lr = await probeInvariants(page, { root: '.aw-lib-drawer' });
    expect(lr.unreachable.map((o) => o.label), 'library drawer unreachable').toEqual([]);
    expect(lr.overWide.map((o) => o.label), 'library drawer over-wide').toEqual([]);
    expect(lr.clippedText, 'library drawer clipped text').toEqual([]);
    await page.keyboard.press('Escape');
    await expect(lib).toHaveCount(0);

    await page.getByRole('button', { name: /⤓ Layouts/ }).click();
    await settled('.aw-layout-drawer');
    const lay = page.locator('.aw-layout-drawer');
    await assertInsideViewport(page, await lay.boundingBox(), 'layout drawer');
    const yr = await probeInvariants(page, { root: '.aw-layout-drawer' });
    expect(yr.unreachable.map((o) => o.label), 'layout drawer unreachable').toEqual([]);
    expect(yr.overWide.map((o) => o.label), 'layout drawer over-wide').toEqual([]);
    expect(yr.clippedText, 'layout drawer clipped text').toEqual([]);
  });

  test(`add-block palette @${w}: opens inside the viewport with reachable rows`, async ({ page }) => {
    await bootEdit(page, w);
    await exitEditMode(page);
    await collapseRail(page);
    const btn = page.locator('[data-widget="axis.widget.addBlock"] button.axis-widget.add').first();
    await expect(btn).toBeVisible();
    await btn.click();
    const card = page.locator('.bg .card');
    await expect(card).toBeVisible();
    await assertInsideViewport(page, await card.boundingBox(), 'palette card');
    const r = await probeInvariants(page, { root: '.bg' });
    expect(r.unreachable.map((o) => o.label), 'palette unreachable controls').toEqual([]);
    expect(r.overWide.map((o) => o.label), 'palette over-wide').toEqual([]);
  });
}

test('overflow chip menu (top-bar zone) @1440 opens inside the viewport', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await installGridMock(page);
  await bootCleanWorkbench(page);
  await page.waitForTimeout(300);
  await forceZoneOverflow(page, 'top.left', 14);

  const chip = page.locator('.aw-overflow-chip');
  await expect(chip).toHaveCount(1);
  await chip.click();
  const menu = page.locator('.aw-overflow-menu');
  await expect(menu).toBeVisible();
  await assertInsideViewport(page, await menu.boundingBox(), 'top.left overflow menu');
  const r = await probeInvariants(page, { root: '.aw-overflow-menu' });
  expect(r.unreachable.map((o) => o.label), 'overflow menu unreachable controls').toEqual([]);
});

/**
 * Bottom-bar overflow: the `⋯` chip menu must stay inside the viewport when the
 * overflowing zone is the BOTTOM bar (previously `.aw-overflow-menu` opened
 * `top: calc(100% + 8px)` DOWNWARD and landed entirely below the fold — chip at
 * y=868, menu rect 183,908 270x1209, visibleH=0). `WidgetZone.svelte` now opens
 * it upward from the zone top with a viewport-capped, internally-scrollable
 * height for the bottom zone.
 */
test('overflow chip menu (bottom bar zone) @1440 opens inside the viewport', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await installGridMock(page);
  await bootCleanWorkbench(page);
  await page.waitForTimeout(300);
  await forceZoneOverflow(page, 'bottom', 40);

  const chip = page.locator('.aw-overflow-chip');
  await expect(chip).toHaveCount(1);
  await chip.click();
  const menu = page.locator('.aw-overflow-menu');
  await expect(menu).toBeVisible();
  await assertInsideViewport(page, await menu.boundingBox(), 'bottom-bar overflow menu');
});
