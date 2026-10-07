// Modifier CURVE read-back (parity audit §3.2 remainder).
//
// The decoded modifier assignment (PresetModifier, GET /preset/modifiers) carries the SOURCE →
// TARGET routing + slot, but NOT the per-slot curve values (min / max / start / mid / end / slope /
// scale / offset). Those live on the assignment's own modifier slot: the served param block
// (GET /preset/blocks/:eid/raw → values keyed by paramId), addressed ONLY through the served modifier
// model (GET /mod/model → fields[key].pid + kind). This module turns that (values, model) pair into a
// per-field read-back.
//
// HONESTY RULE: a curve field the served model/data does not expose — no model, no field def for the
// key, or no value served for its pid — stays `pending: true` with `pid: null` and `value: null`. It
// NEVER invents a paramId or a value. The UI renders pending fields as "pending decode".
//
// Kept free of Svelte/DOM so it is unit-testable in this repo's node-env vitest (the .svelte component
// cannot be mounted here).
import type { ModModel } from './types';

/** Wire max for normalized modifier params — matches ModifierEditorCore's read-back and the gen-3
 *  codec (0..65534). */
export const MOD_WIRE_MAX = 65534;

/** The curve/shape fields the editor renders, in display order (the subset of the editor's Vals that
 *  describe the response curve — NOT source/channel/PC-reset/damping/engage). */
export const MODIFIER_CURVE_FIELDS = ['min', 'max', 'start', 'mid', 'end', 'slope', 'scale', 'offset'] as const;

export type ModifierCurveFieldKey = (typeof MODIFIER_CURVE_FIELDS)[number];

/** One curve field's live read-back. `pending` = the served model/data does not expose it. */
export interface CurveReadbackField {
  key: ModifierCurveFieldKey;
  /** UI value (norm/bipolar → 0..100; ordinal/ref → the raw integer). Null when not exposed. */
  value: number | null;
  /** The served paramId the value came from, or null when the model exposes no pid for the field. */
  pid: number | null;
  /** True when the served model/data does NOT expose this field → render "pending decode". */
  pending: boolean;
}

const clampPct = (n: number) => Math.max(0, Math.min(100, n));

/**
 * Decode a served modifier slot's raw values + the served modifier model into per-field curve
 * read-back. `values` is the raw block map (paramId → wire value); `model` is the served address model
 * (`GET /mod/model`). Pure + total: a missing model / field def / value yields a pending field — never
 * a guessed pid or value. Order follows MODIFIER_CURVE_FIELDS.
 */
export function decodeModifierCurve(
  values: Record<string, number> | null | undefined,
  model: ModModel | null | undefined
): CurveReadbackField[] {
  return MODIFIER_CURVE_FIELDS.map((key) => {
    const f = model?.fields?.[key];
    if (!f || f.pid == null) return { key, value: null, pid: null, pending: true };
    const w = values?.[f.pid];
    if (w == null) return { key, value: null, pid: f.pid, pending: true };
    const value =
      f.kind === 'ordinal' || f.kind === 'ref' ? Math.round(w) : clampPct(Math.round((w / MOD_WIRE_MAX) * 100));
    return { key, value, pid: f.pid, pending: false };
  });
}

/** True when at least one curve field was actually read from the served data. */
export function hasCurveReadback(fields: readonly CurveReadbackField[]): boolean {
  return fields.some((f) => !f.pending);
}

/** How many curve fields were read vs the total rendered (for a disclosure like "6/8 fields read"). */
export function curveReadbackCount(fields: readonly CurveReadbackField[]): { read: number; total: number } {
  let read = 0;
  for (const f of fields) if (!f.pending) read++;
  return { read, total: fields.length };
}

/** Format a curve field's value for display (mirrors the editor's knob labels), or the honest
 *  "pending decode" when the value is not exposed. */
export function formatCurveField(key: ModifierCurveFieldKey, value: number | null): string {
  if (value == null) return 'pending decode';
  if (key === 'slope') return ((value - 50) / 12.5).toFixed(1);
  if (key === 'offset') {
    const n = Math.round(value - 50);
    return (n > 0 ? '+' : '') + n;
  }
  return Math.round(value) + '%';
}
