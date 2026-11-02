import { test, expect, type Page } from '@playwright/test';
import { bootCleanWorkbench } from './support/workbench';
import { installGridMock, type GridMock } from './support/gridMock';

// Shunt interaction: a shunt is routing plumbing, not a block.
//   • click / tap  → block picker for that cell (place() replaces the shunt in place)
//   • right-click  → menu with "Remove shunt"
//   • Delete key   → remove (keyboard path for the same deliberate action)
// Both flows run against the MOCKED backend (installGridMock) — nothing reaches a live FM3.

const SHUNT = '[data-idx="2,1"]'; // seeded shunt, 0-indexed
const ROW = 3; // …which is row 3 in the 1-indexed write bodies
const COL = 2;

async function boot(page: Page): Promise<GridMock> {
  const mock = await installGridMock(page);
  await bootCleanWorkbench(page);
  await expect(page.locator(SHUNT)).toBeVisible();
  return mock;
}

const cellWritesFor = (mock: GridMock) =>
  mock.cellWrites.filter((c) => c.row === ROW && c.col === COL);

test.describe('Shunt menu', () => {
  test('clicking a shunt opens the block picker instead of deleting it', async ({ page }) => {
    const mock = await boot(page);
    await page.locator(SHUNT).click();

    // the palette targets the shunt's cell…
    await expect(page.locator('.search input')).toBeVisible();
    await expect(page.getByText('Place in cell 3,2')).toBeVisible();

    // …and the shunt is still on the grid: nothing was cleared.
    expect(cellWritesFor(mock)).toHaveLength(0);
    await expect(page.locator(SHUNT)).toHaveClass(/shunt/);

    // (The mock's /preset/blocks answers [], so the palette has no rows to pick here — placement onto a
    // shunt is covered by 16-grid-routing. What matters here is that the shunt survived the click.)
  });

  test('right-click → Remove shunt clears the cell', async ({ page }) => {
    const mock = await boot(page);
    await page.locator(SHUNT).click({ button: 'right' });

    const menu = page.getByTestId('shunt-menu');
    await expect(menu).toBeVisible();
    await expect(menu.getByRole('menuitem', { name: 'Select a block…' })).toBeVisible();
    // right-click must not ALSO open the block picker
    await expect(page.locator('.search input')).toHaveCount(0);

    await menu.getByRole('menuitem', { name: 'Remove shunt' }).click();
    await expect(menu).toHaveCount(0);
    // The mock's GET /preset/grid keeps serving the seeded grid, so the reconcile after the write
    // puts the shunt back on screen — assert the WRITE (the thing that reaches the device), not the DOM.
    await expect.poll(() => cellWritesFor(mock).filter((c) => c.blockId === 0).length).toBe(1);
  });

  test('Delete removes a focused shunt', async ({ page }) => {
    const mock = await boot(page);
    await page.locator(SHUNT).focus();
    await page.keyboard.press('Delete');
    await expect.poll(() => cellWritesFor(mock).filter((c) => c.blockId === 0).length).toBe(1);
  });
});
