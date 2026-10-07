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

// ── write-initiation sequencing ─────────────────────────────────────────────────────────────────
//
// The stale guard needs WRITE-INITIATION ORDER, not a value comparison. The older `stale = value !==
// sent` could not tell "the display still holds the value MY write put there" from "a LATER write put
// the same value there" (an ABA burst: A→B→C→B), so an older write's late refusal looked
// un-superseded and wiped the newer value; and it reverted to the optimistic `from` rather than a
// device-confirmed value, so a second refusal in a burst could leave an unconfirmed value on screen.
// Both are closed by giving each control a monotonic write counter:
//
//   beginWrite(key, current)  — called BEFORE the await; mints this write's token on `key`. With
//                               nothing in flight on `key` it also records `current` as the
//                               device-confirmed value: an idle control shows what the device holds.
//   …settle (below)           — `stale = token.n !== latest` is IDENTITY, not value, so an ABA burst
//                               cannot defeat it; a non-stale refusal reverts to the last CONFIRMED
//                               value, updated on every accepted write, never to an unconfirmed `from`.
//
// `key` is the enum param OBJECT for enums (stable identity across writes) or a stable string for a
// scalar field (`bypass:<eid>`, `scene`, `tempo`, `tuner`). Object keys live in a WeakMap so a
// discarded param set cannot leak; string keys in a Map. A key's state is DROPPED when its last
// in-flight write settles, so the maps cannot grow and each control's `confirmed` value is re-seeded
// from the idle on-screen value (which, with nothing in flight, is exactly what the device holds).
//
// Mechanistic note: the trigger for overlapping writes is NOT the confirmation window. On a refusal
// the server's reject-watch resolves IMMEDIATELY (`gen3.ts` #write `match: isOurReject`), so a
// refusal never waits out the 250 ms; the window gates only the SILENT ACCEPT case, which never
// reverts. The realistic trigger is a write queued behind slow reads (bulk reads up to 2.5 s, the
// `meters` serial reads, the edit poll) or a transport drop mid-burst.
export type WriteKey = object | string;

export interface WriteToken {
  /** this write's sequence number on its key (monotonic across a control's writes) */
  readonly n: number;
  /** the control this write belongs to */
  readonly key: WriteKey;
}

interface WriteSeqState {
  /** token of the most recently BEGUN write on this key — the only non-stale write */
  latest: number;
  /** writes begun but not yet settled on this key */
  inflight: number;
  /** the value the device is known to hold (`current` while idle, then each accepted write's value) */
  confirmed: unknown;
}

let objectSeq = new WeakMap<object, WriteSeqState>();
let stringSeq = new Map<string, WriteSeqState>();
let writeCounter = 0;

const seqGet = (key: WriteKey): WriteSeqState | undefined =>
  typeof key === 'string' ? stringSeq.get(key) : objectSeq.get(key);
const seqSet = (key: WriteKey, s: WriteSeqState): void => {
  if (typeof key === 'string') stringSeq.set(key, s);
  else objectSeq.set(key, s);
};
const seqDrop = (key: WriteKey): void => {
  if (typeof key === 'string') stringSeq.delete(key);
  else objectSeq.delete(key);
};

/**
 * Mint this write's sequencing token on `key`; call BEFORE awaiting the write (and before the value
 * the settle helper must be able to revert to is mutated). `current` is the pre-write on-screen value
 * — it becomes the device-confirmed revert target when nothing else is in flight on `key`.
 */
export function beginWrite(key: WriteKey, current: unknown): WriteToken {
  let s = seqGet(key);
  if (!s) { s = { latest: 0, inflight: 0, confirmed: current }; seqSet(key, s); }
  s.latest = ++writeCounter;
  s.inflight++;
  return { n: s.latest, key };
}

/** Reduce a settled write's sequencing state; returns the revert target for a NON-stale refusal. */
function advanceSequencer(
  token: WriteToken,
  sent: unknown,
  accepted: boolean
): { stale: boolean; revertTo: unknown } {
  const s = seqGet(token.key);
  if (!s) return { stale: true, revertTo: undefined }; // no initiation state — never revert blind
  const stale = token.n !== s.latest; // identity, not value: an ABA burst cannot fool this
  if (accepted) s.confirmed = sent;   // the device acknowledged THIS write's value
  s.inflight = Math.max(0, s.inflight - 1);
  const revertTo = s.confirmed;
  if (s.inflight === 0) seqDrop(token.key); // burst over — the next begin re-seeds from the display
  return { stale, revertTo };
}

/** TEST/DIAGNOSTIC ONLY — clear all in-flight sequencing state (the app never needs this). */
export function resetWriteSequencer(): void {
  objectSeq = new WeakMap();
  stringSeq = new Map();
  writeCounter = 0;
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
 * Apply a settled discrete write to the optimistic state: when the write was NOT accepted and is NOT
 * superseded, revert `target.value` to the last device-CONFIRMED value, drop the optimistic history
 * entry, then surface the refusal. Returns the decision so callers/tests can assert it.
 *
 * STALE-SETTLEMENT GUARD: the revert happens ONLY for the latest write on the control (`token.n ===
 * latest`, tracked by the sequencing block above) — a write no newer write has superseded. The check
 * is WRITE-IDENTITY, not value equality, so an odd-length same-value burst (A→B→C→B, where the
 * display returns to an older write's value) can no longer make that older write look
 * un-superseded. The revert target is the last value the device CONFIRMED, not the optimistic `from`,
 * so a burst of refusals cannot leave a value on screen the device never held. The history drop and
 * the refusal toast still apply to a superseded settlement: the entry is this write's own and the
 * refusal is real even when a newer write superseded the displayed value.
 *
 * `token` comes from `beginWrite(e, from)` (the enum param object is its own stable key); the `from`
 * value is no longer passed here — the sequencer carries the confirmed value it replaced.
 */
export function settleEnumWrite(
  target: EnumWriteTarget,
  token: WriteToken,
  sent: number,
  historyId: string | null,
  outcome: WriteSettlement,
  io: EnumWriteIo
): WriteDecision {
  const d = decideWriteOutcome(outcome, target.name);
  const { stale, revertTo } = advanceSequencer(token, sent, d.keep);
  if (!d.keep && !stale) target.value = revertTo as number;
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
// optimistically and hold a local value use `settleEnumWrite`/`settleScalarWrite` per value, as
// `setEnum` does.)

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
// happens; refused/failed (and not superseded) → the scalar is reverted to the last device-confirmed
// value and the refusal is surfaced.
//
// The scalar target is NOT a readable param object — it is a closure over a runes field, so it has no
// stable identity to key the sequencer on. The store therefore supplies BOTH a reader (`get()`, the
// counterpart of `EnumWriteTarget.value`) AND a stable string key to `beginWrite` (`bypass:<eid>`,
// `scene`, `tempo`, `tuner`). Of the scalar call sites only bypass and channel are actually
// reject-watched on gen3 (`setBypass`/`setChannel` go through #write); scene, tempo and tuner return
// `{ok:true}` unconditionally, so the guard there can only ever fire on a thrown transport error.

/** Minimal view of an optimistic SCALAR (non-enum) write target: the store supplies a READER and a
 *  setter for the value it wrote optimistically (tempo `bpm`, tuner `active`, bypass, channel, scene),
 *  because that value lives on a runes field, not on a param object. The reader is the counterpart of
 *  reading `EnumWriteTarget.value`. */
export interface ScalarWriteTarget<T> {
  get(): T;
  set(value: T): void;
}

/** The one side effect the store supplies for a scalar settle: show a toast. */
export interface ScalarWriteIo {
  toast(text: string, accent: string): void;
}

/**
 * Apply a settled SCALAR write to the optimistic state: when the write was NOT accepted and is NOT
 * superseded, revert the scalar to the last device-CONFIRMED value and surface the refusal (same
 * wording as the discrete-write helpers). Returns the decision so callers/tests can assert it. Pure:
 * no device, no store.
 *
 * STALE-SETTLEMENT GUARD: the revert happens ONLY for the latest write on the control (`token.n ===
 * latest`, from `beginWrite(key, from)`), never by comparing values — so a same-value (ABA) burst
 * cannot defeat it — and the revert target is the last CONFIRMED value, so a burst of refusals cannot
 * leave a value on screen the device never held. The scalar's `key` is a stable string the store
 * supplies because the runes field has no object identity to key on.
 */
export function settleScalarWrite<T>(
  target: ScalarWriteTarget<T>,
  token: WriteToken,
  sent: T,
  outcome: WriteSettlement,
  io: ScalarWriteIo,
  label: string
): WriteDecision {
  const d = decideWriteOutcome(outcome, label);
  const { stale, revertTo } = advanceSequencer(token, sent, d.keep);
  if (!d.keep && !stale) target.set(revertTo as T);
  if (d.toast) io.toast(d.toast.text, d.toast.accent);
  return d;
}
