import { describe, it, expect, beforeEach } from 'vitest';
import {
  beginWrite,
  settleScalarWrite,
  resetWriteSequencer,
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
// P11 — the scalar path uses the SAME write sequencer as the enum path: the store mints a token via
// `beginWrite(key, from)` (the key is a stable string: `bypass:<eid>` / `scene` / `tempo` / `tuner`),
// staleness is write-IDENTITY (token, not `target.get() !== sent`), and a non-stale refusal reverts
// to the last device-CONFIRMED value rather than the optimistic `from`. The ABA / double-refusal
// cases are asserted as CORRECT behaviour in paramWriteOutcome.aba.test.ts.

beforeEach(() => resetWriteSequencer());

function fakeIo() {
  const toasts: { text: string; accent: string }[] = [];
  const io: ScalarWriteIo = { toast: (text, accent) => toasts.push({ text, accent }) };
  return { io, toasts };
}

describe('settleScalarWrite (numeric scalar — tempo)', () => {
  it('keeps the optimistic value and says nothing when the device accepted the write', () => {
    let bpm = 140; // the optimistic tempo (and the value this write sent)
    const token = beginWrite('tempo', 120);
    const { io, toasts } = fakeIo();
    const d = settleScalarWrite({ get: () => bpm, set: (v) => (bpm = v) }, token, 140, { status: 'ok' }, io, 'Tempo');
    expect(d.keep).toBe(true);
    expect(bpm).toBe(140); // the write landed — keep it
    expect(toasts).toEqual([]);
  });

  it('reverts to the confirmed `from` and toasts when the device REFUSED the write ({ok:false})', () => {
    let bpm = 140; // optimistic (still this write's)
    const token = beginWrite('tempo', 120);
    const { io, toasts } = fakeIo();
    const d = settleScalarWrite({ get: () => bpm, set: (v) => (bpm = v) }, token, 140, { status: 'rejected' }, io, 'Tempo');
    expect(d.keep).toBe(false);
    expect(bpm).toBe(120); // reverted — a refused tempo must not stay on screen
    expect(toasts).toEqual([{ text: 'Write rejected by device — Tempo', accent: '#d6543f' }]);
  });

  it('reverts + toasts on a thrown transport error too', () => {
    let bpm = 140;
    const token = beginWrite('tempo', 120);
    const { io, toasts } = fakeIo();
    settleScalarWrite({ get: () => bpm, set: (v) => (bpm = v) }, token, 140, { status: 'error' }, io, 'Tempo');
    expect(bpm).toBe(120);
    expect(toasts[0].text).toBe('Write failed — Tempo');
  });
});

describe('settleScalarWrite (boolean scalar — tuner on/off)', () => {
  it('keeps the toggled value on an accepted write', () => {
    let active = true;
    const token = beginWrite('tuner', false);
    const { io, toasts } = fakeIo();
    settleScalarWrite({ get: () => active, set: (v) => (active = v) }, token, true, { status: 'ok' }, io, 'Tuner');
    expect(active).toBe(true);
    expect(toasts).toEqual([]);
  });

  it('reverts the toggle when the device REFUSED it ({ok:false})', () => {
    let active = true; // `this.tuner = { active: next }` optimistic
    const token = beginWrite('tuner', false);
    const { io, toasts } = fakeIo();
    const d = settleScalarWrite({ get: () => active, set: (v) => (active = v) }, token, true, { status: 'rejected' }, io, 'Tuner');
    expect(d.keep).toBe(false);
    expect(active).toBe(false); // reverted to the captured `from`
    expect(toasts).toEqual([{ text: 'Write rejected by device — Tuner', accent: '#d6543f' }]);
  });

  it('reverts the toggle on a thrown transport error too', () => {
    let active = true;
    const token = beginWrite('tuner', false);
    const { io, toasts } = fakeIo();
    settleScalarWrite({ get: () => active, set: (v) => (active = v) }, token, true, { status: 'error' }, io, 'Tuner');
    expect(active).toBe(false);
    expect(toasts[0].text).toBe('Write failed — Tuner');
  });
});

describe('settleScalarWrite exhaustiveness', () => {
  const all: WriteSettlement[] = [{ status: 'ok' }, { status: 'rejected' }, { status: 'error' }];
  it('only the accepted outcome keeps the optimistic scalar', () => {
    const kept = all.map((s) => {
      let v = 9;
      settleScalarWrite({ get: () => v, set: (x) => (v = x) }, beginWrite('x', 3), 9, s, { toast: () => {} }, 'X');
      return v;
    });
    expect(kept).toEqual([9, 3, 3]);
  });
  it('every non-accepted outcome surfaces a toast', () => {
    const toasts: string[] = [];
    for (const s of all) {
      settleScalarWrite({ get: () => 3, set: () => {} }, beginWrite('x', 3), 3, s, { toast: (t) => toasts.push(t) }, 'X');
    }
    expect(toasts.length).toBe(2); // rejected + error; ok stays silent
  });
});

// P6 — a stale settlement must not clobber a newer value; P11 makes the check write-identity so a
// same-value (ABA) burst cannot defeat it. A control's display can move on while an earlier write's
// round-trip is still queued; that earlier refusal must not revert the newer value.
describe('settleScalarWrite — stale-settlement guard (P6/P11)', () => {
  it('does NOT clobber a newer value a later write superseded', () => {
    let scene = 3; // C — a newer write already moved the display on
    const tOld = beginWrite('scene', 1); // this settlement belongs to the earlier write (sent 2)
    beginWrite('scene', 2);              // a newer write begins → the earlier one is stale
    const { io, toasts } = fakeIo();
    const d = settleScalarWrite({ get: () => scene, set: (v) => (scene = v) }, tOld, 2, { status: 'rejected' }, io, 'Scene');
    expect(d.keep).toBe(false);            // the write genuinely did not land
    expect(scene).toBe(3);                 // …but the newer C survives — the stale revert is skipped
    expect(toasts[0].text).toBe('Write rejected by device — Scene'); // the refusal is still surfaced
  });

  it('skips the revert on a stale transport error too', () => {
    let bpm = 999; // C — a newer write already landed on screen
    const tOld = beginWrite('tempo', 120);
    beginWrite('tempo', 140); // a newer write began → stale
    const { io, toasts } = fakeIo();
    const d = settleScalarWrite({ get: () => bpm, set: (v) => (bpm = v) }, tOld, 140, { status: 'error' }, io, 'Tempo');
    expect(d.keep).toBe(false);
    expect(bpm).toBe(999); // the newer value survives
    expect(toasts[0].text).toBe('Write failed — Tempo');
  });

  it('still reverts when this write IS the control\'s latest (not stale)', () => {
    let active = true;
    const token = beginWrite('tuner', false);
    const { io } = fakeIo();
    settleScalarWrite({ get: () => active, set: (v) => (active = v) }, token, true, { status: 'rejected' }, io, 'Tuner');
    expect(active).toBe(false); // reverted — no newer write superseded it
  });

  it('keeps a newer value on an accepted stale write (nothing to revert anyway)', () => {
    let bpm = 999; // a newer write's value
    const tOld = beginWrite('tempo', 120);
    beginWrite('tempo', 140); // stale
    const { io, toasts } = fakeIo();
    const d = settleScalarWrite({ get: () => bpm, set: (v) => (bpm = v) }, tOld, 140, { status: 'ok' }, io, 'Tempo');
    expect(d.keep).toBe(true);
    expect(bpm).toBe(999);
    expect(toasts).toEqual([]);
  });
});
