// "Reset AMP blocks per preset" — the other half of the "Manage Presets" librarian (parity audit §2.4),
// built on the SAME per-slot batch machinery `batchSetOps.ts` uses (scan → select → write → store).
//
// FM3-Edit's Manage Presets resets the AMP block(s) of each selected preset. There is NO wire op that
// resets a block, and the served block-params carry NO per-parameter DEFAULT value (see blockOps.ts —
// "the served blockParams carries no default value"), so a per-param "write every knob to its default"
// reset is NOT expressible. The honest, device-true reset IS: re-select the AMP block's own model/type
// ordinal (POST /preset/blocks/:eid/type) — the FM3 soft-resets a block to that model's defaults when
// its type is (re)selected. This is EXACTLY the mechanism the existing `resetChannel`/`resetBlock`
// (blockOps.ts) already use; no new endpoint and no client-side default table.
//
// So the operation is a client-side sequence, ONE PASS PER TARGET SLOT (the batchSetOps shape):
//
//   GET  /preset/locations                      — which slots exist / are non-empty
//   POST /preset/select                         — load the target slot into the edit buffer
//   GET  /preset/blocks                         — find the AMP block(s) in that preset
//   GET  /preset/blocks/:eid/params             — the block's current model ordinal (never invented)
//   POST /preset/blocks/:eid/type               — re-select it → device re-initialises to model defaults
//   POST /preset/store                          — overwrite the target slot with the reset buffer
//
// HONEST LIMITS: this resets the AMP block's ACTIVE channel (the model the device serves for that block);
// channels other than the active one are not swept (same limitation as the editor's `resetChannel`). A
// preset with no AMP block is left untouched and reported (never an error). This is DESTRUCTIVE: each
// target slot is overwritten. The caller previews (planResetAmp — a pure dry-run over an already-read
// locations scan) and requires an explicit confirm; the runner ABORTS on the first error, reports the
// slots already written, and re-selects the origin preset at the end.
//
// Pure + dependency-free (the batchSetOps.ts pattern); the panel wires the injected IO to `forgefx`.

import type { PresetLocations } from './types';
import {
  planBatchSet,
  type BatchSetRequest,
  type BatchSetSkipped,
  type BatchSetTarget
} from './batchSetOps';

/** One AMP block found in the currently-selected preset, with its current model ordinal. */
export interface ResetAmpBlock {
  /** The placed block's canonical address (gen-3 effectId). */
  eid: number;
  /** The model/type ordinal the block is currently on (device-true — never invented). */
  typeValue: number;
  /** Model display name, when the device serves one. Display only. */
  typeName?: string | null;
}

/** The device operations the sequence composes. Backed by `forgefx` in the panel. */
export interface ResetAmpIo {
  /** GET /preset/locations — the stored-slot name scan. */
  locations(): Promise<PresetLocations>;
  /** POST /preset/select — load a slot into the edit buffer. */
  select(number: number): Promise<unknown>;
  /** The AMP block(s) in the CURRENTLY-SELECTED preset, each with its current model ordinal. */
  ampBlocks(): Promise<ResetAmpBlock[]>;
  /** POST /preset/blocks/:eid/type — re-select the model ordinal → device resets it to defaults. */
  resetAmpBlock(eid: number, typeValue: number): Promise<unknown>;
  /** POST /preset/store — overwrite the slot with the reset buffer. */
  store(number: number): Promise<unknown>;
}

/**
 * The dry-run result: exactly which slots a run WOULD overwrite. Built from an already-read locations
 * scan, so planning itself touches no device.
 */
export interface ResetAmpPreview {
  /** The slot selected BEFORE the run — re-selected at the end. null when unknown. */
  restoreTo: number | null;
  /** Slots that WILL be overwritten, ordered by location, de-duplicated. */
  targets: BatchSetTarget[];
  /** Requested slots left out, each with a reason. */
  skipped: BatchSetSkipped[];
  /** Non-null when the whole operation is blocked. */
  blocked: string | null;
}

/** Outcome of a run. `written` lists every slot fully reset AND stored, in completion order. */
export interface ResetAmpResult {
  ok: number;
  failed: number;
  /** Slots fully reset + stored before the run ended. Precise — on an abort these are the survivors. */
  written: number[];
  /** Total AMP blocks re-selected across all written slots. */
  resetBlocks: number;
  /** Slots that had NO AMP block — left untouched, never an error. */
  noAmp: number[];
  /** The slot where the run ABORTED on the first error, or null when every target succeeded. */
  abortedAt: number | null;
  error: string | null;
  restoreTo: number | null;
  restored: boolean;
}

// A trivially-addressable request — used ONLY to reuse planBatchSet's slot filtering (present / non-empty
// / dedupe / sort) verbatim, so the two ops can never drift on which slots qualify.
const SLOT_FILTER_REQUEST: BatchSetRequest = { eid: 0, paramId: 0, value: 0, continuous: true };

/**
 * Pure dry-run planner. Reuses `planBatchSet`'s slot filtering (an unaddressable request is impossible
 * here, so only the present / non-empty / dedupe / sort rules apply). A reset is always expressible via
 * the model re-select, so `blocked` is null unless the caller passes an empty slot list.
 */
export function planResetAmp(locations: PresetLocations, requested: number[], restoreTo: number | null): ResetAmpPreview {
  const filter = planBatchSet(locations, requested, SLOT_FILTER_REQUEST, restoreTo);
  return { restoreTo, targets: filter.targets, skipped: filter.skipped, blocked: filter.blocked };
}

/**
 * Execute the reset for each planned target. Per target: select → find AMP blocks → re-select each
 * model → store. A target with no AMP block is skipped (nothing to reset) and reported in `noAmp`.
 * Aborts on the FIRST error, reporting which slots were already written. The originally selected preset
 * is re-selected at the end, best-effort, on both success and abort.
 */
export async function runResetAmp(preview: ResetAmpPreview, io: ResetAmpIo): Promise<ResetAmpResult> {
  const written: number[] = [];
  const noAmp: number[] = [];
  let resetBlocks = 0;
  let abortedAt: number | null = null;
  let error: string | null = null;

  if (preview.blocked) {
    return { ok: 0, failed: 0, written, resetBlocks, noAmp, abortedAt: null, error: preview.blocked, restoreTo: preview.restoreTo, restored: false };
  }

  for (const target of preview.targets) {
    try {
      await io.select(target.location);
      const amps = await io.ampBlocks();
      if (!amps.length) {
        noAmp.push(target.location); // nothing to reset — leave the slot untouched, do not store
        continue;
      }
      for (const amp of amps) {
        await io.resetAmpBlock(amp.eid, amp.typeValue);
        resetBlocks++;
      }
      await io.store(target.location);
      written.push(target.location);
    } catch (e) {
      abortedAt = target.location;
      error = (e as Error)?.message || 'reset failed';
      break; // abort on the FIRST error — do not continue past a failed slot
    }
  }

  let restored = false;
  if (preview.restoreTo != null) {
    try {
      await io.select(preview.restoreTo);
      restored = true;
    } catch {
      /* best effort — a failed restore never invalidates the writes that already landed */
    }
  }

  return {
    ok: written.length,
    failed: abortedAt == null ? 0 : 1,
    written,
    resetBlocks,
    noAmp,
    abortedAt,
    error,
    restoreTo: preview.restoreTo,
    restored
  };
}

/** Convenience: scan → plan → run in one call. The caller that wants a preview calls the pieces. */
export async function resetAmpBlocksPerPreset(requested: number[], restoreTo: number | null, io: ResetAmpIo): Promise<ResetAmpResult> {
  const locations = await io.locations();
  return runResetAmp(planResetAmp(locations, requested, restoreTo), io);
}
