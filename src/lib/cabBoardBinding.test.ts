// Regression guard for the owner's 2026-10-12 Cab-block reports, pinned to a LIVE capture of the Cab
// block — preset 410 "USA Mk IV" (the preset name lives in `preset.name`), FM3 fw 13.0 — taken from a
// running ForgeFX (`GET /preset/blocks/62/params` → `cabBoard.fixture.json`, 37 params + 23 enums + the
// 4-page editor layout).
//
// CORRECTION (measured 2026-10-13, ForgeFX round): the fixture's `type.name` `1x8 PRINCETONE` is NOT the
// cab model. The server decoded the family's layout-variant selector — for CABINET that is CABINET_MODE
// (pid 31), the Legacy/DynaCab PAGE flag — and indexed the 45-entry cab-model roster with it, so EVERY
// cab read `roster[1] = '1x8 PRINCETONE'` whatever it held (four cab channels whose CABINET_TYPE1 read
// 27/31/38/42 all served that same name, while the unit's own screen showed the model the owner had
// written). ForgeFX now publishes the model of the LIVE page (`CABINET_DYNACAB_TYPE1` on the DynaCab page,
// `CABINET_TYPE1` on the Legacy page); the capture below therefore predates the fix and is kept as the
// RECORD of it, not as a description of what the server serves today. It is deliberately NOT re-captured:
// that needs the unit switched to preset 410, which would discard the un-stored edit buffer holding the
// owner's in-progress preset 415.
//
// TWO KINDS OF ASSERTION, kept apart on purpose:
//   • BINDING tests (the first describe) — they run the REAL builder over the served payload, so a
//     change in how a control binds, in what order keys are placed, or in the dedupe shows up as a
//     failure. The per-page ORDERED key list is the one assertion that catches a binding change.
//   • PROVENANCE tests (the second describe) — they assert constants inside the static fixture. They
//     document what the unit actually served and can catch a corrupting edit to the fixture, but they
//     CANNOT detect a server regression (the fixture does not move when the server does), so they are
//     labelled as provenance rather than treated as live wiring.
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
  type: { value: number; name: string };
  preset: { id: number; name: string };
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
/** The keys placed on each page, in reading order (headers excluded — they bind no parameter). */
const keysByPage = () =>
  Object.fromEntries(
    board().pageOrder.map((p) => [p, board().boards[p]!.filter((w) => w.view !== 'header').map((w) => w.key)])
  );

describe('Cab block board binding (live payload, preset 410 "USA Mk IV")', () => {
  it('every placed widget binds a catalog key that really exists (no mis-binding)', () => {
    const keys = new Set(catalog().map((c) => c.key));
    // `view: 'header'` is the device's own group text (CAB 1 / CAB 2) — it binds no parameter by design.
    const bad = widgets()
      .filter((w) => w.view !== 'header')
      .filter((w) => !keys.has(w.key) || (w.key2 != null && !keys.has(w.key2)));
    expect(bad.map((w) => w.key)).toEqual([]);
  });

  // THE binding-change detector: any change to which key a control binds, or to its placed order,
  // moves this list. It is the assertion a re-binding regression must trip.
  it('places a pinned, ordered list of keys on every page', () => {
    expect(keysByPage()).toEqual({
      Cab: ['k93', 'e85', 'e89', 'e24', 'k12', 'e74', 'e78', 'k8', 'k97', 'k62', 'k66', 'k94', 'e86', 'e90', 'e25', 'k13', 'e75', 'e79', 'k9', 'k98', 'k63', 'k67', 'k28', 'k29', 'e84'],
      Preamp: ['e43', 'e47', 'k33', 'k34', 'k44', 'k45', 'k46', 'k38', 'e82', 'k39', 'e83', 'k28', 'k29', 'e42', 'e30', 'e84'],
      'Room/Air': ['k35', 'k36', 'e56', 'k53', 'k59', 'k57', 'k58', 'k37', 'k54', 'k55', 'k41', 'k28', 'k29', 'e42', 'e30', 'e84'],
      Align: ['e85', 'e89', 'e24', 'k16', 'e86', 'e90', 'e25', 'k17', 'e105', 'k28', 'k29', 'e84'],
      More: ['k4', 'k5', 'k20', 'k21', 'e0', 'e1', 'e70', 'e71']
    });
  });

  it('the mic-position control is a dynacab tile carrying the cab Distance param', () => {
    const tiles = widgets().filter((w) => w.view === 'dynacab');
    // Two cab slots in this preset → one tile each, bound to the mic-position param + its Distance.
    expect(tiles.map((t) => [t.key, t.key2])).toEqual([
      ['k93', 'k97'],
      ['k94', 'k98']
    ]);
  });

  it('the DynaCab graph WINS its key over the Position knob listed beside it (recorded, not silent)', () => {
    // paramId 93/94 is listed TWICE in the served layout — once as the `dynaCabControl` graph and once
    // as the `knobMiniReadout` "Position" knob. The graph must win; the knob must be the one dropped.
    const graphKeys = widgets().filter((w) => w.view === 'dynacab').map((w) => w.key);
    expect(graphKeys.sort()).toEqual(['k93', 'k94']);
    // …and each dropped key is RECORDED in the board's dedupe list, so it is auditable.
    expect(board().skipped).toEqual(['k93', 'k94']);
  });
});

describe('provenance — the fixture is a live capture; these constants are not a server regression test', () => {
  it('Room Diffusion was served as 0 (norm 0) — the "50% while the unit says 0%" report', () => {
    const p = F.named.find((x) => x.id === 59);
    expect(p).toMatchObject({ name: 'Room Diffusion', value: 0, norm: 0, min: 0, max: 100 });
    // The knob renders `value = norm`; 0 → a zero-length arc → the pointer at the MINIMUM, not the middle.
    const w = widgets().find((x) => x.key === 'k59');
    expect(w, 'Room Diffusion must be placed on the board').toBeTruthy();
    expect(w!.view).toBe('knob');
    expect(w!.key2).toBeUndefined();
  });

  it('the Mic model dropdowns carry their option labels (names, not indices)', () => {
    const mic = F.enums.find((e) => e.id === 89);
    expect(mic?.options.map((o) => o.label)).toEqual(['Condenser', 'Ribbon', 'Dynamic 1', 'Dynamic 2']);
  });

  it('the fixture names the preset in `preset`, and records the server\'s old `type` decode verbatim', () => {
    expect(F.preset).toEqual({ id: 410, name: 'USA Mk IV' });
    // NOT a claim that this is the cab model (see the CORRECTION at the top of this file): this is the
    // value the server USED to serve for `type`, i.e. the CABINET_MODE page flag (1 = DynaCab) rendered
    // through the cab-model roster. The assertion pins the capture so a silent edit to the fixture shows
    // up; whether that decode is right is a SERVER question, answered by ForgeFX's
    // drivers/cab-model-vs-page suite against the real driver — not by this file, which cannot move when
    // the server does.
    expect(F.type.name).toBe('1x8 PRINCETONE');
    expect(F.type.value).toBe(1); // the mode, not a model ordinal (a cab model ordinal here would be 0..44)
    expect(F.type.name).not.toBe(F.preset.name);
  });

  it('the board draws the LAYOUT it was given, so the served model name cannot leak into the cab page', () => {
    // The board consumes `layout` + the served params/enums — not `payload.type`. That is why the wrong
    // `type.name` above never showed up on the Cab page itself: its only Axis consumer is the block-tile
    // label (`editor.svelte.ts` typeNameFor ← meters[].typeName, drawn by SignalGrid). Pinned here so a
    // future binding change that starts reading `type` for the board has to face this case.
    expect(widgets().length).toBeGreaterThan(0); // the board bound something — the guard below is not vacuous
    expect(JSON.stringify(widgets())).not.toContain('PRINCETONE');
  });
});

describe('layout-referenced ids 85 / 86 / 24 are ENUMS, bound as e<n>, never as params', () => {
  it('85 (DYNACAB TYPE1) / 86 (DYNACAB TYPE2) / 24 (MUTE1) are served as enums', () => {
    for (const id of [85, 86, 24]) {
      expect(F.enums.some((e) => e.id === id), `enum ${id} must be served`).toBe(true);
    }
    expect(F.enums.find((e) => e.id === 24)?.name).toBe('MUTE1');
  });

  it('they bind as e85/e86/e24 and never as the param spelling k<n>', () => {
    // The layout references them by paramId…
    const referenced = new Set<number>();
    for (const pg of F.layout?.pages ?? []) for (const row of pg.rows ?? []) for (const c of row.controls ?? []) if (c.paramId != null) referenced.add(c.paramId);
    for (const id of [85, 86, 24]) expect(referenced.has(id)).toBe(true);

    // …the board binds them as the ENUM keys…
    const keys = new Set(widgets().map((w) => w.key));
    for (const id of [85, 86, 24]) expect(keys.has(`e${id}`)).toBe(true);

    // …and NOT as continuous params (the old test asserted the k<n> spelling and could never fail —
    // 85/86 are enums, so `k85`/`k86` were never going to be in the served param set).
    const servedParams = new Set(F.named.map((p) => `k${p.id}`));
    for (const id of [85, 86, 24]) {
      expect(servedParams.has(`k${id}`)).toBe(false);
      expect(keys.has(`k${id}`)).toBe(false);
    }
  });
});
