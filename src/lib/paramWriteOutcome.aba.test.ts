import { describe, it, expect, beforeEach } from 'vitest';
import {
  beginWrite,
  settleEnumWrite,
  settleScalarWrite,
  resetWriteSequencer,
  type EnumWriteIo,
  type ScalarWriteIo
} from './paramWriteOutcome';

// P11 — the write-settlement ABA and double-refusal cases, asserted as CORRECT behaviour.
//
// Background. `settleEnumWrite` / `settleScalarWrite` decide whether a refused (or failed) write
// should revert the optimistic value. P9's guard compared VALUES (`stale = value !== sent`) and
// reverted to the optimistic `from`, which left two reachable defects:
//
//   (1) ABA — an odd-length same-value burst (A→B→C→B) makes an older write's value equal the
//       on-screen value again, so its late refusal looked un-superseded and reverted to its `from`,
//       wiping the newer write.
//   (2) Double refusal — `from` is captured from OPTIMISTIC state, so a second refusal in a burst
//       reverted to a value the device never confirmed, leaving it on screen.
//
// P9 chose to DOCUMENT these as a "known limitation" on the argument that the pure settle signature
// could not carry write-initiation ordering. That was overstated: a per-control write SEQUENCER in
// the pure module fixes both, needs no store-minted token, and runs in the node-env harness with
// plain objects. P11 implements it — `beginWrite(key, current)` mints a token before the await, the
// settle helpers take that token, staleness is `token.n !== latest` (IDENTITY, not value), and a
// non-stale refusal reverts to the last device-CONFIRMED value rather than the optimistic `from`.
// These tests therefore assert the FIXED behaviour; if the sequencer regresses to a value compare
// they fail loudly.
//
// (Mechanistic note: the trigger for overlapping writes is NOT the confirmation window — a refusal
// closes the watch immediately via `match: isOurReject`; the 250 ms gates only the silent accept.
// Overlap comes from a write queued behind slow reads, or a transport drop mid-burst.)

beforeEach(() => resetWriteSequencer());

function enumIo(): EnumWriteIo {
  return { dropHistory: () => {}, toast: () => {} };
}
function scalarIo(): ScalarWriteIo {
  return { toast: () => {} };
}

// ── 1. ABA on a boolean toggle burst (bypass / tuner) ───────────────────────────────────────────
// A→B→C→B is an ODD-length burst that returns to the first write's sent value. The first write's late
// refusal must NOT be treated as current — it is superseded by the third write — so the display keeps
// the third write's value.
describe('ABA (P11) — a same-value burst no longer defeats the stale guard', () => {
  it('scalar toggle false→true→false→true: the 1st write\'s late refusal does NOT wipe the 3rd write', () => {
    // The user toggled tuner on, off, then on again. The 3rd write set `true`; the display is `true`.
    let active = false;
    const t1 = beginWrite('tuner', false); active = true;  // w1: false→true (this refusal settles late)
    const t2 = beginWrite('tuner', true);  active = false; // w2: true→false
    const t3 = beginWrite('tuner', false); active = true;  // w3: false→true — the latest write

    // w1 settles late, refused — but it is superseded (latest is t3), so it must NOT revert.
    settleScalarWrite({ get: () => active, set: (v) => (active = v) }, t1, true, { status: 'rejected' }, scalarIo(), 'Tuner');
    expect(active).toBe(true); // the 3rd write's on-state survives

    // w2 also superseded → no revert.
    settleScalarWrite({ get: () => active, set: (v) => (active = v) }, t2, false, { status: 'rejected' }, scalarIo(), 'Tuner');
    expect(active).toBe(true);

    // w3 (the latest) refused → revert to the CONFIRMED value (the pre-burst `false`), never to a guess.
    settleScalarWrite({ get: () => active, set: (v) => (active = v) }, t3, true, { status: 'rejected' }, scalarIo(), 'Tuner');
    expect(active).toBe(false); // the device never confirmed `true`; `false` is what it holds
  });

  it('enum burst A→B→C→B: the 1st write\'s late refusal does NOT wipe the 3rd write', () => {
    const target = { name: 'Model', value: 2 }; // A
    const t1 = beginWrite(target, 2); target.value = 3; // w1 A→B (settles late, refused)
    const t2 = beginWrite(target, 3); target.value = 4; // w2 B→C
    const t3 = beginWrite(target, 4); target.value = 3; // w3 C→B — the latest write re-sends B

    // w3 is the latest and the device ACCEPTED it → confirmed = B (3), display stays 3.
    settleEnumWrite(target, t3, 3, 'h3', { status: 'ok' }, enumIo());
    expect(target.value).toBe(3);

    // w1's late refusal: display (3) equals w1's sent (3) — the ABA — but w1 is superseded → skip.
    settleEnumWrite(target, t1, 3, 'h1', { status: 'rejected' }, enumIo());
    expect(target.value).toBe(3); // the newer B survives (old code reverted to A=2)
  });
});

// ── 2. Double refusal can no longer leave an UNCONFIRMED value on screen ─────────────────────────
// `from` is captured from OPTIMISTIC state (`editor.svelte.ts` `setEnum`/`selectScene`). In a burst
// the second write's `from` is the first write's never-confirmed value; reverting to it left a value
// on screen the device never held. The sequencer reverts to the last CONFIRMED value instead.
describe('double refusal (P11) — reverts to the last device-CONFIRMED value, not an optimistic `from`', () => {
  it('1st refusal superseded (no revert) + 2nd refusal reverts to the confirmed value', () => {
    // w1: A→B (from A=1, sent B=2). w2: B→C (from B=2, sent C=3). The device still holds A (1).
    let scene = 1; // A — the device-confirmed value
    const t1 = beginWrite('scene', 1); scene = 2; // w1 A→B
    const t2 = beginWrite('scene', 2); scene = 3; // w2 B→C — the latest write

    // w1 settles first, refused but superseded → no revert.
    settleScalarWrite({ get: () => scene, set: (v) => (scene = v) }, t1, 2, { status: 'rejected' }, scalarIo(), 'Scene');
    expect(scene).toBe(3);

    // w2 settles, refused, and IS the latest → revert to the CONFIRMED value A (1), never to B (2).
    settleScalarWrite({ get: () => scene, set: (v) => (scene = v) }, t2, 3, { status: 'rejected' }, scalarIo(), 'Scene');
    expect(scene).toBe(1); // the device holds A; the unconfirmed B must not remain on screen
  });

  it('a single refusal still reverts to its `from` (which IS the confirmed value when idle)', () => {
    let scene = 1;
    const t1 = beginWrite('scene', 1); scene = 2;
    settleScalarWrite({ get: () => scene, set: (v) => (scene = v) }, t1, 2, { status: 'rejected' }, scalarIo(), 'Scene');
    expect(scene).toBe(1);
  });
});

// ── Positive control: the guard STILL protects the ordinary (non-ABA) supersession case ──────────
// A newer write whose value DIFFERS from the refused write's sent value is detected as stale and the
// revert is skipped — the guarantee P6 established must remain intact.
describe('positive control — a newer distinct value is not clobbered by an earlier refusal', () => {
  it('scalar: a newer distinct value is not clobbered by an earlier refusal', () => {
    let scene = 5; // a newer write's value, distinct from this write's sent (2)
    const tOld = beginWrite('scene', 1);
    beginWrite('scene', 2); // a newer write began → stale
    settleScalarWrite({ get: () => scene, set: (v) => (scene = v) }, tOld, 2, { status: 'rejected' }, scalarIo(), 'Scene');
    expect(scene).toBe(5);
  });

  it('enum: a newer distinct value is not clobbered by an earlier refusal', () => {
    const target = { name: 'Model', value: 7 }; // a newer write's value, distinct from sent (3)
    const tOld = beginWrite(target, 2);
    beginWrite(target, 7); // a newer write began → stale
    settleEnumWrite(target, tOld, 3, 'h1', { status: 'rejected' }, enumIo());
    expect(target.value).toBe(7);
  });
});

// ── Freshness: once a burst is over the sequencer forgets the key, so the next write re-seeds its
// confirmed value from the idle on-screen value (which, with nothing in flight, is the device truth).
describe('sequencer freshness — a new burst re-seeds the confirmed value', () => {
  it('a write after an idle gap reverts to the CURRENT on-screen value, not a stale earlier one', () => {
    let scene = 1;
    const t1 = beginWrite('scene', 1); scene = 2; // burst 1
    settleScalarWrite({ get: () => scene, set: (v) => (scene = v) }, t1, 2, { status: 'ok' }, scalarIo(), 'Scene');
    expect(scene).toBe(2); // accepted, burst over (state dropped)

    // The device moved on externally; the display is now 8.
    scene = 8;
    const t2 = beginWrite('scene', 8); scene = 9; // burst 2
    settleScalarWrite({ get: () => scene, set: (v) => (scene = v) }, t2, 9, { status: 'rejected' }, scalarIo(), 'Scene');
    expect(scene).toBe(8); // reverts to the value confirmed at THIS burst's start, not the old 1
  });
});
