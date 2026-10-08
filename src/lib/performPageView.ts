// Presentation model for the device's PER-PRESET PERFORMANCE PAGE (§2.2), read-only from ForgeFX
// `GET /preset/perform` (see `forgefx.performPage()`).
//
// Kept a plain TS module (no Svelte, no editor import) so this repo's node-env vitest can cover the
// HONESTY RULE without mounting a component: a slot with effectId 0 is UNASSIGNED, and the body still
// carries STALE leftover label text from whatever last occupied it (measured: "ate" from "Rate"). The
// display must therefore blank the labels of an unassigned slot — showing them would present a dead
// string as if it named a live control.
import type { PerformPage } from './types';

/** One row of the page as the UI renders it: labels are EMPTY when the slot is unassigned. */
export interface PerformRow {
  /** 1-based slot number (the editor's own numbering). */
  slot: number;
  /** True when the slot points at a real control (effectId !== 0). */
  assigned: boolean;
  /** Raw effect id (0 when unassigned) — shown for honesty/debugging. */
  effectId: number;
  /** Raw param id (0 when unassigned). */
  paramId: number;
  /** Effect label, or '' when the slot is unassigned (stale text is never surfaced). */
  effectLabel: string;
  /** Param label, or '' when the slot is unassigned (stale text is never surfaced). */
  paramLabel: string;
}

/** Build the renderable rows from a page. A null/absent page (no page, or a device that can't read
 *  it) yields no rows — never a fabricated ten. */
export function performPageRows(page: PerformPage | null | undefined): PerformRow[] {
  if (!page) return [];
  return page.slots.map((s) => {
    const assigned = s.effectId !== 0;
    return {
      slot: s.slot,
      assigned,
      effectId: s.effectId,
      paramId: s.paramId,
      effectLabel: assigned ? s.effectLabel : '',
      paramLabel: assigned ? s.paramLabel : ''
    };
  });
}

/** How many slots are assigned — from the server's own `assigned`, else counted from the rows. */
export function assignedCount(page: PerformPage | null | undefined): number {
  if (!page) return 0;
  if (Number.isInteger(page.assigned)) return page.assigned;
  return page.slots.filter((s) => s.effectId !== 0).length;
}
