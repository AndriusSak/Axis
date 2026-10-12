// Regression guard for the owner's 2026-10-12 Cab-block reports, pinned to a LIVE capture of the Cab
// block (preset 410 `USA Mk IV`, FM3 fw 13.0) taken from a running ForgeFX (`GET /preset/blocks/62/params`
// → `cabBoard.fixture.json`, 37 params + 23 enums + the 4-page editor layout).
//
// The three reports, and what this pins about each:
//   1. "Room Diffusion shows 50% while the unit says 0%" — the SERVED value for that param must stay 0 with
//      norm 0, and the board must bind it to `k59`. The dial renders `value = norm` (its arc is
//      `norm * 117.8`), so a knob reading 50% can only mean the client got norm 0.5 from somewhere that is
//      NOT this payload — i.e. any future change that makes the payload say 0.5 is a real regression.
//   2. "Mic placement in Cab is nowhere to be seen" — the mic-position control is the layout's
//      `dynaCabControl` (paramId 93/94, Axis view `dynacab`), which carries the cab's Distance param as
//      `key2` (97/98). It must be PRESENT on the Cab page, and the Mic model dropdowns (enum 89/90) must
//      bind with their option labels intact — so an invisible control is a RENDERING problem, not a
//      missing binding.
//   3. "switches display numbers instead of names" — not covered here (that is `perPresetSwitchView`,
//      which prints the served `functionName`/`targetLabel`); this file only fixes the Cab payload facts.
//
// A layout control whose parameter the device does not serve must resolve to a GAP, never to a different
// key: a mis-binding is how one knob silently renders another knob's value.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildDeviceLayoutBoard, type BoardCtl } from './deviceLayoutBoard';

interface FixtureParam { id: number; name: string; value: number; norm: number; min: number; max: number }
interface FixtureEnum { id: number; name: string; value: number; options: { value: number; label: string }[] }
interface Fixture {
  named: FixtureParam[];
  enums: FixtureEnum[];
  layout: Parameters<typeof buildDeviceLayoutBoard>[0];
}

const F = JSON.parse(
  readFileSync(fileURLToPath(new URL('./cabBoard.fixture.json', import.meta.url)), 'utf8')
) as Fixture;

/** The catalog ControlSurface derives from a served block payload (same shape, same keys). */
function catalog(): BoardCtl[] {
  const out: BoardCtl[] = [];
  for (const p of F.named) out.push({ key: `k${p.id}`, kind: 'cont', label: p.name, id: p.id, w: 1, h: 1, view: 'knob', views: ['knob'] });
  for (const e of F.enums) {
    const tog = e.options.length <= 2;
    out.push({ key: `e${e.id}`, kind: tog ? 'toggle' : 'select', label: e.name, id: e.id, w: tog ? 1 : 2, h: 1, view: tog ? 'button' : 'select', views: ['select'] });
  }
  return out;
}

const board = () => {
  const b = buildDeviceLayoutBoard(F.layout, catalog(), 12);
  if (!b) throw new Error('the served layout produced no board');
  return b;
};
const widgets = () => Object.values(board().boards).flat();

describe('Cab block board binding (live payload, preset 410)', () => {
  it('every placed widget binds a catalog key that really exists (no mis-binding)', () => {
    const keys = new Set(catalog().map((c) => c.key));
    // `view: 'header'` is the device's own group text (CAB 1 / CAB 2) — it binds no parameter by design.
    const bad = widgets()
      .filter((w) => w.view !== 'header')
      .filter((w) => !keys.has(w.key) || (w.key2 != null && !keys.has(w.key2)));
    expect(bad.map((w) => w.key)).toEqual([]);
  });

  it('Room Diffusion is served as 0 (norm 0), and the board binds it to k59', () => {
    const p = F.named.find((x) => x.id === 59);
    expect(p).toMatchObject({ name: 'Room Diffusion', value: 0, norm: 0, min: 0, max: 100 });
    // The knob renders `value = norm`; 0 → a zero-length arc → the pointer at the MINIMUM, not the middle.
    const w = widgets().find((x) => x.key === 'k59');
    expect(w, 'Room Diffusion must be placed on the board').toBeTruthy();
    expect(w!.view).toBe('knob');
    expect(w!.key2).toBeUndefined();
  });

  it('the mic-position control is a dynacab tile carrying the cab Distance param', () => {
    const tiles = widgets().filter((w) => w.view === 'dynacab');
    // Two cab slots in this preset → one tile each, bound to the mic-position param + its Distance.
    expect(tiles.map((t) => [t.key, t.key2])).toEqual([
      ['k93', 'k97'],
      ['k94', 'k98'],
    ]);
  });

  it('the Mic model dropdowns bind with their option labels (names, not indices)', () => {
    const mic = F.enums.find((e) => e.id === 89);
    expect(mic?.options.map((o) => o.label)).toEqual(['Condenser', 'Ribbon', 'Dynamic 1', 'Dynamic 2']);
    // and the served value selects one of them rather than being absent
    expect(mic!.value).toBeGreaterThanOrEqual(0);
    const keys = new Set(widgets().map((w) => w.key));
    expect(keys.has('e89')).toBe(true);
    expect(keys.has('e90')).toBe(true);
  });

  it('a layout control the device does not serve leaves a gap instead of borrowing a neighbour', () => {
    // CABINET_DYNACAB_TYPE2 (86) / MUTE1 (24) are layout-referenced but not in this block's served set.
    const served = new Set(F.named.map((p) => `k${p.id}`));
    for (const absent of [85, 86]) expect(served.has(`k${absent}`)).toBe(false);
    // The board must not have silently bound them to some other param.
    const keys = new Set(widgets().map((w) => w.key));
    for (const absent of [85, 86]) expect(keys.has(`k${absent}`)).toBe(false);
  });
});
