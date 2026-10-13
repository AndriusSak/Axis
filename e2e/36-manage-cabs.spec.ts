import { test, expect, type Page, type Route } from '@playwright/test';
import { buildCabIrContainerFromWords, cabIrContentXor, cabIrUserSlot, computeCabIrClosePayload, parseCabIrSyx, CAB_IR_SAMPLE_SLOTS } from 'forgefx-midi/devices/gen3';
import { bootCleanWorkbench, clickNav } from './support/workbench';
import { installGridMock } from './support/gridMock';

/**
 * Manage Cabs (V1) — real-browser coverage. The whole cab backend is an in-browser mock so no frame can
 * reach the operator's live unit: it answers GET /cab/slots from an in-memory occupancy map, records every
 * upload / clear, and can be told to DISCARD an upload (close 0x13) to prove the UI reports the unit's own
 * answer rather than the acks. Container bytes are checked in Node with the codec itself.
 */

const CAPS = {
  slotModel: 'grid', slotCount: 512, grid: { rows: 4, cols: 6 }, hasScenes: false, sceneCount: 0, hasChannels: false,
  channelNames: [], channelBlocks: [], supportsSave: true, gridRouting: true, gridCursorSelect: false, shuntBase: 1024,
  cabIrs: true
};
const DEVICE = { model: 'FM3', modelByte: '0x11', modelId: 0x11, apiVersion: 2, capabilities: CAPS, firmware: null, port: 'mock' };
const DETECT = { connected: true, modelId: 0x11, name: 'FM3', short: 'FM3', gen: 3, supported: true, port: 'mock' };

interface Upload { user: number; bytes: Buffer }
interface CabMock {
  populated: Set<number>;
  uploads: Upload[];
  clears: number[];
  order: string[];
  discard: boolean;
  library: { id: string; user: number; name: string; bytes: number[] }[];
  /** Slots refilled OUTSIDE Axis: the name the unit now reports differs from the library copy. */
  refilled: Record<number, string>;
}

const sha = 'a'.repeat(64);
const libContainer = (name: string): number[] =>
  buildCabIrContainerFromWords(0x11, cabIrUserSlot(1), name, Array.from({ length: CAB_IR_SAMPLE_SLOTS }, (_, i) => i * 7));

async function installCabMock(page: Page, seed: { populated: number[]; held?: { user: number; name: string }[]; refilled?: Record<number, string> }): Promise<CabMock> {
  const mock: CabMock = {
    populated: new Set(seed.populated), uploads: [], clears: [], order: [], discard: false, refilled: seed.refilled ?? {},
    library: (seed.held ?? []).map((h, i) => ({ id: `cab-m${i}-0000000${i}`, user: h.user, name: h.name, bytes: libContainer(h.name) }))
  };
  await installGridMock(page);
  const json = (route: Route, body: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
  // A populated slot reports its held name (or the REFILLED name if it was changed outside Axis); a slot
  // with no held/refilled identity reports a loud placeholder so a UI leak is unmistakable.
  const nameOf = (user: number) => mock.refilled[user] ?? mock.library.find((e) => e.user === user)?.name ?? 'SHOULD NEVER RENDER';
  const row = (page16: number, index: number) => {
    const user = (page16 - 0x10) * 128 + index + 1;
    const pop = mock.populated.has(user);
    return { index, page: page16, populated: pop, flag: pop ? 1 : 0x7f, nameRegion: [], name: pop ? nameOf(user) : '<EMPTY>' };
  };
  await page.route('**/api/**', async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const path = url.pathname.replace(/^\/api/, '');
    const m = req.method();
    if (path === '/device') return json(route, DEVICE);
    if (path === '/device/detect') return json(route, DETECT);
    if (path === '/cab/slots' && m === 'GET') {
      const user = url.searchParams.get('user');
      if (user) { const u = Number(user); return json(route, [row(0x10 + Math.floor((u - 1) / 128), (u - 1) % 128)]); }
      const p = Number(url.searchParams.get('page'));
      return json(route, Array.from({ length: 128 }, (_, i) => row(p, i)));
    }
    if (path === '/cab/library' && m === 'GET') {
      return json(route, {
        entries: mock.library.map((e, i) => ({ id: e.id, name: e.name, page: 0x10, index: e.user - 1, user: e.user, length: e.bytes.length, sha256: sha, savedAt: 1000 + i, source: 'upload', available: true })),
        total: mock.library.length, skipped: 0, cap: 200,
        scope: 'IRs uploaded through Axis. Slots that already held an IR when the stack first saw the unit are not captured — the firmware has no slot-samples read.'
      });
    }
    const bytesMatch = path.match(/^\/cab\/library\/([^/]+)\/bytes$/);
    if (bytesMatch && m === 'GET') {
      const e = mock.library.find((x) => x.id === bytesMatch[1]);
      return e ? route.fulfill({ status: 200, contentType: 'application/octet-stream', body: Buffer.from(e.bytes) }) : json(route, { error: 'nf' }, 404);
    }
    if (path === '/cab/ir/upload' && m === 'POST') {
      const user = Number(url.searchParams.get('user'));
      mock.uploads.push({ user, bytes: req.postDataBuffer() ?? Buffer.alloc(0) });
      mock.order.push(`upload:${user}`);
      const discarded = mock.discard;
      if (!discarded) mock.populated.add(user);
      return json(route, {
        ok: !discarded, discarded, closeCode: discarded ? 0x13 : 0, reason: '', name: 'x', modelId: 0x11, frames: 10, bytes: 10345, sampleSlots: 2040, renamed: false,
        dest: { page: 0x10, index: (user - 1) % 128 },
        acks: { start: true, data: 8, expectedData: 8, end: true, complete: true, codes: [] }
      });
    }
    if (path === '/cab/slots/clear' && m === 'POST') {
      const user = Number(url.searchParams.get('user'));
      mock.clears.push(user);
      mock.order.push(`clear:${user}`);
      mock.populated.delete(user);
      return json(route, { ok: true, index: (user - 1) % 128, page: 0x10, wasPopulated: true, nowPopulated: false, closeCode: 0, reason: 'cleared: the slot reads EMPTY after the blank container' });
    }
    return route.fallback();
  });
  return mock;
}

async function openManager(page: Page) {
  await bootCleanWorkbench(page);
  await clickNav(page, 'cabManager');
  await expect(page.getByTestId('cab-manager')).toBeVisible();
}

const cell = (page: Page, n: number) => page.locator(`[data-testid="cab-grid"] [data-slot="${n}"]`);

function wavBuffer(samples: number[], rate = 48000): Buffer {
  const data = Buffer.alloc(samples.length * 4);
  samples.forEach((v, i) => data.writeFloatLE(v, i * 4));
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + data.length, 4); h.write('WAVEfmt ', 8); h.writeUInt32LE(16, 16);
  h.writeUInt16LE(3, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(rate, 24); h.writeUInt32LE(rate * 4, 28); h.writeUInt16LE(4, 32); h.writeUInt16LE(32, 34);
  h.write('data', 36); h.writeUInt32LE(data.length, 40);
  return Buffer.concat([h, data]);
}

test.describe('Manage Cabs (V1)', () => {
  test('the rail entry opens the registered panel; the grid is unscanned until read, then shows populated/empty only, with the cap disclosed', async ({ page }) => {
    await installCabMock(page, { populated: [1, 2, 40] });
    await bootCleanWorkbench(page);
    await expect(page.locator('[data-nav-entry="cabManager"] button.axis-nav-entry')).toHaveAttribute('aria-label', 'Manage Cabs');
    await clickNav(page, 'cabManager');
    await expect(page.locator('.aw-tabstack[data-region="main"] .aw-pane-tab').filter({ hasText: 'Manage Cabs' })).toHaveCount(1);

    await expect(page.getByTestId('cab-disclosure')).toContainText('one bank (128 slots) per request');
    await expect(page.getByTestId('cab-coverage')).toContainText('not scanned yet — 128 slots unscanned');
    await expect(page.locator('[data-testid="cab-grid"] [data-status="unscanned"]')).toHaveCount(128);

    await page.getByRole('button', { name: /^Scan Bank 1/ }).click();
    await expect(page.getByTestId('cab-coverage')).toContainText('3 populated · 125 empty — all 128 slots read');
    await expect(cell(page, 1)).toHaveAttribute('data-status', 'populated');
    await expect(cell(page, 3)).toHaveAttribute('data-status', 'empty');
    // the drift-prone name field is NEVER rendered, even though the mock sends one
    await expect(page.getByTestId('cab-manager')).not.toContainText('SHOULD NEVER RENDER');

    // the other banks stay unscanned and say so
    await page.getByRole('button', { name: /^Bank 2/ }).click();
    await expect(page.getByTestId('cab-coverage')).toContainText('not scanned yet');
    await expect(page.getByTestId('cab-library-scope')).toContainText('IRs uploaded through Axis');
  });

  test('multi-select (click + shift-range) then clear: previewed, needs a confirm, sends one clear per slot and the grid re-reads empty', async ({ page }) => {
    const mock = await installCabMock(page, { populated: [1, 2, 3, 9] });
    await openManager(page);
    await page.getByRole('button', { name: /^Scan Bank 1/ }).click();
    await expect(cell(page, 1)).toHaveAttribute('data-status', 'populated');

    await cell(page, 1).click();
    await cell(page, 3).click({ modifiers: ['Shift'] });
    await expect(page.getByTestId('cab-selection-count')).toHaveText('3 selected');
    await page.getByRole('button', { name: 'Clear…' }).click();
    const panel = page.getByTestId('cab-panel-clear');
    await expect(panel).toContainText('3 slot(s) will lose their IR: 1, 2, 3');
    const go = panel.getByRole('button', { name: 'Clear', exact: true });
    await expect(go).toBeDisabled();
    await panel.getByRole('checkbox').check();
    await go.click();
    await expect(page.getByTestId('cab-log')).toContainText('Slot 3: cleared');
    expect(mock.clears).toEqual([1, 2, 3]);
    await expect(cell(page, 1)).toHaveAttribute('data-status', 'empty');
    await expect(cell(page, 9)).toHaveAttribute('data-status', 'populated'); // untouched neighbour
  });

  test('rename is a disabled control WITH its reason for an IR Axis does not hold, and works for one it does', async ({ page }) => {
    const mock = await installCabMock(page, { populated: [5, 6], held: [{ user: 5, name: 'Held Five' }] });
    await openManager(page);
    await page.getByRole('button', { name: /^Scan Bank 1/ }).click();
    await expect(cell(page, 5)).toHaveAttribute('data-status', 'populated');

    await cell(page, 6).click(); // populated, NOT in the library
    const rename = page.getByTestId('cab-rename-btn');
    await expect(rename).toBeDisabled();
    await expect(rename).toHaveAttribute('title', /no slot-data read/);
    await expect(page.getByTestId('cab-disabled-reasons')).toContainText('cannot be rewritten');

    await cell(page, 6).click(); // deselect
    await cell(page, 5).click(); // held
    await expect(rename).toBeEnabled();
    await rename.click();
    const panel = page.getByTestId('cab-panel-rename');
    await expect(page.getByTestId('cab-rename-input')).toHaveValue('Held Five');
    await page.getByTestId('cab-rename-input').fill('Renamed Five');
    await panel.getByRole('checkbox').check();
    await panel.getByRole('button', { name: 'Rename', exact: true }).click();
    await expect(page.getByTestId('cab-log')).toContainText('Stored');
    expect(mock.uploads).toHaveLength(1);
    expect(mock.uploads[0]!.user).toBe(5);
    const sent = new Uint8Array(mock.uploads[0]!.bytes);
    expect(parseCabIrSyx(sent).name).toBe('Renamed Five');
    // the codec recomputed the close for the new name — what the unit's content check demands
    expect(parseCabIrSyx(sent).endPayload).toEqual(computeCabIrClosePayload(sent));
  });

  test('move: a held source is copied THEN erased; an unheld source is named with its reason and the import fallback', async ({ page }) => {
    const mock = await installCabMock(page, { populated: [1, 2], held: [{ user: 1, name: 'One' }] });
    await openManager(page);
    await page.getByRole('button', { name: /^Scan Bank 1/ }).click();
    await cell(page, 1).click();
    await cell(page, 2).click();
    await page.getByRole('button', { name: 'Move…' }).click();
    const panel = page.getByTestId('cab-panel-move');
    await page.getByTestId('cab-move-dest').fill('20');
    const plan = page.getByTestId('cab-move-plan');
    await expect(plan.locator('[data-from="1"]')).toContainText('from the Axis library');
    await expect(plan.locator('[data-from="2"]')).toContainText('not in the IR library — it was not uploaded through Axis');
    await expect(plan.locator('[data-from="2"]')).toContainText('Import a file to slot 21');
    await panel.getByRole('checkbox').check();
    await panel.getByRole('button', { name: /^Move 1 of 2/ }).click();
    await expect(page.getByTestId('cab-log')).toContainText('Source 1 erased');
    expect(mock.order).toEqual(['upload:20', 'clear:1']);
    await expect(cell(page, 20)).toHaveAttribute('data-status', 'populated');
    await expect(cell(page, 1)).toHaveAttribute('data-status', 'empty');
    await expect(cell(page, 2)).toHaveAttribute('data-status', 'populated'); // never touched
  });

  test('a DISCARDED copy is reported as discarded and the source is NOT erased', async ({ page }) => {
    const mock = await installCabMock(page, { populated: [1], held: [{ user: 1, name: 'One' }] });
    mock.discard = true;
    await openManager(page);
    await page.getByRole('button', { name: /^Scan Bank 1/ }).click();
    await cell(page, 1).click();
    await page.getByRole('button', { name: 'Move…' }).click();
    await page.getByTestId('cab-move-dest').fill('30');
    const panel = page.getByTestId('cab-panel-move');
    await panel.getByRole('checkbox').check();
    await panel.getByRole('button', { name: /^Move 1/ }).click();
    await expect(page.getByTestId('cab-log')).toContainText('DISCARDED by the unit');
    await expect(page.getByTestId('cab-log')).toContainText('was NOT erased');
    expect(mock.clears).toEqual([]);
    await expect(cell(page, 1)).toHaveAttribute('data-status', 'populated');
  });

  test('import a .wav with MPT + auto-trim: the NOT-PROVEN warning is shown and gated, the container is a valid 2040-slot IR, and the result is the unit\'s verdict', async ({ page }) => {
    const mock = await installCabMock(page, { populated: [] });
    await openManager(page);
    await page.getByRole('button', { name: /^Scan Bank 1/ }).click();
    await page.getByRole('button', { name: 'Import…' }).click();
    const panel = page.getByTestId('cab-panel-import');

    // the choice FM3-Edit offers is visible; unavailable formats are disabled WITH a reason
    await expect(page.getByTestId('cab-import-format').locator('option[value="ultrares"]')).toHaveAttribute('disabled', '');
    await expect(page.getByTestId('cab-format-reasons')).toContainText('No UltraRes container exists');
    await expect(page.getByTestId('cab-format-reasons')).toContainText('Legacy geometry');

    await page.getByTestId('cab-import-file').setInputFiles({ name: 'My Cab 57.wav', mimeType: 'audio/wav', buffer: wavBuffer([0, 0, 0, 0.5, 0.25, -0.1, 0, 0]) });
    await panel.getByLabel('Minimum-phase transform (MPT)').check();
    await panel.getByLabel('Auto-trim (strip leading silence + normalise)').check();
    await page.getByTestId('cab-import-dest').fill('7');
    await expect(page.getByTestId('cab-unvalidated')).toContainText('CONSTRAINED');
    await expect(page.getByTestId('cab-import-steps')).toContainText('minimum-phase transform');
    await expect(page.getByTestId('cab-import-steps')).toContainText('auto-trim');
    await expect(page.getByTestId('cab-import-staged')).toContainText('“My Cab 57”');

    // gated: confirm alone is not enough — the unvalidated acknowledgement is required too
    const go = page.getByTestId('cab-import-go');
    await panel.getByLabel('Write to user slot 7').check();
    await expect(go).toBeDisabled();
    await page.getByTestId('cab-ack-unvalidated').check();
    await expect(go).toBeEnabled();
    await go.click();
    await expect(page.getByTestId('cab-log')).toContainText('Stored — close 0x00, and slot 7 reads POPULATED');
    await expect(page.getByTestId('cab-log')).toContainText('CONVERTED — its samples are unvalidated');
    expect(mock.uploads).toHaveLength(1);
    const sent = new Uint8Array(mock.uploads[0]!.bytes);
    const ir = parseCabIrSyx(sent);
    expect(ir.sampleSlots).toBe(2040);
    expect(ir.name).toBe('My Cab 57');
    expect(cabIrContentXor(sent)).toBeGreaterThan(0);
    expect(ir.endPayload).toEqual(computeCabIrClosePayload(sent));
    await expect(cell(page, 7)).toHaveAttribute('data-status', 'populated');
  });

  test('a .ir that is not a WAV is refused with the documented reason (no guessed format)', async ({ page }) => {
    await installCabMock(page, { populated: [] });
    await openManager(page);
    await page.getByRole('button', { name: 'Import…' }).click();
    await page.getByTestId('cab-import-file').setInputFiles({ name: 'cab.ir', mimeType: 'application/octet-stream', buffer: Buffer.from([1, 2, 3, 4, 5]) });
    await expect(page.getByTestId('cab-import-error')).toContainText('not documented anywhere in this stack');
    await expect(page.getByTestId('cab-import-go')).toBeDisabled();
  });

  test('restore needs its OWN confirm (#9): without it nothing uploads; with it the entry goes to the chosen slot', async ({ page }) => {
    const mock = await installCabMock(page, { populated: [], held: [{ user: 4, name: 'Library Four' }] });
    await openManager(page);
    const lib = page.getByTestId('cab-library');
    await expect(lib).toContainText('IRs uploaded through Axis');
    await expect(page.getByTestId('cab-library-count')).toContainText('1 of 1 stored IR');
    await expect(page.getByTestId('cab-library-count')).toContainText('library cap 200');
    await lib.getByLabel('Restore Library Four to slot').fill('50');
    // #9: the destructive write is gated by a per-entry confirm
    const restore = lib.getByRole('button', { name: 'Restore to slot' });
    await expect(restore).toBeDisabled();
    await lib.getByRole('checkbox').check(); // the per-entry confirm
    await expect(restore).toBeEnabled();
    await restore.click();
    await expect(page.getByTestId('cab-log')).toContainText('Restore “Library Four” → slot 50: Stored');
    expect(mock.uploads.map((u) => u.user)).toEqual([50]);
    expect(parseCabIrSyx(new Uint8Array(mock.uploads[0]!.bytes)).name).toBe('Library Four');
  });

  test('restore does not write until its confirm box is ticked (#9)', async ({ page }) => {
    const mock = await installCabMock(page, { populated: [], held: [{ user: 4, name: 'Library Four' }] });
    await openManager(page);
    const lib = page.getByTestId('cab-library');
    await lib.getByLabel('Restore Library Four to slot').fill('60');
    await lib.getByRole('button', { name: 'Restore to slot' }).click({ force: true }); // disabled — no-op
    expect(mock.uploads).toEqual([]);
    await expect(page.getByTestId('cab-log')).toHaveCount(0);
  });

  test('move REFUSES (nothing written, source intact) when the source was refilled OUTSIDE Axis (#1)', async ({ page }) => {
    const mock = await installCabMock(page, { populated: [1], held: [{ user: 1, name: 'One' }], refilled: { 1: 'REFILLED ELSEWHERE' } });
    await openManager(page);
    await page.getByRole('button', { name: /^Scan Bank 1/ }).click();
    await cell(page, 1).click();
    await page.getByRole('button', { name: 'Move…' }).click();
    await page.getByTestId('cab-move-dest').fill('20');
    const panel = page.getByTestId('cab-panel-move');
    await panel.getByRole('checkbox').check();
    await panel.getByRole('button', { name: /^Move 1/ }).click();
    await expect(page.getByTestId('cab-log')).toContainText('REFUSED');
    await expect(page.getByTestId('cab-log')).toContainText('REFILLED ELSEWHERE');
    expect(mock.uploads).toEqual([]);
    expect(mock.clears).toEqual([]);
    await expect(cell(page, 1)).toHaveAttribute('data-status', 'populated'); // source untouched
  });

  test('import WARNS (does not silently proceed) when the destination bank was never scanned (#10)', async ({ page }) => {
    await installCabMock(page, { populated: [] });
    await openManager(page);
    await page.getByRole('button', { name: 'Import…' }).click();
    // slot 500 is in bank 4, which was never scanned → UNKNOWN, not "not populated"
    await page.getByTestId('cab-import-dest').fill('500');
    await expect(page.getByTestId('cab-import-dest-warn')).toContainText('has not been scanned — it may hold an IR');
  });
});
