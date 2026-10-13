import { test, expect, type Page, type Route } from '@playwright/test';
import { bootCleanWorkbench } from './support/workbench';
import { readFileSync } from 'node:fs';

/**
 * The device group label ("CAB 1" / "CAB 2") must be HONEST about a narrow band.
 *
 * The owner's call (2026-10-13) is a product decision, not a fit-to-view one: the label must never be
 * SILENTLY clipped. A band too narrow for the text truncates it VISUALLY with an ellipsis, and the full
 * string stays available in `title` + `aria-label`. The 2026-10-07 fit-to-view cell shrink is NOT the
 * answer — it dropped dials to ~30px on a tall board and was reverted the same day; the accepted
 * behaviour is a board that fills the pane width and scrolls.
 *
 * Driven over the REAL served Cab payload (`src/lib/cabBoard.fixture.json`, the live GET
 * /preset/blocks/62/params for Cab 1 of preset 410) so the headings are the device's own "CAB 1"/"CAB 2"
 * bands, not a toy mock. Nothing here touches the unit: the backend is mocked.
 *
 * WHY the assertion is written this way: "it fits" is not the property under test (a wide band fits and
 * says nothing). The property is "IF the text is wider than its box, it is truncated WITH an ellipsis,
 * and the full text is still retrievable". Both halves are asserted, with the measured widths printed.
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
  editorLayouts: true
};
const DEVICE = { model: 'FM3', modelByte: '0x11', modelId: 17, apiVersion: 2, capabilities: CAPS, firmware: null, port: 'mock' };
const DETECT = { connected: true, modelId: 17, name: 'FM3', short: 'FM3', gen: 3, supported: true, port: 'mock' };
const GRID = {
  model: 'FM3',
  name: 'MOCK LAYOUT',
  crcValid: true,
  rows: 4,
  cols: 6,
  scenes: [],
  cells: [{ row: 0, col: 0, effectId: 200, name: '1x8 Princetone', slug: 'Cab', isShunt: false, routeFlag: 0, fromRows: [] }]
};

const REAL = JSON.parse(readFileSync(new URL('../src/lib/cabBoard.fixture.json', import.meta.url), 'utf8'));

async function bootWithRealCab(page: Page): Promise<void> {
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
    if (/^\/preset\/blocks\/200\/params$/.test(path)) return json(route, REAL);
    return json(route, {});
  });
  await page.route('**/api/events', (route) => route.abort());
  await bootCleanWorkbench(page);
  await expect(page.locator('[data-idx="0,0"].cell.block')).toBeVisible();
  await page.locator('[data-idx="0,0"].cell.block').click();
  await expect(page.locator('.boardwrap')).toBeVisible();
}

test.describe('device group label — honest truncation, never a silent clip', () => {
  test('the full label is in title + aria-label, and a narrow band ellipsizes instead of clipping', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await bootWithRealCab(page);

    // Two device bands, each with the device's own label.
    await expect(page.locator('.grouphead')).toHaveCount(2);

    const m = await page.evaluate(() => {
      const heads = [...document.querySelectorAll('.grouphead')] as HTMLElement[];
      return heads.map((head) => {
        const txt = head.querySelector('.gheadtxt') as HTMLElement | null;
        // Measure the REAL rendered widths: the box, and the text's own (unclipped) extent.
        const boxW = Math.round(head.getBoundingClientRect().width);
        const textW = Math.round((txt ?? head).scrollWidth);
        const clientW = Math.round((txt ?? head).clientWidth);
        const cs = getComputedStyle(txt ?? head);
        return {
          text: head.textContent?.trim() ?? '',
          title: head.getAttribute('title'),
          ariaLabel: head.getAttribute('aria-label'),
          boxW,
          textW,
          clientW,
          // "would truncate": the text is wider than the space it is given.
          truncated: textW > clientW + 1,
          overflow: cs.overflow,
          whiteSpace: cs.whiteSpace,
          textOverflow: cs.textOverflow
        };
      });
    });

    console.log('group-label measurements:', JSON.stringify(m));

    for (const h of m) {
      // (1) The full text is ALWAYS recoverable, whether or not it is visually truncated.
      expect(h.title, `title must carry the full label for "${h.text}"`).toBe(h.text);
      expect(h.ariaLabel, `aria-label must carry the full label for "${h.text}"`).toBe(h.text);

      // (2) The label's own text is set up to ELLIPSIZE, never to clip: the honesty contract is that a
      //     band too narrow for the string shows a truncation marker, not a cut-off word.
      expect(h.textOverflow, `"${h.text}" must truncate with an ellipsis`).toBe('ellipsis');
      expect(h.whiteSpace, `"${h.text}" must stay on one line`).toBe('nowrap');
      expect(h.overflow, `"${h.text}" must hide its overflow`).toBe('hidden');
    }
  });

  test('squeezed narrower than the text, the label truncates WITH an ellipsis instead of clipping', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await bootWithRealCab(page);

    // On this device the band is wide, so the string fits and nothing is truncated — a case that would
    // prove nothing. Squeeze the label's box below the text width and measure the REAL behaviour: the
    // text must now overflow (scrollWidth > clientWidth) AND still carry the ellipsis, i.e. it is
    // truncated visually rather than silently cut. This is the property under test — not "it fits".
    const m = await page.evaluate(() => {
      const head = document.querySelector('.grouphead') as HTMLElement;
      const txt = head.querySelector('.gheadtxt') as HTMLElement;
      const before = Math.round(txt.scrollWidth);
      txt.style.maxWidth = '18px';
      const after = { textW: Math.round(txt.scrollWidth), clientW: Math.round(txt.clientWidth) };
      const cs = getComputedStyle(txt);
      const out = {
        text: head.textContent?.trim() ?? '',
        title: head.getAttribute('title'),
        ariaLabel: head.getAttribute('aria-label'),
        naturalTextW: before,
        squeezedTextW: after.textW,
        squeezedClientW: after.clientW,
        textOverflow: cs.textOverflow,
        whiteSpace: cs.whiteSpace,
        overflow: cs.overflow
      };
      txt.style.maxWidth = '';
      return out;
    });
    console.log('squeezed group-label measurement:', JSON.stringify(m));

    expect(m.squeezedTextW, 'the label really is wider than its squeezed box').toBeGreaterThan(m.squeezedClientW + 1);
    expect(m.textOverflow, 'a squeezed label must ellipsize, not clip').toBe('ellipsis');
    expect(m.whiteSpace).toBe('nowrap');
    expect(m.overflow).toBe('hidden');
    // …and the full text never becomes unreachable just because the box is narrow.
    expect(m.title).toBe(m.text);
    expect(m.ariaLabel).toBe(m.text);
  });
});
