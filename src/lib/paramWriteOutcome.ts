// Device-confirmed discrete (enum/model) write outcome → what the UI must do.
//
// The FM3 reject-watches a discrete param write and answers with a 0x64 frame; ForgeFX turns that
// into HTTP 200 `{ok:false}` (server `drivers/gen3.ts` #write returns `{ ok: !rejected }` and
// `runtime/handlers.ts` setParamH returns it straight back). A discrete write is rarer and worth
// confirming — unlike the continuous knob stream, which is fire-and-forget BY DESIGN because it
// streams at high frequency (`gen3.ts` `setParam`'s continuous branch → `#send`). Axis's `setEnum` writes optimistically (sets
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

/** Minimal view of the discrete param the write targets — only the mutable `value` is touched.
 *  `value` may be `null` (the server could not resolve the ordinal — non-positional GLOBAL); an
 *  unknown on-screen value is never equal to the value this write sent, so a late refusal will not
 *  clobber it (the revert is skipped), and there is no fabricated 0 to restore. */
export interface EnumWriteTarget { name: string; value: number | null }

/** The side effects the store supplies: drop the optimistic history entry + show a toast. */
export interface EnumWriteIo {
  dropHistory(id: string | null): void;
  toast(text: string, accent: string): void;
}

/**
 * Apply a settled discrete write to the optimistic state: when the write was NOT accepted, revert
 * `target.value` to the captured `from`, drop the optimistic history entry, then surface the refusal.
 * Returns the decision so callers/tests can assert it.
 *
 * STALE-SETTLEMENT GUARD (Opus A/B 2026-10-07): the revert happens ONLY when the value on screen is
 * still the one THIS write set (`sent`). A discrete write holds its confirmation window ~250 ms, so a
 * newer write can land on the same param before this one settles — A→B then B→C is an easy user
 * sequence, and if B is refused, reverting to B's `from` (= A) would wipe the newer C. Comparing
 * `target.value` against the value this write sent is the staleness condition, and it belongs
 * in this pure module (the one place provable without the runes compiler) rather than in the store
 * wiring. The history drop and the refusal toast still apply to a stale settlement: the entry is this
 * write's own and the refusal is real even when a newer write superseded the displayed value.
 *
 * KNOWN LIMITATION (P9 2026-10-07) — the guard is VALUE-based, so an ABA burst defeats it. A→B then
 * B→C then C→B (an odd-length toggle/enum burst) leaves the display equal to this write's `sent`
 * again, so a late refusal of the FIRST write reads "not stale" and reverts to its `from`, wiping the
 * THIRD write's newer value. This is reachable in normal use (the 250 ms window makes a 3-write burst
 * easy), not theoretical. Closing it needs per-control WRITE-INITIATION ordering — a sequence token
 * minted at write time — which the pure settle signature cannot carry (its inputs are a stateless
 * snapshot: target + from + sent + outcome). Supplying it means either the store minting a token
 * (store state, declined in P6) or hoisting a stable per-control target so this module can key a
 * WeakMap on it; both widen the contract seven store call sites and their sourceguard regexes depend
 * on. Documented, not fixed, in `paramWriteOutcome.aba.test.ts` (which pins the ABA and the
 * double-refusal case): if it ever matters, that token is the upgrade the module already names.
 */
export function settleEnumWrite(
  target: EnumWriteTarget,
  from: number,
  sent: number,
  historyId: string | null,
  outcome: WriteSettlement,
  io: EnumWriteIo
): WriteDecision {
  const d = decideWriteOutcome(outcome, target.name);
  const stale = target.value !== sent; // a newer write has superseded this one — do not clobber it
  if (!d.keep && !stale) target.value = from;
  if (!d.keepHistory) io.dropHistory(historyId);
  if (d.toast) io.toast(d.toast.text, d.toast.accent);
  return d;
}

// ── P2.1 — a SET of writes reports what LANDED, not what was requested ───────────────────────────
//
// The same swallow idiom that P1.1 removed from `setEnum` survived at the batch sites:
//   for (const w of writes) await forgefx.setParam(...).catch(() => {})
//   history.checkpoint(...);                      // fired unconditionally
//   this.showToast(`Pasted ${writes.length} …`)   // the number SENT, not the number that landed
// `.catch(() => {})` discards BOTH a thrown transport error AND the server's HTTP-200 `{ok:false}`
// rejection (a discrete write the device refused — see `decideWriteOutcome`), so a paste that never
// reached the device was reported as fully applied over an already-recorded history checkpoint.
//
// `settleWriteSet` is the pure aggregation over a set: honest landed/failed counts, the checkpoint
// decision (only when at least one write landed — a set that never reached the device must not
// leave a history barrier), and the toast that says what really happened. The caller turns each
// `await`ed write into a `WriteSettlement` (the result's `.ok` → ok/rejected, a throw → error) and
// the pure module decides; the store wiring is pinned by refusedWrite.sourceguard.test.ts.
//
// The batch sites reload params FROM THE DEVICE after the set (`#loadParams()` / `load()`), so there
// is no optimistic local value to revert here — the visual state self-corrects on the reload, and
// the one thing the UI must never do is claim a failed write landed. (Sites that DO write
// optimistically and hold a local value use `settleEnumWrite` per value, as `setEnum` does.)

const LANDED_COLOR = '#33c46b'; // the success accent the paste/recall paths already use
const PARTIAL_COLOR = '#f5a623'; // the warning accent the cross-preset paste already uses

export interface WriteSetCopy {
  /** Noun phrase shown in every toast, e.g. "Pasted channel A → B". */
  subject: string;
  /** Counted noun for the success toast, pluralised by count; default "value". */
  noun?: string;
  /** Emit a success toast when every write landed? default true. A caller that shows its own
   *  success toast (e.g. the cab picker) passes false but still gets partial/failure toasts. */
  successToast?: boolean;
}

export interface WriteSetReport {
  /** Writes attempted. */
  requested: number;
  /** Writes the device accepted (`{ok:true}` / no throw). */
  landed: number;
  /** Writes that did not land — rejected + errored. */
  failed: number;
  /** Writes the device answered `{ok:false}` to. */
  rejected: number;
  /** Writes that threw (transport/API failure, never confirmed). */
  errored: number;
  /** Record a history checkpoint? Only when at least one write landed. */
  checkpoint: boolean;
  /** Every requested write landed. */
  allLanded: boolean;
  /** No requested write landed (and at least one was requested). */
  noneLanded: boolean;
  /** The toast describing the TRUE outcome, or null (nothing requested, or success suppressed). */
  toast: { text: string; accent: string } | null;
}

/**
 * Aggregate a set of settled device writes into the honest outcome + the UI decision. Pure: no
 * device, no store. `results` is one `WriteSettlement` per attempted write, in send order.
 */
export function settleWriteSet(results: WriteSettlement[], copy: WriteSetCopy): WriteSetReport {
  const requested = results.length;
  let landed = 0, rejected = 0, errored = 0;
  for (const r of results) {
    if (r.status === 'ok') landed++;
    else if (r.status === 'rejected') rejected++;
    else errored++;
  }
  const failed = rejected + errored;
  const allLanded = requested > 0 && failed === 0;
  const noneLanded = requested > 0 && landed === 0;
  const checkpoint = requested > 0 && landed > 0;

  let toast: WriteSetReport['toast'] = null;
  if (requested > 0) {
    const subject = copy.subject;
    if (allLanded) {
      if (copy.successToast !== false) {
        const noun = copy.noun ?? 'value';
        toast = { text: `${subject} — ${landed} ${noun}${landed === 1 ? '' : 's'}`, accent: LANDED_COLOR };
      }
    } else if (noneLanded) {
      toast = { text: `${subject} — nothing landed (${failed} failed)`, accent: REFUSED_COLOR };
    } else {
      toast = { text: `${subject} — ${landed} of ${requested} landed, ${failed} failed`, accent: PARTIAL_COLOR };
    }
  }
  return { requested, landed, failed, rejected, errored, checkpoint, allLanded, noneLanded, toast };
}

// ── P4 follow-ups — a SCALAR (non-enum) optimistic write must honour the outcome too ─────────────
//
// The same optimistic-write defect class as P1.1/P2.1, on a plain scalar held on a runes FIELD
// rather than a param object: `setBpm` sets `this.bpm = n` (tempo) and `toggleTuner` sets
// `this.tuner = { active: next }` BEFORE the round-trip. On gen3 these two are NOT reject-watched —
// `setTempo` (gen3.ts `sendQueued`) and `setTuner` (registryCore.ts) return `{ok:true}`
// unconditionally — so on this device the settle helpers below only ever see `ok` or a thrown
// transport error, never a device `{ok:false}` (see the corrected notes on `setBpm`/`selectScene` in
// editor.svelte.ts). They still route through the settlement for a uniform contract, and to handle a
// throw. `setBpm` had NO revert at all (a failed tempo stayed displayed), and `toggleTuner` reverted
// only in its `.catch` — a throw — so a throw on the tempo/tuner path stayed displayed. Neither
// surfaced anything.
//
// `settleScalarWrite` is the smallest scalar counterpart to `settleEnumWrite`: there is no history
// entry to drop (a tempo/tuner change is not an undoable param edit) and the scalar lives on a FIELD,
// so the store hands a reader + a setter rather than a mutable param object. It reuses
// `decideWriteOutcome` so the wording/accent stay in the same toast family as the discrete-write
// helpers — "Write rejected by device — <label>" / "Write failed — <label>". Accepted → nothing
// happens; refused/failed → the scalar is reverted to the captured `from` and the refusal is surfaced.
//
// STALE-SETTLEMENT GUARD (P6): `settleEnumWrite` reverts only when the on-screen value is still the
// one that write set (`stale = target.value !== sent`), so a late refusal cannot wipe a newer value
// (an A→B then B→C sequence inside the ~250 ms discrete window). The scalar path needed the same
// protection — a rapid double-write on ONE control can clobber the same way (of the five scalar call
// sites only bypass and channel are actually reject-watched on gen3: `setBypass`/`setChannel` go
// through `#write`; scene, tempo and tuner return `{ok:true}` unconditionally, so the guard there can
// only ever fire on a thrown transport error). The scalar target is NOT a readable param object
// though; it is a closure over a runes field, so there is no `target.value` to compare. The fix is to
// give the target a reader (`get()`) and pass the value this write SENT — then the guard is the SAME
// comparison as the enum one (`target.get() !== sent`), one mechanism and one vocabulary, and it is
// provable in the node-env harness with a plain local variable (a `{ get, set }` pair backed by a
// `let`). We chose the value-sent comparison over a captured sequence token deliberately: a token
// would need the store to mint and track a per-control counter (a second piece of state the runes
// module cannot expose to the node-env harness) for no benefit on these small discrete controls, and
// it would introduce a second staleness vocabulary where the enum guard already established one.
//
// KNOWN LIMITATION (P9 2026-10-07) — the ABA caveat is REACHABLE, not theoretical. A value that a
// later write re-sends becomes indistinguishable from this write's own value, and an odd-length
// toggle/enum burst (A→B→C→B, e.g. bypass/tuner toggled false→true→false→true) is exactly that case:
// a late refusal of the FIRST write reads "not stale" and reverts to its `from`, wiping the THIRD
// write's value. The double-refusal case is likewise reachable — `from` is captured from OPTIMISTIC
// state, so a second refusal can revert to a value the device never confirmed, leaving it on screen
// while the device holds the original. Both are pinned in `paramWriteOutcome.aba.test.ts`. Closing
// either needs per-control WRITE-INITIATION ordering (a token minted at write time, or a tracked
// last-CONFIRMED value) — per-control state the pure inputs do not carry and the store would have to
// supply; P6 declined that, and supplying it now would widen the seven call sites and their
// sourceguards. If it ever matters, a token is the upgrade, not a rewrite.

/** Minimal view of an optimistic SCALAR (non-enum) write target: the store supplies a READER and a
 *  setter for the value it wrote optimistically (tempo `bpm`, tuner `active`, bypass, channel, scene),
 *  because that value lives on a runes field, not on a param object. The reader is the counterpart of
 *  reading `EnumWriteTarget.value` — it is what makes the stale-settlement guard possible. */
export interface ScalarWriteTarget<T> {
  get(): T;
  set(value: T): void;
}

/** The one side effect the store supplies for a scalar settle: show a toast. */
export interface ScalarWriteIo {
  toast(text: string, accent: string): void;
}

/**
 * Apply a settled SCALAR write to the optimistic state: when the write was NOT accepted, revert the
 * scalar to the captured `from` and surface the refusal (same wording as the discrete-write helpers).
 * STALE-SETTLEMENT GUARD: the revert happens ONLY when the value on screen (`target.get()`) is still
 * the one THIS write set (`sent`) — a late refusal must not clobber a newer write's value. Returns
 * the decision so callers/tests can assert it. Pure: no device, no store.
 */
export function settleScalarWrite<T>(
  target: ScalarWriteTarget<T>,
  from: T,
  sent: T,
  outcome: WriteSettlement,
  io: ScalarWriteIo,
  label: string
): WriteDecision {
  const d = decideWriteOutcome(outcome, label);
  const stale = target.get() !== sent; // a newer write has superseded this one — do not clobber it
  if (!d.keep && !stale) target.set(from);
  if (d.toast) io.toast(d.toast.text, d.toast.accent);
  return d;
}
