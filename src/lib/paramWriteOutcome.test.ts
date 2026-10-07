import { describe, it, expect, vi } from 'vitest';
import {
  decideWriteOutcome,
  settleEnumWrite,
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
    const { io, dropped, toasts } = fakeIo();
    settleEnumWrite(target, 2, 'h1', { status: 'ok' }, io);
    expect(target.value).toBe(3); // the write landed — keep it
    expect(dropped).toEqual([]);  // history entry stays
    expect(toasts).toEqual([]);
  });

  it('reverts the value to `from`, drops the history entry and toasts on a REFUSED write', () => {
    const target = { name: 'Model', value: 3 }; // optimistic value
    const { io, dropped, toasts } = fakeIo();
    const d = settleEnumWrite(target, 2, 'h1', { status: 'rejected' }, io);
    expect(d.keep).toBe(false);
    expect(target.value).toBe(2);        // reverted — a refused value must not stay on screen
    expect(dropped).toEqual(['h1']);     // the optimistic history record is removed
    expect(toasts).toEqual([{ text: 'Write rejected by device — Model', accent: '#d6543f' }]);
  });

  it('reverts + drops + toasts on a thrown transport error too', () => {
    const target = { name: 'Model', value: 3 };
    const { io, dropped, toasts } = fakeIo();
    settleEnumWrite(target, 2, 'h1', { status: 'error' }, io);
    expect(target.value).toBe(2);
    expect(dropped).toEqual(['h1']);
    expect(toasts[0].text).toBe('Write failed — Model');
  });

  it('is a no-op history drop when the value was unchanged (no entry was recorded)', () => {
    const target = { name: 'Model', value: 3 };
    const { io, dropped } = fakeIo();
    settleEnumWrite(target, 2, null, { status: 'rejected' }, io);
    expect(dropped).toEqual([null]); // store's history.drop(null) is a no-op
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
