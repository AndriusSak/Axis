// Channel operations that SPAN scenes and blocks (parity audit §2.10 remainder).
//
// Two operations, neither of which has a dedicated wire op in the ForgeFX write protocol:
//
//   (a) setChannelAcrossScenes — set the open block's channel in EVERY scene
//   (b) copyChannelAcrossBlocks — paste one block's captured channel onto a DIFFERENT block
//
// Both are CLIENT-SIDE SEQUENCES over endpoints that already exist (the same ones sceneOps.ts uses):
//
//   POST /scene                          — switch the active scene (0-based)
//   POST /preset/blocks/:eid/channel     — write one block's channel in the active scene
//   PUT  /preset/blocks/:eid/params/:paramId — write one per-block parameter (channel values)
//
// No new server route, no invented eid/paramId. Extracted into a plain module because this repo's
// node-env vitest cannot mount .svelte components; the store (editor.svelte.ts) and the Block Editor
// footer only bind these functions to `forgefx` + the editor store.
//
// ── Honesty ──
//   • (a) writes the channel in EVERY scene unconditionally (the channel is per-scene state, so a
//     write is the only way to set it); a per-scene failure is counted, never fatal. The device is
//     ALWAYS returned to the scene the user was on — if that restore itself fails it is reported
//     (`restoreOk:false`), never silently swallowed.
//   • (b) reuses blockOps' captureChannel/pasteChannelWrites, so the client-side semantics (ids the
//     target block does not expose are dropped) are identical to the existing footer paste; the
//     difference is that this path REPORTS what was written, dropped and failed instead of assuming
//     success. A same-block target is refused (there is nothing to copy across).

import { pasteChannelWrites, type ChannelClip, type ParamWrite } from './blockOps';
import type { NamedParam, EnumParam } from './types';

const msg = (e: unknown): string => (e instanceof Error ? e.message : String(e));

// ── (a) set the open block's channel in EVERY scene ─────────────────────────────────────────────

/** One step: switch to `scene` (0-based) and set `effectId`'s channel there. */
export interface ChannelSceneStep {
  scene: number;
  effectId: number;
  channel: string;
}

/** The two device operations the across-scenes sequence composes. Backed by `forgefx` in the store. */
export interface ChannelSceneIo {
  /** Switch the active scene (0-based). */
  setScene(index: number): Promise<unknown>;
  /** Write one block's channel in the ACTIVE scene (POST /preset/blocks/:eid/channel). */
  setChannel(effectId: number, channel: string): Promise<unknown>;
}

export interface ChannelSceneFailure {
  /** 0-based scene index. */
  scene: number;
  /** Which step of the sequence failed. */
  stage: 'scene' | 'channel';
  message: string;
}

export interface ChannelSceneReport {
  /** Scenes (0-based, ascending) where the channel write succeeded. */
  written: number[];
  /** Scenes (0-based, ascending) that did NOT take the channel write. */
  failed: number[];
  /** Per-failure detail (stage + message). */
  failures: ChannelSceneFailure[];
  /** The scene the device was on when the run started (0-based). */
  origin: number;
  /** True when the device was returned to `origin`; false when the restore write itself failed. */
  restoreOk: boolean;
}

/**
 * Plan one write per scene for `effectId`'s channel. Empty when there is no channel to set, no valid
 * effectId, or no scenes — the caller never issues a device write in that case.
 */
export function planSetChannelAcrossScenes(effectId: number, channel: string, sceneCount: number): ChannelSceneStep[] {
  const n = Math.max(0, Math.floor(sceneCount));
  if (!channel || !Number.isFinite(effectId) || n === 0) return [];
  const steps: ChannelSceneStep[] = [];
  for (let scene = 0; scene < n; scene++) steps.push({ scene, effectId, channel });
  return steps;
}

/**
 * Execute the across-scenes plan: switch to each scene, write the channel, then restore `origin`.
 *
 * A failed scene SWITCH skips that scene's channel write (the device is on an unknown scene — writing
 * would hit the wrong block). A failed channel write is counted, never fatal. The restore is ALWAYS
 * attempted when any scene was switched; its own failure is reported via `restoreOk:false` and a
 * `failures` entry, so a partial run never leaves the caller believing the device is home when it is not.
 */
export async function applySetChannelAcrossScenes(
  plan: ChannelSceneStep[],
  io: ChannelSceneIo,
  origin: number
): Promise<ChannelSceneReport> {
  const written: number[] = [];
  const failed: number[] = [];
  const failures: ChannelSceneFailure[] = [];
  for (const step of plan) {
    try {
      await io.setScene(step.scene);
    } catch (e) {
      failed.push(step.scene);
      failures.push({ scene: step.scene, stage: 'scene', message: msg(e) });
      continue;
    }
    try {
      await io.setChannel(step.effectId, step.channel);
      written.push(step.scene);
    } catch (e) {
      failed.push(step.scene);
      failures.push({ scene: step.scene, stage: 'channel', message: msg(e) });
    }
  }
  let restoreOk = true;
  if (plan.length) {
    try {
      await io.setScene(origin);
    } catch (e) {
      restoreOk = false;
      failures.push({ scene: origin, stage: 'scene', message: msg(e) });
    }
  }
  return { written, failed, failures, origin, restoreOk };
}

// ── (b) copy one block's channel onto a DIFFERENT block's channel ───────────────────────────────

export interface ChannelBlockCopyPlan {
  /** The block the clip was captured from. */
  sourceEffectId: number;
  /** The block the clip will be written to. */
  targetEffectId: number;
  /** The target block's current channel (shown in the report/toast), or null when unknown. */
  targetChannel: string | null;
  /** The per-param writes (knobs as norm, enums as ordinal), already filtered to exposed ids. */
  writes: ParamWrite[];
  /** Captured values the target block does not expose (dropped — reported, never silently lost). */
  dropped: number;
  /** True when source and target are the same block (the plan is then empty). */
  sameBlock: boolean;
}

/** The write operation the across-blocks sequence uses. Backed by `forgefx` in the store. */
export interface ChannelBlockCopyIo {
  setParam(effectId: number, paramId: number, value: number, continuous: boolean): Promise<unknown>;
}

export interface ChannelBlockCopyFailure {
  paramId: number;
  name: string;
  message: string;
}

export interface ChannelBlockCopyReport {
  /** Values written successfully. */
  ok: number;
  /** Values the device rejected. */
  failed: number;
  /** Captured values the target block does not expose (never attempted). */
  dropped: number;
  failures: ChannelBlockCopyFailure[];
}

/**
 * Plan pasting a captured clip onto a DIFFERENT block's channel. Reuses pasteChannelWrites so the
 * id-matching semantics are identical to the existing footer paste; `dropped` is the honest count of
 * captured values the target block cannot take. A same-block target yields an empty plan.
 */
export function planCopyChannelAcrossBlocks(
  clip: ChannelClip,
  sourceEffectId: number,
  targetEffectId: number,
  targetChannel: string | null,
  targetParams: NamedParam[],
  targetEnums: EnumParam[]
): ChannelBlockCopyPlan {
  const sameBlock = sourceEffectId === targetEffectId;
  if (sameBlock) {
    return { sourceEffectId, targetEffectId, targetChannel, writes: [], dropped: 0, sameBlock: true };
  }
  const writes = pasteChannelWrites(clip, targetParams, targetEnums);
  const captured = clip.knobs.length + clip.enums.length;
  return { sourceEffectId, targetEffectId, targetChannel, writes, dropped: Math.max(0, captured - writes.length), sameBlock: false };
}

/**
 * Execute the across-blocks plan: write each value through the per-block param PUT. A per-param
 * failure is counted with its message, never fatal — the remaining values still write. `dropped` is
 * carried through so the caller can report exactly what did NOT make it.
 */
export async function applyCopyChannelAcrossBlocks(
  plan: ChannelBlockCopyPlan,
  io: ChannelBlockCopyIo
): Promise<ChannelBlockCopyReport> {
  const failures: ChannelBlockCopyFailure[] = [];
  let ok = 0;
  for (const w of plan.writes) {
    try {
      await io.setParam(plan.targetEffectId, w.paramId, w.value, w.continuous);
      ok++;
    } catch (e) {
      failures.push({ paramId: w.paramId, name: w.name, message: msg(e) });
    }
  }
  return { ok, failed: failures.length, dropped: plan.dropped, failures };
}
