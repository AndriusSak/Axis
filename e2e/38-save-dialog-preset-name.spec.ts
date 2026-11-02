import { test, expect, type Page, type Route } from '@playwright/test';
import { bootCleanWorkbench } from './support/workbench';

/**
 * There was no way to name a preset while saving it.
 *
 * The device takes the name from the EDIT BUFFER, and the store operation (`/preset/store`) writes the
 * buffer as-is — so a name typed only at save time has to be pushed to the buffer first (`/preset/name`)
 * and then stored. The dialog had a slot picker and nothing else; the only naming control was the ✎
 * in the top bar, which nobody looking for "name my preset while saving" would find.
 *
 * This spec drives the real dialog against a mocked backend and asserts the ORDER: rename, then store,
 * and that a failed rename aborts the store (storing would otherwise write the OLD name to the slot).
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
  editorLayouts: true,
  // liveQuery: the current-preset poll populates editor.preset (the NAME field is gated on it).
  presets: { canRename: true, liveQuery: true, count: 512 }
};
const DEVICE = { model: 'FM3', modelByte: '0x11', modelId: 17, apiVersion: 2, capabilities: CAPS, firmware: null, port: 'mock' };
const DETECT = { connected: true, modelId: 17, name: 'FM3', short: 'FM3', gen: 3, supported: true, port: 'mock' };
const GRID = {
  model: 'FM3',
  name: 'MOCK',
  crcValid: true,
  rows: 4,
  cols: 6,
  scenes: [],
  cells: [
    { row: 0, col: 0, effectId: 200, name: 'Input', slug: 'Input', isShunt: false, routeFlag: 0, fromRows: [] },
    { row: 0, col: 1, effectId: 201, name: 'USA Mk IV', slug: 'Amp', isShunt: false, routeFlag: 0, fromRows: [] }
  ]
};

/** `calls` records the write endpoints in the order the page hit them. */
async function bootWithDevice(page: Page, calls: string[], opts: { nameOk?: boolean } = {}): Promise<void> {
  const json = (route: Route, body: unknown, status = 200) =>
    route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
  // The unit reflects a successful rename in its current-preset query — the client re-reads it to
  // confirm the name stuck before storing, so the mock has to behave like the device here.
  let currentName = 'Usa Mk4 Four Blocks';
  await page.route('**/api/**', async (route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname.replace(/^\/api/, '');
    if (req.method() === 'POST' && (path === '/preset/name' || path === '/preset/store')) calls.push(path);
    if (path === '/device') return json(route, DEVICE);
    if (path === '/device/detect') return json(route, DETECT);
    if (path === '/healthz') return json(route, { ok: true, api: { version: 2 }, device: 'FM3' });
    if (path === '/preset') return json(route, { number: 411, name: currentName });
    if (path === '/preset/grid') return json(route, GRID);
    if (path === '/preset/blocks') return json(route, []);
    if (path === '/ports') return json(route, { chosen: null, override: null, profileOverride: null, ports: [] });
    if (path === '/preset/name') {
      const ok = opts.nameOk !== false;
      if (ok) currentName = (JSON.parse(req.postData() ?? '{}').name ?? currentName) as string;
      return json(route, { ok });
    }
    if (path === '/preset/store') return json(route, { ok: true, location: 411, code: 'C11' });
    return json(route, {});
  });
  await page.route('**/api/events', (route) => route.abort());
  await bootCleanWorkbench(page);
}

test.describe('Save dialog — preset name', () => {
  test('the dialog carries a NAME field prefilled from the loaded preset', async ({ page }) => {
    const calls: string[] = [];
    await bootWithDevice(page, calls);

    // The Save widget ships in the default top-right cluster.
    await page.locator('[data-widget="axis.widget.save"] button').click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    const name = dialog.locator('input.txt');
    await expect(name).toBeVisible();
    await expect(name).toHaveValue('Usa Mk4 Four Blocks');
  });

  test('renaming writes the buffer FIRST, then stores the slot', async ({ page }) => {
    const calls: string[] = [];
    await bootWithDevice(page, calls);

    await page.locator('[data-widget="axis.widget.save"] button').click();
    const dialog = page.getByRole('dialog');
    const name = dialog.locator('input.txt');
    await name.fill('Blade Runner Live');
    await dialog.getByRole('button', { name: /^Save to/ }).click();

    await expect.poll(() => calls).toEqual(['/preset/name', '/preset/store']);
    await expect(dialog).toHaveCount(0);
  });

  test('a rejected rename never reaches the store', async ({ page }) => {
    const calls: string[] = [];
    await bootWithDevice(page, calls, { nameOk: false });

    await page.locator('[data-widget="axis.widget.save"] button').click();
    const dialog = page.getByRole('dialog');
    await dialog.locator('input.txt').fill('Will Not Stick');
    await dialog.getByRole('button', { name: /^Save to/ }).click();

    await expect.poll(() => calls).toEqual(['/preset/name']);
    // The dialog stays up so the user can retry rather than believing the save happened.
    await expect(dialog).toBeVisible();
  });
});
