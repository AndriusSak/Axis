import { test, expect, type Page, type Route } from '@playwright/test';
import { bootCleanWorkbench } from './support/workbench';

// P10 — a param the device could not resolve (ForgeFX's non-positional GLOBAL bulk read serves
// `value: null` + `norm: null` + a reason, never a fabricated 0 — `7d1f800`) must render as an
// EXPLICIT inert unknown control on the ControlSurface, NOT a knob parked at 0 (a fabricated zero is
// indistinguishable from a real one). Driven against a fully MOCKED backend so nothing touches a
// live FM3. Mirrors e2e/17-device-layout.spec.ts's mock shape (a v2 DeviceLayout drives the board).

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
  shuntBase: SHUNT_BASE,
  editorLayouts: true
};
const DEVICE = { model: 'FM3', modelByte: '0x11', modelId: 17, apiVersion: 2, capabilities: CAPS, firmware: null, port: 'mock' };
const DETECT = { connected: true, modelId: 17, name: 'FM3', short: 'FM3', gen: 3, supported: true, port: 'mock' };

const GRID = {
  model: 'FM3',
  name: 'MOCK NULL',
  crcValid: true,
  rows: 4,
  cols: 6,
  scenes: [],
  cells: [{ row: 0, col: 0, effectId: 200, name: 'Drive 1', slug: 'Drive', isShunt: false, routeFlag: 0, fromRows: [] }]
};

// One known knob (Gain) + one UNRESOLVED knob (the null contract) + one UNRESOLVED enum, each bound by
// a v2 layout control so the Default board draws them.
const knob = (id: number, name: string) => ({ id, name, value: 0, norm: 0.5, min: 0, max: 10 });
const BLOCK_PARAMS = {
  block: 'Drive',
  slug: 'drive',
  page: 12,
  named: [
    knob(0, 'Gain'),
    { id: 2, name: 'FS Brightness', value: null, norm: null, unresolved: 'non-positional GLOBAL family (stride 186)' }
  ],
  enums: [
    { id: 9, name: 'Bright', value: null, unresolved: 'non-positional GLOBAL family', options: [{ value: 0, label: 'Off' }, { value: 1, label: 'On' }] }
  ],
  type: { value: 3, name: 'FET Boost' },
  layout: {
    editorName: 'Drive',
    family: 'DRIVE',
    variantName: 'Type',
    variantValue: 'FET Boost',
    pages: [
      {
        name: 'Drive',
        rows: [
          {
            section: 'parameters',
            controls: [
              { label: 'Gain', paramName: 'DRIVE_GAIN', paramId: 0, widget: 'knob', rawWidget: 'knob' },
              { label: 'FS Brightness', paramName: 'GLOBAL_FS_BRIGHTNESS', paramId: 2, widget: 'knob', rawWidget: 'knob' },
              { label: 'Bright', paramName: 'DRIVE_BRIGHT', paramId: 9, widget: 'toggle', rawWidget: 'toggle' }
            ]
          }
        ]
      }
    ]
  }
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
    if (/^\/preset\/blocks\/200\/params$/.test(path)) return json(route, BLOCK_PARAMS);
    return json(route, {});
  });
  await page.route('**/api/events', (route) => route.abort());

  await bootCleanWorkbench(page);
  await expect(page.locator('[data-idx="0,0"].cell.block')).toBeVisible();
}

test.describe('P10 — an unresolved param renders as an explicit unknown control', () => {
  test('a null-value knob is inert with an em-dash, never a knob at 0', async ({ page }) => {
    await boot(page);
    await page.locator('[data-idx="0,0"].cell.block').click();
    await expect(page.locator('.boardwrap')).toBeVisible();

    // The unresolved knob renders the explicit unknown tile…
    const unknown = page.locator('.unknownctl', { hasText: 'FS Brightness' });
    await expect(unknown).toBeVisible();
    // …showing the em-dash (not 0.0) and the reason…
    await expect(unknown.locator('.ukv')).toHaveText('—');
    await expect(unknown).toHaveText(/value unavailable/);
    await expect(unknown).not.toHaveText(/0\.0/);
    // …and carrying the server's reason in its tooltip.
    await expect(unknown).toHaveAttribute('title', /non-positional GLOBAL/);

    // The unresolved knob bound NO dial (the known Gain knob still does).
    await expect(page.locator('.dialwrap')).toHaveCount(1);
  });

  test('an unresolved enum renders an inert control (no fabricated "Off")', async ({ page }) => {
    await boot(page);
    await page.locator('[data-idx="0,0"].cell.block').click();
    await expect(page.locator('.boardwrap')).toBeVisible();

    const unknown = page.locator('.unknownctl', { hasText: 'Bright' });
    await expect(unknown).toBeVisible();
    await expect(unknown.locator('.ukv')).toHaveText('—');
    // the fabricated "Off" (the old toggle behaviour for a null ordinal) must NOT appear
    await expect(page.locator('.onoff-l', { hasText: 'Bright' })).toHaveCount(0);
  });
});
