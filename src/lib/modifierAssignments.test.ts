import { describe, expect, it } from 'vitest';
import {
  findModifierForTarget,
  isModifierInUse,
  modifierSlotEid,
  modifiersInUse,
  describeModifier
} from './modifierAssignments';
import type { PresetModifier } from './types';

// The codec surfaces BOTH real assignments and empty/stale pre-chain entries (source ordinal 0 →
// 'source_0', or a target that isn't placed → targetEffectId null). Only the real ones count as
// "in use" for the modifier editor's read-back (parity audit §3.2).
const real: PresetModifier = { source: 'LFO 1A', target: 'Filter 1', targetEffectId: 114, param: 1, origin: 'pre-chain', slot: 2 };
const unplaced: PresetModifier = { source: 'External 1', target: 'Wah 1', targetEffectId: null, param: 5, origin: 'pre-chain', slot: 1 };
const noSource: PresetModifier = { source: 'source_0', target: 'Vol/Pan 2', targetEffectId: 103, param: 0, origin: 'pre-chain', slot: 6 };

describe('modifier assignments — which count as "in use"', () => {
  it('keeps a sourced modifier on a placed target', () => {
    expect(isModifierInUse(real)).toBe(true);
  });
  it('drops a modifier whose source is None (source_0)', () => {
    expect(isModifierInUse(noSource)).toBe(false);
  });
  it('drops a modifier whose target is not a placed block', () => {
    expect(isModifierInUse(unplaced)).toBe(false);
  });
  it('filters a mixed list down to the real assignments', () => {
    expect(modifiersInUse([real, unplaced, noSource])).toEqual([real]);
    expect(modifiersInUse(undefined)).toEqual([]);
  });
});

describe('modifier assignments — target lookup', () => {
  it('finds the modifier bound to a block eid + param', () => {
    expect(findModifierForTarget([real, noSource], 114, 1)).toEqual(real);
  });
  it('returns null when the param has no modifier', () => {
    expect(findModifierForTarget([real], 114, 9)).toBeNull();
    expect(findModifierForTarget([real], 99, 1)).toBeNull();
  });
  it('ignores null target eids and missing target args', () => {
    expect(findModifierForTarget([unplaced], null, 5)).toBeNull();
    expect(findModifierForTarget([real], null, 1)).toBeNull();
    expect(findModifierForTarget([real], 114, null)).toBeNull();
  });
});

describe('modifier assignments — display + addressing', () => {
  it('describes a modifier as "source → block (param N)"', () => {
    expect(describeModifier(real)).toBe('LFO 1A → Filter 1 (param 1)');
  });
  it('maps a 1-based slot to its virtual-effect eid', () => {
    expect(modifierSlotEid(3, 1)).toBe(3);
    expect(modifierSlotEid(3, 2)).toBe(4);
  });
});
