// Presentation model for the device's PER-PRESET PERFORMANCE PAGE (§2.2), read-only from ForgeFX
// `GET /preset/perform` (see `forgefx.performPage()`).
//
// Kept a plain TS module (no Svelte, no editor import) so this repo's node-env vitest can cover the
// HONESTY RULE without mounting a component: a slot with effectId 0 is UNASSIGNED, and the body still
// carries STALE leftover label text from whatever last occupied it (measured: "ate" from "Rate"). The
// display must therefore blank the labels of an unassigned slot — showing them would present a dead
// string as if it named a live control.
import type { PerformPage, PerformSlotPatch } from './types';

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

/** The raw editor fields for one slot write, as the panel's inputs hold them (all strings). */
export interface PerformSlotFields {
  effectId: string;
  paramId: string;
  effectLabel: string;
  paramLabel: string;
}

/**
 * Turn the panel's raw inputs into the write payload, or `null` when there is nothing to send.
 *
 * Two rules the UI must not get wrong:
 *  • an EMPTY text input means "leave this field alone", never "write an empty label" — a blank label
 *    is indistinguishable from the stale text an unassigned slot carries anyway, so it can only lose
 *    information;
 *  • an id must be a whole number in the codec's 14-bit space, and a NON-numeric id is dropped for the
 *    same reason — the server answers 400, but a UI that sends it is a UI that lies about what it did.
 *
 * Returns null (rather than {}) when every field is empty, so the caller can refuse to send rather
 * than have the server reject an empty patch.
 */
export function patchFromFields(f: PerformSlotFields): PerformSlotPatch | null {
  const patch: PerformSlotPatch = {};
  const id = (v: string): number | undefined => {
    const t = v.trim();
    return /^\d+$/.test(t) && Number(t) <= 0x3fff ? Number(t) : undefined;
  };
  const effectId = id(f.effectId);
  const paramId = id(f.paramId);
  if (effectId !== undefined) patch.effectId = effectId;
  if (paramId !== undefined) patch.paramId = paramId;
  if (f.effectLabel.trim()) patch.effectLabel = f.effectLabel.trim();
  if (f.paramLabel.trim()) patch.paramLabel = f.paramLabel.trim();
  return Object.keys(patch).length ? patch : null;
}

/** Which label input a slot's id change invalidates: the effect id change invalidates the effect
 *  label, the param id change the param label. */
export type PerformLabelField = 'effectLabel' | 'paramLabel';

/** The next editor state after an id change: the field values to show, plus which label was CLEARED. */
export interface PerformLabelClear {
  /** The editor fields to show next — the stale label blanked when it was non-empty, else untouched. */
  fields: PerformSlotFields;
  /** The label field this change cleared, or '' when there was nothing to clear. */
  cleared: PerformLabelField | '';
}

/**
 * Changing a TARGET clears the label that names it. This is the write-side defect the 2026-10-08 round
 * trip produced for real: a slot's ids moved while its label stayed, so the page displayed "Master
 * Volume" pointing at Cab proximity — structurally valid, and a lie. The label inputs are prefilled
 * from the row being edited, so without this an id-only edit silently re-writes the OLD name onto the
 * NEW target, and the read-back CONFIRMS it (what was written is what reads back). A label must be
 * re-entered deliberately.
 *
 * `cleared` is '' (and the fields untouched) when the label was ALREADY empty — an empty label names
 * nothing, so there is nothing to clear and no notice to raise.
 */
export function clearLabelOnTargetChange(f: PerformSlotFields, which: PerformLabelField): PerformLabelClear {
  if (f[which] === '') return { fields: f, cleared: '' };
  return { fields: { ...f, [which]: '' }, cleared: which };
}

/** A one-line, honest summary of a write verdict — the `reason` when it was not confirmed. */
export function writeVerdict(result: { ok: boolean; reason?: string }): string {
  if (result.ok) return 'Written to the unit’s edit buffer (not saved — reloading the preset discards it).';
  return `NOT confirmed by the unit${result.reason ? ` (${result.reason})` : ''} — the slot still reads as shown.`;
}
