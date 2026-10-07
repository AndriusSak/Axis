// Parameter-VALUE clipboard (parity audit §2.11 remainder) — copy ONE served parameter's value from
// a block and paste it onto another block, keyed by the DEVICE paramId.
//
// Semantics deliberately mirror blockOps' channel copy/paste and channelOps' across-blocks copy:
// the value is snapshotted from the served param (a knob by its normalized 0..1 value, an enum by its
// ordinal) and written back through the EXISTING per-block param PUT
// (PUT /preset/blocks/:eid/params/:paramId). No new server route, no invented paramId.
//
// ── Honesty ──
//   • The paste key is the device paramId, never a display label. A param that carries no id cannot
//     be captured (returns null) — it is not guessed.
//   • An id the TARGET block does not expose is DROPPED and reported, never coerced onto a
//     lookalike label or written blindly. A continuous value is only written to a continuous param
//     (knob) and a discrete value only to a discrete one (enum) — pasting a knob's 0..1 norm onto an
//     enum ordinal would write a wrong value, so a kind mismatch is a drop, not a write.
//
// Pure + dependency-free (this repo's node-env vitest cannot mount .svelte components), with an
// injectable IO so the one device write is provable with a mock and no hardware.

import type { NamedParam, EnumParam } from './types';
import type { ParamWrite } from './blockOps';

/** A single parameter VALUE copied for pasting onto another block. */
export interface ParamValueClip {
  /** Device-true paramId — the paste key. Never invented. */
  paramId: number;
  /** Source param display label (for the toast). */
  name: string;
  /** The captured value: normalized 0..1 for a knob, the enum ordinal for a discrete param. */
  value: number;
  /** true = continuous (knob, `value` is norm 0..1); false = discrete (enum ordinal). */
  continuous: boolean;
  /** Source block display name (toast only). */
  block: string;
}

/** Snapshot a single served param's value. Returns null when the param carries no device paramId
 *  (it cannot be written back — never guessed). `continuous` picks which field is the value. */
export function captureParamValue(
  p: { id?: number; name: string; value: number; norm?: number },
  block: string,
  continuous: boolean
): ParamValueClip | null {
  if (p.id == null) return null;
  return { paramId: p.id, name: p.name, value: continuous ? (p.norm ?? 0) : p.value, continuous, block };
}

/** The result of matching a clip against a target block's served params. */
export interface ParamPastePlan {
  /** The write to apply, or null when the target block does not expose the copied paramId. */
  write: ParamWrite | null;
  /** True when the copied paramId is absent from the target block (dropped — never guessed). */
  dropped: boolean;
  /** Human reason when dropped (names the param + id); null otherwise. */
  reason: string | null;
}

/**
 * Plan pasting a clip onto a target block: match by device paramId AND kind. A knob clip only matches
 * a target knob (continuous), an enum clip only a target enum (discrete). No match → dropped with a
 * precise reason (the target does not expose that id), never a blind write.
 */
export function planParamPaste(
  clip: ParamValueClip,
  targetParams: NamedParam[],
  targetEnums: EnumParam[]
): ParamPastePlan {
  if (clip.continuous) {
    const hit = targetParams.find((p) => p.id === clip.paramId);
    if (!hit) return { write: null, dropped: true, reason: `block does not expose “${clip.name}” (paramId ${clip.paramId})` };
    return { write: { paramId: clip.paramId, value: clip.value, continuous: true, name: clip.name }, dropped: false, reason: null };
  }
  const hit = targetEnums.find((e) => e.id === clip.paramId);
  if (!hit) return { write: null, dropped: true, reason: `block does not expose “${clip.name}” (paramId ${clip.paramId})` };
  return { write: { paramId: clip.paramId, value: clip.value, continuous: false, name: clip.name }, dropped: false, reason: null };
}

/** The one device operation the paste composes. Backed by `forgefx` in the store. */
export interface ParamPasteIo {
  setParam(effectId: number, paramId: number, value: number, continuous: boolean): Promise<unknown>;
}

export interface ParamPasteReport {
  /** True when a value was written. */
  ok: boolean;
  /** True when the target block does not expose the copied paramId (nothing was attempted). */
  dropped: boolean;
  /** The drop reason when `dropped`; null otherwise. */
  reason: string | null;
  /** The device error when the write failed; null otherwise. */
  error: string | null;
}

/** Execute the plan: write the matched value through the per-block param PUT. A dropped plan issues
 *  NO device write and returns the reason; a rejected write returns the error. */
export async function applyParamPaste(
  plan: ParamPastePlan,
  effectId: number,
  io: ParamPasteIo
): Promise<ParamPasteReport> {
  if (!plan.write) return { ok: false, dropped: plan.dropped, reason: plan.reason, error: null };
  try {
    await io.setParam(effectId, plan.write.paramId, plan.write.value, plan.write.continuous);
    return { ok: true, dropped: false, reason: null, error: null };
  } catch (e) {
    return { ok: false, dropped: false, reason: null, error: e instanceof Error ? e.message : String(e) };
  }
}
