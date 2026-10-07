import { describe, it, expect } from 'vitest';
import { decideGridOpOutcome } from './gridOpOutcome';
import type { WriteSettlement } from './paramWriteOutcome';

// Grid/routing undo fidelity — the pure decision.
//
// A grid/routing op is a sequence of discrete device writes, each settling ok / rejected / error.
// The op is one undoable step, so it must be recorded ONLY when every one of its writes landed;
// otherwise undo would replay an operation the device never completed.

const ok: WriteSettlement = { status: 'ok' };
const rejected: WriteSettlement = { status: 'rejected' };
const errored: WriteSettlement = { status: 'error' };

describe('decideGridOpOutcome', () => {
  it('records the op and stays silent when every write landed', () => {
    const d = decideGridOpOutcome([ok, ok, ok], 'Moved Amp to r2c3');
    expect(d.recordHistory).toBe(true);
    expect(d.toast).toBeNull();
  });

  it('does NOT record when a mid-op write was REFUSED, and says nothing landed', () => {
    const d = decideGridOpOutcome([ok, rejected, ok], 'Connected Amp → r2c4');
    expect(d.recordHistory).toBe(false);
    expect(d.toast?.text).toBe('Connected Amp → r2c4 — 2 of 3 landed, 1 failed');
    expect(d.toast?.accent).toBe('#f5a623'); // partial-landed warning
  });

  it('does NOT record and reports the total failure when nothing landed', () => {
    const d = decideGridOpOutcome([rejected, rejected], 'Removed block at r1c1');
    expect(d.recordHistory).toBe(false);
    expect(d.toast?.text).toBe('Removed block at r1c1 — nothing landed (2 failed)');
    expect(d.toast?.accent).toBe('#d6543f'); // refusal accent
  });

  it('treats a transport error (never confirmed) as not-landed too', () => {
    const d = decideGridOpOutcome([ok, errored], 'Disconnected all cables');
    expect(d.recordHistory).toBe(false);
    expect(d.toast?.text).toBe('Disconnected all cables — 1 of 2 landed, 1 failed');
  });

  it('never records an op that issued no writes', () => {
    const d = decideGridOpOutcome([], 'Nothing');
    expect(d.recordHistory).toBe(false);
    expect(d.toast).toBeNull();
  });
});
