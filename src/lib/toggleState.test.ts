import { describe, expect, it } from 'vitest';
import { enumIsOn } from './toggleState';

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
