// Pure grid-routing planners — given the current layout + a source/target, compute the
// list of mutation ops (place/cable, mirrored as history ops) that realize the edit.
//
// Kept free of any runes/DOM/network so it is unit-testable in the node-env vitest and
// reused verbatim by BOTH the executor (editor.svelte.ts) and the drag PREVIEW
// (SignalGrid.svelte) — the preview highlights exactly the cells/cables a drop commits.
//
// Coordinates are 0-indexed (like `Layout`); the editor's `#W` shifts them to the
// 1-indexed write API. `HistoryOp` is imported type-only so this stays a plain module.
import type { HistoryOp } from './history.svelte';

/** Minimal projection of a grid cell the planners need (positions + wiring + identity). */
export interface RouteCell {
  row: number;
  col: number;
  kind: 'block' | 'shunt';
  effectId: number;
  fromRows: number[];
  display: string;
}

/** A cable segment `(srcRow,srcCol) → (destRow, srcCol+1)` — used for preview drawing. */
export interface CableSeg {
  srcRow: number;
  srcCol: number;
  destRow: number;
}

export interface RoutePlan {
  ok: boolean;
  /** Present when `ok === false` — a short user-facing reason. */
  error?: string;
  /** Executed forward; recorded as a composite and undone in reverse. */
  ops: HistoryOp[];
  /** Human-readable composite label. */
  label: string;
  /** Cells that gain a NEW shunt (preview highlight + optimistic layout add). */
  newShunts: { row: number; col: number; blockId: number }[];
  /** All cables the plan creates (preview drawing + optimistic layout wiring). */
  cables: CableSeg[];
}

const err = (error: string): RoutePlan => ({ ok: false, error, ops: [], label: '', newShunts: [], cables: [] });

/** Lowest-free-instance shunt allocator over the existing routing cells. FM-Edit gives every
 *  shunt a unique instance id (`shuntBase + n`); reusing one makes the device silently dedupe. */
function shuntAllocator(cells: RouteCell[], shuntBase: number): () => number {
  const used = new Set(cells.filter((c) => c.effectId >= shuntBase).map((c) => c.effectId - shuntBase));
  let next = 0;
  return () => {
    while (used.has(next)) next++;
    used.add(next);
    return shuntBase + next;
  };
}

/**
 * Connect `src` → `(destRow,destCol)`, spanning any number of columns.
 *
 * Straight run flows along `src.row`; empty intermediate cells get a fresh shunt, existing
 * blocks on that row are CHAINED through (output→input), existing shunts are reused. The
 * final hop bends into `destRow` (diagonal) — so a cross-row target routes on the source row
 * until the target column, then a single diagonal cable. Blocks that sit OFF `src.row` in an
 * intermediate column are left alone (the shunt on src.row routes around them).
 */
export function planConnect(
  cells: RouteCell[],
  shunts: RouteCell[],
  src: { row: number; col: number; display: string },
  destRow: number,
  destCol: number,
  shuntBase: number,
): RoutePlan {
  if (destCol <= src.col) return err('Connect to a later column');
  const all = [...cells, ...shunts];
  const at = (r: number, c: number) => all.find((x) => x.row === r && x.col === c);
  const alloc = shuntAllocator(all, shuntBase);

  const ops: HistoryOp[] = [];
  const newShunts: { row: number; col: number; blockId: number }[] = [];

  // ensure a carrier cell exists in every intermediate column along src.row
  for (let c = src.col + 1; c < destCol; c++) {
    const cell = at(src.row, c);
    if (!cell) {
      const sid = alloc();
      ops.push({ kind: 'place', row: src.row, col: c, blockId: sid, display: 'Shunt' });
      newShunts.push({ row: src.row, col: c, blockId: sid });
    }
    // else: block → chain through it; shunt → reuse. Either way no placement.
  }
  // ensure the destination cell exists (shunt if dropped on empty)
  if (!at(destRow, destCol)) {
    const sid = alloc();
    ops.push({ kind: 'place', row: destRow, col: destCol, blockId: sid, display: 'Shunt' });
    newShunts.push({ row: destRow, col: destCol, blockId: sid });
  }

  // chain the cables: straight along src.row, then bend into destRow on the last hop
  const cables: CableSeg[] = [];
  for (let c = src.col; c < destCol - 1; c++) {
    ops.push({ kind: 'cable', srcRow: src.row, srcCol: c, destRow: src.row, connect: true });
    cables.push({ srcRow: src.row, srcCol: c, destRow: src.row });
  }
  ops.push({ kind: 'cable', srcRow: src.row, srcCol: destCol - 1, destRow, connect: true });
  cables.push({ srcRow: src.row, srcCol: destCol - 1, destRow });

  return { ok: true, ops, label: `Connected ${src.display} → r${destRow + 1}c${destCol + 1}`, newShunts, cables };
}

/** Rows of column `col+1` that are currently fed from `(row,col)` — a cell's downstream taps. */
function outgoingRows(cells: RouteCell[], shunts: RouteCell[], row: number, col: number): number[] {
  return [...cells, ...shunts].filter((c) => c.col === col + 1 && c.fromRows.includes(row)).map((c) => c.row);
}

/**
 * Replace the SHUNT at `target` with a block, preserving the shunt's exact cable topology
 * (its inputs and outputs move onto the block). Two entry shapes:
 *   - move: `src` is an existing block being relocated onto the shunt (its own cell is cleared,
 *     its wires captured for undo, then dropped — cross-cell move default).
 *   - place: `src` omitted, `blockId`/`display` given for an add-block-onto-shunt.
 *
 * Ops (forward): remove src? → remove shunt → place block → re-cable inputs → re-cable outputs.
 * Recorded as one composite; undo restores the shunt (with its cables) and the source block.
 */
export function planReplaceShunt(
  cells: RouteCell[],
  shunts: RouteCell[],
  target: RouteCell,
  block: { blockId: number; display: string; src?: { row: number; col: number; effectId: number; display: string; fromRows: number[] } },
): RoutePlan {
  if (target.kind !== 'shunt') return err('Target is not a shunt');
  const shuntInputs = target.fromRows.slice();
  const shuntOutputs = outgoingRows(cells, shunts, target.row, target.col);

  const ops: HistoryOp[] = [];
  const src = block.src;
  if (src) {
    if (src.row === target.row && src.col === target.col) return err('Same cell');
    const srcOutputs = outgoingRows(cells, shunts, src.row, src.col);
    // clearing the source drops its own wires — carried on the remove op so undo restores them
    ops.push({ kind: 'remove', row: src.row, col: src.col, blockId: src.effectId, display: src.display, inRows: src.fromRows.slice(), outRows: srcOutputs });
  }
  // clear the shunt (drops its cables) — carried so undo restores the shunt intact
  ops.push({ kind: 'remove', row: target.row, col: target.col, blockId: target.effectId, display: 'Shunt', inRows: shuntInputs, outRows: shuntOutputs });
  // drop the block into the shunt's cell
  ops.push({ kind: 'place', row: target.row, col: target.col, blockId: block.blockId, display: block.display });
  // re-wire the block exactly as the shunt was wired
  const cables: CableSeg[] = [];
  for (const fr of shuntInputs) {
    ops.push({ kind: 'cable', srcRow: fr, srcCol: target.col - 1, destRow: target.row, connect: true });
    cables.push({ srcRow: fr, srcCol: target.col - 1, destRow: target.row });
  }
  for (const dr of shuntOutputs) {
    ops.push({ kind: 'cable', srcRow: target.row, srcCol: target.col, destRow: dr, connect: true });
    cables.push({ srcRow: target.row, srcCol: target.col, destRow: dr });
  }

  const label = src
    ? `Moved ${block.display} onto shunt r${target.row + 1}c${target.col + 1}`
    : `Placed ${block.display} on shunt r${target.row + 1}c${target.col + 1}`;
  return { ok: true, ops, label, newShunts: [], cables };
}

/**
 * Every cable touching cell `(row,col)` — incoming (the cell's own feeders from col-1) followed by
 * outgoing (cells in col+1 fed from this row). Returned 0-indexed like the rest of the planners.
 */
function cablesTouching(cells: RouteCell[], shunts: RouteCell[], row: number, col: number): CableSeg[] {
  const all = [...cells, ...shunts];
  const cell = all.find((c) => c.row === row && c.col === col);
  const incoming = (cell?.fromRows ?? []).map((fr) => ({ srcRow: fr, srcCol: col - 1, destRow: row }));
  const outgoing = all
    .filter((c) => c.col === col + 1 && c.fromRows.includes(row))
    .map((c) => ({ srcRow: row, srcCol: col, destRow: c.row }));
  return [...incoming, ...outgoing];
}

/**
 * FM3-Edit "Disconnect all cables" (Cmd+D): drop EVERY cable into and out of `(row,col)` in one
 * undoable step. Emits one `cable … connect:false` op per touching wire; the composite is undone in
 * reverse, so each is re-connected. Fails (ok:false) when the cell has no cables to remove.
 */
export function planDisconnectAll(cells: RouteCell[], shunts: RouteCell[], row: number, col: number): RoutePlan {
  const segs = cablesTouching(cells, shunts, row, col);
  if (!segs.length) return err('No cables to disconnect');
  const ops: HistoryOp[] = segs.map((s) => ({ kind: 'cable', srcRow: s.srcRow, srcCol: s.srcCol, destRow: s.destRow, connect: false }));
  return { ok: true, ops, label: `Disconnected all cables from r${row + 1}c${col + 1}`, newShunts: [], cables: segs };
}

/**
 * FM3-Edit "Insert shunt" (Cmd+U): place an explicit routing (shunt) cell in an EMPTY grid cell.
 * Unlike `planConnect` (which lays shunts as a side effect of routing), this is a standalone insert
 * the user asked for. Allocates the lowest free shunt instance id so the device never dedupes it.
 */
export function planInsertShunt(cells: RouteCell[], shunts: RouteCell[], row: number, col: number, shuntBase: number): RoutePlan {
  const all = [...cells, ...shunts];
  if (all.find((c) => c.row === row && c.col === col)) return err('Cell is not empty');
  const sid = shuntAllocator(all, shuntBase)();
  const ops: HistoryOp[] = [{ kind: 'place', row, col, blockId: sid, display: 'Shunt' }];
  return { ok: true, ops, label: `Inserted shunt at r${row + 1}c${col + 1}`, newShunts: [{ row, col, blockId: sid }], cables: [] };
}

/**
 * FM3-Edit "Reset block / reset channel": re-initialize a block's parameters to the DEVICE DEFAULTS
 * while keeping it in place and preserving its routing. Device-true mechanism: clear the cell and
 * re-place the SAME effect id — a freshly placed block comes up with model defaults. The cell's
 * feeder and downstream cables are captured on the remove op (for undo) and re-laid afterwards, so
 * the topology is unchanged. One composite step (undo restores the pre-reset placement + wires; the
 * old parameter VALUES are not snapshotted — same v1 limitation as the cab-change checkpoint).
 */
export function planResetBlock(cells: RouteCell[], shunts: RouteCell[], target: RouteCell, blockId: number, display: string): RoutePlan {
  if (target.kind !== 'block') return err('Target is not a block');
  const inputs = target.fromRows.slice();
  const outputs = outgoingRows(cells, shunts, target.row, target.col);
  const ops: HistoryOp[] = [
    { kind: 'remove', row: target.row, col: target.col, blockId: target.effectId, display: target.display, inRows: inputs, outRows: outputs },
    { kind: 'place', row: target.row, col: target.col, blockId, display }
  ];
  const cables: CableSeg[] = [];
  for (const fr of inputs) {
    ops.push({ kind: 'cable', srcRow: fr, srcCol: target.col - 1, destRow: target.row, connect: true });
    cables.push({ srcRow: fr, srcCol: target.col - 1, destRow: target.row });
  }
  for (const dr of outputs) {
    ops.push({ kind: 'cable', srcRow: target.row, srcCol: target.col, destRow: dr, connect: true });
    cables.push({ srcRow: target.row, srcCol: target.col, destRow: dr });
  }
  return { ok: true, ops, label: `Reset ${display} at r${target.row + 1}c${target.col + 1}`, newShunts: [], cables };
}

/**
 * FM3-Edit "drag a block onto a block to SWAP": exchange the two placed blocks between their cells.
 * Cables are PRESERVED because the cell POSITIONS never move — each cell is re-wired with its OWN
 * original input/output topology (the block instance carries its settings, the cell keeps its wires).
 * Both cells are cleared first (wires carried on the removes for undo), then each block is placed
 * into the other's cell and re-wired. One composite step.
 */
export function planSwap(cells: RouteCell[], shunts: RouteCell[], a: RouteCell, b: RouteCell): RoutePlan {
  if (a.kind !== 'block' || b.kind !== 'block') return err('Swap needs two blocks');
  if (a.row === b.row && a.col === b.col) return err('Same cell');
  const inA = a.fromRows.slice();
  const outA = outgoingRows(cells, shunts, a.row, a.col);
  const inB = b.fromRows.slice();
  const outB = outgoingRows(cells, shunts, b.row, b.col);

  const ops: HistoryOp[] = [
    { kind: 'remove', row: a.row, col: a.col, blockId: a.effectId, display: a.display, inRows: inA, outRows: outA },
    { kind: 'remove', row: b.row, col: b.col, blockId: b.effectId, display: b.display, inRows: inB, outRows: outB },
    // exchange the block instances between the two (now empty) cells
    { kind: 'place', row: a.row, col: a.col, blockId: b.effectId, display: b.display },
    { kind: 'place', row: b.row, col: b.col, blockId: a.effectId, display: a.display }
  ];
  const cables: CableSeg[] = [];
  // re-lay each cell's own topology (the position keeps its wires; the block model merely swapped)
  const wireIn = (rows: number[], col: number, destRow: number) => {
    for (const fr of rows) {
      ops.push({ kind: 'cable', srcRow: fr, srcCol: col - 1, destRow, connect: true });
      cables.push({ srcRow: fr, srcCol: col - 1, destRow });
    }
  };
  const wireOut = (rows: number[], row: number, col: number) => {
    for (const dr of rows) {
      ops.push({ kind: 'cable', srcRow: row, srcCol: col, destRow: dr, connect: true });
      cables.push({ srcRow: row, srcCol: col, destRow: dr });
    }
  };
  wireIn(inA, a.col, a.row);
  wireOut(outA, a.row, a.col);
  wireIn(inB, b.col, b.row);
  wireOut(outB, b.row, b.col);

  return { ok: true, ops, label: `Swapped ${a.display} and ${b.display}`, newShunts: [], cables };
}

/**
 * FM3-Edit "Paste block": place a copied block instance into an EMPTY cell. The structural ops here
 * are just the placement (undoable); the copied parameter values are written afterwards by the
 * editor's paste path (like the cab-change checkpoint — old values aren't captured on an empty cell).
 */
export function planPasteBlock(cells: RouteCell[], shunts: RouteCell[], row: number, col: number, blockId: number, display: string): RoutePlan {
  if ([...cells, ...shunts].find((c) => c.row === row && c.col === col)) return err('Cell is not empty');
  return { ok: true, ops: [{ kind: 'place', row, col, blockId, display }], label: `Pasted ${display} at r${row + 1}c${col + 1}`, newShunts: [], cables: [] };
}

