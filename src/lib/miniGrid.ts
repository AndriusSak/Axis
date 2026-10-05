// Compact routing-grid preview geometry for MiniGrid.svelte (the Preset-Browser's read-only grid).
//
// The decoded grid it renders (GET /presets/:n/grid → PresetGrid, see grid.ts/SignalGrid) is
// 0-INDEXED: `col === 0` is the first column and grid.ts draws a cable for `col === 0`'s cells only
// when `col > 0`. This module is the plain-TS home of MiniGrid's pixel math so the geometry is
// unit-testable (the component cannot be mounted in this repo's node-env vitest).
export const MINIGRID_CW = 62; // cell width
export const MINIGRID_CH = 32; // cell height
export const MINIGRID_GAP = 18; // inter-cell gap

/** Column count needed to hold every cell (highest col + 1, never below 1). The grid is 0-indexed, so
 *  a cell at col 0 is the first column and a cell at col 11 needs 12 columns. */
export function miniGridCols(cells: { col: number }[]): number {
  return Math.max(1, ...cells.map((c) => c.col + 1));
}

/** Left pixel of a column (0-indexed: col 0 → 0). Matches grid.ts `x = col*(cw+gap)`. */
export function miniGridX(col: number): number {
  return col * (MINIGRID_CW + MINIGRID_GAP);
}

/** Top pixel of a row (0-indexed: row 0 → 0). Matches grid.ts `y = row*(ch+gap)`. */
export function miniGridY(row: number): number {
  return row * (MINIGRID_CH + MINIGRID_GAP);
}

/** Whether a cell draws an incoming cable: it needs a previous column (col >= 1) to be fed from. */
export function miniGridHasCable(col: number, fromRows: number[]): boolean {
  return col > 0 && fromRows.length > 0;
}
