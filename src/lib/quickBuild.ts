// Quick Build panel (parity audit §2.9) — the FM3-Edit "Quick Build" block PLACEMENT surface.
//
// FM3-Edit's Quick Build panel is a curated one-click builder: pick a common block and it is dropped
// onto the grid without opening the full searchable palette. Axis already has the searchable Cmd+K
// command palette (CommandPalette.svelte) for arbitrary placement; this module backs a small curated
// panel that places the everyday building blocks in one click.
//
// PLACEMENT REUSE RULE: this module only DECIDES a target cell (and refuses with a named reason when
// none is available) — it never places. The panel calls the EXISTING grid placement op
// (`editor.place` → `forgefx.placeCell`), the same path the palette uses. No second placement path.
//
// Everything here is pure + dependency-free (the paletteRows.ts / gridRouting.ts pattern) so it is
// unit-testable under this repo's node-env vitest; the .svelte hookup is pinned by a source-guard test.

import type { Cell, Layout } from './grid';

/** One curated Quick Build block: the editor "pack" slug the served roster addresses families by,
 *  plus the canonical button label (the served roster name wins when present). */
export interface QuickBuildEntry {
  slug: string;
  name: string;
}

/**
 * The curated shortlist, ordered roughly along the signal chain. Slugs are the authoritative editor
 * pack keys (forgefx-midi gen-3 `BASE_SLUG`) — a served family whose slug is not listed is simply not
 * offered here (this is a curated shortlist, not the full roster; the palette covers the rest).
 */
export const QUICK_BUILD_BLOCKS: readonly QuickBuildEntry[] = [
  { slug: 'gate', name: 'Gate' },
  { slug: 'comp', name: 'Compressor' },
  { slug: 'drive', name: 'Drive' },
  { slug: 'amp', name: 'Amp' },
  { slug: 'cab', name: 'Cab' },
  { slug: 'peq', name: 'Parametric EQ' },
  { slug: 'geq', name: 'Graphic EQ' },
  { slug: 'filter', name: 'Filter' },
  { slug: 'wah', name: 'Wah' },
  { slug: 'chorus', name: 'Chorus' },
  { slug: 'flanger', name: 'Flanger' },
  { slug: 'phaser', name: 'Phaser' },
  { slug: 'tremolo', name: 'Tremolo' },
  { slug: 'pitch', name: 'Pitch' },
  { slug: 'delay', name: 'Delay' },
  { slug: 'multitap', name: 'Multitap Delay' },
  { slug: 'reverb', name: 'Reverb' },
  { slug: 'volume', name: 'Volume/Pan' },
  { slug: 'looper', name: 'Looper' }
];

/** A served block family (`GET /blocks`), the roster Quick Build resolves its curated slugs against. */
export interface QuickBuildFamily {
  slug: string;
  name: string;
  page: number;
}

/** A placeable Quick Build row, resolved against the served roster (page = family base effect id). */
export interface QuickBuildRow {
  slug: string;
  name: string;
  page: number;
}

/**
 * Resolve the curated list against the SERVED roster, preserving the curated order and using the
 * served `page` (the effect id placement needs) + the served display name. Slugs absent from the
 * roster are omitted — a curated entry that this device has no family for is not placeable.
 */
export function resolveQuickBuild(
  families: readonly QuickBuildFamily[],
  curated: readonly QuickBuildEntry[] = QUICK_BUILD_BLOCKS
): QuickBuildRow[] {
  const bySlug = new Map<string, QuickBuildFamily>();
  for (const f of families) bySlug.set(f.slug.toLowerCase(), f);
  const rows: QuickBuildRow[] = [];
  for (const entry of curated) {
    const family = bySlug.get(entry.slug.toLowerCase());
    if (!family) continue;
    rows.push({ slug: family.slug, name: family.name || entry.name, page: family.page });
  }
  return rows;
}

/** A grid coordinate (0-indexed, matching the decoded layout — NOT the 1-indexed write API). */
export interface QuickBuildCell {
  row: number;
  col: number;
}

/** A placement decision: the resolved target cell, or a NAMED refusal (never a silent drop). */
export type QuickBuildPlacement =
  | { ok: true; target: QuickBuildCell; auto: boolean }
  | { ok: false; reason: string };

/** Set of occupied `"row,col"` keys over the placed blocks + shunts (matches editor.firstEmptyCell). */
export function occupiedKeys(cells: readonly { row: number; col: number }[]): Set<string> {
  return new Set(cells.map((c) => `${c.row},${c.col}`));
}

/**
 * First free cell of the grid, scanning column-major (outer col, inner row) — the SAME order
 * `editor.firstEmptyCell` uses, so Quick Build's automatic target matches the palette's. Returns null
 * when every cell is filled.
 */
export function quickBuildFirstFreeCell(
  layout: Pick<Layout, 'cells' | 'shunts' | 'rows' | 'cols'>
): QuickBuildCell | null {
  const filled = occupiedKeys([...layout.cells, ...layout.shunts]);
  for (let col = 0; col < layout.cols; col++)
    for (let row = 0; row < layout.rows; row++) if (!filled.has(`${row},${col}`)) return { row, col };
  return null;
}

/**
 * Decide where a Quick Build placement should land: a user-CHOSEN cell when one is supplied (it must be
 * in bounds and empty), else the first free cell. Refuses with a named reason — the panel surfaces it —
 * rather than dropping the click silently. `auto` is true for the first-free-cell case.
 */
export function quickBuildTarget(
  layout: Pick<Layout, 'cells' | 'shunts' | 'rows' | 'cols'>,
  chosen?: QuickBuildCell | null
): QuickBuildPlacement {
  if (chosen) {
    const inBounds = chosen.row >= 0 && chosen.row < layout.rows && chosen.col >= 0 && chosen.col < layout.cols;
    if (!inBounds) return { ok: false, reason: `cell ${chosen.row + 1},${chosen.col + 1} is outside the grid` };
    if (occupiedKeys([...layout.cells, ...layout.shunts]).has(`${chosen.row},${chosen.col}`))
      return { ok: false, reason: `cell ${chosen.row + 1},${chosen.col + 1} is occupied — pick an empty cell` };
    return { ok: true, target: chosen, auto: false };
  }
  const first = quickBuildFirstFreeCell(layout);
  if (!first) return { ok: false, reason: 'the grid is full — remove a block first' };
  return { ok: true, target: first, auto: true };
}

/**
 * True when a family is already on the grid. Mirrors the palette's `isPlaced` (CommandPalette.svelte):
 * a cell whose effectId equals the family base page id counts as placed, so the panel can grey the
 * entry out instead of offering a duplicate first instance.
 */
export function isQuickBuildPlaced(cells: readonly Cell[], page: number): boolean {
  return cells.some((c) => c.effectId === page);
}
