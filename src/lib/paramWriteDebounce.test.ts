import { describe, it, expect, vi, afterEach } from 'vitest';
import { ParamWriteDebouncer, paramWriteKey } from './paramWriteDebounce';

// The pure debouncer behind editor's continuous param writes. The regression it closes: the timers were
// keyed by PARAM ID only, so a write to pid N on one block was cancelled by a write to pid N on another
// block within the window and one write was silently dropped.

describe('paramWriteKey', () => {
  it('namespaces the param id by its block', () => {
    expect(paramWriteKey(11, 5)).toBe('11:5');
    expect(paramWriteKey(22, 5)).toBe('22:5');
    expect(paramWriteKey(11, 5)).not.toBe(paramWriteKey(22, 5)); // two blocks never share a slot
  });
});

describe('ParamWriteDebouncer', () => {
  afterEach(() => vi.useRealTimers());

  it('keeps writes to the SAME pid on DIFFERENT blocks independent (both survive)', () => {
    vi.useFakeTimers();
    const d = new ParamWriteDebouncer();
    const ran: string[] = [];
    d.schedule(11, 5, 50, () => ran.push('block11:pid5'));
    d.schedule(22, 5, 50, () => ran.push('block22:pid5')); // same pid, different block
    vi.advanceTimersByTime(60);
    expect(ran.sort()).toEqual(['block11:pid5', 'block22:pid5']); // NEITHER is dropped
  });

  it('coalesces repeated writes to the SAME (block,param) into one trailing run', () => {
    vi.useFakeTimers();
    const d = new ParamWriteDebouncer();
    let runs = 0;
    d.schedule(11, 5, 50, () => runs++);
    vi.advanceTimersByTime(20);
    d.schedule(11, 5, 50, () => runs++); // replaces the pending one
    vi.advanceTimersByTime(20);
    expect(runs).toBe(0); // still inside the (reset) window
    vi.advanceTimersByTime(40);
    expect(runs).toBe(1); // only the last of the two ran
  });

  it('cancel drops a pending write for that (block,param) only', () => {
    vi.useFakeTimers();
    const d = new ParamWriteDebouncer();
    const ran: string[] = [];
    d.schedule(11, 5, 50, () => ran.push('a'));
    d.schedule(11, 6, 50, () => ran.push('b'));
    d.cancel(11, 5);
    vi.advanceTimersByTime(60);
    expect(ran).toEqual(['b']);
  });
});
