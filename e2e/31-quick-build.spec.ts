import { test, expect, type Page } from '@playwright/test';
import { bootCleanWorkbench } from './support/workbench';
import { installGridMock } from './support/gridMock';

/**
 * R27 — real-browser coverage for the R24 §2.9 Quick Build panel.
 *
 * R24 shipped the panel with ONLY sourceguard unit tests (they regex the .svelte source). This spec
 * proves, in Chromium, that the 'Q' chord docks the registered `axis.quickBuild` panel and that
 * placing a curated block from it actually WRITES the grid (via the existing editor.place op) and
 * changes the rendered Signal Grid.
 *
 * The block roster comes from `GET /blocks`; `installGridMock` would answer `[]` (no device), so we
 * serve a small deterministic roster on top of it. We also make `GET /preset/grid` stateful over the
 * grid mock's seed so the placed cell survives the post-place reconcile and is visible on the grid —
 * every /api call stays inside the browser (no live device is touched).
 */

// Same seed shape gridMock uses, so the Quick Build auto-target is deterministic:
// column-major first free cell = row 3, col 0 → 1-indexed cell 4,1.
const SEED = [
  { row: 0, col: 0, effectId: 100, name: 'PEQ 1', slug: 'PEQ', isShunt: false, fromRows: [] },
  { row: 0, col: 1, effectId: 101, name: 'PEQ 2', slug: 'PEQ', isShunt: false, fromRows: [0] },
  { row: 1, col: 0, effectId: 300, name: 'Comp 1', slug: 'Comp', isShunt: false, fromRows: [] },
  { row: 2, col: 0, effectId: 200, name: 'Drive 1', slug: 'Drive', isShunt: false, fromRows: [] },
  { row: 2, col: 1, effectId: 1024, name: 'Shunt', slug: null, isShunt: true, fromRows: [2] },
  { row: 2, col: 2, effectId: 201, name: 'Delay 1', slug: 'Delay', isShunt: false, fromRows: [2] }
];

// The curated roster we serve. 'gate' is placeable (page 600 is NOT on the seeded grid);
// 'reverb' is deliberately present too so the panel has more than one row.
const ROSTER = [
  { slug: 'gate', name: 'Gate', page: 600 },
  { slug: 'reverb', name: 'Reverb', page: 500 }
];

interface StatefulGrid {
  /** Captured `PUT /preset/grid/cell` bodies (1-indexed row/col; blockId 0 = clear). */
  writes: { row: number; col: number; blockId: number }[];
}

/** Serve the block roster and make the grid reflect cell writes (so placement is visible). */
async function installStatefulGrid(page: Page): Promise<StatefulGrid> {
  let cells = SEED.map((c) => ({ ...c }));
  const state: StatefulGrid = { writes: [] };
  const json = (route: Parameters<Parameters<Page['route']>[1]>[0], body: unknown) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });

  await page.route('**/api/**', async (route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname.replace(/^\/api/, '');
    if (path === '/blocks' && req.method() === 'GET') return json(route, ROSTER);
    if (path === '/preset/grid' && req.method() === 'GET')
      return json(route, {
        model: 'FM3',
        name: 'MOCK ROUTE',
        crcValid: true,
        rows: 4,
        cols: 6,
        scenes: [],
        cells: cells.map((c) => ({ ...c, routeFlag: c.fromRows.reduce((m, r) => m | (1 << r), 0) }))
      });
    if (path === '/preset/grid/cell' && req.method() === 'PUT') {
      const b = req.postDataJSON() as { row: number; col: number; blockId: number };
      state.writes.push(b);
      cells = cells.filter((c) => !(c.row === b.row - 1 && c.col === b.col - 1));
      if (b.blockId !== 0)
        cells.push({ row: b.row - 1, col: b.col - 1, effectId: b.blockId, name: 'Gate', slug: 'Gate', isShunt: false, fromRows: [] });
      return json(route, { ok: true });
    }
    return route.fallback();
  });
  return state;
}

test.describe('R24 §2.9 — Quick Build panel (browser)', () => {
  test("the 'Q' chord opens Quick Build and placing a curated block changes the grid", async ({ page }) => {
    await installGridMock(page);
    const grid = await installStatefulGrid(page);
    await bootCleanWorkbench(page);
    await expect(page.locator('.cell.block').first()).toBeVisible();

    // Baseline: the seeded grid's occupied block cells.
    const main = page.locator('.aw-tabstack[data-region="main"]');
    await expect(main.locator('.cell.block')).toHaveCount(5);

    // The 'Q' chord (shortcuts.ts → routes/+page.svelte → axis.openQuickBuild) docks the panel.
    await page.keyboard.press('q');
    const qb = page.locator('.quick-build');
    await expect(qb).toBeVisible();
    await expect(
      page.locator('.aw-tabstack[data-region="left"] .aw-pane-tab').filter({ hasText: 'Quick Build' })
    ).toHaveCount(1);
    await expect(qb.getByRole('heading', { name: 'Quick Build' })).toBeVisible();

    // The served roster resolved to placeable rows; the auto target is the deterministic first free cell.
    await expect(qb.locator('.targetbar')).toContainText('cell 4,1');
    const gate = qb.locator('.blocks .block', { hasText: 'Gate' });
    await expect(gate).toBeVisible();
    await expect(gate).toBeEnabled();

    // Place it — the panel reports the exact cell and the placement op writes that grid cell.
    await gate.click();
    await expect(qb.locator('.status')).toContainText('Placed Gate in cell 4,1.');

    // Concrete post-state #1: the grid write (1-indexed) for the curated block's page id.
    expect(grid.writes).toEqual([{ row: 4, col: 1, blockId: 600 }]);

    // Concrete post-state #2: the Signal Grid actually changed — a new block cell at (row 3, col 0).
    await expect(main.locator('.cell.block')).toHaveCount(6);
    await expect(main.locator('[data-idx="3,0"].cell.block')).toHaveCount(1);

    // The placed family is now greyed out ("on grid") in the panel — placement is reflected back.
    await expect(gate).toBeDisabled();
    await expect(gate.locator('.on')).toHaveText('on grid');
  });
});
