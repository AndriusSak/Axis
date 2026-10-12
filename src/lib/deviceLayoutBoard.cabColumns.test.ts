import { describe, it, expect } from 'vitest';
import { buildDeviceLayoutBoard, type BoardCtl } from './deviceLayoutBoard';
import type { DeviceLayout, LayoutControl } from './types';

// The Cab block's DynaCab mic page is the case that exposed this.
//
// The device's own layout is PIXEL-PLACED: every control carries `placement.positionExact`, and the
// FM3's mic page puts cab 1 and cab 2 in two SIDE-BY-SIDE COLUMNS — cab 1 across x 303..647, a
// `Seperator` at x=733, cab 2 across x 735..1077 (all 31 of those controls in ONE layout row).
//
// `buildDeviceLayoutBoard` re-flowed that single row left→right and wrapped at the shown column count,
// so the wrap landed mid-group and cab 2's controls (including its 2×2 DynaCab tile) rendered in the
// same visual band as cab 1's knobs — reported as "cab 2 shows up in cab 1 area and vice versa".
//
// Fixture numbers are the real ones from forgefx-midi `layouts.generated.ts` (CABINET variant 1, mic
// page), trimmed to the controls that matter for grouping.
const ctl = (
  label: string,
  paramName: string | null,
  paramId: number | null,
  x: number | null,
  raw: string
): LayoutControl =>
  ({
    label,
    paramName,
    paramId,
    widget: raw.startsWith('knob') || raw.startsWith('dropdown') ? 'knob' : raw,
    rawWidget: raw,
    ...(x != null ? { placement: { positionExact: `${x},0` } } : {})
  }) as unknown as LayoutControl;

// cab 1 (x 303..647) then cab 2 (x 735..1077) — the real mic row, in layout order
const micRow: LayoutControl[] = [
  ctl('CAB 1', 'CABINET_LABEL1', 65284, 303, 'labelBold'),
  ctl('', 'CABINET_DYNACAB_TYPE1', 85, 359, 'dropdownCabDyna'),
  ctl('Mic', 'CABINET_LABEL1', 65284, 320, 'labelBold'),
  ctl('', 'CABINET_DYNACAB_MIC1', 89, 359, 'dropdownCabDyna'),
  ctl('M', 'CABINET_BTN_MUTE1', 65286, 517, 'btnSquare'),
  ctl('S', 'CABINET_BTN_SOLO1', 65288, 551, 'btnSquare'),
  ctl('DynaCab', 'CABINET_DYNACAB_R1', 93, 310, 'dynaCabControl'),
  ctl('Pan', 'CABINET_PAN1', 12, 564, 'knobMiniReadout'),
  ctl('Level', 'CABINET_LEVEL1', 8, 315, 'knobMiniReadout'),
  ctl('Position', 'CABINET_DYNACAB_R1', 93, 398, 'knobMiniReadout'),
  ctl('Distance', 'CABINET_DYNACAB_Z1', 97, 481, 'knobMiniReadout'),
  ctl('Low Cut', 'CABINET_LOCUT1', 62, 564, 'knobMiniReadout'),
  ctl('High Cut', 'CABINET_HICUT1', 66, 647, 'knobMiniReadout'),
  ctl('Seperator', null, null, 733, 'labelSeperator'),
  ctl('CAB 2', 'CABINET_LABEL2', 65285, 735, 'labelBold'),
  ctl('', 'CABINET_DYNACAB_TYPE2', 86, 791, 'dropdownCabDyna'),
  ctl('Mic', 'CABINET_LABEL2', 65285, 752, 'labelBold'),
  ctl('', 'CABINET_DYNACAB_MIC2', 90, 791, 'dropdownCabDyna'),
  ctl('M', 'CABINET_BTN_MUTE2', 65287, 949, 'btnSquare'),
  ctl('S', 'CABINET_BTN_SOLO2', 65289, 983, 'btnSquare'),
  ctl('DynaCab', 'CABINET_DYNACAB_R2', 94, 740, 'dynaCabControl'),
  ctl('Pan', 'CABINET_PAN2', 13, 994, 'knobMiniReadout'),
  ctl('Level', 'CABINET_LEVEL2', 9, 745, 'knobMiniReadout'),
  ctl('Position', 'CABINET_DYNACAB_R2', 94, 828, 'knobMiniReadout'),
  ctl('Distance', 'CABINET_DYNACAB_Z2', 98, 911, 'knobMiniReadout'),
  ctl('Low Cut', 'CABINET_LOCUT2', 63, 994, 'knobMiniReadout'),
  ctl('High Cut', 'CABINET_HICUT2', 67, 1077, 'knobMiniReadout')
];

const lay: DeviceLayout = {
  pages: [{ name: 'Cab', rows: [{ controls: micRow }] }]
} as unknown as DeviceLayout;

const knob = (id: number, label: string): BoardCtl => ({
  key: `k${id}`,
  kind: 'cont',
  id,
  w: 1,
  h: 1,
  view: 'knob',
  views: ['knob', 'fader', 'slider', 'number', 'dynacab'],
  label
});
const cnv = (id: number, label: string, key = `e${id}`): BoardCtl => ({
  key,
  kind: 'toggle',
  id,
  w: 1,
  h: 1,
  view: 'button',
  views: ['button', 'switch'],
  label
});

const catalog: BoardCtl[] = [
  ...[8, 9, 12, 13, 62, 63, 66, 67, 97, 98, 93, 94].map((id) => knob(id, `K${id}`)),
  ...([85, 86, 89, 90].map((id) => ({
    key: `e${id}`,
    kind: 'select',
    id,
    w: 2,
    h: 1,
    view: 'select',
    views: ['select'],
    label: `S${id}`
  })) as BoardCtl[]),
  cnv(0, 'MUTE1', 'e9001'),
  cnv(0, 'MUTE2', 'e9002')
];

// Tag EVERY cab-specific control, not just the knobs — the offending widgets at 12 columns are the
// wide (w=2) selects and the M/S button, which flow up into the other cab's line.
const CAB1 = new Set(['k8', 'k12', 'k62', 'k66', 'k93', 'k97', 'e85', 'e89', 'e9001']);
const CAB2 = new Set(['k9', 'k13', 'k63', 'k67', 'k94', 'k98', 'e86', 'e90', 'e9002']);

describe('Cab mic page — cab 1 and cab 2 must not interleave', () => {
  const ws = buildDeviceLayoutBoard(lay, catalog, 12)!.boards['Cab'];
  const cab1 = ws.filter((w) => CAB1.has(w.key));
  const cab2 = ws.filter((w) => CAB2.has(w.key));

  it('places both cabs controls at all', () => {
    expect(cab1.length).toBe(9);
    expect(cab2.length).toBe(9);
  });

  it('renders cab 2 strictly BELOW cab 1 (no cab-2 tile in cab 1 territory)', () => {
    const cab1Bottom = Math.max(...cab1.map((w) => w.y + w.h));
    const cab2Top = Math.min(...cab2.map((w) => w.y));
    expect(cab2Top).toBeGreaterThanOrEqual(cab1Bottom);
  });

  it('keeps every cab-1 widget strictly before every cab-2 widget in reading order', () => {
    const flow = (w: { y: number; x: number }) => w.y * 100 + w.x;
    expect(Math.max(...cab1.map(flow))).toBeLessThan(Math.min(...cab2.map(flow)));
  });

  it('never puts cab 2 on a grid line that also carries a cab 1 control', () => {
    const y1 = new Set(cab1.map((w) => w.y));
    for (const w of cab2) expect(y1.has(w.y)).toBe(false);
  });

  it('renders both DynaCab mic graphs, each inside its own cab group', () => {
    const graphs = ws.filter((w) => w.view === 'dynacab');
    expect(graphs.length).toBe(2);
    const [g1, g2] = graphs.sort((a, b) => a.key.localeCompare(b.key)); // k93 (cab 1) then k94 (cab 2)
    expect(g1.key).toBe('k93');
    expect(g2.key).toBe('k94');
    expect(g1.y + g1.h).toBeLessThanOrEqual(g2.y);
    // and each graph still binds its own cab's Distance sibling
    expect(g1.key2).toBe('k97');
    expect(g2.key2).toBe('k98');
  });

  it('titles each column with the device\'s own group label', () => {
    const heads = ws.filter((w) => w.view === 'header');
    expect(heads.map((h) => h.text)).toEqual(['CAB 1', 'CAB 2']);
    // each heading sits directly above every control of its own cab, spanning the board width
    const [h1, h2] = heads;
    expect(h1.w).toBe(12);
    expect(h1.x).toBe(0);
    expect(h2.y).toBeGreaterThan(h1.y);
    for (const w of cab1) expect(w.y).toBeGreaterThan(h1.y);
    for (const w of cab2) expect(w.y).toBeGreaterThan(h2.y);
  });

  it('binds no parameter for a heading (own render pass, not a catalog lookup)', () => {
    for (const h of ws.filter((w) => w.view === 'header')) {
      expect(h.key.startsWith('hdr:')).toBe(true);
      expect(h.id.startsWith('h')).toBe(true);
    }
  });

  // Owner decision 2026-10-12: "mic graph can be first and knobs after". The graphs used to land at the
  // END of their column's line (the served order), which put them at y=737 in a block pane only ~281px
  // tall at 1280x800 — below the fold, reported as "mic placement isn't in any of the tabs".
  it('LEADS each column with its DynaCab mic graph, knobs after', () => {
    const graphs = ws.filter((w) => w.view === 'dynacab').sort((a, b) => a.key.localeCompare(b.key));
    const [g1, g2] = graphs;
    const [h1, h2] = ws.filter((w) => w.view === 'header');
    // the graph is the first content line of its own column, directly under that column's label
    expect(g1!.y).toBe(h1!.y + 1);
    expect(g2!.y).toBe(h2!.y + 1);
    // nothing else in that column comes before it in reading order (same line only to its right)
    const leads = (g: { key: string; x: number; y: number; w: number }, group: typeof cab1) =>
      group.every((w) => w.key === g.key || w.y > g.y || (w.y === g.y && w.x >= g.x + g.w));
    expect(leads(g1!, cab1)).toBe(true);
    expect(leads(g2!, cab2)).toBe(true);
    // and the graphs no longer sit at the foot of their columns (the regression this pins)
    for (const [g, group] of [
      [g1!, cab1],
      [g2!, cab2]
    ] as const) {
      expect(g.y).toBeLessThan(Math.max(...group.map((w) => w.y + w.h)));
    }
  });
});
