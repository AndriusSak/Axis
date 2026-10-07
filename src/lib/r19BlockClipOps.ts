// Cross-PRESET block paste (parity audit §2.10 remainder) — copy a block in one preset, switch the
// device to another preset, paste it there.
//
// ── What the existing in-memory block clipboard does when the preset changes (the audit question) ──
// `editor.blockClipboard` is NEVER cleared on a preset switch (only `copyBlock` assigns it), so the
// clipboard itself survives — but `pasteBlock` was written for the SAME preset: it places/addresses
// the SOURCE block's effectId and writes the SOURCE preset's captured paramIds straight back. After a
// preset switch that eid may belong to a different block (or be unplaced), and the source paramIds
// may not be served by the target block at all. So the paste silently targets the wrong block. This
// module makes the cross-preset path honest.
//
// ── How it stays honest ──
//   • The target effectId is decided against the TARGET preset's own layout: paste onto an existing
//     block addresses THAT block's eid; paste into an empty/shunt cell reuses the source eid when it is
//     FREE in the target preset, else picks a free instance of the SAME family from the served block
//     roster (a different instance, never a silent move of the existing block). When no instance is
//     free — or the family base cannot be resolved — the paste is GATED with a reason naming exactly
//     what is missing.
//   • After placing/retyping, the block's served params are RE-READ from the target preset and only
//     the ids it actually exposes are written; the rest are DROPPED and counted (the same rule as the
//     channel/recall paths). No invented paramId, no blind write.
//
// Pure decision + injectable IO (the channelOps.ts pattern) so the whole sequence is provable with a
// mock and no hardware. The store binds the IO to `forgefx` + its existing grid writers.

import type { NamedParam, EnumParam } from './types';
import { captureChannel, pasteChannelWrites, type ParamWrite } from './blockOps';

/** Instances a gen-3 block family can address (eid = base..base+3). The device profile's own cap is
 *  the final arbiter server-side; this only bounds the free-instance search. */
export const MAX_FAMILY_INSTANCES = 4;

/** The subset of the editor's block clipboard this planner reads (structurally `BlockClipboard`).
 *  Declared here so the pure module never imports back into the store. */
export interface BlockClipSource {
  /** The source block's effectId in ITS preset (the instance id we try to reuse on paste). */
  blockId: number;
  display: string;
  pack: string | null;
  type: { value: number; name: string } | null;
  channel?: string;
  /** The source block's served params (knobs) + enums, as captured by `copyBlock`. */
  named: NamedParam[];
  enums: EnumParam[];
}

/** A minimal projection of a grid cell the planner needs (positions + identity). */
export interface ClipRouteCell {
  row: number;
  col: number;
  kind: 'block' | 'shunt';
  effectId: number;
  display: string;
}

/** Where a cross-preset paste lands. */
export interface CrossPresetTarget {
  /** 'onto-block' = write settings onto the block already in the target cell; 'place' = place first. */
  mode: 'onto-block' | 'place';
  /** The effectId the settings are written to in the TARGET preset. */
  eid: number;
  row: number;
  col: number;
}

export interface CrossPresetBlockPlan {
  ok: boolean;
  /** Present when `ok === false` — a precise reason naming what is missing. */
  error?: string;
  target: CrossPresetTarget | null;
}

/** True when the clip was captured in a different device slot than the one now loaded. Unknown on
 *  either side (a local buffer, or a clip made before a slot was known) → false: the caller keeps the
 *  existing same-preset path rather than claiming a cross-preset guarantee it cannot verify. */
export function isCrossPreset(clipPreset: number | null | undefined, currentPreset: number | null | undefined): boolean {
  return clipPreset != null && currentPreset != null && clipPreset !== currentPreset;
}

/**
 * Decide where a cross-preset paste lands, purely from the TARGET preset's layout.
 *
 *   • target cell holds a block → 'onto-block' (address that block's eid; no placement).
 *   • target cell empty or a shunt → 'place'. The copied instance id is reused when it is FREE in the
 *     target preset; when it is already placed elsewhere, a free instance of the SAME family is picked
 *     from `familyBase` (the family's base eid, from the served block roster) so the paste still works
 *     without moving the existing block. When no instance is free — or the family base is unknown (the
 *     roster was not read) — it is GATED with a reason naming exactly what is missing.
 */
export function planCrossPresetBlockPaste(
  clip: BlockClipSource,
  cells: ClipRouteCell[],
  shunts: ClipRouteCell[],
  row: number,
  col: number,
  familyBase: number | null = null
): CrossPresetBlockPlan {
  const all = [...cells, ...shunts];
  const occ = all.find((c) => c.row === row && c.col === col);
  if (occ && occ.kind === 'block') {
    return { ok: true, target: { mode: 'onto-block', eid: occ.effectId, row, col } };
  }
  const used = new Set(all.map((c) => c.effectId));
  if (!used.has(clip.blockId)) {
    return { ok: true, target: { mode: 'place', eid: clip.blockId, row, col } };
  }
  // The copied instance id is taken. Pick a free instance of the SAME family when we know its base eid
  // (from the served block roster) — a different instance of the family, not a move of the existing one.
  if (familyBase != null && Number.isInteger(familyBase) && familyBase >= 0) {
    for (let k = 0; k < MAX_FAMILY_INSTANCES; k++) {
      const eid = familyBase + k;
      if (!used.has(eid)) return { ok: true, target: { mode: 'place', eid, row, col } };
    }
    return {
      ok: false,
      error: `all ${MAX_FAMILY_INSTANCES} instances of “${clip.display}”’s family (base eid ${familyBase}) are already placed in this preset — no free instance id to paste into`,
      target: null
    };
  }
  const clash = all.find((c) => c.effectId === clip.blockId)!;
  return {
    ok: false,
    error:
      `“${clip.display}”’s instance (eid ${clip.blockId}) is already placed at ` +
      `r${clash.row + 1}c${clash.col + 1} in this preset — a cross-preset paste needs a free instance id ` +
      `for the block’s family, which this path cannot pick without the served block roster’s family base`,
    target: null
  };
}

/**
 * The source values filtered to the TARGET block's served params: knobs continuous (norm), enums
 * discrete (ordinal). Reuses blockOps' captureChannel/pasteChannelWrites so the id-matching semantics
 * are identical to the existing channel paste; `dropped` is the honest count of captured values the
 * target block cannot take.
 */
export function crossPresetWrites(
  clip: BlockClipSource,
  targetParams: NamedParam[],
  targetEnums: EnumParam[]
): { writes: ParamWrite[]; dropped: number } {
  const channelClip = captureChannel(clip.display, clip.channel ?? null, clip.named ?? [], clip.enums ?? []);
  const writes = pasteChannelWrites(channelClip, targetParams, targetEnums);
  const captured = channelClip.knobs.length + channelClip.enums.length;
  return { writes, dropped: Math.max(0, captured - writes.length) };
}

/** The device operations the cross-preset paste composes. Backed by `forgefx` + the store's existing
 *  grid writers in the editor store. */
export interface CrossPresetBlockIo {
  /** Place a block at a cell (existing grid endpoint; reuses the store's place/shunt-replace path). */
  place(row: number, col: number, blockId: number): Promise<unknown>;
  /** Set the block's model type (existing per-block write; the params reset on retype). */
  setType(eid: number, value: number): Promise<unknown>;
  /** Read a block's served params in the CURRENT (target) preset. */
  blockParams(eid: number): Promise<{ named: NamedParam[]; enums: EnumParam[] }>;
  /** Write one param (existing per-block write). `continuous` is sent EXPLICITLY. */
  setParam(eid: number, paramId: number, value: number, continuous: boolean): Promise<unknown>;
}

export interface CrossPresetBlockFailure {
  paramId: number;
  name: string;
  message: string;
}

export interface CrossPresetBlockReport {
  ok: boolean;
  /** The gate reason (plan refused / a step failed), or null. */
  error: string | null;
  /** True when a block was placed into the target preset. */
  placed: boolean;
  /** The target block's effectId in the target preset (null when the plan was refused). */
  eid: number | null;
  /** Values written successfully. */
  written: number;
  /** Captured values the target block does not expose (never attempted). */
  dropped: number;
  /** Values the device rejected. */
  failed: number;
  failures: CrossPresetBlockFailure[];
}

const msg = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/**
 * Execute a cross-preset paste: place (when the plan says so) → set the model type → RE-READ the
 * target preset's served params → write only the ids it exposes → report dropped/failed.
 *
 * A refused plan issues NO device write. A failure in place/setType/blockParams aborts with the error
 * (nothing is half-written past a step that could not complete). A per-param write failure is counted,
 * never fatal — the remaining values still write.
 */
export async function applyCrossPresetBlockPaste(
  plan: CrossPresetBlockPlan,
  clip: BlockClipSource,
  io: CrossPresetBlockIo
): Promise<CrossPresetBlockReport> {
  if (!plan.ok || !plan.target) {
    return { ok: false, error: plan.error ?? 'cannot paste', placed: false, eid: null, written: 0, dropped: 0, failed: 0, failures: [] };
  }
  const { mode, eid, row, col } = plan.target;
  let placed = false;
  try {
    if (mode === 'place') {
      await io.place(row, col, eid);
      placed = true;
    }
    if (clip.type) await io.setType(eid, clip.type.value);
    // Re-read the TARGET preset's own served params for the block we addressed — the param set may
    // have changed (retype) and is the target's, not the source's.
    const r = await io.blockParams(eid);
    const { writes, dropped } = crossPresetWrites(clip, r.named ?? [], r.enums ?? []);
    const failures: CrossPresetBlockFailure[] = [];
    let written = 0;
    for (const w of writes) {
      try {
        await io.setParam(eid, w.paramId, w.value, w.continuous);
        written++;
      } catch (e) {
        failures.push({ paramId: w.paramId, name: w.name, message: msg(e) });
      }
    }
    return { ok: true, error: null, placed, eid, written, dropped, failed: failures.length, failures };
  } catch (e) {
    return { ok: false, error: msg(e), placed, eid, written: 0, dropped: 0, failed: 0, failures: [] };
  }
}
