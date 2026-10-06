import { describe, it, expect } from 'vitest';
import {
  planDisconnectAll,
  planInsertShunt,
  planResetBlock,
  planSwap,
  planPasteBlock,
  type RouteCell
} from './gridRouting';

// FM3-Edit grid/structure edit operations FM3-Edit has and Axis lacked (audit §2.9):
//   disconnect-all, explicit insert shunt, reset block/channel, copy/paste, block swap.
// These planners are pure (no runes/DOM/network) — the same ops the editor executes
// forward and `history` replays in reverse, so undo is exact.

const SHUNT_BASE = 1024;

const block = (row: number, col: number, effectId: number, display: string, fromRows: number[] = []): RouteCell =>
  ({ row, col, kind: 'block', effectId, display, fromRows });
const shunt = (row: number, col: number, inst: number, fromRows: number[] = []): RouteCell =>
  ({ row, col, kind: 'shunt', effectId: SHUNT_BASE + inst, display: 'Shunt', fromRows });

const places = (ops: { kind: string }[]) => ops.filter((o) => o.kind === 'place');
const cables = (ops: { kind: string }[]) => ops.filter((o) => o.kind === 'cable');
const removes = (ops: { kind: string }[]) => ops.filter((o) => o.kind === 'remove');

describe('planDisconnectAll', () => {
  it('emits a disconnect for every cable touching the cell (incoming + outgoing)', () => {
    // Amp @ (1,1): fed from row 0 of col 0; feeds a cab @ (1,2) and a cell @ (2,2)
    const amp = block(1, 1, 40, 'Amp', [0]);
    const cab = block(1, 2, 41, 'Cab', [1]);
    const other = shunt(2, 2, 0, [1]);
    const p = planDisconnectAll([amp, cab], [other], 1, 1);
    expect(p.ok).toBe(true);
    expect(cables(p.ops).map((o: any) => `${o.srcRow},${o.srcCol}->${o.destRow}:${o.connect}`)).toEqual([
      '0,0->1:false', // incoming
      '1,1->1:false', // outgoing to cab
      '1,1->2:false' // outgoing to the shunt
    ]);
    expect(places(p.ops)).toHaveLength(0);
  });

  it('reports nothing to do when the cell has no cables', () => {
    const lonely = block(0, 0, 40, 'Amp', []);
    const p = planDisconnectAll([lonely], [], 0, 0);
    expect(p.ok).toBe(false);
    expect(p.error).toMatch(/no cables/i);
  });
});

describe('planInsertShunt', () => {
  it('places a fresh, uniquely-allocated shunt into an empty cell', () => {
    const existing = shunt(0, 0, 0); // instance 0 in use
    const p = planInsertShunt([], [existing], 2, 3, SHUNT_BASE);
    expect(p.ok).toBe(true);
    expect(places(p.ops)[0]).toMatchObject({ kind: 'place', row: 2, col: 3, blockId: SHUNT_BASE + 1, display: 'Shunt' });
    expect(p.newShunts).toEqual([{ row: 2, col: 3, blockId: SHUNT_BASE + 1 }]);
  });

  it('refuses to insert into an occupied cell', () => {
    const amp = block(1, 1, 40, 'Amp');
    const p = planInsertShunt([amp], [], 1, 1, SHUNT_BASE);
    expect(p.ok).toBe(false);
    expect(p.error).toMatch(/not empty/i);
  });
});

describe('planResetBlock', () => {
  it('re-inits the block in place, preserving its input/output cables', () => {
    // Reverb @ (1,2) fed from rows [0,1] of col1, feeding a block @ (1,3)
    const rev = block(1, 2, 30, 'Reverb', [0, 1]);
    const down = block(1, 3, 31, 'Cab', [1]);
    const p = planResetBlock([rev, down], [], rev, rev.effectId, rev.display);
    expect(p.ok).toBe(true);
    // clear the cell (carrying its wires for undo) then place the SAME block id back
    expect(removes(p.ops)[0]).toMatchObject({ kind: 'remove', row: 1, col: 2, blockId: 30, inRows: [0, 1], outRows: [1] });
    expect(places(p.ops)[0]).toMatchObject({ kind: 'place', row: 1, col: 2, blockId: 30, display: 'Reverb' });
    // both feeders re-wired in, the downstream tap re-wired out
    expect(cables(p.ops).map((o: any) => `${o.srcRow},${o.srcCol}->${o.destRow}`)).toEqual(['0,1->1', '1,1->1', '1,2->1']);
  });

  it('rejects a non-block target', () => {
    const s = shunt(0, 1, 0);
    const p = planResetBlock([], [s], s, SHUNT_BASE, 'Shunt');
    expect(p.ok).toBe(false);
  });
});

describe('planSwap', () => {
  it('exchanges two blocks between their cells, re-wiring each cell as it was', () => {
    // Amp @ (0,0) fed from nothing, feeding (0,1); Cab @ (2,1) fed from row 1, feeding (2,2)
    const amp = block(0, 0, 40, 'Amp', []);
    const ampOut = block(0, 1, 41, 'Cab', [0]);
    const cab = block(2, 1, 50, 'Cab', [1]);
    const cabOut = block(2, 2, 51, 'Reverb', [2]);
    const p = planSwap([amp, ampOut, cab, cabOut], [], amp, cab);
    expect(p.ok).toBe(true);
    // both cells cleared (wires carried on the removes for undo) …
    expect(removes(p.ops)).toHaveLength(2);
    // … then each block placed into the OTHER's cell
    expect(places(p.ops).map((o: any) => `${o.row},${o.col}:${o.blockId}`)).toEqual(['0,0:50', '2,1:40']);
    // each cell re-wired with its OWN original topology (cables preserved in place)
    expect(cables(p.ops).map((o: any) => `${o.srcRow},${o.srcCol}->${o.destRow}`)).toEqual([
      '0,0->0', // Amp cell's output → the cell at (0,1) (now holding the cab)
      '1,0->2', // Cab cell's input  (now holding the amp)
      '2,1->2' // Cab cell's output (now holding the amp)
    ]);
  });

  it('rejects swapping a cell with itself or a non-block', () => {
    const a = block(0, 0, 40, 'Amp');
    expect(planSwap([a], [], a, a).ok).toBe(false);
    const s = shunt(1, 1, 0);
    expect(planSwap([a], [s], a, s).ok).toBe(false);
  });
});

describe('planPasteBlock', () => {
  it('places a copied block into an empty cell', () => {
    const p = planPasteBlock([], [], 2, 2, 40, 'Amp');
    expect(p.ok).toBe(true);
    expect(places(p.ops)[0]).toMatchObject({ kind: 'place', row: 2, col: 2, blockId: 40, display: 'Amp' });
  });

  it('refuses pasting onto an occupied cell', () => {
    const amp = block(2, 2, 40, 'Amp');
    expect(planPasteBlock([amp], [], 2, 2, 50, 'Cab').ok).toBe(false);
  });
});
