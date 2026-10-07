// Device-confirmed discrete (enum/model) write outcome → what the UI must do.
//
// The FM3 reject-watches a discrete param write and answers with a 0x64 frame; ForgeFX turns that
// into HTTP 200 `{ok:false}` (server `drivers/gen3.ts` #write returns `{ ok: !rejected }` and
// `runtime/handlers.ts` setParamH returns it straight back). A discrete write is rarer and worth
// confirming — unlike the continuous knob stream, which is fire-and-forget BY DESIGN because it
// streams at high frequency (`gen3.ts:1391-1393`). Axis's `setEnum` writes optimistically (sets
// `e.value` and records a history entry) BEFORE the round-trip, so it MUST consult the outcome and
// undo its optimistic state when the device refused the write — otherwise a refused model/cab/enum
// value stays on screen as if applied, indefinitely (P1.1).
//
// This module is the framework-free decision + the pure application of it; the store wiring
// (`editor.svelte.ts` setEnum) is a thin call. Kept pure so it is provable with no hardware and no
// Svelte compiler in the node-env vitest harness (editor.svelte.ts is a runes module that throws on
// import there — see `paletteRows.ts` + `listCaps.test.ts` for the established pattern).

export type WriteSettlement =
  | { status: 'ok' }        // device accepted the write
  | { status: 'rejected' }  // device answered a 0x64 rejection → server `{ok:false}`
  | { status: 'error' };    // transport/API error — the write was never confirmed either

export interface WriteDecision {
  /** keep the optimistically written value on screen; false → revert to the previous value */
  keep: boolean;
  /** keep the optimistic history entry; false → drop it (the edit never happened) */
  keepHistory: boolean;
  /** refusal to surface, or null when the write was accepted */
  toast: { text: string; accent: string } | null;
}

const REFUSED_COLOR = '#d6543f'; // the rejection accent the save/type-change paths already use

/**
 * Decide what the UI must do after a discrete write settles. Accepted → keep everything, say
 * nothing. Refused (device `{ok:false}`) or failed (transport error) → the value did not land, so
 * revert the optimistic value, drop the optimistic history entry, and tell the user why. The
 * wording mirrors the save path's "Save rejected by device" / "Save failed".
 */
export function decideWriteOutcome(outcome: WriteSettlement, paramName: string): WriteDecision {
  if (outcome.status === 'ok') return { keep: true, keepHistory: true, toast: null };
  const text = outcome.status === 'rejected'
    ? `Write rejected by device — ${paramName}`
    : `Write failed — ${paramName}`;
  return { keep: false, keepHistory: false, toast: { text, accent: REFUSED_COLOR } };
}

/** Minimal view of the discrete param the write targets — only the mutable `value` is touched. */
export interface EnumWriteTarget { name: string; value: number }

/** The side effects the store supplies: drop the optimistic history entry + show a toast. */
export interface EnumWriteIo {
  dropHistory(id: string | null): void;
  toast(text: string, accent: string): void;
}

/**
 * Apply a settled discrete write to the optimistic state: when the write was NOT accepted, revert
 * `target.value` to the captured `from` and drop the optimistic history entry, then surface the
 * refusal. Returns the decision so callers/tests can assert it.
 */
export function settleEnumWrite(
  target: EnumWriteTarget,
  from: number,
  historyId: string | null,
  outcome: WriteSettlement,
  io: EnumWriteIo
): WriteDecision {
  const d = decideWriteOutcome(outcome, target.name);
  if (!d.keep) target.value = from;
  if (!d.keepHistory) io.dropHistory(historyId);
  if (d.toast) io.toast(d.toast.text, d.toast.accent);
  return d;
}
