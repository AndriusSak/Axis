import { describe, it, expect } from 'vitest';
import {
  settleWriteSet,
  type WriteSettlement
} from './paramWriteOutcome';

// P2.1 — a SET of device writes must report what actually LANDED, not what was requested.
//
// The defect: `pasteChannel` (and `recallBlockEntry`, the block-paste `#applyClip`, `applyCab`) did
// `for (const w of writes) await forgefx.setParam(...).catch(() => {})` and then reported
// `writes.length` as if every write had landed — while `.catch(() => {})` swallowed both a transport
// error AND the server's HTTP-200 `{ok:false}` rejection, and the history checkpoint had already
// fired over a set that may never have reached the device.
//
// This is the pure aggregation: given each write's WriteSettlement, return the honest counts + the
// decision (checkpoint only when something landed; what to toast). The store wiring is pinned by
// refusedWrite.sourceguard.test.ts. NOTE: these sites reload params from the device after the write
// set (no optimistic local value is kept), so there is nothing local to revert here — the "failed"
// write simply must not be counted as landed.

const OK: WriteSettlement = { status: 'ok' };
const REJ: WriteSettlement = { status: 'rejected' }; // server HTTP 200 {ok:false}
const ERR: WriteSettlement = { status: 'error' };    // thrown transport/API error

describe('settleWriteSet — counts', () => {
  it('reports every write as landed when the device accepted them all', () => {
    const r = settleWriteSet([OK, OK, OK], { subject: 'Pasted channel A → B' });
    expect(r.requested).toBe(3);
    expect(r.landed).toBe(3);
    expect(r.failed).toBe(0);
    expect(r.rejected).toBe(0);
    expect(r.errored).toBe(0);
    expect(r.allLanded).toBe(true);
    expect(r.noneLanded).toBe(false);
  });

  it('counts a {ok:false} rejection AND a thrown error as failed (mixed set)', () => {
    const r = settleWriteSet([OK, REJ, ERR], { subject: 'Pasted channel A → B' });
    expect(r.requested).toBe(3);
    expect(r.landed).toBe(1);
    expect(r.failed).toBe(2);
    expect(r.rejected).toBe(1);
    expect(r.errored).toBe(1);
    expect(r.allLanded).toBe(false);
    expect(r.noneLanded).toBe(false);
  });

  it('does NOT count a rejection as landed (the P2.1 defect)', () => {
    // the cross-preset pattern only caught THROWS, so a {ok:false} writes was reported as written
    const r = settleWriteSet([REJ, OK], { subject: 'X' });
    expect(r.landed).toBe(1); // not 2
  });
});

describe('settleWriteSet — checkpoint decision', () => {
  it('checkpoints when at least one write landed', () => {
    expect(settleWriteSet([OK, REJ], { subject: 'X' }).checkpoint).toBe(true);
    expect(settleWriteSet([OK], { subject: 'X' }).checkpoint).toBe(true);
  });

  it('does NOT checkpoint a zero-landed set', () => {
    const r = settleWriteSet([REJ, ERR], { subject: 'Recalled “Foo”' });
    expect(r.landed).toBe(0);
    expect(r.noneLanded).toBe(true);
    expect(r.checkpoint).toBe(false);
  });

  it('does not checkpoint an empty set', () => {
    const r = settleWriteSet([], { subject: 'X' });
    expect(r.requested).toBe(0);
    expect(r.checkpoint).toBe(false);
    expect(r.toast).toBeNull();
  });
});

describe('settleWriteSet — toast reflects reality', () => {
  it('toasts the landed count (not the requested count) on a clean set', () => {
    const r = settleWriteSet([OK, OK, OK, OK, OK], { subject: 'Pasted channel A → B' });
    expect(r.toast).toEqual({ text: 'Pasted channel A → B — 5 values', accent: '#33c46b' });
  });

  it('singularises a one-value success toast', () => {
    const r = settleWriteSet([OK], { subject: 'X', noun: 'value' });
    expect(r.toast?.text).toBe('X — 1 value');
  });

  it('says how many landed vs failed on a partial failure (amber)', () => {
    const r = settleWriteSet([OK, OK, REJ, ERR, OK], { subject: 'Recalled “Foo”' });
    expect(r.toast?.text).toBe('Recalled “Foo” — 3 of 5 landed, 2 failed');
    expect(r.toast?.accent).toBe('#f5a623');
  });

  it('reports nothing landed (red) when every write failed', () => {
    const r = settleWriteSet([REJ, ERR], { subject: 'Recalled “Foo”' });
    expect(r.toast?.text).toBe('Recalled “Foo” — nothing landed (2 failed)');
    expect(r.toast?.accent).toBe('#d6543f');
  });

  it('can suppress the success toast (a caller that shows its own) but still reports failures', () => {
    const ok = settleWriteSet([OK, OK], { subject: 'Cab change', successToast: false });
    expect(ok.toast).toBeNull();
    const bad = settleWriteSet([OK, REJ], { subject: 'Cab change', successToast: false });
    expect(bad.toast?.text).toBe('Cab change — 1 of 2 landed, 1 failed');
  });

  it('honours a custom counted noun', () => {
    const r = settleWriteSet([OK, OK], { subject: 'X', noun: 'setting' });
    expect(r.toast?.text).toBe('X — 2 settings');
  });
});
