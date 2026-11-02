import { test, expect, type Page, type Route } from '@playwright/test';
import { bootCleanWorkbench, WORKBENCH_DOC_KEY } from './support/workbench';

// The Output block's output-level meter (FM3 / FM3-Edit parity): the OUT block page shows a live
// Output 1 L/R meter fed by the always-on Preset Leveling stream — no METER toggle, no extra serial
// reads. The same reading is available as a workbench widget (axis.outputMeter).
//
// Fully mocked backend: nothing here may reach the operator's live FM3 on :5056.

const SHUNT_BASE = 1024;

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
  shuntBase: SHUNT_BASE
};
const DEVICE = { model: 'FM3', modelByte: '0x11', modelId: 17, apiVersion: 2, capabilities: CAPS, firmware: null, port: 'mock' };
const DETECT = { connected: true, modelId: 17, name: 'FM3', short: 'FM3', gen: 3, supported: true, port: 'mock' };

// One Output block. eid 42 = 0x2a, the gen-3 OUTPUT effect id.
const GRID = {
  model: 'FM3',
  name: 'MOCK OUT',
  crcValid: true,
  rows: 4,
  cols: 6,
  scenes: [],
  cells: [{ row: 1, col: 0, effectId: 42, name: 'Output 1', slug: 'Output', isShunt: false, routeFlag: 0, fromRows: [] }]
};

// Minimal BlockParams DTO — the level meter must render whether or not the block's knobs loaded.
const BLOCK_PARAMS = {
  block: 'Output',
  slug: 'output',
  page: 0,
  named: [],
  enums: [],
  type: { value: 0, name: 'Output' }
};

async function boot(page: Page): Promise<void> {
  const json = (route: Route, body: unknown, status = 200) =>
    route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname.replace(/^\/api/, '');
    if (path === '/device') return json(route, DEVICE);
    if (path === '/device/detect') return json(route, DETECT);
    if (path === '/healthz') return json(route, { ok: true, api: { version: 2 }, device: 'FM3' });
    if (path === '/preset/grid') return json(route, GRID);
    if (path === '/preset/blocks') return json(route, []);
    if (path === '/ports') return json(route, { chosen: null, override: null, profileOverride: null, ports: [] });
    if (/^\/preset\/blocks\/42\/params$/.test(path)) return json(route, BLOCK_PARAMS);
    return json(route, {});
  });
  // The live event stream would otherwise hang / reach the dev backend.
  await page.route('**/api/events', (route) => route.abort());

  await bootCleanWorkbench(page);
  await expect(page.locator('[data-idx="1,0"].cell.block')).toBeVisible();
}

test.describe('Output block level meter', () => {
  test('the Output block page shows the Output 1 L/R meter without the METER toggle', async ({ page }) => {
    await boot(page);
    await page.locator('[data-idx="1,0"].cell.block').click();

    const meter = page.getByTestId('output-meter');
    await expect(meter).toBeVisible();
    await expect(meter).toContainText('OUT 1');
    // Two bars (L + R) on Output 1.
    await expect(meter.locator('.row').first().locator('.bar')).toHaveCount(2);
    // Output 2 only appears when it carries signal — an idle Output 2 must not add a dead row.
    await expect(meter.locator('.row')).toHaveCount(1);
    // No reading yet (the leveling stream is aborted in this mock) → an honest dash, never a fake 0.0.
    await expect(meter.locator('.row').first().locator('.db')).toHaveText('—');
  });

  test('the same meter is available as a workbench widget (axis.outputMeter)', async ({ page }) => {
    await boot(page);

    // Place the widget the way the widget library does: an instance in a zone.
    await page.evaluate((key) => {
      const doc = JSON.parse(window.localStorage.getItem(key) as string);
      const layout = doc.layouts[doc.profiles[doc.activeProfileId].layoutId];
      layout.widgets['axis.widget.outputMeter'] = {
        id: 'axis.widget.outputMeter',
        type: 'axis.outputMeter',
        zone: 'top.right',
        order: 9,
        size: 'default',
        state: { overflowPriority: 25 }
      };
      window.localStorage.setItem(key, JSON.stringify(doc));
    }, WORKBENCH_DOC_KEY);
    await page.reload();
    await page.waitForSelector('.aw-root');

    const widget = page.locator('.axis-widget.out-meter');
    await expect(widget).toBeVisible();
    await expect(widget.getByTestId('output-meter')).toBeVisible();
    await expect(widget).toContainText('OUT 1');
  });
});
