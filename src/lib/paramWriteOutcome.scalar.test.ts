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
// `settleScalarWrite` is the pure core; the store wiring is pinned by refusedWrite.sourceguard.test.ts.

function fakeIo() {
  const toasts: { text: string; accent: string }[] = [];
  const io: ScalarWriteIo = { toast: (text, accent) => toasts.push({ text, accent }) };
  return { io, toasts };
}

describe('settleScalarWrite (numeric scalar — tempo)', () => {
  it('keeps the optimistic value and says nothing when the device accepted the write', () => {
    let bpm = 140; // the optimistic tempo
    const { io, toasts } = fakeIo();
    const d = settleScalarWrite({ set: (v) => (bpm = v) }, 120, { status: 'ok' }, io, 'Tempo');
    expect(d.keep).toBe(true);
    expect(bpm).toBe(140); // the write landed — keep it
    expect(toasts).toEqual([]);
  });

  it('reverts to `from` and toasts when the device REFUSED the write ({ok:false})', () => {
    let bpm = 140; // optimistic
    const { io, toasts } = fakeIo();
    const d = settleScalarWrite({ set: (v) => (bpm = v) }, 120, { status: 'rejected' }, io, 'Tempo');
    expect(d.keep).toBe(false);
    expect(bpm).toBe(120); // reverted — a refused tempo must not stay on screen
    expect(toasts).toEqual([{ text: 'Write rejected by device — Tempo', accent: '#d6543f' }]);
  });

  it('reverts + toasts on a thrown transport error too', () => {
    let bpm = 140;
    const { io, toasts } = fakeIo();
    settleScalarWrite({ set: (v) => (bpm = v) }, 120, { status: 'error' }, io, 'Tempo');
    expect(bpm).toBe(120);
    expect(toasts[0].text).toBe('Write failed — Tempo');
  });
});

describe('settleScalarWrite (boolean scalar — tuner on/off)', () => {
  it('keeps the toggled value on an accepted write', () => {
    let active = true;
    const { io, toasts } = fakeIo();
    settleScalarWrite({ set: (v) => (active = v) }, false, { status: 'ok' }, io, 'Tuner');
    expect(active).toBe(true);
    expect(toasts).toEqual([]);
  });

  it('reverts the toggle when the device REFUSED it ({ok:false})', () => {
    let active = true; // `this.tuner = { active: next }` optimistic
    const { io, toasts } = fakeIo();
    const d = settleScalarWrite({ set: (v) => (active = v) }, false, { status: 'rejected' }, io, 'Tuner');
    expect(d.keep).toBe(false);
    expect(active).toBe(false); // reverted to the captured `from`
    expect(toasts).toEqual([{ text: 'Write rejected by device — Tuner', accent: '#d6543f' }]);
  });

  it('reverts the toggle on a thrown transport error too', () => {
    let active = true;
    const { io, toasts } = fakeIo();
    settleScalarWrite({ set: (v) => (active = v) }, false, { status: 'error' }, io, 'Tuner');
    expect(active).toBe(false);
    expect(toasts[0].text).toBe('Write failed — Tuner');
  });
});

describe('settleScalarWrite exhaustiveness', () => {
  const all: WriteSettlement[] = [{ status: 'ok' }, { status: 'rejected' }, { status: 'error' }];
  it('only the accepted outcome keeps the optimistic scalar', () => {
    const kept = all.map((s) => {
      let v = 9;
      settleScalarWrite({ set: (x) => (v = x) }, 3, s, { toast: () => {} }, 'X');
      return v;
    });
    expect(kept).toEqual([9, 3, 3]);
  });
  it('every non-accepted outcome surfaces a toast', () => {
    const toasts: string[] = [];
    for (const s of all) {
      settleScalarWrite({ set: () => {} }, 3, s, { toast: (t) => toasts.push(t) }, 'X');
    }
    expect(toasts.length).toBe(2); // rejected + error; ok stays silent
  });
});
