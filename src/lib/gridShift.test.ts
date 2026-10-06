import { describe, it, expect } from 'vitest';
import { planGridShiftRow, planGridShiftColumn, type GridShiftShape } from './gridShift';
import type { RouteCell } from './gridRouting';

// "Move an entire grid row / column" (audit §2.9) — the pure planner behind the Signal Grid
// border controls. Both operations shift a whole band ONE ROW POSITION (up/down): a grid cable
// only ever spans two ADJACENT COLUMNS, so moving a cell across columns would strand its wires.
// Moving a band along the ROW axis keeps every cell's column, so blocks, shunts AND the cables
// attached to them travel together and nothing is dropped. Bounded by the device's real grid
// shape (FM3 4x12, Axe-Fx III 4x14); refuses rather than pushing a block off the edge.

const SHUNT_BASE = 1024;
const FM3: GridShiftShape = { rows: 4, cols: 12 };
const III: GridShiftShape = { rows: 4, cols: 14 };

const block = (row: number, col: number, effectId: number, display: string, fromRows: number[] = []): RouteCell =>
  ({ row, col, kind: 'block', effectId, display, fromRows });
const shunt = (row: number, col: number, inst: number, fromRows: number[] = []): RouteCell =>
  ({ row, col, kind: 'shunt', effectId: SHUNT_BASE + inst, display: 'Shunt', fromRows });

const places = (ops: { kind: string }[]) => ops.filter((o) => o.kind === 'place');
const cables = (ops: { kind: string }[]) => ops.filter((o) => o.kind === 'cable');
const removes = (ops: { kind: string }[]) => ops.filter((o) => o.kind === 'remove');
const pset = (ops: { kind: string }[]) => places(ops).map((o: any) => `${o.row},${o.col}:${o.blockId}`).sort();
const cset = (ops: { kind: string }[]) => cables(ops).map((o: any) => `${o.srcRow},${o.srcCol}->${o.destRow}:${o.connect}`).sort();
const rcset = (ops: { kind: string }[]) => removes(ops).map((o: any) => `${o.row},${o.col}`).sort();

describe('planGridShiftRow', () => {
  it('moves a whole row one position down, carrying blocks, shunts AND their cables', () => {
    // chain on row 0: Amp → Cab → shunt, all wired along the row
    const amp = block(0, 0, 40, 'Amp', []);
    const cab = block(0, 1, 41, 'Cab', [0]);
    const sh = shunt(0, 2, 0, [0]);
    const p = planGridShiftRow([amp, cab], [sh], 0, 1, FM3);
    expect(p.ok).toBe(true);
    // every cell landed one row down (row 1 was empty → a plain slide)
    expect(pset(p.ops)).toEqual(['1,0:40', '1,1:41', '1,2:1024'].sort());
    // each moved cell is cleared first (its wiring carried on the remove for undo)
    expect(rcset(p.ops)).toEqual(['0,0', '0,1', '0,2']);
    expect(removes(p.ops).find((o: any) => o.col === 1)).toMatchObject({ inRows: [0], outRows: [0] });
    // the cables travelled with the cells: r0→r0 hops became r1→r1 hops
    expect(cset(p.ops)).toEqual(['1,0->1:true', '1,1->1:true'].sort());
    expect(p.cables).toHaveLength(2);
    expect(p.label).toMatch(/row 1 down/i);
  });

  it('swaps a populated row with the populated row below it (device "changes places")', () => {
    const top = block(0, 0, 40, 'Amp', []);
    const bottom = block(1, 0, 50, 'Drive', []);
    const p = planGridShiftRow([top, bottom], [], 0, 1, FM3);
    expect(p.ok).toBe(true);
    // the two rows exchanged their contents
    expect(pset(p.ops)).toEqual(['0,0:50', '1,0:40'].sort());
  });

  it('remaps diagonal (cross-row) cables through the same row permutation', () => {
    // Amp @(0,0) fans out to BOTH (0,1) and (1,1)
    const amp = block(0, 0, 40, 'Amp', []);
    const straight = block(0, 1, 41, 'Cab', [0]);
    const diag = block(1, 1, 42, 'Reverb', [0]);
    const p = planGridShiftRow([amp, straight, diag], [], 0, 1, FM3);
    expect(p.ok).toBe(true);
    // rows 0 and 1 exchange: (1,1)'s Reverb moves up, (0,1)'s Cab moves down
    expect(pset(p.ops)).toEqual(['1,0:40', '1,1:41', '0,1:42'].sort());
    // both feeders now originate from the moved Amp at row 1
    expect(cset(p.ops)).toEqual(['1,0->1:true', '1,0->0:true'].sort());
  });

  it('explicitly disconnects an outgoing cable whose destination did NOT move', () => {
    // Amp @(0,0) feeds Cab @(2,1); shifting row 0 down moves the Amp but NOT the Cab (row 2)
    const amp = block(0, 0, 40, 'Amp', []);
    const cab = block(2, 1, 41, 'Cab', [0]);
    const p = planGridShiftRow([amp, cab], [], 0, 1, FM3);
    expect(p.ok).toBe(true);
    // Cab stayed in row 2, so its old feeder bit must be dropped explicitly …
    expect(cset(p.ops)).toEqual(['0,0->2:false', '1,0->2:true'].sort());
  });

  it('refuses to push a row off the top or bottom edge (naming the reason)', () => {
    const bottom = planGridShiftRow([block(3, 0, 40, 'Amp')], [], 3, 1, FM3);
    expect(bottom.ok).toBe(false);
    expect(bottom.error).toMatch(/bottom edge/i);
    const top = planGridShiftRow([block(0, 0, 40, 'Amp')], [], 0, -1, FM3);
    expect(top.ok).toBe(false);
    expect(top.error).toMatch(/top edge/i);
  });

  it('refuses when both rows are empty (nothing to move)', () => {
    const p = planGridShiftRow([], [], 0, 1, FM3);
    expect(p.ok).toBe(false);
    expect(p.error).toMatch(/empty/i);
  });

  it('validates the row against the device grid shape', () => {
    expect(planGridShiftRow([block(3, 0, 40, 'Amp')], [], 4, -1, FM3).ok).toBe(false); // row 5 of 4
  });

  it('preserves shunt identity (instance id) across the move', () => {
    const sh = shunt(1, 5, 7, []);
    const p = planGridShiftRow([], [sh], 1, 1, FM3);
    expect(p.ok).toBe(true);
    expect(pset(p.ops)).toEqual(['2,5:1031']);
  });
});

describe('planGridShiftColumn', () => {
  it('moves a whole column one position up, carrying blocks, shunts AND their cables', () => {
    // column 2: Amp @(1,2) fed from (0,1); Cab @(2,2) fed from (1,1)
    const amp = block(1, 2, 40, 'Amp', [0]);
    const cab = block(2, 2, 41, 'Cab', [1]);
    const p = planGridShiftColumn([amp, cab], [], 2, -1, FM3);
    expect(p.ok).toBe(true);
    expect(pset(p.ops)).toEqual(['0,2:40', '1,2:41'].sort());
    expect(rcset(p.ops)).toEqual(['1,2', '2,2']);
    // incoming cables (from col 1, which does not move) re-anchor to the new rows
    expect(cset(p.ops)).toEqual(['0,1->0:true', '1,1->1:true'].sort());
    expect(p.label).toMatch(/column 3 up/i);
  });

  it('re-lays an outgoing cable onto the moved cell (old feeder bit dropped, new one set)', () => {
    // column 2 cell @(2,2) feeds (2,3); shifting col 2 up moves the source to (1,2)
    const src = block(2, 2, 40, 'Amp', []);
    const dst = block(2, 3, 41, 'Cab', [2]);
    const p = planGridShiftColumn([src, dst], [], 2, -1, FM3);
    expect(p.ok).toBe(true);
    expect(cset(p.ops)).toEqual(['2,2->2:false', '1,2->2:true'].sort());
  });

  it('refuses to push a column off the top or bottom edge (naming the reason)', () => {
    const up = planGridShiftColumn([block(0, 2, 40, 'Amp')], [], 2, -1, FM3);
    expect(up.ok).toBe(false);
    expect(up.error).toMatch(/top edge/i);
    const down = planGridShiftColumn([block(3, 2, 40, 'Amp')], [], 2, 1, FM3);
    expect(down.ok).toBe(false);
    expect(down.error).toMatch(/bottom edge/i);
  });

  it('bounds the column index by the device grid shape (FM3 12 cols vs Axe-Fx III 14)', () => {
    const c12 = block(1, 12, 40, 'Amp'); // the 13th column
    expect(planGridShiftColumn([c12], [], 12, -1, III).ok).toBe(true);
    const fm3 = planGridShiftColumn([c12], [], 12, -1, FM3);
    expect(fm3.ok).toBe(false);
    expect(fm3.error).toMatch(/12-column/i);
  });

  it('refuses an empty column', () => {
    const p = planGridShiftColumn([block(0, 0, 40, 'Amp')], [], 3, -1, FM3);
    expect(p.ok).toBe(false);
    expect(p.error).toMatch(/empty/i);
  });
});
