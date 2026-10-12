import { describe, expect, it, vi } from 'vitest';
import {
  applyBoolToggle,
  applySlotStep,
  FC_UNREAD_MARKER,
  planBoolToggle,
  planSlotStep,
  readBoolSlot,
  readFieldValue,
  readSlotValue,
  type FcSlotWriter
} from './fcSlotEdit';
import type { AxisFcSlotLike } from './fcWorkbenchData';

// Finder #1: the panel fabricated a 0 for an unread field/slot and then WROTE from it. These cases
// pin the two write paths — the stepper (`min ± 1` from a guessed 0) and the bool pill (a hard `1`
// from a guessed "off") — as REFUSALS: the writer is a spy and must never be called while the value
// is unread. They also pin every read as `number | null`, so a real `0` stays distinguishable.
const spyWriter = (): FcSlotWriter & { writeSlot: ReturnType<typeof vi.fn> } => ({
  writeSlot: vi.fn(async () => true)
});

const slot = (over: Partial<AxisFcSlotLike> = {}): AxisFcSlotLike => ({
  i: 2,
  role: 'Value',
  type: 'int',
  min: 0,
  max: 127,
  ...over
});

describe('readSlotValue / readFieldValue / readBoolSlot — unread is null, a real 0 is 0', () => {
  it('returns null for an absent slot, and 0 for a real read of 0', () => {
    expect(readSlotValue({}, 'tap', 2, 7)).toBeNull();
    expect(readSlotValue({ 'tapParams#2:7': 0 }, 'tap', 2, 7)).toBe(0);
  });

  it('returns null for an absent field, and the value when present', () => {
    expect(readFieldValue({}, 'tapCategory', 7)).toBeNull();
    expect(readFieldValue({ 'tapCategory:7': 3 }, 'tapCategory', 7)).toBe(3);
  });

  it('reports a bool slot as null when unread, not as "off"', () => {
    expect(readBoolSlot({}, 'tap', 2, 7)).toBeNull();
    expect(readBoolSlot({ 'tapParams#2:7': 0 }, 'tap', 2, 7)).toBe(false);
    expect(readBoolSlot({ 'tapParams#2:7': 1 }, 'tap', 2, 7)).toBe(true);
  });
});

describe('the STEP write is REFUSED while the slot is unread', () => {
  it('plans null (no target value) for an unread slot', () => {
    expect(planSlotStep({}, 'tap', slot({ min: 1, max: 8 }), 7, 1)).toBeNull();
  });

  it('does NOT call writeSlot — the pre-fix `min ± 1` guess is never sent', async () => {
    const writer = spyWriter();
    const ok = await applySlotStep(writer, {}, 'tap', slot({ min: 1, max: 8 }), 7, 1);
    expect(ok).toBe(false);
    expect(writer.writeSlot).not.toHaveBeenCalled();
  });

  it('steps normally once a real value has been read, clamped to the slot range', async () => {
    const writer = spyWriter();
    const ok = await applySlotStep(writer, { 'tapParams#2:7': 3 }, 'tap', slot({ min: 1, max: 8 }), 7, 1);
    expect(ok).toBe(true);
    expect(writer.writeSlot).toHaveBeenCalledWith('tap', 2, 4, 7);
  });
});

describe('the BOOL TOGGLE write is REFUSED while the slot is unread', () => {
  it('plans null for an unread slot (pressing used to write a hard 1)', () => {
    expect(planBoolToggle({}, 'tap', 2, 7)).toBeNull();
  });

  it('does NOT call writeSlot when unread', async () => {
    const writer = spyWriter();
    const ok = await applyBoolToggle(writer, {}, 'tap', 2, 7);
    expect(ok).toBe(false);
    expect(writer.writeSlot).not.toHaveBeenCalled();
  });

  it('toggles once read: off→1, on→0', async () => {
    const off = spyWriter();
    await applyBoolToggle(off, { 'tapParams#2:7': 0 }, 'tap', 2, 7);
    expect(off.writeSlot).toHaveBeenCalledWith('tap', 2, 1, 7);

    const on = spyWriter();
    await applyBoolToggle(on, { 'tapParams#2:7': 1 }, 'tap', 2, 7);
    expect(on.writeSlot).toHaveBeenCalledWith('tap', 2, 0, 7);
  });
});

describe('the unread marker is an em dash, never 0', () => {
  it('states the marker explicitly', () => {
    expect(FC_UNREAD_MARKER).toBe('—');
    expect(FC_UNREAD_MARKER).not.toBe('0');
  });
});
