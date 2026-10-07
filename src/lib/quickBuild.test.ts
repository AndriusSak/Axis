import { describe, it, expect } from 'vitest';
import {
  QUICK_BUILD_BLOCKS,
  resolveQuickBuild,
  quickBuildFirstFreeCell,
  quickBuildTarget,
  isQuickBuildPlaced,
  type QuickBuildFamily
} from './quickBuild';
import type { Cell, Layout } from './grid';

const fam = (slug: string, name: string, page: number): QuickBuildFamily => ({ slug, name, page });

const cell = (row: number, col: number, effectId: number, kind: 'block' | 'shunt' = 'block'): Cell => ({
  row,
  col,
  kind,
  effectId,
  display: kind === 'shunt' ? 'shunt' : `Blk ${effectId}`,
  pack: null,
  color: '#000',
  fromRows: []
});

const layout = (over: Partial<Layout> = {}): Layout => ({
  cells: [],
  shunts: [],
  rows: 2,
  cols: 3,
  name: 'Test',
  model: 'FM3',
  crcValid: true,
  ...over
});

describe('quickBuild — curated resolution against the served roster', () => {
  it('keeps the curated order and uses the served page + name', () => {
    const families = [
      fam('reverb', 'Reverb', 200),
      fam('amp', 'Amp', 100),
      fam('drive', 'Drive', 50)
    ];
    const rows = resolveQuickBuild(families);
    // curated order is gate, comp, drive, amp, cab, … → drive before amp; gate/comp/cab absent.
    expect(rows.map((r) => r.slug)).toEqual(['drive', 'amp', 'reverb']);
    expect(rows[0]).toEqual({ slug: 'drive', name: 'Drive', page: 50 });
    expect(rows[2]).toEqual({ slug: 'reverb', name: 'Reverb', page: 200 });
  });

  it('omits curated slugs the device does not serve (no invented page id)', () => {
    const rows = resolveQuickBuild([fam('amp', 'Amp', 100), fam('nonsense', 'Nonsense', 9)]);
    expect(rows).toEqual([{ slug: 'amp', name: 'Amp', page: 100 }]);
  });

  it('matches slugs case-insensitively', () => {
    expect(resolveQuickBuild([fam('AMP', 'Amp', 100)])).toEqual([{ slug: 'AMP', name: 'Amp', page: 100 }]);
  });

  it('falls back to the curated label when the served name is blank', () => {
    expect(resolveQuickBuild([fam('amp', '', 100)])).toEqual([{ slug: 'amp', name: 'Amp', page: 100 }]);
  });

  it('returns nothing for an empty roster', () => {
    expect(resolveQuickBuild([])).toEqual([]);
  });

  it('the curated list has unique slugs', () => {
    const slugs = QUICK_BUILD_BLOCKS.map((b) => b.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });
});

describe('quickBuild — first free cell (column-major, matches editor.firstEmptyCell)', () => {
  it('scans column-major and skips blocks + shunts', () => {
    const l = layout({ cells: [cell(0, 0, 1), cell(0, 1, 2)], shunts: [cell(1, 0, 1024, 'shunt')] });
    expect(quickBuildFirstFreeCell(l)).toEqual({ row: 1, col: 1 });
  });

  it('returns null when the grid is full', () => {
    const cells = [cell(0, 0, 1), cell(1, 0, 2), cell(0, 1, 3), cell(1, 1, 4), cell(0, 2, 5), cell(1, 2, 6)];
    expect(quickBuildFirstFreeCell(layout({ cells }))).toBeNull();
  });
});

describe('quickBuild — target decision (auto vs chosen, named refusals)', () => {
  it('auto target is the first free cell', () => {
    const p = quickBuildTarget(layout({ cells: [cell(0, 0, 1)] }));
    expect(p).toEqual({ ok: true, target: { row: 1, col: 0 }, auto: true });
  });

  it('honours a free chosen cell (auto=false)', () => {
    const p = quickBuildTarget(layout(), { row: 1, col: 2 });
    expect(p).toEqual({ ok: true, target: { row: 1, col: 2 }, auto: false });
  });

  it('refuses an occupied chosen cell with a named reason', () => {
    const p = quickBuildTarget(layout({ cells: [cell(1, 2, 7)] }), { row: 1, col: 2 });
    expect(p.ok).toBe(false);
    if (!p.ok) expect(p.reason).toMatch(/occupied/);
  });

  it('refuses an out-of-bounds chosen cell with a named reason', () => {
    const p = quickBuildTarget(layout(), { row: 5, col: 9 });
    expect(p.ok).toBe(false);
    if (!p.ok) expect(p.reason).toMatch(/outside/);
  });

  it('refuses when the grid is full (auto)', () => {
    const cells = [cell(0, 0, 1), cell(1, 0, 2), cell(0, 1, 3), cell(1, 1, 4), cell(0, 2, 5), cell(1, 2, 6)];
    const p = quickBuildTarget(layout({ cells }));
    expect(p.ok).toBe(false);
    if (!p.ok) expect(p.reason).toMatch(/full/);
  });
});

describe('quickBuild — placed detection (mirrors the palette)', () => {
  it('detects a placed family by its base page id', () => {
    expect(isQuickBuildPlaced([cell(0, 0, 100)], 100)).toBe(true);
    expect(isQuickBuildPlaced([cell(0, 0, 100)], 101)).toBe(false);
    expect(isQuickBuildPlaced([], 100)).toBe(false);
  });
});
