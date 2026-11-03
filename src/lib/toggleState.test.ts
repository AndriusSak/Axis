import { describe, expect, it } from 'vitest';
import { enumIsOn, isOnOffEnum } from './toggleState';

describe('enumIsOn', () => {
  it('reads the FM3 bypass flags, where ON is option 0 (Power/Cabinet Modeling)', () => {
    const pwr = { value: 0, options: [{ value: 0, label: 'On' }, { value: 1, label: 'Off' }] };
    expect(enumIsOn(pwr)).toBe(true);
    expect(enumIsOn({ ...pwr, value: 1 })).toBe(false);
  });

  it('still reads the usual Off-then-On order', () => {
    const e = { value: 1, options: [{ value: 0, label: 'Off' }, { value: 1, label: 'On' }] };
    expect(enumIsOn(e)).toBe(true);
    expect(enumIsOn({ ...e, value: 0 })).toBe(false);
  });

  it('treats Bypassed / Disabled / Muted as off and Engaged / On as on', () => {
    const pairs = [['Engaged', 'Bypassed'], ['Enabled', 'Disabled'], ['Active', 'Muted'], ['On', 'Bypassed']];
    for (const [on, off] of pairs) {
      expect(enumIsOn({ value: 0, options: [{ value: 0, label: on }, { value: 1, label: off }] })).toBe(true);
      expect(enumIsOn({ value: 1, options: [{ value: 0, label: on }, { value: 1, label: off }] })).toBe(false);
    }
  });

  it('falls back to the option index when the labels are numbers or missing', () => {
    expect(enumIsOn({ value: 1, options: [{ value: 0, label: '0' }, { value: 1, label: '1' }] })).toBe(true);
    expect(enumIsOn({ value: 0, options: [{ value: 0, label: '0' }, { value: 1, label: '1' }] })).toBe(false);
    expect(enumIsOn({ value: 1 })).toBe(false);
    expect(enumIsOn(undefined)).toBe(false);
  });
});

describe('isOnOffEnum — a two-option enum is not automatically a flag', () => {
  it('rejects the FM3 Controllers selectors that were drawn as permanently-green toggles', () => {
    // Measured on the FM3 2026-11-03: both are two options, neither is on/off, and enumIsOn read
    // BOTH states as "on" — so a press changed the unit and the button never moved.
    expect(isOnOffEnum({ value: 0, options: [{ value: 0, label: 'PRESET' }, { value: 1, label: 'GLOBAL' }] })).toBe(false);
    expect(isOnOffEnum({ value: 0, options: [{ value: 0, label: 'INPUT 1' }, { value: 1, label: 'INPUT 2' }] })).toBe(false);
  });

  it('accepts real flags, in either option order', () => {
    expect(isOnOffEnum({ value: 0, options: [{ value: 0, label: 'On' }, { value: 1, label: 'Off' }] })).toBe(true);
    expect(isOnOffEnum({ value: 0, options: [{ value: 0, label: 'Off' }, { value: 1, label: 'On' }] })).toBe(true);
    expect(isOnOffEnum({ value: 0, options: [{ value: 0, label: 'Engaged' }, { value: 1, label: 'Bypassed' }] })).toBe(true);
  });

  it('keeps numeric/symbolic pairs as flags and anything longer than two options as a selector', () => {
    expect(isOnOffEnum({ value: 0, options: [{ value: 0, label: '0' }, { value: 1, label: '1' }] })).toBe(true);
    expect(isOnOffEnum({ value: 0, options: [{ value: 0, label: 'A' }, { value: 1, label: 'B' }] })).toBe(false);
    expect(
      isOnOffEnum({ value: 0, options: [{ value: 0, label: 'Off' }, { value: 1, label: 'On' }, { value: 2, label: 'Auto' }] })
    ).toBe(false);
    expect(isOnOffEnum(undefined)).toBe(false);
  });
});
