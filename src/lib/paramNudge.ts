// Parameter value-nudge planner (parity audit §2.12 — the ↑/↓ arrow shortcuts).
//
// FM3-Edit nudges the currently selected parameter with the arrow keys. Axis has no "selected
// parameter" write action of its own, so this module is the HONEST, framework-free core: given the
// open block's SERVED parameter metadata it returns the single next value (never a wire op, never an
// invented step). The thin store/page wiring (`editor.nudgeParam`, routes/+page.svelte) applies the
// result through the EXISTING setParam/setEnum actions — exactly the two writes the app already uses.
//
// STEP SIZE — derived, not invented. No per-param step is served on the param DTO (NamedParam carries
// only {value, norm, min, max, unit, log}); the ForgeFX catalog's own `step` field is not part of the
// editor's served metadata. So "one step" is defined as ONE UNIT OF THE SERVED DISPLAY VALUE:
//   • a calibrated knob (min/max served, max > min): the norm delta that moves the displayed value by
//     1 — linear `1/(max−min)`, or the geometric equivalent on a log taper (min > 0);
//   • an uncalibrated knob (no usable range): 1 unit on the shared 0..10 knob scale the formatter
//     documents (format.ts — paramValue() reads `norm*10`), i.e. 0.1 in norm;
//   • an enum/discrete param: the adjacent entry in the SERVED options (ordinal) list.
// When no next value exists (already at the end, a single-option enum, or an unknown current value)
// the planner returns null and the caller lets the key through — it never fakes a step.
import { paramValue } from './format';
import type { NamedParam, EnumParam } from './types';

/** One unit of the shared 0..10 knob scale (format.ts) = 0.1 in normalized space. */
export const UNCALIBRATED_STEP = 0.1;

export type NudgePlan =
  | { kind: 'param'; param: NamedParam; norm: number }
  | { kind: 'enum'; enum: EnumParam; value: number };

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

/** The normalized step for one unit of the served display value (see the header note). */
export function stepNorm(p: { norm?: number; min?: number; max?: number; log?: boolean }): number {
  if (p.min == null || p.max == null || !(p.max > p.min)) return UNCALIBRATED_STEP;
  if (p.log && p.min > 0) {
    // Geometric taper: one value unit is a value-relative fraction, so the norm delta depends on
    // where the knob currently sits. Use the current display value (clamped to the floor).
    const v = Math.max(paramValue({ norm: p.norm, min: p.min, max: p.max, log: true }), p.min);
    return Math.log((v + 1) / v) / Math.log(p.max / p.min);
  }
  return 1 / (p.max - p.min);
}

/** Nudge a continuous knob by one step. Null when the knob has no id or is already at the end. */
export function nudgeNamed(p: NamedParam, dir: 1 | -1): NudgePlan | null {
  if (p.id == null) return null;
  const norm = clamp01(p.norm ?? 0);
  const step = stepNorm(p);
  if (!(step > 0)) return null;
  const next = clamp01(norm + dir * step);
  if (next === norm) return null; // clamped to the same position → nothing to nudge
  return { kind: 'param', param: p, norm: next };
}

/** Step a discrete param by one entry in its served options (ordinal) list. */
export function nudgeEnum(e: EnumParam, dir: 1 | -1): NudgePlan | null {
  const i = e.options.findIndex((o) => o.value === e.value);
  if (i < 0) return null; // current value is not in the served list — cannot define "one step"
  const j = i + dir;
  if (j < 0 || j >= e.options.length) return null;
  return { kind: 'enum', enum: e, value: e.options[j].value };
}

/**
 * Resolve the nudge target and its next value. `selectedId` is the parameter the user last selected
 * in the open block editor (may be null → fall back to the block's primary control: the first
 * continuous param, else the first discrete one). Returns null when there is nothing to nudge.
 */
export function planNudge(
  params: NamedParam[],
  enums: EnumParam[],
  selectedId: number | null,
  dir: 1 | -1
): NudgePlan | null {
  if (selectedId != null) {
    const p = params.find((x) => x.id === selectedId);
    if (p) return nudgeNamed(p, dir);
    const e = enums.find((x) => x.id === selectedId);
    if (e) return nudgeEnum(e, dir);
  }
  if (params.length) return nudgeNamed(params[0], dir);
  if (enums.length) return nudgeEnum(enums[0], dir);
  return null;
}
