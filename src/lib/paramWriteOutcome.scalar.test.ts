import { describe, it, expect } from 'vitest';
import {
  settleScalarWrite,
  type ScalarWriteIo,
  type WriteSettlement
} from './paramWriteOutcome';

// P4 follow-ups (setBpm / toggleTuner) — a device-REFUSED SCALAR (non-enum) write must never stay
// on screen. `setBpm` writes the tempo optimistically (`this.bpm = n`) and `toggleTuner` writes the
// tuner on/off optimistically (`this.tuner = { active: next }`) BEFORE the round-trip. Both are
// discrete control writes ForgeFX reject-watches, so the device may answer HTTP 200 `{ok:false}`;
// a transport error means the write was never confirmed. In BOTH cases the optimistic value did not
// land and the UI MUST revert it + surface the refusal — exactly the class `settleEnumWrite` closed
// for enums (P1.1/P2.1), here for a plain scalar held on a runes field rather than a param object.
//
// P6 adds the STALE-SETTLEMENT GUARD the enum path already has: the revert happens only while the
// on-screen value is still the one THIS write set (`sent`, read back via `target.get()`), so a late
// refusal cannot wipe a newer value a rapid double-write already moved on screen.
//
// `settleScalarWrite` is the pure core; the store wiring is pinned by refusedWrite.sourceguard.test.ts.

function fakeIo() {
  const toasts: { text: string; accent: string }[] = [];
  const io: ScalarWriteIo = { toast: (text, accent) => toasts.push({ text, accent }) };
  return { io, toasts };
}

describe('settleScalarWrite (numeric scalar — tempo)', () => {
  it('keeps the optimistic value and says nothing when the device accepted the write', () => {
    let bpm = 140; // the optimistic tempo (and the value this write sent)
    const { io, toasts } = fakeIo();
    const d = settleScalarWrite({ get: () => bpm, set: (v) => (bpm = v) }, 120, 140, { status: 'ok' }, io, 'Tempo');
    expect(d.keep).toBe(true);
    expect(bpm).toBe(140); // the write landed — keep it
    expect(toasts).toEqual([]);
  });

  it('reverts to `from` and toasts when the device REFUSED the write ({ok:false})', () => {
    let bpm = 140; // optimistic (still the sent value → not stale)
    const { io, toasts } = fakeIo();
    const d = settleScalarWrite({ get: () => bpm, set: (v) => (bpm = v) }, 120, 140, { status: 'rejected' }, io, 'Tempo');
    expect(d.keep).toBe(false);
    expect(bpm).toBe(120); // reverted — a refused tempo must not stay on screen
    expect(toasts).toEqual([{ text: 'Write rejected by device — Tempo', accent: '#d6543f' }]);
  });

  it('reverts + toasts on a thrown transport error too', () => {
    let bpm = 140;
    const { io, toasts } = fakeIo();
    settleScalarWrite({ get: () => bpm, set: (v) => (bpm = v) }, 120, 140, { status: 'error' }, io, 'Tempo');
    expect(bpm).toBe(120);
    expect(toasts[0].text).toBe('Write failed — Tempo');
  });
});

describe('settleScalarWrite (boolean scalar — tuner on/off)', () => {
  it('keeps the toggled value on an accepted write', () => {
    let active = true;
    const { io, toasts } = fakeIo();
    settleScalarWrite({ get: () => active, set: (v) => (active = v) }, false, true, { status: 'ok' }, io, 'Tuner');
    expect(active).toBe(true);
    expect(toasts).toEqual([]);
  });

  it('reverts the toggle when the device REFUSED it ({ok:false})', () => {
    let active = true; // `this.tuner = { active: next }` optimistic (still the sent value)
    const { io, toasts } = fakeIo();
    const d = settleScalarWrite({ get: () => active, set: (v) => (active = v) }, false, true, { status: 'rejected' }, io, 'Tuner');
    expect(d.keep).toBe(false);
    expect(active).toBe(false); // reverted to the captured `from`
    expect(toasts).toEqual([{ text: 'Write rejected by device — Tuner', accent: '#d6543f' }]);
  });

  it('reverts the toggle on a thrown transport error too', () => {
    let active = true;
    const { io, toasts } = fakeIo();
    settleScalarWrite({ get: () => active, set: (v) => (active = v) }, false, true, { status: 'error' }, io, 'Tuner');
    expect(active).toBe(false);
    expect(toasts[0].text).toBe('Write failed — Tuner');
  });
});

describe('settleScalarWrite exhaustiveness', () => {
  const all: WriteSettlement[] = [{ status: 'ok' }, { status: 'rejected' }, { status: 'error' }];
  it('only the accepted outcome keeps the optimistic scalar', () => {
    const kept = all.map((s) => {
      let v = 9;
      settleScalarWrite({ get: () => v, set: (x) => (v = x) }, 3, 9, s, { toast: () => {} }, 'X');
      return v;
    });
    expect(kept).toEqual([9, 3, 3]);
  });
  it('every non-accepted outcome surfaces a toast', () => {
    const toasts: string[] = [];
    for (const s of all) {
      settleScalarWrite({ get: () => 3, set: () => {} }, 3, 3, s, { toast: (t) => toasts.push(t) }, 'X');
    }
    expect(toasts.length).toBe(2); // rejected + error; ok stays silent
  });
});

// P6 — a stale settlement must not clobber a newer value (the scalar counterpart of the enum guard).
//
// A discrete write holds its confirmation window ~250 ms, so the user can toggle bypass/scene twice
// (A→B then B→C) before B's round-trip settles. The settlement for B carries `from = A`, `sent = B`;
// when a newer write has already moved the control to C, B's refusal must NOT revert the display to A.
// This fails on an unconditional `if (!d.keep) target.set(from);` and passes with the guard.
describe('settleScalarWrite — stale-settlement guard (P6)', () => {
  it('does NOT clobber a newer value a later write superseded (B refused after C landed)', () => {
    let scene = 3; // C — a newer write already moved the display on
    const { io, toasts } = fakeIo();
    // this settlement belongs to the earlier write (from = 1, sent = 2); the device refused it
    const d = settleScalarWrite({ get: () => scene, set: (v) => (scene = v) }, 1, 2, { status: 'rejected' }, io, 'Scene');
    expect(d.keep).toBe(false);            // the write genuinely did not land
    expect(scene).toBe(3);                 // …but the newer C survives — the stale revert is skipped
    expect(toasts[0].text).toBe('Write rejected by device — Scene'); // the refusal is still surfaced
  });

  it('skips the revert on a stale transport error too', () => {
    let bpm = 999; // C — a newer write already landed on screen
    const { io, toasts } = fakeIo();
    // this settlement is for the earlier write (from = 120, sent = 140); it threw
    const d = settleScalarWrite({ get: () => bpm, set: (v) => (bpm = v) }, 120, 140, { status: 'error' }, io, 'Tempo');
    expect(d.keep).toBe(false);
    expect(bpm).toBe(999); // the newer value survives
    expect(toasts[0].text).toBe('Write failed — Tempo');
  });

  it('still reverts when the on-screen value IS the one this write sent (not stale)', () => {
    let active = true; // the sent value is still on screen → this write is the latest
    const { io } = fakeIo();
    settleScalarWrite({ get: () => active, set: (v) => (active = v) }, false, true, { status: 'rejected' }, io, 'Tuner');
    expect(active).toBe(false); // reverted — no newer write superseded it
  });

  it('keeps a newer value on an accepted stale write (nothing to revert anyway)', () => {
    let bpm = 999; // a newer write's value
    const { io, toasts } = fakeIo();
    const d = settleScalarWrite({ get: () => bpm, set: (v) => (bpm = v) }, 120, 140, { status: 'ok' }, io, 'Tempo');
    expect(d.keep).toBe(true);
    expect(bpm).toBe(999);
    expect(toasts).toEqual([]);
  });
});
