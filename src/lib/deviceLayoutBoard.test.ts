import { describe, it, expect } from 'vitest';
import { buildDeviceLayoutBoard, layoutVariantSig, packRows, overflowsColumns, type BoardCtl, type SurfaceWidget } from './deviceLayoutBoard';
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
