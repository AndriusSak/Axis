// "Set a parameter in multiple presets" — apply ONE parameter value to MANY device slots
// (parity audit §2.11, the FM3-Edit hidden "Parameter Batch Set" / "Set In Multiple Presets").
//
// There is NO wire op that writes a parameter into a set of presets at once, and the FM3 exposes no
// cross-preset param write. So the operation is a CLIENT-SIDE SEQUENCE over the endpoints that DO
// exist, one pass PER TARGET SLOT:
//
//   GET  /preset/locations            — the stored-slot NAME scan (which slots exist / are non-empty)
//   POST /preset/select               — load the target slot into the edit buffer
//   PUT  /preset/blocks/:eid/params/:paramId — write the parameter in the edit buffer
//   POST /preset/store                — overwrite the target slot with the edited buffer
//
// The `continuous` flag is sent EXPLICITLY on every write. The server defaults an omitted flag to
// `false` (discrete), which CLAMPS a bare ordinal — so a knob write sent without `continuous: true`
// would silently write the wrong value. `BatchSetIo.setParam` therefore takes `continuous` as a
// required argument and the runner forwards the request's flag verbatim.
//
// This is DESTRUCTIVE: each target slot is overwritten. The caller must preview (planBatchSet, a pure
// dry-run over an already-read locations scan) and require an explicit confirm before running. The
// runner ABORTS on the first error and reports exactly which slots were already written; the
// originally selected preset is re-selected at the end whether the run succeeded or aborted.
//
// Extracted into a plain, dependency-free module (the sceneOps.ts pattern) because this repo's
// node-env vitest cannot mount .svelte components; the panel (AxisBatchSetPanel.svelte) only wires
// these functions to `forgefx` + the editor store.
//
// See docs/axis-fm3edit-feature-parity-audit.md §2.11 for the parity context.

import type { PresetLocations } from './types';

/** One slot the batch write would overwrite. */
export interface BatchSetTarget {
  /** 0-based device slot number (the value POST /preset/select + /preset/store take). */
  location: number;
  /** Bank-letter code the device reports (e.g. "C02"), or null. Display only. */
  code: string | null;
  /** Stored slot name. Display only. */
  name: string;
}

/** A requested slot that will NOT be written, with the precise reason. */
export interface BatchSetSkipped {
  location: number;
  reason: string;
}

/** The parameter write to apply to every target slot. */
export interface BatchSetRequest {
  /** The placed block's canonical address (gen-3 effectId / AM4 pidLow). */
  eid: number;
  /** Device-true paramId (never invented — the caller takes it from the served param list). */
  paramId: number;
  /** The value to write. continuous=true → normalized 0..1; false → enum ordinal. */
  value: number;
  /** Sent EXPLICITLY on the wire; an omitted flag means discrete and clamps a bare ordinal. */
  continuous: boolean;
  /** Human label for the preview (never sent to the device). */
  paramName?: string;
}

/**
 * The dry-run result: exactly what a run WOULD do. Built from an already-read locations scan, so
 * planning itself touches no device.
 */
export interface BatchSetPreview {
  request: BatchSetRequest;
  /** The slot that was selected BEFORE the run — re-selected at the end. null when unknown. */
  restoreTo: number | null;
  /** Slots that WILL be overwritten, ordered by location, de-duplicated. */
  targets: BatchSetTarget[];
  /** Requested slots left out, each with a reason. */
  skipped: BatchSetSkipped[];
  /** Non-null when the whole operation is blocked (the param cannot be addressed at all). */
  blocked: string | null;
}

/** The four device operations the sequence composes. Backed by `forgefx` in the panel. */
export interface BatchSetIo {
  /** GET /preset/locations — the stored-slot name scan. */
  locations(): Promise<PresetLocations>;
  /** POST /preset/select — load a slot into the edit buffer. */
  select(number: number): Promise<unknown>;
  /** PUT /preset/blocks/:eid/params/:paramId — write the param. `continuous` is REQUIRED and sent as-is. */
  setParam(eid: number, paramId: number, value: number, continuous: boolean): Promise<unknown>;
  /** POST /preset/store — overwrite the slot with the edit buffer. */
  store(number: number): Promise<unknown>;
}

/** Outcome of a run. `written` lists every slot fully written AND stored, in completion order. */
export interface BatchSetResult {
  ok: number;
  failed: number;
  /** Slots fully written + stored before the run ended. Precise — on an abort these are the survivors. */
  written: number[];
  /** The slot where the run ABORTED on the first error, or null when every target succeeded. */
  abortedAt: number | null;
  /** The error message from the aborting slot, or null. */
  error: string | null;
  /** The originally selected preset (re-selected at the end). */
  restoreTo: number | null;
  /** True when the originally selected preset was successfully re-selected. */
  restored: boolean;
}

const isLocation = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n) && n >= 0;

/** True when the (eid, paramId) pair is addressable at all (never invent an id). */
export function canBatchSet(eid: number, paramId: number): boolean {
  return Number.isInteger(eid) && eid >= 0 && Number.isInteger(paramId) && paramId >= 0;
}

/**
 * Pure dry-run planner. Given the device's stored-location scan and the requested slot numbers,
 * decide exactly which slots would be overwritten and which are left out (with a reason). An
 * unaddressable param blocks the whole operation rather than writing into random slots.
 *
 * A currently-selected slot IS allowed as a target (it is a stored slot like any other); it is also
 * the restore point, re-selected at the end.
 */
export function planBatchSet(
  locations: PresetLocations,
  requested: number[],
  request: BatchSetRequest,
  restoreTo: number | null
): BatchSetPreview {
  const skipped: BatchSetSkipped[] = [];
  const targets: BatchSetTarget[] = [];

  if (!canBatchSet(request.eid, request.paramId)) {
    return {
      request,
      restoreTo,
      targets,
      skipped,
      blocked: `cannot address param ${request.paramId} on block ${request.eid}`
    };
  }

  const byLocation = new Map(locations.locations.map((l) => [l.location, l]));
  const seen = new Set<number>();
  for (const location of requested) {
    if (!isLocation(location)) {
      skipped.push({ location, reason: 'not a valid slot number' });
      continue;
    }
    if (seen.has(location)) {
      skipped.push({ location, reason: 'listed twice' });
      continue;
    }
    seen.add(location);
    const entry = byLocation.get(location);
    if (!entry) {
      skipped.push({ location, reason: 'not present in the device slot scan' });
      continue;
    }
    if (entry.isEmpty) {
      skipped.push({ location, reason: 'empty slot' });
      continue;
    }
    targets.push({ location, code: entry.code, name: entry.name });
  }
  targets.sort((a, b) => a.location - b.location);

  return { request, restoreTo, targets, skipped, blocked: null };
}

/**
 * Execute the batch write for each planned target. Per target: select → setParam → store. Aborts on
 * the FIRST error (a slot left half-written cannot be trusted to continue past), reporting which
 * slots were already written and which one failed. The originally selected preset is re-selected at
 * the end, best-effort, on both success and abort.
 */
export async function runBatchSet(preview: BatchSetPreview, io: BatchSetIo): Promise<BatchSetResult> {
  const written: number[] = [];
  let abortedAt: number | null = null;
  let error: string | null = null;

  if (preview.blocked) {
    return { ok: 0, failed: 0, written, abortedAt: null, error: preview.blocked, restoreTo: preview.restoreTo, restored: false };
  }

  for (const target of preview.targets) {
    try {
      await io.select(target.location);
      await io.setParam(preview.request.eid, preview.request.paramId, preview.request.value, preview.request.continuous);
      await io.store(target.location);
      written.push(target.location);
    } catch (e) {
      abortedAt = target.location;
      error = (e as Error)?.message || 'write failed';
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
    abortedAt,
    error,
    restoreTo: preview.restoreTo,
    restored
  };
}

/** Convenience: scan → plan → run in one call. The caller that wants a preview calls the pieces. */
export async function batchSetParam(
  requested: number[],
  request: BatchSetRequest,
  restoreTo: number | null,
  io: BatchSetIo
): Promise<BatchSetResult> {
  const locations = await io.locations();
  return runBatchSet(planBatchSet(locations, requested, request, restoreTo), io);
}
