// Channel / block operations for the Block Editor footer — copy channel, paste channel,
// reset channel, reset block, and the Scene Ignore toggle.
//
// PURE module: this repo's vitest runs in a node environment and cannot mount .svelte components,
// so all the decision logic lives here (unit-tested) and `editor.svelte.ts` / `BlockEditor.svelte`
// are thin shells over it.
//
// ── What is REAL and what is not (honesty note — see docs/axis-fm3edit-feature-parity-audit.md §3.1) ──
//   • Copy/paste channel: real. A channel is snapshotted from the block's served params (knobs by
//     their normalized 0..1 value, enums by ordinal) keyed by the device-true paramId, then written
//     back through the existing per-block param PUT. Cross-family pastes drop ids the target block
//     does not expose.
//   • Scene Ignore: real. The FM3 catalog serves a per-family `<FAMILY>_SCENEIGNORE` enum
//     (27 families — CABINET pid 84, DELAY pid 83, DISTORT pid 137, …), so the footer toggles the
//     block's own served "Scene Ignore" selector. It is NOT invented.
//   • Mute: NO generic per-block mute parameter is served. A `grep -io '"[A-Z_0-9]*MUTE[A-Z_0-9]*"'
//     over forgefx-midi/catalog/fm3.json returns only family-specific rows — CABINET_MUTE1..4 /
//     CABINET_BTN_MUTE1..2 (per cab slot), MULTICOMP_MUTE1..3 (per multiband-comp band),
//     GLOBAL_TUNERMUTE and GLOBAL_REMOTE_MUTE (both global) — none is a generic block mute. The
//     footer therefore keeps Mute as a disabled control that says so; do NOT wire it to an invented
//     paramId. (Bypass is the served "silence this block" control and lives right beside it.)
//   • Reset channel / reset block: real, via the FM3's own model-reselect reset. Community-documented
//     behaviour: "a soft reset is done by simply going to the amp type drop down menu and reselecting
//     the current amp … if you have separate channels, you must do this for every channel"
//     (Fractal forum: "For Those Confused About Amp Resetting"). So `resetChannel` re-selects the
//     active channel's model ordinal (POST /preset/blocks/:eid/type) and `resetBlock` does that on
//     each of A–D. Both are existing per-block writes — no new server endpoint. The defaults are the
//     device's, not a client-side table (the served blockParams carries no default value).

import type { NamedParam, EnumParam } from './types';

/** A snapshot of one channel's writable parameter values. */
export interface ChannelClip {
  /** Block display name the clip came from (for the toast). */
  block: string;
  /** Source channel letter (A–D) or null when unknown. */
  channel: string | null;
  /** Continuous params: device paramId → normalized 0..1 (what `setParam(…, true)` expects). */
  knobs: { id: number; name: string; norm: number }[];
  /** Discrete params: device paramId → ordinal (what `setParam(…, false)` expects). */
  enums: { id: number; name: string; value: number }[];
}

/** One write to apply to a target block/channel. */
export interface ParamWrite {
  paramId: number;
  value: number;
  continuous: boolean;
  name: string;
}

/** Snapshot the given channel's params for a later paste. Only params carrying a device paramId AND a
 *  device-RESOLVED value are captured — a param without an id cannot be written back, and a param the
 *  device could not resolve (null norm/value, non-positional GLOBAL) must not be captured as a
 *  fabricated 0. */
export function captureChannel(
  block: string,
  channel: string | null,
  params: NamedParam[],
  enums: EnumParam[]
): ChannelClip {
  return {
    block,
    channel,
    knobs: params
      .filter((p) => p.id != null && p.norm != null)
      .map((p) => ({ id: p.id as number, name: p.name, norm: p.norm as number })),
    enums: enums.filter((e) => e.id != null && e.value != null).map((e) => ({ id: e.id, name: e.name, value: e.value as number }))
  };
}

/** Plan the writes that paste a clip onto a target block/channel: knobs go out continuous (norm),
 *  enums discrete (ordinal). Ids the target block does not expose are dropped (cross-family paste). */
export function pasteChannelWrites(clip: ChannelClip, params: NamedParam[], enums: EnumParam[]): ParamWrite[] {
  const knobIds = new Set(params.filter((p) => p.id != null).map((p) => p.id as number));
  const enumIds = new Set(enums.filter((e) => e.id != null).map((e) => e.id));
  const out: ParamWrite[] = [];
  for (const k of clip.knobs) {
    if (knobIds.has(k.id)) out.push({ paramId: k.id, value: k.norm, continuous: true, name: k.name });
  }
  for (const e of clip.enums) {
    if (enumIds.has(e.id)) out.push({ paramId: e.id, value: e.value, continuous: false, name: e.name });
  }
  return out;
}

/** The block's served "Scene Ignore" enum, or null when the family does not expose one. Matches the
 *  served display label (the server labels the `*_SCENEIGNORE` params "Scene Ignore"). */
export function sceneIgnoreParam(enums: EnumParam[]): EnumParam | null {
  return enums.find((e) => /^scene\s*ignore$/i.test(e.name.trim())) ?? null;
}

/** The ordinal to write for a Scene Ignore toggle: prefer the option whose label reads On/Yes; else
 *  the conventional 1 = on / 0 = off. */
export function sceneIgnoreValue(e: EnumParam, on: boolean): number {
  const wantOn = /^(on|yes|enabled|true)$/i;
  const wantOff = /^(off|no|disabled|false)$/i;
  const match = e.options.find((o) => (on ? wantOn : wantOff).test(o.label.trim()));
  if (match) return match.value;
  return on ? 1 : 0;
}

/** Whether a block can be reset by re-selecting its model. Blocks with no model/type selector (a
 *  plain GEQ/Volume block, or a virtual effect) have no reselect-to-default path. */
export function blockResettable(blockType: { value: number; name: string } | null | undefined): boolean {
  return blockType != null;
}

/** The channels a "reset block" sweeps — the FM3's four channels. */
export const BLOCK_CHANNELS = ['A', 'B', 'C', 'D'] as const;
