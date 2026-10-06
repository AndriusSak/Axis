import { describe, it, expect, vi } from 'vitest';
import {
  runRevertPreset,
  formatRevertSlot,
  revertBarrierLabel,
  type RevertPresetSurface
} from './revertPreset';

// Revert Preset (FM3-Edit parity; audit §2.7): discard unsaved edits by re-reading the STORED
// contents of the currently-loaded slot back into the device's edit buffer.
//
// The contract these pin:
//  - it targets the CURRENTLY-loaded slot (a SAME-slot re-select), never a neighbour;
//  - it falls back to the last-known slot when the live preset ref is momentarily null;
//  - it records a history BARRIER (buffer replaced) only AFTER the device confirms the reload, so a
//    failed revert cannot silently break undo past still-live edits;
//  - it is NOT the version-history snapshot revert (`history.revertTo`).

function surface(over: Partial<RevertPresetSurface> = {}): RevertPresetSurface {
  return {
    loaded: () => ({ number: 5, name: 'My Lead' }),
    lastSlot: () => 5,
    reload: vi.fn(async () => {}),
    refresh: vi.fn(async () => {}),
    noteBufferReplaced: vi.fn(),
    toast: vi.fn(),
    ...over
  };
}

describe('runRevertPreset', () => {
  it('reverts the CURRENTLY-loaded slot (same slot, not a neighbour)', async () => {
    const s = surface({ loaded: () => ({ number: 42, name: 'X' }) });
    const out = await runRevertPreset(s);
    expect(s.reload).toHaveBeenCalledTimes(1);
    expect(s.reload).toHaveBeenCalledWith(42); // exact slot — not 41/43
    expect(out).toEqual({ kind: 'reverted', slot: 42 });
  });

  it('falls back to the last-known slot when no live preset ref is present', async () => {
    const s = surface({ loaded: () => null, lastSlot: () => 7 });
    const out = await runRevertPreset(s);
    expect(s.reload).toHaveBeenCalledWith(7);
    expect(out).toEqual({ kind: 'reverted', slot: 7 });
  });

  it('is a no-op (no device call, no barrier, no toast) when nothing is loaded', async () => {
    const s = surface({ loaded: () => null, lastSlot: () => null });
    const out = await runRevertPreset(s);
    expect(out).toEqual({ kind: 'noop', reason: 'no-preset' });
    expect(s.reload).not.toHaveBeenCalled();
    expect(s.refresh).not.toHaveBeenCalled();
    expect(s.noteBufferReplaced).not.toHaveBeenCalled();
    expect(s.toast).not.toHaveBeenCalled();
  });

  it('rejects a negative / non-integer slot as no-preset', async () => {
    const s = surface({ loaded: () => ({ number: -1, name: '' }), lastSlot: () => -1 });
    expect(await runRevertPreset(s)).toEqual({ kind: 'noop', reason: 'no-preset' });
    expect(s.reload).not.toHaveBeenCalled();
  });

  it('refreshes the UI and records a history barrier after a confirmed reload', async () => {
    const order: string[] = [];
    const s = surface({
      loaded: () => ({ number: 12, name: 'Clean' }),
      reload: vi.fn(async () => { order.push('reload'); }),
      refresh: vi.fn(async () => { order.push('refresh'); }),
      noteBufferReplaced: vi.fn((l: string) => { order.push(`barrier:${l}`); })
    });
    await runRevertPreset(s);
    expect(order).toEqual(['reload', 'refresh', 'barrier:Reverted to stored preset 012']);
    expect(s.toast).toHaveBeenCalledWith('Reverted to stored preset 012', '#35c9d6');
  });

  it('does NOT touch history/refresh and surfaces an error toast when the reload fails', async () => {
    const boom = new Error('offline');
    const s = surface({ reload: vi.fn(async () => { throw boom; }) });
    const out = await runRevertPreset(s);
    expect(out.kind).toBe('failed');
    expect(out).toMatchObject({ slot: 5, error: boom });
    expect(s.refresh).not.toHaveBeenCalled();
    expect(s.noteBufferReplaced).not.toHaveBeenCalled();
    expect(s.toast).toHaveBeenCalledWith('Revert failed — device offline?', '#d6543f');
  });

  it('formats the slot as a bank-letter code for bankLetter-addressing devices (AM4)', async () => {
    // Mirrors SaveDialog.svelte's bankCode: A01..D04 per bank of four (the app's own mapping).
    const s = surface({ loaded: () => ({ number: 9, name: '' }) });
    await runRevertPreset(s, { bankLetter: true });
    expect(s.noteBufferReplaced).toHaveBeenCalledWith('Reverted to stored preset C02');
    expect(s.toast).toHaveBeenCalledWith('Reverted to stored preset C02', '#35c9d6');
  });
});

describe('formatRevertSlot / revertBarrierLabel', () => {
  it('zero-pads numeric slots to three digits', () => {
    expect(formatRevertSlot(7)).toBe('007');
    expect(formatRevertSlot(123)).toBe('123');
  });

  it('renders bank-letter slots as A01..D04', () => {
    expect(formatRevertSlot(0, true)).toBe('A01');
    expect(formatRevertSlot(9, true)).toBe('C02');
  });

  it('labels the barrier with the reverted slot', () => {
    expect(revertBarrierLabel(42)).toBe('Reverted to stored preset 042');
  });
});
