// §2.7 — the cab-MOVE planner. A user-cab "move" is a device-side no-op: the only way is re-uploading
// the IR's BYTES to the destination, then erasing the source (measured: FM3-Edit does exactly two
// container uploads). Those bytes are therefore REQUIRED. This planner decides where they come from:
//   • the server-side BYTE LIBRARY (an IR previously uploaded THROUGH Axis), preferred; else
//   • the file the user picks, as before.
//
// PURE — no runes, DOM or network imports (source-guarded), so the decision is unit-testable while
// the .svelte component (which vitest cannot mount) only renders it.
import type { CabLibraryListEntry } from './types';

/** The honest scope line shown next to any library-backed action — NEVER "your cab library". */
export const CAB_LIBRARY_NOTE =
  'IRs uploaded through Axis only — slots that already held an IR are not captured (the unit cannot read a slot’s samples).';

export type LibraryMovePlan =
  | { ok: true; entry: CabLibraryListEntry }
  | { ok: false; reason: string };

function isUserSlot(n: number): boolean {
  return Number.isInteger(n) && n >= 1 && n <= 512;
}

/**
 * Pick the stored bytes for a move from `fromUserSlot`. ok:true names the library entry to re-upload;
 * ok:false carries a user-facing reason (so the UI says WHY, rather than failing silently).
 */
export function planLibraryMove(
  entries: readonly CabLibraryListEntry[],
  fromUserSlot: number,
  toUserSlot: number
): LibraryMovePlan {
  if (!isUserSlot(fromUserSlot)) return { ok: false, reason: `source must be a user cab slot 1–512 (got ${fromUserSlot})` };
  if (!isUserSlot(toUserSlot)) return { ok: false, reason: `destination must be a user cab slot 1–512 (got ${toUserSlot})` };
  if (fromUserSlot === toUserSlot) return { ok: false, reason: 'source and destination are the same slot' };
  const entry = entries.find((e) => e.user === fromUserSlot && e.available);
  if (!entry) {
    return {
      ok: false,
      reason: `source slot ${fromUserSlot} is not in the IR library — it was not uploaded through Axis. Pick the IR file to move it.`
    };
  }
  return { ok: true, entry };
}

/** True when the library can move `fromUserSlot` with no file — drives the UI's enable/claim. */
export function libraryCanMove(entries: readonly CabLibraryListEntry[], fromUserSlot: number): boolean {
  return entries.some((e) => e.user === fromUserSlot && e.available);
}
