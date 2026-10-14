import { describe, it, expect } from 'vitest';
import { PRESET_PICKER_SOFT_ROW_CAP, applyPresetPickerRowCap } from './presetListCap';

// The picker's cap must never make the tail of the slot list unreachable: capping is only allowed
// together with an expander, so every branch here is asserted on `capped` / `hiddenCount` too — the
// values a caller renders its disclosure from (`listCaps.test.ts` guards the caller side).
const slots = (n: number) => Array.from({ length: n }, (_, i) => ({ n: i }));

describe('applyPresetPickerRowCap', () => {
  it('caps an FM3-sized slot list at 300 and reports the hidden tail', () => {
    const r = applyPresetPickerRowCap(slots(512), false);
    expect(r.rows).toHaveLength(PRESET_PICKER_SOFT_ROW_CAP);
    expect(r.rows[0].n).toBe(0);
    expect(r.rows[r.rows.length - 1].n).toBe(299);
    expect(r.totalRows).toBe(512);
    expect(r.capped).toBe(true);
    expect(r.hiddenCount).toBe(212);
  });

  it('returns every row once the expander has been used', () => {
    const r = applyPresetPickerRowCap(slots(512), true);
    expect(r.rows).toHaveLength(512);
    // The last slot is REACHABLE now — this is the assertion the old cap failed.
    expect(r.rows[r.rows.length - 1].n).toBe(511);
    expect(r.capped).toBe(false);
    expect(r.hiddenCount).toBe(0);
  });

  it('never caps a list at or under the cap', () => {
    const exact = applyPresetPickerRowCap(slots(PRESET_PICKER_SOFT_ROW_CAP), false);
    expect(exact.rows).toHaveLength(PRESET_PICKER_SOFT_ROW_CAP);
    expect(exact.capped).toBe(false);
    expect(exact.hiddenCount).toBe(0);

    const under = applyPresetPickerRowCap(slots(12), false);
    expect(under.rows).toHaveLength(12);
    expect(under.totalRows).toBe(12);
    expect(under.capped).toBe(false);
    expect(under.hiddenCount).toBe(0);
  });

  it('handles an empty list', () => {
    const r = applyPresetPickerRowCap([], false);
    expect(r.rows).toEqual([]);
    expect(r.totalRows).toBe(0);
    expect(r.capped).toBe(false);
    expect(r.hiddenCount).toBe(0);
  });

  it('caps a long SEARCH result too (a match set can exceed the cap)', () => {
    const r = applyPresetPickerRowCap(slots(400), false, 300);
    expect(r.rows).toHaveLength(300);
    expect(r.totalRows).toBe(400);
    expect(r.capped).toBe(true);
    expect(r.hiddenCount).toBe(100);
  });

  it('is a pure prefix: rows are the list head, never a reorder or a truncation of the count', () => {
    const list = slots(512);
    const r = applyPresetPickerRowCap(list, false);
    expect(r.rows).toEqual(list.slice(0, PRESET_PICKER_SOFT_ROW_CAP));
    // the caller may render `totalRows`, so it must not equal the capped length
    expect(r.totalRows).not.toBe(r.rows.length);
  });
});
