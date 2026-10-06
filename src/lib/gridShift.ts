// Pure "move an entire grid row / column" planners (audit §2.9 — FM3-Edit's grid border sliders).
//
// A grid cable only ever spans two ADJACENT COLUMNS: a cell is fed from its `fromRows` in the
// PREVIOUS column. That is the whole reason both planners here move their band along the ROW axis
// (one row up/down): a cell that keeps its column keeps a valid route, so its blocks, shunts AND
// the cables attached to them all travel together and nothing is stranded. Moving a band ACROSS
// columns would leave every cross-column wire pointing at a cell that no longer exists — so it is
// deliberately not offered.
//
//   • planGridShiftRow    — row R and row R+dir exchange places (the device's own rule: "it changes
//                           places with the item in the space it is moved to").
//   • planGridShiftColumn — column C's cells slide one row up/down within that column.
//
// Both are pure (no runes/DOM/network), mirror the `HistoryOp` shapes gridRouting.ts emits, and are
// bounded by the DEVICE's real grid shape (FM3 4x12, Axe-Fx III 4x14 — read from the decoded
// layout, never hardcoded). Off-edge moves are refused with a user-facing reason, so the UI can
// disable the control and name why, rather than silently dropping a block.
import type { RouteCell, RoutePlan, CableSeg } from './gridRouting';
import type { HistoryOp } from './history.svelte';

/** The device's real grid dimensions (rows x cols) — the bound for every shift. */
export interface GridShiftShape {
  rows: number;
  cols: number;
}

const err = (error: string): RoutePlan => ({ ok: false, error, ops: [], label: '', newShunts: [], cables: [] });

/** Rows of the NEXT column currently fed from `(row,col)` — a cell's downstream taps. */
function outgoingRows(all: RouteCell[], row: number, col: number): number[] {
  return all.filter((c) => c.col === col + 1 && c.fromRows.includes(row)).map((c) => c.row);
}

/**
 * Move an entire grid ROW one position UP (`dir === -1`) or DOWN (`dir === +1`).
 *
 * Row `row` and row `row+dir` swap: every cell in either row relocates one row, and every row
 * reference (cell position AND cable endpoint) is remapped through the same involution `π`, so the
 * routing stays valid because no COLUMN changes. Cells whose destination row is off the grid are
 * refused, not dropped. Ops: clear each moved cell (its wires ride the remove op for undo) → place
 * it at the swapped row → drop the outgoing cables whose destination did NOT move (the clear does
 * not touch the destination's own feeder bit) → re-lay every cable whose endpoint row changed.
 */
export function planGridShiftRow(
  cells: RouteCell[],
  shunts: RouteCell[],
  row: number,
  dir: -1 | 1,
  shape: GridShiftShape
): RoutePlan {
  if (dir !== 1 && dir !== -1) return err('Direction must be up (−1) or down (+1)');
  if (!Number.isInteger(row) || row < 0 || row >= shape.rows) return err(`Row ${row + 1} is outside the ${shape.rows}-row grid`);
  const target = row + dir;
  if (target < 0 || target >= shape.rows) {
    return err(`Moving row ${row + 1} ${dir < 0 ? 'up' : 'down'} would push it off the ${dir < 0 ? 'top' : 'bottom'} edge of the ${shape.rows}-row grid`);
  }
  const all = [...cells, ...shunts];
  const pi = (r: number) => (r === row ? target : r === target ? row : r);
  const inBand = (r: number) => r === row || r === target;
  const moved = all.filter((c) => inBand(c.row)).sort((a, b) => a.row - b.row || a.col - b.col);
  if (!moved.length) return err(`Rows ${row + 1} and ${target + 1} are both empty — nothing to move`);

  const ops: HistoryOp[] = [];
  const cables: CableSeg[] = [];
  // 1. clear every moved cell, carrying its wiring on the remove op so undo restores it intact
  for (const c of moved) {
    ops.push({ kind: 'remove', row: c.row, col: c.col, blockId: c.effectId, display: c.display, inRows: c.fromRows.slice(), outRows: outgoingRows(all, c.row, c.col) });
  }
  // 2. re-place each cell at the swapped row
  for (const c of moved) {
    ops.push({ kind: 'place', row: pi(c.row), col: c.col, blockId: c.effectId, display: c.display });
  }
  // 3. disconnect outgoing cables from a moved source to a destination that did NOT move: the
  //    source's clear leaves that destination's feeder bit behind, so it must be dropped explicitly.
  for (const c of moved) {
    for (const dr of outgoingRows(all, c.row, c.col)) {
      if (!inBand(dr)) ops.push({ kind: 'cable', srcRow: c.row, srcCol: c.col, destRow: dr, connect: false });
    }
  }
  // 4. re-lay every cable whose endpoint row changed (all of them were dropped by the clears above)
  const seen = new Set<string>();
  for (const c of all) {
    if (c.col === 0) continue;
    for (const fr of c.fromRows) {
      const sr = pi(fr);
      const dr = pi(c.row);
      if (sr === fr && dr === c.row) continue; // this cable does not touch either row — leave it
      const key = `${sr},${c.col - 1}->${dr},${c.col}`;
      if (seen.has(key)) continue;
      seen.add(key);
      ops.push({ kind: 'cable', srcRow: sr, srcCol: c.col - 1, destRow: dr, connect: true });
      cables.push({ srcRow: sr, srcCol: c.col - 1, destRow: dr });
    }
  }
  return { ok: true, ops, label: `Moved row ${row + 1} ${dir < 0 ? 'up' : 'down'}`, newShunts: [], cables };
}

/**
 * Move an entire grid COLUMN one position UP (`dir === -1`) or DOWN (`dir === +1`).
 *
 * Every cell in column `col` slides one row within that column. The column keeps its index, so
 * incoming cables (from `col-1`) simply re-anchor to the cell's new row and the cell keeps its own
 * `fromRows`; downstream cells in `col+1` have their feeder row remapped to the moved cell's new
 * row. A cell that would slide off the top/bottom row is refused, not dropped.
 */
export function planGridShiftColumn(
  cells: RouteCell[],
  shunts: RouteCell[],
  col: number,
  dir: -1 | 1,
  shape: GridShiftShape
): RoutePlan {
  if (dir !== 1 && dir !== -1) return err('Direction must be up (−1) or down (+1)');
  if (!Number.isInteger(col) || col < 0 || col >= shape.cols) return err(`Column ${col + 1} is outside the ${shape.cols}-column grid`);
  const all = [...cells, ...shunts];
  const band = all.filter((c) => c.col === col).sort((a, b) => a.row - b.row);
  if (!band.length) return err(`Column ${col + 1} is empty — nothing to move`);
  for (const c of band) {
    const nr = c.row + dir;
    if (nr < 0 || nr >= shape.rows) {
      return err(`Moving column ${col + 1} ${dir < 0 ? 'up' : 'down'} would push a block off the ${dir < 0 ? 'top' : 'bottom'} edge of the ${shape.rows}-row grid`);
    }
  }

  const ops: HistoryOp[] = [];
  const cables: CableSeg[] = [];
  // 1. clear every cell in the column (wiring carried on the remove for undo)
  for (const c of band) {
    ops.push({ kind: 'remove', row: c.row, col: c.col, blockId: c.effectId, display: c.display, inRows: c.fromRows.slice(), outRows: outgoingRows(all, c.row, c.col) });
  }
  // 2. place each one row over
  for (const c of band) {
    ops.push({ kind: 'place', row: c.row + dir, col: c.col, blockId: c.effectId, display: c.display });
  }
  // 3. drop each outgoing cable's OLD feeder bit on the downstream cell (col+1 never moves)
  for (const c of band) {
    for (const dr of outgoingRows(all, c.row, c.col)) {
      ops.push({ kind: 'cable', srcRow: c.row, srcCol: c.col, destRow: dr, connect: false });
    }
  }
  // 4. re-lay: incoming (sources in col-1 keep their rows) and outgoing (new source row)
  for (const c of band) {
    const nr = c.row + dir;
    if (c.col > 0) {
      for (const fr of c.fromRows) {
        ops.push({ kind: 'cable', srcRow: fr, srcCol: c.col - 1, destRow: nr, connect: true });
        cables.push({ srcRow: fr, srcCol: c.col - 1, destRow: nr });
      }
    }
    for (const dr of outgoingRows(all, c.row, c.col)) {
      ops.push({ kind: 'cable', srcRow: nr, srcCol: c.col, destRow: dr, connect: true });
      cables.push({ srcRow: nr, srcCol: c.col, destRow: dr });
    }
  }
  return { ok: true, ops, label: `Moved column ${col + 1} ${dir < 0 ? 'up' : 'down'}`, newShunts: [], cables };
}
