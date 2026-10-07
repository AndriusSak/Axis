import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  decideWriteOutcome,
  beginWrite,
  settleEnumWrite,
  resetWriteSequencer,
  type EnumWriteIo,
  type WriteSettlement
} from './paramWriteOutcome';

// P1.1 — a device-REFUSED discrete (enum/model) write must never stay on screen.
//
// `setEnum` writes optimistically (mutates e.value, records a history entry) before the round-trip.
// ForgeFX reject-watches a discrete write and reports a refusal as HTTP 200 `{ok:false}`; a transport
// error means the write was never confirmed. In BOTH cases the value did not land, so the UI must
// revert e.value, drop the optimistic history entry, and toast the refusal. This is the pure core of
// that decision (the store wiring is pinned by refusedWrite.sourceguard.test.ts).
//
// P11 — the revert target is the last device-CONFIRMED value carried by the write sequencer, not the
// optimistic `from` (and staleness is write-IDENTITY via `beginWrite`'s token, not a value compare).
// The ABA / double-refusal cases that the old value-based guard could not close are asserted as
// CORRECT behaviour in paramWriteOutcome.aba.test.ts.

beforeEach(() => resetWriteSequencer());

function fakeIo() {
  const dropped: (string | null)[] = [];
  const toasts: { text: string; accent: string }[] = [];
  const io: EnumWriteIo = {
    dropHistory: (id) => dropped.push(id),
    toast: (text, accent) => toasts.push({ text, accent })
  };
  return { io, dropped, toasts };
}

describe('decideWriteOutcome', () => {
  it('keeps the value + history and says nothing when the device accepted the write', () => {
    const d = decideWriteOutcome({ status: 'ok' }, 'Model');
    expect(d).toEqual({ keep: true, keepHistory: true, toast: null });
  });

  it('reverts + drops history and names the param when the device REFUSED the write', () => {
    const d = decideWriteOutcome({ status: 'rejected' }, 'Model');
    expect(d.keep).toBe(false);
    expect(d.keepHistory).toBe(false);
    expect(d.toast?.text).toBe('Write rejected by device — Model');
    expect(d.toast?.accent).toBe('#d6543f');
  });

  it('reverts + drops history and reports the failure on a transport error', () => {
    const d = decideWriteOutcome({ status: 'error' }, 'Cab');
    expect(d.keep).toBe(false);
    expect(d.keepHistory).toBe(false);
    expect(d.toast?.text).toBe('Write failed — Cab');
  });
});

describe('settleEnumWrite (the optimistic-state rollback)', () => {
  it('leaves the optimistic value and history untouched on an accepted write', () => {
    const target = { name: 'Model', value: 3 };
    const token = beginWrite(target, 2);
    const { io, dropped, toasts } = fakeIo();
    settleEnumWrite(target, token, 3, 'h1', { status: 'ok' }, io);
    expect(target.value).toBe(3); // the write landed — keep it
    expect(dropped).toEqual([]);  // history entry stays
    expect(toasts).toEqual([]);
  });

  it('reverts the value to the confirmed `from`, drops the history entry and toasts on a REFUSED write', () => {
    const target = { name: 'Model', value: 3 }; // optimistic value
    const token = beginWrite(target, 2);        // 2 is the device-confirmed value before this write
    const { io, dropped, toasts } = fakeIo();
    const d = settleEnumWrite(target, token, 3, 'h1', { status: 'rejected' }, io);
    expect(d.keep).toBe(false);
    expect(target.value).toBe(2);        // reverted — a refused value must not stay on screen
    expect(dropped).toEqual(['h1']);     // the optimistic history record is removed
    expect(toasts).toEqual([{ text: 'Write rejected by device — Model', accent: '#d6543f' }]);
  });

  it('reverts + drops + toasts on a thrown transport error too', () => {
    const target = { name: 'Model', value: 3 };
    const token = beginWrite(target, 2);
    const { io, dropped, toasts } = fakeIo();
    settleEnumWrite(target, token, 3, 'h1', { status: 'error' }, io);
    expect(target.value).toBe(2);
    expect(dropped).toEqual(['h1']);
    expect(toasts[0].text).toBe('Write failed — Model');
  });

  it('is a no-op history drop when the value was unchanged (no entry was recorded)', () => {
    const target = { name: 'Model', value: 3 };
    const token = beginWrite(target, 2);
    const { io, dropped } = fakeIo();
    settleEnumWrite(target, token, 3, null, { status: 'rejected' }, io);
    expect(dropped).toEqual([null]); // store's history.drop(null) is a no-op
  });
});

// HIGH — a stale settlement must not clobber a newer value (Opus A/B 2026-10-07).
//
// A write can settle after a newer write on the same control has moved the display on (it queues
// behind slow reads, or the transport drops mid-burst — a refusal itself closes the watch
// immediately, so the window is not what makes this reachable). `settleEnumWrite` for the earlier
// write must NOT revert the display when a newer write has already begun — staleness is the earlier
// write no longer being the control's latest (P11: compare the write TOKEN, not the value).
describe('settleEnumWrite — stale-settlement guard', () => {
  it('does NOT clobber a newer value a later write superseded (B refused after C landed)', () => {
    const target = { name: 'Model', value: 3 };
    const tB = beginWrite(target, 2); // this settlement belongs to the earlier A→B write
    target.value = 4;                 // a newer write already moved the display to C
    const tC = beginWrite(target, 3); // a newer write on the same control begins (supersedes B)
    const { io, dropped, toasts } = fakeIo();
    settleEnumWrite(target, tC, 4, 'h2', { status: 'ok' }, io); // C lands
    const d = settleEnumWrite(target, tB, 3, 'h1', { status: 'rejected' }, io); // B settles late, refused
    expect(d.keep).toBe(false);       // the write genuinely did not land
    expect(target.value).toBe(4);     // …but the newer C survives — the stale revert is skipped
    expect(dropped).toEqual(['h1']);  // B's own optimistic history entry is still removed
    expect(toasts[0].text).toBe('Write rejected by device — Model'); // the refusal is still surfaced
  });

  it('skips the revert on a stale transport error too', () => {
    const target = { name: 'Cab', value: 7 };
    const tOld = beginWrite(target, 2);
    beginWrite(target, 7); // a newer write began — this one is now stale
    const { io } = fakeIo();
    settleEnumWrite(target, tOld, 3, 'h2', { status: 'error' }, io);
    expect(target.value).toBe(7); // a newer value remains — not reverted to the stale value
  });

  it('still reverts when this write IS the control\'s latest (not stale)', () => {
    const target = { name: 'Model', value: 3 }; // unchanged since this write set it
    const token = beginWrite(target, 2);
    const { io } = fakeIo();
    settleEnumWrite(target, token, 3, 'h1', { status: 'rejected' }, io);
    expect(target.value).toBe(2); // not superseded → revert as before
  });
});

// Guard against the decision silently accepting a swallow: the store MUST route every settlement
// through this module. Kept here so a future edit to the module's contract is caught next to it.
describe('settlement exhaustiveness', () => {
  const all: WriteSettlement[] = [{ status: 'ok' }, { status: 'rejected' }, { status: 'error' }];
  it('only the accepted outcome keeps the optimistic value', () => {
    const kept = all.map((s) => decideWriteOutcome(s, 'X').keep);
    expect(kept).toEqual([true, false, false]);
  });
  it('every non-accepted outcome surfaces a toast', () => {
    for (const s of all) {
      const d = decideWriteOutcome(s, 'X');
      if (s.status === 'ok') expect(d.toast).toBeNull();
      else expect(d.toast).not.toBeNull();
    }
    vi.restoreAllMocks();
  });
});
