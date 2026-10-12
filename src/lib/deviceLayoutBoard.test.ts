import { describe, it, expect } from 'vitest';
import { buildDeviceLayoutBoard, layoutVariantSig, packRows, overflowsColumns, pageForViewMode, type BoardCtl, type SurfaceWidget, type SurfaceBoard } from './deviceLayoutBoard';
import type { DeviceLayout, LayoutControl, LayoutWidget } from './types';

// ── catalog builders (mirror ControlSurface's live catalog entries) ──
const knob = (id: number): BoardCtl => ({ key: `k${id}`, kind: 'cont', id, w: 1, h: 1, view: 'knob', views: ['knob', 'fader', 'slider', 'number'] });
const select = (id: number): BoardCtl => ({ key: `e${id}`, kind: 'select', id, w: 2, h: 1, view: 'select', views: ['select'] });
const toggle = (id: number): BoardCtl => ({ key: `e${id}`, kind: 'toggle', id, w: 1, h: 1, view: 'button', views: ['button', 'switch'] });
const EQ: BoardCtl = { key: 'eq', kind: 'eq', id: -1, w: 4, h: 2, view: 'eq', views: ['eq'] };
const BYPASS: BoardCtl = { key: 'bypass', kind: 'action', id: -2, w: 2, h: 1, view: 'action', views: ['action'] };
const METER: BoardCtl = { key: 'meter', kind: 'meter', id: -3, w: 1, h: 2, view: 'meter', views: ['meter'] };

const ctl = (widget: LayoutWidget, paramId: number | null, label = '', extra: Partial<LayoutControl> = {}): LayoutControl => ({
  label,
  paramName: label || null,
  paramId,
  widget,
  ...extra
});

const layout = (pages: DeviceLayout['pages'], extra: Partial<DeviceLayout> = {}): DeviceLayout => ({
  family: 'INPUT',
  pages,
  ...extra
});

const find = (ws: SurfaceWidget[], key: string): SurfaceWidget => ws.find((w) => w.key === key)!;

describe('buildDeviceLayoutBoard — rows + widget mapping', () => {
  const catalog: BoardCtl[] = [knob(0), knob(1), select(4), toggle(9), knob(5), METER, BYPASS];
  const lay = layout([
    {
      name: 'Gate',
      rows: [
        { controls: [ctl('knob', 0, 'Threshold'), ctl('knob', 1, 'Ratio'), ctl('spacer', null), ctl('meter', 8, 'Gain', { rawWidget: 'meterGainVert' })] },
        { controls: [ctl('dropdown', 4, 'Impedance'), ctl('toggle', 9, 'Mode'), ctl('slider', 5, 'Level')] },
        { controls: [ctl('button', 6, 'Bypass', { rawWidget: 'btnBypass' })] }
      ]
    }
  ]);

  it('renders the page as a tab and lays controls left→right, rows top→bottom', () => {
    const board = buildDeviceLayoutBoard(lay, catalog, 12)!;
    expect(board).toBeTruthy();
    expect(board.pageOrder[0]).toBe('Gate');
    const ws = board.boards['Gate'];

    // row 0: knob0 @ x0, knob1 @ x1
    expect(find(ws, 'k0')).toMatchObject({ x: 0, y: 0, row: 0 });
    expect(find(ws, 'k1')).toMatchObject({ x: 1, y: 0, row: 0 });
    // spacer advances the cursor: the meter lands at x3 (not x2)
    expect(find(ws, 'meter')).toMatchObject({ x: 3, y: 0, row: 0 });

    // row 1 sits BELOW the tallest widget of row 0 (the meter is h2 → next row at y2)
    expect(find(ws, 'e4').y).toBe(2);
    expect(find(ws, 'e4')).toMatchObject({ x: 0, row: 1 });
    expect(find(ws, 'e9')).toMatchObject({ x: 2, row: 1 }); // after the w2 select
    expect(find(ws, 'k5')).toMatchObject({ x: 3, row: 1 });

    // row 2 below row 1
    expect(find(ws, 'bypass').y).toBe(3);
    expect(find(ws, 'bypass').row).toBe(2);
  });

  it('maps widget kinds to the right catalog view', () => {
    const ws = buildDeviceLayoutBoard(lay, catalog, 12)!.boards['Gate'];
    expect(find(ws, 'k0').view).toBe('knob'); // knob → knob
    expect(find(ws, 'k5').view).toBe('slider'); // slider → slider view
    expect(find(ws, 'e4').view).toBe('select'); // dropdown (enum) → select
    expect(find(ws, 'e9').view).toBe('switch'); // toggle (2-option enum) → switch
    expect(find(ws, 'meter').view).toBe('meter'); // meter (no live param) → meter catalog entry
    expect(find(ws, 'bypass').view).toBe('action'); // button + btnBypass → bypass action entry
  });

  it('unknown/unmapped widgets fall back to the catalog default (no FM3 regression)', () => {
    const board = buildDeviceLayoutBoard(
      layout([{ name: 'P', rows: [{ controls: [ctl('unknown', 0, 'Threshold')] }] }]),
      [knob(0)],
      12
    )!;
    expect(find(board.boards['P'], 'k0').view).toBe('knob');
  });

  it('meter/bypass are dropped when the block has no such catalog entry (leaves a gap, no crash)', () => {
    const board = buildDeviceLayoutBoard(
      layout([{ name: 'P', rows: [{ controls: [ctl('meter', 8, 'Gain'), ctl('knob', 0, 'Threshold')] }] }]),
      [knob(0)], // no METER entry
      12
    )!;
    // meter had no entry → gap → knob shifts one slot right
    expect(find(board.boards['P'], 'k0')).toMatchObject({ x: 1, y: 0 });
    expect(board.boards['P'].some((w) => w.key === 'meter')).toBe(false);
  });

  it('wraps a control that overflows the remaining columns onto a new grid line', () => {
    const board = buildDeviceLayoutBoard(
      layout([{ name: 'P', rows: [{ controls: [knob(0), knob(1), knob(2)].map((k) => ctl('knob', k.id, `k${k.id}`)) }] }]),
      [knob(0), knob(1), knob(2)],
      2 // only 2 cols → third knob wraps
    )!;
    const ws = board.boards['P'];
    expect(find(ws, 'k0')).toMatchObject({ x: 0, y: 0 });
    expect(find(ws, 'k1')).toMatchObject({ x: 1, y: 0 });
    expect(find(ws, 'k2')).toMatchObject({ x: 0, y: 1 }); // wrapped, still row 0
    expect(find(ws, 'k2').row).toBe(0);
  });

  it('de-duplicates a param listed twice on one page but keeps the slot', () => {
    const board = buildDeviceLayoutBoard(
      layout([{ name: 'P', rows: [{ controls: [ctl('knob', 0, 'A'), ctl('knob', 0, 'A again'), ctl('knob', 1, 'B')] }] }]),
      [knob(0), knob(1)],
      12
    )!;
    const ws = board.boards['P'];
    expect(ws.filter((w) => w.key === 'k0')).toHaveLength(1);
    expect(find(ws, 'k1').x).toBe(2); // dup advanced the cursor
  });
});

describe('buildDeviceLayoutBoard — pages, sweep, variant', () => {
  it('suffixes duplicate page names so the {#each} keys stay unique', () => {
    const board = buildDeviceLayoutBoard(
      layout([
        { name: 'Gate', rows: [{ controls: [ctl('knob', 0, 'A')] }] },
        { name: 'Gate', rows: [{ controls: [ctl('knob', 1, 'B')] }] }
      ]),
      [knob(0), knob(1)],
      12
    )!;
    expect(board.pageOrder).toEqual(['Gate', 'Gate 2']);
  });

  it('sweeps catalog controls the layout never referenced onto a trailing "More" page', () => {
    const board = buildDeviceLayoutBoard(
      layout([{ name: 'Gate', rows: [{ controls: [ctl('knob', 0, 'A')] }] }]),
      [knob(0), knob(99)], // k99 unreferenced
      12
    )!;
    expect(board.pageOrder).toEqual(['Gate', 'More']);
    expect(board.boards['More'].map((w) => w.key)).toEqual(['k99']);
  });

  it('returns null when no page has a renderable control (caller uses its heuristic board)', () => {
    expect(buildDeviceLayoutBoard(layout([{ name: 'P', rows: [{ controls: [ctl('spacer', null)] }] }]), [knob(0)], 12)).toBeNull();
    expect(buildDeviceLayoutBoard(null, [knob(0)], 12)).toBeNull();
    expect(buildDeviceLayoutBoard(layout([]), [knob(0)], 12)).toBeNull();
  });

  it('stamps a variantSig that changes with the served variant (drives Default re-seed)', () => {
    const pages = [{ name: 'P', rows: [{ controls: [ctl('knob', 0, 'A')] }] }] as DeviceLayout['pages'];
    const a = buildDeviceLayoutBoard(layout(pages, { variantName: 'Type', variantValue: 'A' }), [knob(0)], 12)!;
    const b = buildDeviceLayoutBoard(layout(pages, { variantName: 'Type', variantValue: 'B' }), [knob(0)], 12)!;
    expect(a.variantSig).not.toBe(b.variantSig);
    expect(a.variantSig).toBe(layoutVariantSig(layout(pages, { variantName: 'Type', variantValue: 'A' })));
    expect(layoutVariantSig(null)).toBe('');
  });
});

describe('packRows — row-preserving responsive reflow', () => {
  it('re-lays each source row on its own grid line, wrapping within the row', () => {
    // three widgets on row 0, one on row 1; narrow to 2 cols
    const widgets = [
      { id: 'a', key: 'k0', x: 0, y: 0, w: 1, h: 1, view: 'knob', row: 0 },
      { id: 'b', key: 'k1', x: 1, y: 0, w: 1, h: 1, view: 'knob', row: 0 },
      { id: 'c', key: 'k2', x: 2, y: 0, w: 1, h: 1, view: 'knob', row: 0 },
      { id: 'd', key: 'k3', x: 0, y: 1, w: 1, h: 1, view: 'knob', row: 1 }
    ];
    const out = packRows(widgets, 2);
    const at = (id: string) => out.find((w) => w.id === id)!;
    expect(at('a')).toMatchObject({ x: 0, y: 0 });
    expect(at('b')).toMatchObject({ x: 1, y: 0 });
    expect(at('c')).toMatchObject({ x: 0, y: 1 }); // wrapped within row 0 onto a new line
    expect(at('d').y).toBe(2); // row 1 starts strictly below everything from row 0
  });
});

// The re-pack trigger. The board's CSS grid template has exactly `displayCols` tracks, and a widget
// placed past them lands in an IMPLICIT track — which CSS gives zero width, so the trailing tiles render
// on top of each other (the "dials bunched up in one spot" report on a Steam Deck). The old trigger was
// only `displayCols < cols`, which misses the case where the arrangement simply does not fit the shown
// columns; this predicate is what catches it.
describe('overflowsColumns — the responsive re-pack trigger', () => {
  const w = (x: number, width = 1) => ({ x, w: width });

  it('is false when every widget fits the shown columns', () => {
    expect(overflowsColumns([w(0), w(1), w(2)], 3)).toBe(false);
    expect(overflowsColumns([], 8)).toBe(false);
  });

  it('is true when a widget ends past the last shown column', () => {
    // 12 controls in a 12-column arrangement shown in 8 columns: columns 8..11 do not exist.
    const wide = Array.from({ length: 12 }, (_, i) => w(i));
    expect(overflowsColumns(wide, 8)).toBe(true);
    expect(overflowsColumns(wide, 12)).toBe(false);
  });

  it('accounts for a widget spanning more than one column', () => {
    expect(overflowsColumns([w(6, 2)], 8)).toBe(false); // occupies 6..7
    expect(overflowsColumns([w(7, 2)], 8)).toBe(true); // occupies 7..8 → column 8 does not exist
  });

  it('agrees with packRows: the re-packed output never overflows the target columns', () => {
    const wide = Array.from({ length: 12 }, (_, i) => ({ id: `w${i}`, key: `k${i}`, x: i, y: 0, w: 1, h: 1, view: 'knob', row: 0 }));
    expect(overflowsColumns(wide, 8)).toBe(true);
    expect(overflowsColumns(packRows(wide, 8), 8)).toBe(false);
  });
});

// The Cab block's DynaCab page (FM3 fw > 6.03) carries the device's own `dynaCabControl` — a
// graphical mic-position widget bound to the cab's Position parameter, NOT a dial. FM3-Edit draws it
// as a speaker cone with the mic placed by Position (CAP at centre → EDGE at the rim); the builder
// must map it to the `dynacab` view (and give it room) instead of falling back to a knob.
describe('buildDeviceLayoutBoard — DynaCab mic graph', () => {
  const knobDyn = (id: number): BoardCtl => ({ key: `k${id}`, kind: 'cont', id, w: 1, h: 1, view: 'knob', views: ['knob', 'fader', 'slider', 'number', 'dynacab'] });
  const dyna = (id = 93, cols = 12) =>
    buildDeviceLayoutBoard(
      layout([{ name: 'Cab', rows: [{ controls: [ctl('unknown', id, 'DynaCab', { rawWidget: 'dynaCabControl' })] }] }]),
      [knobDyn(id)],
      cols
    )!;

  it('maps the device dynaCabControl to the mic-graph view, not a knob', () => {
    expect(find(dyna().boards['Cab'], 'k93').view).toBe('dynacab');
  });

  it('gives the graph a 2x2 tile so the cone is readable', () => {
    expect(find(dyna().boards['Cab'], 'k93')).toMatchObject({ w: 2, h: 2 });
  });

  it('clamps the graph footprint to a narrow board', () => {
    expect(find(dyna(93, 1).boards['Cab'], 'k93').w).toBe(1);
  });

  it('a plain unknown widget still falls back to its catalog view (no regression)', () => {
    const board = buildDeviceLayoutBoard(
      layout([{ name: 'P', rows: [{ controls: [ctl('unknown', 93, 'Position')] }] }]),
      [knobDyn(93)],
      12
    )!;
    expect(find(board.boards['P'], 'k93').view).toBe('knob');
  });
});

// The mic graph drives TWO params in one tile (FM3-Edit places both in that one control): Position —
// the control's own paramId, laid out vertically CAP (top) → EDGE (bottom) — and the SAME cab slot's
// Distance, laid out horizontally as the mic's standoff. The device layout carries the pair as sibling
// controls (`CABINET_DYNACAB_R<n>` for the graph, `CABINET_DYNACAB_Z<n>` for the Distance knob), so the
// builder resolves the sibling by name and binds it as the widget's `key2`.
describe('buildDeviceLayoutBoard — DynaCab graph binds the cab Distance param', () => {
  const knobDyn = (id: number): BoardCtl => ({ key: `k${id}`, kind: 'cont', id, w: 1, h: 1, view: 'knob', views: ['knob', 'fader', 'slider', 'number', 'dynacab'] });
  const cab = (graphPid: number, graphName: string, dist: { pid: number; name: string } | null) =>
    buildDeviceLayoutBoard(
      layout([
        {
          name: 'Cab',
          rows: [
            {
              controls: [
                ctl('unknown', graphPid, 'DynaCab', { rawWidget: 'dynaCabControl', paramName: graphName }),
                ...(dist ? [ctl('knob', dist.pid, 'Distance', { paramName: dist.name })] : []),
              ],
            },
          ],
        },
      ]),
      [knobDyn(graphPid), ...(dist ? [knobDyn(dist.pid)] : [])],
      12
    )!;

  it('binds cab slot 1\u2019s Distance (_Z1) to the graph bound to _R1', () => {
    const b = cab(93, 'CABINET_DYNACAB_R1', { pid: 97, name: 'CABINET_DYNACAB_Z1' });
    expect(find(b.boards['Cab'], 'k93')).toMatchObject({ view: 'dynacab', key2: 'k97' });
  });

  it('binds cab slot 2 to ITS OWN Distance, not slot 1\u2019s', () => {
    const b = cab(94, 'CABINET_DYNACAB_R2', { pid: 98, name: 'CABINET_DYNACAB_Z2' });
    expect(find(b.boards['Cab'], 'k94').key2).toBe('k98');
  });

  it('leaves key2 unset when the layout has no sibling Distance control', () => {
    const b = cab(93, 'CABINET_DYNACAB_R1', null);
    expect(find(b.boards['Cab'], 'k93').key2).toBeUndefined();
    expect(find(b.boards['Cab'], 'k93').view).toBe('dynacab');
  });

  it('leaves key2 unset when the Distance param is not in the live catalog', () => {
    const board = buildDeviceLayoutBoard(
      layout([
        {
          name: 'Cab',
          rows: [
            {
              controls: [
                ctl('unknown', 93, 'DynaCab', { rawWidget: 'dynaCabControl', paramName: 'CABINET_DYNACAB_R1' }),
                ctl('knob', 97, 'Distance', { paramName: 'CABINET_DYNACAB_Z1' }),
              ],
            },
          ],
        },
      ]),
      [knobDyn(93)], // slot 1's Distance (k97) is absent
      12
    )!;
    expect(find(board.boards['Cab'], 'k93').key2).toBeUndefined();
  });
});

// The FM3 cab page's per-cab M / S buttons carry pseudo paramIds (65286…65289) that the device never
// serves; the state they drive is the `MUTE<n>` enum the block DOES serve (`-- / MUTE / SOLO`). Without
// a re-resolve by name the buttons vanish and the Cab page offers no way to mute/solo a cab.
describe('buildDeviceLayoutBoard — pseudo-param buttons (cab M/S)', () => {
  const muteEnum = (id: number, label: string): BoardCtl => ({ key: `e${id}`, kind: 'select', id, w: 2, h: 1, view: 'select', views: ['select'], label });
  const cabBtns = (catalog: BoardCtl[]): SurfaceBoard | null =>
    buildDeviceLayoutBoard(
      layout([
        {
          name: 'Cab',
          rows: [
            {
              controls: [
                ctl('button', 65286, 'M', { rawWidget: 'btnSquare', paramName: 'CABINET_BTN_MUTE1' }),
                ctl('button', 65288, 'S', { rawWidget: 'btnSquare', paramName: 'CABINET_BTN_SOLO1' }),
              ],
            },
          ],
        },
      ]),
      catalog,
      12
    );

  it('binds the cab M button (pseudo-id 65286) to the served MUTE1 param', () => {
    const b = cabBtns([muteEnum(24, 'MUTE1')]);
    expect(find(b!.boards['Cab'], 'e24')).toMatchObject({ view: 'select' });
  });

  it('collapses the M/S pair onto the single state param they both drive', () => {
    const b = cabBtns([muteEnum(24, 'MUTE1')]);
    expect(b!.boards['Cab']).toHaveLength(1); // the S button has no param of its own
  });

  it('gaps a pseudo-param the block does not serve', () => {
    expect(cabBtns([muteEnum(24, 'SOMETHING_ELSE')])).toBeNull(); // nothing renderable
  });

  // The PRIMARY path now: a current ForgeFX gen-3 server rewrites the pseudo control to the real served
  // param id while serving the layout (resolvePseudoParamControls), so the board resolves it by paramId
  // alone — no served-name map, no name matching. The tests above cover the older-server FALLBACK.
  it('resolves a SERVER-rewritten control (real paramId, empty name map) via the primary paramId path', () => {
    const b = buildDeviceLayoutBoard(
      layout([
        {
          name: 'Cab',
          rows: [{ controls: [ctl('button', 24, 'M', { rawWidget: 'btnSquare', paramName: 'CABINET_MUTE1' })] }],
        },
      ]),
      // no `label` → byName map is empty, so only the primary paramId lookup can bind it
      [{ key: 'e24', kind: 'select', id: 24, w: 2, h: 1, view: 'select', views: ['select'] }],
      12
    );
    expect(find(b!.boards['Cab'], 'e24')).toMatchObject({ view: 'select' });
  });
});

// A persisted Default board is re-seeded when `layoutVariantSig` moves. A count-only signature missed
// the changes that actually matter: the server's pseudo-id rewrite (65286 → the real id) and swapping
// two same-named selector pages both leave the family/variant/count fields identical, yet they change
// which parameter a control binds. The signature now carries the ORDERED (page name, paramId, rawWidget)
// list, so those changes re-seed the board.
describe('layoutVariantSig — the fingerprint follows a BINDING change, not just counts', () => {
  const page = (name: string, controls: LayoutControl[]) => [{ name, rows: [{ controls }] }] as DeviceLayout['pages'];

  it('is versioned so an older persisted board re-seeds once (db6 prefix)', () => {
    expect(layoutVariantSig(layout(page('P', [ctl('knob', 10, 'A')])))).toMatch(/^db6\|/);
  });

  it('changes when a paramId changes while the family/variant/counts stay identical', () => {
    // the server rewriting a pseudo-id to the real served id — same control count, same page
    const a = layoutVariantSig(layout(page('P', [ctl('knob', 65286, 'MUTE')])));
    const b = layoutVariantSig(layout(page('P', [ctl('knob', 24, 'MUTE')])));
    expect(a).not.toBe(b);
  });

  it('changes when a control\'s rawWidget changes', () => {
    const a = layoutVariantSig(layout(page('P', [ctl('knob', 10, 'A', { rawWidget: 'knobMiniReadout' })])));
    const b = layoutVariantSig(layout(page('P', [ctl('knob', 10, 'A', { rawWidget: 'knobCompact' })])));
    expect(a).not.toBe(b);
  });

  it('changes when two same-named pages are swapped', () => {
    const a = layoutVariantSig(layout(page('X', [ctl('knob', 10, 'A')])));
    const b = layoutVariantSig(layout(page('Y', [ctl('knob', 10, 'A')])));
    expect(a).not.toBe(b);
  });
});

// The dedupe rule for a key claimed twice, one claimant being the DynaCab mic graph: the GRAPH wins,
// and every key the dedupe drops is RECORDED. The band reorder already made the graph win on the Cab
// page, but that was incidental; these cases pin the rule as explicit and order-independent.
describe('buildDeviceLayoutBoard — the DynaCab graph wins a shared key (explicit rule)', () => {
  const knobDyn = (id: number): BoardCtl => ({ key: `k${id}`, kind: 'cont', id, w: 1, h: 1, view: 'knob', views: ['knob', 'dynacab'] });
  const graph = () => ctl('unknown', 93, 'DynaCab', { rawWidget: 'dynaCabControl' });
  const positionKnob = () => ctl('knob', 93, 'Position');
  const separator = () => ctl('label', null, 'Seperator', { rawWidget: 'labelSeperator' });

  it('wins even when the Position knob is in an EARLIER band (the silent 1×1-knob case)', () => {
    const board = buildDeviceLayoutBoard(
      layout([{ name: 'Cab', rows: [{ controls: [positionKnob(), separator(), graph()] }] }]),
      [knobDyn(93)],
      12
    )!;
    const ws = board.boards['Cab'];
    expect(find(ws, 'k93').view).toBe('dynacab'); // the graph, not the knob
    expect(ws.filter((w) => w.key === 'k93')).toHaveLength(1);
    expect(board.skipped).toEqual(['k93']); // the dropped knob is recorded, never silent
  });

  it('wins within one band regardless of served order', () => {
    const board = buildDeviceLayoutBoard(
      layout([{ name: 'Cab', rows: [{ controls: [positionKnob(), graph()] }] }]),
      [knobDyn(93)],
      12
    )!;
    expect(find(board.boards['Cab'], 'k93').view).toBe('dynacab');
    expect(board.skipped).toEqual(['k93']);
  });

  it('records a plain duplicate (no graph involved) too', () => {
    const board = buildDeviceLayoutBoard(
      layout([{ name: 'P', rows: [{ controls: [ctl('knob', 0, 'A'), ctl('knob', 0, 'A again')] }] }]),
      [knob(0)],
      12
    )!;
    expect(board.skipped).toEqual(['k0']);
  });
});

// The top bar's Basic/Advanced View toggle drives `editor.globalMode`; this is the contract it documents
// ("blocks open on Ideal / Advanced") re-pointed at the board pages that replaced the old tab strip.
describe('pageForViewMode — Basic/Advanced open-on choice', () => {
  it('basic opens the block on its first page', () => {
    expect(pageForViewMode(['Cab', 'Preamp', 'More'], 'basic')).toBe('Cab');
  });

  it('advanced opens on the full-parameter sweep page', () => {
    expect(pageForViewMode(['Cab', 'Preamp', 'More'], 'advanced')).toBe('More');
  });

  it('advanced falls back to the last page when the block has no sweep page', () => {
    expect(pageForViewMode(['Cab', 'Preamp'], 'advanced')).toBe('Preamp');
  });

  it('the fallback board reads its own Main/Advanced pages', () => {
    expect(pageForViewMode(['Main', 'Advanced'], 'basic')).toBe('Main');
    expect(pageForViewMode(['Main', 'Advanced'], 'advanced')).toBe('Advanced');
  });

  it('an empty page list is safe', () => {
    expect(pageForViewMode([], 'advanced')).toBe('');
  });
});
