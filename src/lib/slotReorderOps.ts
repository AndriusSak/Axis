// Multi-slot REORDER of device slots — the remainder of the "Manage Presets" librarian (parity audit
// §2.4), built on the SAME copy-by-store primitives `presetSlotOps.ts` uses (dump → load into the edit
// buffer → store). It is the N-slot generalisation of that module's 2-slot `swapSlots`.
//
// Relationship to `duplicateSlot`/`swapSlots`: those two are the 1-move and 2-move cases of the same
// sequence. This runner does NOT call them per move, on purpose:
//   • `duplicateSlot` writes the target IMMEDIATELY after dumping its single source, which would destroy
//     a source a later move still needs (unsafe for N>2 with no scratch slot and no erase op);
//   • neither helper reports WHICH store landed, but the abort contract here requires the exact list of
//     moves already written. So the runner drives the identical dump/load/store transport directly and
//     keeps precise accounting. (A 2-slot reorder still produces exactly the swapSlots byte order —
//     dump both, then load/store each — as the tests pin.)
//
// The FM3 (gen-3) wire protocol exposes NO slot-erase op and NO slot-copy op, so a reorder CANNOT be
// performed by clearing or moving slots. It IS provable as a pure CONTENT PERMUTATION over the existing
// endpoints:
//
//   1. dump EVERY source slot into client memory FIRST — the exact "capture both dumps first" rule of
//      `swapSlots`, widened to N. Writing any destination before all sources are captured would destroy
//      a source that a later move still needs.
//   2. then, for each move, load that source's captured bytes into the edit buffer (POST /preset/load)
//      and store the buffer into the destination slot (POST /preset/store).
//
// Because every destination is also a source (a true permutation of the same slot set), no slot's
// content is lost and no erase primitive is needed. A reorder whose destination set differs from its
// source set is a MOVE (it would strand/erase a slot off the set) → REFUSED with a named reason, never
// faked. Same for a duplicate-into-a-slot-outside-the-set.
//
// DESTRUCTIVE to the edit buffer (the caller warns first) and to every destination slot. The runner
// ABORTS on the first error and reports exactly which moves had already landed; the originally selected
// preset is re-selected at the end whether the run succeeded or aborted.
//
// Pure + dependency-free (the batchSetOps.ts pattern) so it unit-tests under this repo's node-env vitest
// (no .svelte mount). The transport is injected; the editor binds one over forgefx.

import type { SlotOpsClient } from './presetSlotOps';

/** One content move: the preset currently in `from` must end up in `to`. */
export interface SlotMove {
  from: number;
  to: number;
}

/** A resolved, display-ready move (slot names filled by the caller from its location scan). */
export interface SlotReorderTarget {
  from: number;
  to: number;
  /** Destination slot's stored name, when the caller supplied the scan. Display only. */
  fromName?: string | null;
  toName?: string | null;
}

/** The dry-run result: exactly what a run WOULD do. Planning itself touches no device. */
export interface SlotReorderPreview {
  /** The requested moves, verbatim (for reference/debugging). */
  moves: SlotMove[];
  /** The slot selected BEFORE the run — re-selected at the end. null when unknown. */
  restoreTo: number | null;
  /** The writes that WILL happen, ordered by destination slot, de-duplicated. */
  targets: SlotReorderTarget[];
  /** Non-null when the whole reorder is refused (with the precise reason). */
  blocked: string | null;
}

/** Outcome of a run. `written` lists every move fully stored, in completion order. */
export interface SlotReorderResult {
  ok: number;
  failed: number;
  /** Moves fully written + stored before the run ended. Precise — on an abort these are the survivors. */
  written: SlotMove[];
  /** The move where the run ABORTED on the first error, or null when every move succeeded. */
  abortedAt: SlotMove | null;
  error: string | null;
  /** The originally selected preset (re-selected at the end). */
  restoreTo: number | null;
  /** True when the originally selected preset was successfully re-selected. */
  restored: boolean;
}

/**
 * The transport a reorder drives. It is EXACTLY the copy-by-store client `presetSlotOps.ts` uses
 * (`duplicateSlot`/`swapSlots`) — dump / load-into-edit-buffer / store — plus `select`, used only to
 * re-load the origin preset into the edit buffer at the end (the batchSetOps restore rule).
 */
export interface SlotReorderIo extends SlotOpsClient {
  /** POST /preset/select — load a slot into the edit buffer (the end-of-run restore). */
  select(number: number): Promise<unknown>;
}

const toU8 = (b: number[] | Uint8Array): Uint8Array => (b instanceof Uint8Array ? b : Uint8Array.from(b));
const isSlot = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n) && n >= 0;
const msg = (e: unknown, fallback: string) => (e as Error)?.message || fallback;

function blockedPreview(moves: SlotMove[], restoreTo: number | null, reason: string): SlotReorderPreview {
  return { moves, restoreTo, targets: [], blocked: reason };
}

/**
 * Pure dry-run planner. Validates that `moves` is a genuine CONTENT PERMUTATION over one fixed set of
 * slots (every source is also a destination, no slot read or written twice, the order actually changes)
 * and, when it is, returns the writes in a deterministic (destination-ascending) order. A non-permutation
 * — i.e. anything that would need a slot-erase/slot-copy primitive the protocol lacks — is refused with
 * a named reason rather than faked.
 */
export function planSlotReorder(moves: SlotMove[], restoreTo: number | null): SlotReorderPreview {
  if (!Array.isArray(moves) || moves.length === 0) {
    return blockedPreview(moves ?? [], restoreTo, 'no slots to reorder');
  }
  for (const m of moves) {
    if (!m || !isSlot(m.from) || !isSlot(m.to)) {
      return blockedPreview(moves, restoreTo, 'slot numbers must be non-negative integers');
    }
  }
  const froms = moves.map((m) => m.from);
  const tos = moves.map((m) => m.to);
  if (new Set(froms).size !== froms.length) {
    return blockedPreview(moves, restoreTo, 'two moves read from the same slot');
  }
  if (new Set(tos).size !== tos.length) {
    return blockedPreview(moves, restoreTo, 'two moves write to the same slot');
  }
  // A reorder must move the SAME set of slots among themselves. If a destination is not also a source
  // (or vice-versa) the operation is a move/duplicate off the set, which needs a slot-erase op the FM3
  // wire protocol does not expose.
  const fromSet = [...froms].sort((a, b) => a - b);
  const toSet = [...tos].sort((a, b) => a - b);
  if (fromSet.some((v, i) => v !== toSet[i])) {
    return blockedPreview(
      moves,
      restoreTo,
      'a reorder must be a permutation of the same slots — moving into or out of a slot outside the set would need a slot-erase op the device protocol does not expose'
    );
  }
  if (moves.every((m) => m.from === m.to)) {
    return blockedPreview(moves, restoreTo, 'the order is unchanged — nothing to reorder');
  }

  const targets: SlotReorderTarget[] = moves.map((m) => ({ from: m.from, to: m.to }));
  targets.sort((a, b) => a.to - b.to); // deterministic, destination-ascending
  return { moves: moves.map((m) => ({ ...m })), restoreTo, targets, blocked: null };
}

async function restoreOrigin(io: SlotReorderIo, restoreTo: number | null): Promise<boolean> {
  if (restoreTo == null) return false;
  try {
    await io.select(restoreTo);
    return true;
  } catch {
    return false; // best effort — a failed restore never invalidates the writes that already landed
  }
}

/**
 * Execute a planned reorder. Phase 1 dumps every source into memory (NO writes yet, so a failed capture
 * leaves the device untouched). Phase 2 writes each destination from its captured bytes. Aborts on the
 * FIRST error (a half-written reorder cannot be trusted to continue past) and reports exactly which moves
 * landed. The originally selected preset is re-selected at the end, best-effort, on success and abort.
 */
export async function runSlotReorder(preview: SlotReorderPreview, io: SlotReorderIo): Promise<SlotReorderResult> {
  const written: SlotMove[] = [];
  if (preview.blocked) {
    return { ok: 0, failed: 0, written, abortedAt: null, error: preview.blocked, restoreTo: preview.restoreTo, restored: false };
  }

  // ── phase 1: capture EVERY source dump before any write (swapSlots' rule, widened to N) ──
  const captured = new Map<number, Uint8Array>();
  for (const t of preview.targets) {
    try {
      captured.set(t.from, toU8((await io.dump(t.from)).bytes));
    } catch (e) {
      const restored = await restoreOrigin(io, preview.restoreTo);
      return { ok: 0, failed: 1, written, abortedAt: { from: t.from, to: t.to }, error: msg(e, 'dump failed'), restoreTo: preview.restoreTo, restored };
    }
  }

  // ── phase 2: write each destination from its captured bytes ──
  for (const t of preview.targets) {
    try {
      await io.load(captured.get(t.from)!);
      const r = await io.store(t.to);
      if (!r || !r.ok) throw new Error(`store to slot ${t.to} was rejected`);
      written.push({ from: t.from, to: t.to });
    } catch (e) {
      const restored = await restoreOrigin(io, preview.restoreTo);
      return { ok: written.length, failed: 1, written, abortedAt: { from: t.from, to: t.to }, error: msg(e, 'store failed'), restoreTo: preview.restoreTo, restored };
    }
  }

  const restored = await restoreOrigin(io, preview.restoreTo);
  return { ok: written.length, failed: 0, written, abortedAt: null, error: null, restoreTo: preview.restoreTo, restored };
}

/** Convenience: plan → run in one call. A caller that wants a preview calls the pieces. */
export async function reorderSlots(moves: SlotMove[], restoreTo: number | null, io: SlotReorderIo): Promise<SlotReorderResult> {
  return runSlotReorder(planSlotReorder(moves, restoreTo), io);
}
