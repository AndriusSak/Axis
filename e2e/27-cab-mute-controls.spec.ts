import { test, expect, type Page, type Route } from '@playwright/test';
import { bootCleanWorkbench } from './support/workbench';

/**
 * The Cab page's per-cab M / S controls.
 *
 * The device layout gives each cab slot an M and an S button carrying pseudo paramIds
 * (65286…65289; paramName CABINET_BTN_MUTE<n> / CABINET_BTN_SOLO<n>) that are never served as
 * parameters. The state they drive IS served: enum MUTE<n> with options '-- / MUTE / SOLO'. The board
 * builder re-resolves the pseudo-param by name, so each cab slot must render ONE working state
 * control — and clicking it must open the option list.
 *
 * Reproduces the reported "only Mute 1, and the dropdown does nothing" against a mocked backend.
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
  name: 'MOCK CAB MUTE',
  crcValid: true,
  rows: 4,
  cols: 6,
  scenes: [],
  cells: [{ row: 0, col: 0, effectId: 200, name: '4x12 Recto', slug: 'Cab', isShunt: false, routeFlag: 0, fromRows: [] }]
};

const states = (v: number) => ({ id: 0, name: '', value: v, options: [{ value: 0, label: '--' }, { value: 1, label: 'MUTE' }, { value: 2, label: 'SOLO' }] });
const muteEnum = (id: number, name: string, value = 0) => ({ ...states(value), id, name });

const muteBtn = (label: string, paramId: number, paramName: string) => ({
  label,
  paramName,
  paramId,
  widget: 'button',
  rawWidget: 'btnSquare'
});
const knobCtl = (label: string, paramId: number, rawWidget = 'knobMiniReadout') => ({ label, paramName: null, paramId, widget: 'knob', rawWidget });

const named = (id: number, name: string, norm = 0) => ({ id, name, value: norm * 10, norm, min: 0, max: 10 });
const enumNamed = (id: number, name: string, n = 3) => ({
  id,
  name,
  value: 0,
  options: Array.from({ length: n }, (_, i) => ({ value: i, label: `OPT${i}` }))
});

// The REAL FM3 DynaCab Cab page, both slots: the M/S pseudo-buttons, the mic graphs, the knobs that
// push them down the grid, and the two cab-slot type/mic dropdowns.
const BLOCK_PARAMS = {
  block: 'Cab',
  slug: 'cab',
  page: 12,
  named: [named(93, 'DynaCab1 Pos'), named(97, 'DynaCab1 Dist'), named(8, 'Level 1'), named(12, 'Pan 1'), named(94, 'DynaCab2 Pos'), named(98, 'DynaCab2 Dist'), named(9, 'Level 2'), named(13, 'Pan 2')],
  enums: [muteEnum(24, 'MUTE1'), muteEnum(25, 'MUTE2'), enumNamed(85, 'DYNACAB TYPE1', 45), enumNamed(89, 'DYNACAB MIC1', 4), enumNamed(86, 'DYNACAB TYPE2', 45), enumNamed(90, 'DYNACAB MIC2', 4)],
  type: { value: 1, name: 'DYNA-CAB' },
  layout: {
    editorName: 'Cab',
    family: 'CABINET',
    variantName: 'Mode',
    variantValue: 'DYNA-CAB',
    pages: [
      {
        name: 'Cab',
        rows: [
          {
            section: 'parameters',
            controls: [
              muteBtn('M', 65286, 'CABINET_BTN_MUTE1'),
              muteBtn('S', 65288, 'CABINET_BTN_SOLO1'),
              { label: 'DynaCab', paramName: 'CABINET_DYNACAB_R1', paramId: 93, widget: 'unknown', rawWidget: 'dynaCabControl' },
              knobCtl('Pan', 12),
              knobCtl('Distance', 97),
              knobCtl('Level', 8),
              muteBtn('M', 65287, 'CABINET_BTN_MUTE2'),
              muteBtn('S', 65289, 'CABINET_BTN_SOLO2'),
              { label: 'DynaCab', paramName: 'CABINET_DYNACAB_R2', paramId: 94, widget: 'unknown', rawWidget: 'dynaCabControl' },
              knobCtl('Pan', 13),
              knobCtl('Distance', 98),
              knobCtl('Level', 9)
            ]
          }
        ]
      }
    ]
  }
};

async function bootWithCab(page: Page, params: unknown = BLOCK_PARAMS): Promise<void> {
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
    if (/^\/preset\/blocks\/200\/params$/.test(path)) return json(route, params);
    return json(route, {});
  });
  await page.route('**/api/events', (route) => route.abort());
  await bootCleanWorkbench(page);
  await expect(page.locator('[data-idx="0,0"].cell.block')).toBeVisible();
  await page.locator('[data-idx="0,0"].cell.block').click();
  await expect(page.locator('.boardwrap')).toBeVisible();
}

/**
 * The SERVER-RESOLVED shape — the PRIMARY path since parity-audit §3.6 item 4 was fixed. ForgeFX's
 * gen-3 driver now rewrites `CABINET_BTN_MUTE<n>` to the REAL served enum before the layout reaches
 * the client, so the M controls arrive with real paramIds (24 / 25 = the `MUTE<n>` enums) instead of
 * the 65286… pseudo ids. The S controls legitimately KEEP their pseudo ids: "SOLO" is an OPTION of the
 * MUTE enum, not a param, so the client's pair-collapse still handles them.
 *
 * The rest of this file mocks the OLDER-SERVER shape, which pins the documented client FALLBACK. This
 * block pins the primary path so a regression in either cannot hide behind the other.
 */
const SERVER_RESOLVED_PARAMS = {
  ...BLOCK_PARAMS,
  layout: {
    ...BLOCK_PARAMS.layout,
    pages: [
      {
        name: 'Cab',
        rows: [
          {
            section: 'parameters',
            controls: BLOCK_PARAMS.layout.pages[0].rows[0].controls.map((c) => {
              if (c.label === 'M' && c.paramName === 'CABINET_BTN_MUTE1') return { ...c, paramId: 24, paramName: 'CABINET_MUTE1' };
              if (c.label === 'M' && c.paramName === 'CABINET_BTN_MUTE2') return { ...c, paramId: 25, paramName: 'CABINET_MUTE2' };
              return c;
            })
          }
        ]
      }
    ]
  }
};

test.describe('Cab page M / S controls', () => {
  test('both cab slots get their state control', async ({ page }) => {
    await bootWithCab(page);
    await expect(page.locator('.seltop')).toHaveCount(2);
    await expect(page.locator('.seltop').first()).toHaveText(/MUTE1/);
    await expect(page.locator('.seltop').nth(1)).toHaveText(/MUTE2/);
  });

  test('clicking a state control opens its option list', async ({ page }) => {
    await bootWithCab(page);
    await page.locator('.selfield').first().click();
    await expect(page.locator('.selopt')).toHaveCount(3);
  });

  // The menu is positioned from the widget's GRID cell inside the board container, so a control in a
  // lower row puts the menu below the board — and the block-editor pane clips it. Then the click looks
  // like it "does nothing except highlight". Assert the menu lands inside the pane the user can see.
  test('the option list of a LOWER-row state control is visible (not clipped by the pane)', async ({ page }) => {
    await bootWithCab(page);
    const field = page.locator('.selfield').nth(1);
    await field.scrollIntoViewIfNeeded();
    await field.click();
    await expect(page.locator('.selopt')).toHaveCount(3);

    const geo = await page.evaluate(() => {
      const menu = document.querySelector('.selmenu') as HTMLElement | null;
      const bw = document.querySelector('.boardwrap');
      let pane: HTMLElement | null = null;
      for (let p = bw?.parentElement ?? null; p && p !== document.body; p = p.parentElement) {
        const s = getComputedStyle(p);
        if (s.overflowY === 'auto' || s.overflowY === 'scroll' || s.overflow === 'hidden') {
          pane = p;
          break;
        }
      }
      const r = menu?.getBoundingClientRect();
      const pr = pane?.getBoundingClientRect();
      const fr = (document.querySelectorAll('.selfield')[1] as HTMLElement | undefined)?.getBoundingClientRect();
      const br = bw?.getBoundingClientRect();
      return {
        paneH: pr ? Math.round(pr.height) : null,
        menu: r ? { t: Math.round(r.top), b: Math.round(r.bottom), h: Math.round(r.height) } : null,
        pane: pr ? { t: Math.round(pr.top), b: Math.round(pr.bottom) } : null,
        field: fr ? { t: Math.round(fr.top), b: Math.round(fr.bottom) } : null,
        board: br ? { t: Math.round(br.top), b: Math.round(br.bottom) } : null,
        menuStyle: menu?.getAttribute('style') ?? null,
        visibleH: r && pr ? Math.round(Math.max(0, Math.min(r.bottom, pr.bottom) - Math.max(r.top, pr.top))) : 0,
        visible: !!r && !!pr && r.top < pr.bottom && r.bottom > pr.top
      };
    });
    // eslint-disable-next-line no-console
    console.log('MENU GEO ' + JSON.stringify(geo));
    // Not merely "overlaps the pane": enough of the list must be on screen to actually pick an option.
    expect(geo.visibleH, `menu must be usable inside the pane: ${JSON.stringify(geo)}`).toBeGreaterThanOrEqual(56);
  });

  // The reported symptom was "the search only shows Mute 1". The search renders EVERY catalog match as
  // a card, so if the first fills the results area the rest are invisible — and unreachable if nothing
  // in that area scrolls. Assert every match has real visible area (or a scrollable ancestor).
  test('the control search makes EVERY match reachable, not just the first', async ({ page }) => {
    await bootWithCab(page);
    await page.locator('.csin').fill('mute');
    await expect(page.locator('.seltop')).toHaveCount(2);

    const info = await page.evaluate(() => {
      const clip = (el: Element) => {
        let r = el.getBoundingClientRect();
        for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
          const s = getComputedStyle(p);
          if (s.overflow === 'visible' && s.overflowY === 'visible') continue;
          const pr = p.getBoundingClientRect();
          const t = Math.max(r.top, pr.top);
          const b = Math.min(r.bottom, pr.bottom);
          const l = Math.max(r.left, pr.left);
          const rr = Math.min(r.right, pr.right);
          r = { ...r, top: t, bottom: b, left: l, right: rr, width: Math.max(0, rr - l), height: Math.max(0, b - t) } as DOMRect;
        }
        const winB = window.innerHeight;
        const winR = window.innerWidth;
        const t = Math.max(r.top, 0);
        const b = Math.min(r.bottom, winB);
        const l = Math.max(r.left, 0);
        const rr = Math.min(r.right, winR);
        return Math.max(0, b - t) * Math.max(0, rr - l);
      };
      const scrollable = (() => {
        for (let p = document.querySelector('.boardwrap')?.parentElement ?? null; p && p !== document.body; p = p.parentElement) {
          const s = getComputedStyle(p);
          if ((s.overflowY === 'auto' || s.overflowY === 'scroll') && p.scrollHeight > p.clientHeight + 2) return true;
        }
        return false;
      })();
      return {
        areas: Array.from(document.querySelectorAll('.seltop')).map((e) => Math.round(clip(e))),
        labels: Array.from(document.querySelectorAll('.seltop')).map((e) => e.textContent?.trim() ?? ''),
        scrollable
      };
    });
    // eslint-disable-next-line no-console
    console.log('SEARCH MATCHES ' + JSON.stringify(info));
    const bothVisible = info.areas.every((a) => a > 200);
    expect(bothVisible || info.scrollable, `a match is unreachable: ${JSON.stringify(info)}`).toBe(true);
  });

  // Existence is not enough: two widgets placed in the SAME grid cell stack on top of each other and
  // the user sees one control. Assert both have real area and do not overlap.
  test('the two state controls do not overlap each other', async ({ page }) => {
    await bootWithCab(page);
    const boxes = await page.locator('.selfield').evaluateAll((els) =>
      els.map((e) => {
        const r = e.getBoundingClientRect();
        return { t: Math.round(r.top), b: Math.round(r.bottom), l: Math.round(r.left), r: Math.round(r.right) };
      })
    );
    // eslint-disable-next-line no-console
    console.log('FIELDS ' + JSON.stringify(boxes));
    expect(boxes.length).toBe(2);
    const [a, b] = boxes;
    const overlap = a.l < b.r && b.l < a.r && a.t < b.b && b.t < a.b;
    expect(overlap, `state controls overlap each other: ${JSON.stringify(boxes)}`).toBe(false);
    for (const x of boxes) expect((x.r - x.l) * (x.b - x.t), `zero-area control ${JSON.stringify(x)}`).toBeGreaterThan(100);
  });

  // The Cab page is taller than the block-editor pane, so the LOWER cab slot's control only exists for
  // the user if the pane actually scrolls. Dump the ancestor chain and assert reachability.
  test('the lower cab-slot control is reachable, not clipped with no way to scroll', async ({ page }) => {
    await bootWithCab(page);
    const info = await page.evaluate(() => {
      const bw = document.querySelector('.boardwrap') as HTMLElement | null;
      const chain: {
        tag: string;
        cls: string;
        oy: string;
        o: string;
        sh: number;
        ch: number;
        top: number;
        bottom: number;
      }[] = [];
      for (let p = bw?.parentElement ?? null; p && p !== document.body; p = p.parentElement) {
        const s = getComputedStyle(p);
        const r = p.getBoundingClientRect();
        chain.push({
          tag: p.tagName,
          cls: typeof p.className === 'string' ? p.className : '',
          oy: s.overflowY,
          o: s.overflow,
          sh: p.scrollHeight,
          ch: p.clientHeight,
          top: Math.round(r.top),
          bottom: Math.round(r.bottom)
        });
      }
      const fields = Array.from(document.querySelectorAll('.selfield')) as HTMLElement[];
      const last = fields[fields.length - 1];
      const r = last?.getBoundingClientRect();
      const scrollable = chain.some((c) => (c.oy === 'auto' || c.oy === 'scroll') && c.sh > c.ch + 2);
      return {
        chain,
        lastField: r ? { t: Math.round(r.top), b: Math.round(r.bottom) } : null,
        board: bw ? { h: Math.round(bw.getBoundingClientRect().height) } : null,
        scrollable,
        winH: window.innerHeight
      };
    });
    // eslint-disable-next-line no-console
    console.log('PANE CHAIN ' + JSON.stringify(info, null, 1));
    const inWindow = !!info.lastField && info.lastField.t < info.winH && info.lastField.b > 0;
    expect(inWindow || info.scrollable, `lower control unreachable: ${JSON.stringify(info)}`).toBe(true);
  });

  // "The search only shows Mute 1" was read as "Mute 2 does not exist". The matches render as full
  // control cards, so in a short block pane only the first is on screen — the count must therefore
  // state how many controls matched, or a single visible card reads as a single result.
  test('the search reports HOW MANY controls matched, not just the ones that fit', async ({ page }) => {
    await bootWithCab(page);
    await expect(page.locator('.cscount')).toHaveCount(0); // only while searching
    await page.locator('.csin').fill('mute');
    await expect(page.locator('.cscount')).toBeVisible();
    await expect(page.locator('.cscount')).toHaveText('2 matches');
    await page.locator('.csin').fill('dynacab mic1');
    await expect(page.locator('.cscount')).toHaveText('1 match');
    await page.locator('.csin').fill('zzz no such control');
    await expect(page.locator('.cscount')).toHaveText('0 matches');
  });
});

// ── the PRIMARY path: the server has already resolved the pseudo ids ────────────────────────────────
test.describe('Cab page M / S controls — server-resolved layout (parity audit §3.6 item 4)', () => {
  test('both cab slots still get exactly one working state control', async ({ page }) => {
    await bootWithCab(page, SERVER_RESOLVED_PARAMS);
    await expect(page.locator('.seltop')).toHaveCount(2);
    await expect(page.locator('.seltop').first()).toHaveText(/MUTE1/);
    await expect(page.locator('.seltop').nth(1)).toHaveText(/MUTE2/);
  });

  test('clicking a state control opens its option list', async ({ page }) => {
    await bootWithCab(page, SERVER_RESOLVED_PARAMS);
    await page.locator('.selfield').first().click();
    await expect(page.locator('.selopt')).toHaveCount(3);
  });

  test('the two state controls have real area and do not overlap', async ({ page }) => {
    await bootWithCab(page, SERVER_RESOLVED_PARAMS);
    const boxes = await page.locator('.selfield').evaluateAll((els) =>
      els.map((e) => {
        const r = e.getBoundingClientRect();
        return { t: Math.round(r.top), b: Math.round(r.bottom), l: Math.round(r.left), r: Math.round(r.right) };
      })
    );
    // eslint-disable-next-line no-console
    console.log('FIELDS (server-resolved) ' + JSON.stringify(boxes));
    expect(boxes.length).toBe(2);
    const [a, b] = boxes;
    const overlap = a.l < b.r && b.l < a.r && a.t < b.b && b.t < a.b;
    expect(overlap, `state controls overlap each other: ${JSON.stringify(boxes)}`).toBe(false);
    for (const x of boxes) expect((x.r - x.l) * (x.b - x.t), `zero-area control ${JSON.stringify(x)}`).toBeGreaterThan(100);
  });

  test('a write targets the REAL served param id, not the pseudo id', async ({ page }) => {
    // The server-resolved M control carries paramId 24 (`CABINET_MUTE1`), so selecting an option must
    // PUT to /preset/blocks/200/params/24 — never to the dead 65286 pseudo id.
    const puts: string[] = [];
    await page.route('**/api/**', async (route) => {
      const req = route.request();
      if (req.method() === 'PUT') {
        puts.push(new URL(req.url()).pathname);
        return route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' });
      }
      const p = new URL(req.url()).pathname.replace(/^\/api/, '');
      const body: Record<string, unknown> =
        p === '/device' ? DEVICE
        : p === '/device/detect' ? DETECT
        : p === '/healthz' ? { ok: true, api: { version: 2 }, device: 'FM3' }
        : p === '/preset/grid' ? GRID
        : p === '/preset/blocks' ? []
        : p === '/ports' ? { chosen: null, override: null, profileOverride: null, ports: [] }
        : /^\/preset\/blocks\/200\/params$/.test(p) ? (SERVER_RESOLVED_PARAMS as unknown as Record<string, unknown>)
        : {};
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    });
    await page.route('**/api/events', (route) => route.abort());
    await bootCleanWorkbench(page);
    await page.locator('[data-idx="0,0"].cell.block').click();
    await expect(page.locator('.boardwrap')).toBeVisible();

    await page.locator('.selfield').first().click();
    await page.locator('.selopt').nth(1).click(); // MUTE
    await page.waitForTimeout(200);
    expect(puts.length, `no PUT captured: ${JSON.stringify(puts)}`).toBeGreaterThan(0);
    expect(puts.some((u) => u.includes('/params/24')), `wrote to a pseudo/other id: ${JSON.stringify(puts)}`).toBe(true);
    expect(puts.some((u) => u.includes('65286')), `wrote to the DEAD pseudo id: ${JSON.stringify(puts)}`).toBe(false);
  });
});
