import { describe, it, expect } from 'vitest';
import { miniGridCols, miniGridX, miniGridY, miniGridHasCable, MINIGRID_CW, MINIGRID_GAP } from './miniGrid';

// W4.1 — the compact preview is fed the 0-indexed decoded grid (grid.ts reference: `col*(cw+gap)`,
// cable drawn for `col > 0`). These assertions pin MiniGrid's geometry to that same 0-indexed model.
describe('miniGrid geometry (0-indexed decoded grid)', () => {
  it('places column 0 at x = 0 and column 1 one cell+gap to the right', () => {
    expect(miniGridX(0)).toBe(0);
    expect(miniGridX(1)).toBe(MINIGRID_CW + MINIGRID_GAP);
  });

  it('places row 0 at y = 0', () => {
    expect(miniGridY(0)).toBe(0);
  });

  it('sizes the canvas to max col + 1 (cells spanning cols 0..11 need 12 columns)', () => {
    const cells = Array.from({ length: 12 }, (_, i) => ({ row: 0, col: i }));
    expect(miniGridCols(cells)).toBe(12);
    expect(miniGridCols([{ col: 0 }])).toBe(1);
  });

  it('draws an incoming cable only for col >= 1; col 0 has no previous column', () => {
    expect(miniGridHasCable(0, [0])).toBe(false);
    expect(miniGridHasCable(1, [0])).toBe(true);
    expect(miniGridHasCable(1, [])).toBe(false);
  });
});
