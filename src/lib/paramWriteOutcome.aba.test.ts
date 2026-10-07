import { describe, it, expect } from 'vitest';
import {
  settleEnumWrite,
  settleScalarWrite,
  type EnumWriteIo,
  type ScalarWriteIo
} from './paramWriteOutcome';

// P9 — the write-settlement ABA caveat, PINNED as a known limitation.
//
// Background. `settleEnumWrite` / `settleScalarWrite` decide whether a refused (or failed) discrete
// write should revert the optimistic value. Their STALE-SETTLEMENT GUARD skips the revert when the
// on-screen value is no longer the value THIS write sent (`target.value !== sent` /
// `target.get() !== sent`), so a late refusal cannot clobber a NEWER write's value.
//
// That guard is value-based, not identity/time-based, so it cannot distinguish "the display still
// holds the value MY write put there" from "the display holds the value a LATER write put there that
// happens to be equal to my sent value" (an ABA sequence). The module's own comment (~:203-205)
// accepted this only for a *re-sent identical value* as a residual; this file shows an odd-length
// toggle/enum burst is exactly that case and is reachable in normal use (a ~250 ms confirmation
// window makes an A→B→C→B burst easy to issue).
//
// P9 decision: DOCUMENT, do not fix. Closing ABA needs per-control WRITE-INITIATION ordering, which
// is information the pure settle signature provably cannot carry (its inputs are target + from +
// sent + outcome — a stateless snapshot); it can only be supplied by the store minting a token at
// write time or by hoisting a stable per-control target so the module can key a WeakMap on it. Both
// widen the contract that seven store call sites and their sourceguard regexes depend on, and neither
// is compiler-verifiable inside this round's single-file test budget (node-env vitest cannot compile
// `.svelte.ts`). So these tests assert the CURRENT behaviour and name it a KNOWN LIMITATION; if ABA
// ever matters in practice, the upgrade is the per-control token the module comment names.
//
// NOTE: these tests do NOT weaken the existing guarantees — the guard still works whenever the
// superseding write's value differs from the refused write's sent value (positive control at the
// bottom, and the pre-existing "-stale-settlement guard" suites).

function enumIo() {
  const io: EnumWriteIo = { dropHistory: () => {}, toast: () => {} };
  return io;
}
function scalarIo() {
  const io: ScalarWriteIo = { toast: () => {} };
  return io;
}

// ── 1. ABA on a boolean toggle burst (bypass / tuner) ───────────────────────────────────────────
// A→B→C→B is an ODD-length burst that returns to the first write's sent value, so a late refusal of
// the FIRST write is not seen as stale and reverts the display, wiping the THIRD write's value.
describe('KNOWN LIMITATION (P9) — ABA: a same-value burst defeats the value-based stale guard', () => {
  it('scalar toggle false→true→false→true: the 1st write\'s late refusal wipes the 3rd write\'s value', () => {
    // The user toggled tuner on, off, then on again. The 3rd write set `true`; the display is `true`.
    let active = true; // == the 1st write's sent value (this is the ABA)
    const settled = settleScalarWrite(
      { get: () => active, set: (v) => (active = v) },
      /* from */ false,
      /* sent */ true, // the FIRST write: false→true; its refusal settles late
      { status: 'rejected' },
      scalarIo(),
      'Tuner'
    );
    expect(settled.keep).toBe(false); // the 1st write genuinely did not land
    // KNOWN LIMITATION: the guard reads target.get() (true) === sent (true) → "not stale" → it
    // reverts to `from` (false), wiping the 3rd write's on-state. A token would tell them apart.
    expect(active).toBe(false);
  });

  it('enum burst B, C, B: the 1st write\'s late refusal wipes the 3rd write\'s value', () => {
    // Enum A→B then B→C then C→B; the display is B again, equal to the 1st write's sent value.
    const target = { name: 'Model', value: 3 }; // B (3) — the 3rd write re-sent it
    const settled = settleEnumWrite(
      target,
      /* from */ 2, // A
      /* sent */ 3, // B — the FIRST write: A→B; its refusal settles late
      'h1',
      { status: 'rejected' },
      enumIo()
    );
    expect(settled.keep).toBe(false);
    // KNOWN LIMITATION: reverted to A (2), wiping the newer B (3) the 3rd write set.
    expect(target.value).toBe(2);
  });
});

// ── 2. Double refusal can leave an UNCONFIRMED value on screen ───────────────────────────────────
// `from` is captured from OPTIMISTIC state (editor.svelte.ts:1679 `const from = e.value`). In a burst
// the second write's `from` is the first write's never-confirmed value, so a double refusal ends with
// the display showing that unconfirmed value while the device still holds the original.
describe('KNOWN LIMITATION (P9) — double refusal leaves an unconfirmed value (from = optimistic, not confirmed)', () => {
  it('1st refusal stale (no revert) + 2nd refusal reverts to the 2nd write\'s unconfirmed `from`', () => {
    // w1: A→B (from A=1, sent B=2). w2: B→C (from B=2, sent C=3). The display is C.
    let scene = 3; // C — w2's optimistic value is on screen
    // (w1 has already settled, refused but STALE — the display had moved past B, so w1 did not revert)
    // Now w2 settles, refused, and IS "not stale" (display 3 === sent 3) → it reverts to `from` = B.
    const settled = settleScalarWrite(
      { get: () => scene, set: (v) => (scene = v) },
      /* from */ 2, // B — captured optimistically by w2; B was NEVER confirmed by the device
      /* sent */ 3, // C — w2
      { status: 'rejected' },
      scalarIo(),
      'Scene'
    );
    expect(settled.keep).toBe(false);
    // KNOWN LIMITATION: the display now shows B (2) while the device still holds A (1) — an
    // unconfirmed value left on screen. Capturing `from` as the LAST CONFIRMED value would fix this,
    // but that needs per-control confirmed-value state the pure module does not receive (see the
    // module comment); it is the same store-state the token upgrade would need.
    expect(scene).toBe(2);
  });
});

// ── Positive control: the guard STILL protects the ordinary (non-ABA) supersession case ──────────
// A newer write whose value DIFFERS from the refused write's sent value is detected as stale and the
// revert is skipped — the guarantee P6 established must remain intact.
describe('positive control — the stale guard still fires when the newer value differs from `sent`', () => {
  it('scalar: a newer distinct value is not clobbered by an earlier refusal', () => {
    let scene = 5; // a newer write's value, distinct from this write's sent (2)
    settleScalarWrite({ get: () => scene, set: (v) => (scene = v) }, 1, 2, { status: 'rejected' }, scalarIo(), 'Scene');
    expect(scene).toBe(5);
  });

  it('enum: a newer distinct value is not clobbered by an earlier refusal', () => {
    const target = { name: 'Model', value: 7 }; // a newer write's value, distinct from sent (3)
    settleEnumWrite(target, 2, 3, 'h1', { status: 'rejected' }, enumIo());
    expect(target.value).toBe(7);
  });
});
