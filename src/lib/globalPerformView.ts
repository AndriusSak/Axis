// Presentation model for the GLOBAL PERFORMANCE PAGE — the ten controls stored in the unit's GLOBAL
// settings rather than in a preset (ForgeFX `GET /global/perform`, MEASURED on hardware 2026-10-30).
//
// Kept a plain TS module (no Svelte, no editor import) so the node-env vitest can pin the two rules that
// matter:
//
//  1. UNASSIGNED IS NOT A NAME. A slot with effectId 0 has no control behind it; whatever text the record
//     still holds must never be rendered as if it named something.
//  2. NO PAGE IS NOT TEN EMPTY SLOTS. A device (or an old server) that cannot read the page yields no
//     rows at all, so the panel can say "not available" instead of drawing a fabricated page.
import type { GlobalPerformPage } from './types';

/** One row as the panel renders it. `slot` is 1-based (the editor's numbering). */
export interface GlobalPerformRow {
  slot: number;
  assigned: boolean;
  effectId: number;
  paramId: number;
  effectLabel: string;
  paramLabel: string;
}

/** Build the renderable rows. An absent page yields `[]` — never a fabricated ten. */
export function globalPerformRows(page: GlobalPerformPage | null | undefined): GlobalPerformRow[] {
  if (!page?.slots) return [];
  return page.slots.map((s, i) => {
    const assigned = s.effectId !== 0;
    return {
      slot: i + 1,
      assigned,
      effectId: s.effectId,
      paramId: s.paramId,
      effectLabel: assigned ? s.effectLabel : '',
      paramLabel: assigned ? s.paramLabel : ''
    };
  });
}

/** How many of the page's slots point at a control. */
export function globalAssignedCount(page: GlobalPerformPage | null | undefined): number {
  return globalPerformRows(page).filter((r) => r.assigned).length;
}

/**
 * True when the page names a target the rows do NOT describe — ids present but the label block empty.
 * That is what a half-written slot looks like (ids written, labels not), and the panel says so instead of
 * showing a control with a blank name as if it were merely unnamed.
 */
export function globalPageHasUnlabelledSlots(page: GlobalPerformPage | null | undefined): boolean {
  if (!page?.slots) return false;
  return page.slots.some((s) => s.effectId !== 0 && !s.effectLabel);
}
