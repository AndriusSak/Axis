import { describe, it, expect } from 'vitest';
import { planNudge, nudgeNamed, nudgeEnum, stepNorm, UNCALIBRATED_STEP } from './paramNudge';
import type { NamedParam, EnumParam } from './types';

const knob = (over: Partial<NamedParam>): NamedParam => ({ id: 1, name: 'P', value: 0, norm: 0.5, ...over });
const enm = (value: number, values: number[]): EnumParam => ({
  id: 7,
  name: 'E',
  value,
  options: values.map((v) => ({ value: v, label: `opt${v}` }))
});

describe('paramNudge — step size is derived from the served range (never invented)', () => {
  it('calibrated linear knob: one unit = 1/(max−min) of norm', () => {
    expect(stepNorm({ norm: 0.5, min: -20, max: 20 })).toBeCloseTo(0.025, 10);
    expect(stepNorm({ norm: 0.5, min: 0, max: 100 })).toBeCloseTo(0.01, 10);
  });

  it('log taper: one value unit is value-relative (geometric)', () => {
    // freq 20..20000 Hz at the floor: ln(21/20)/ln(1000)
    expect(stepNorm({ norm: 0, min: 20, max: 20000, log: true })).toBeCloseTo(0.0070635, 6);
  });

  it('uncalibrated knob: one unit of the shared 0..10 scale = 0.1 norm', () => {
    expect(stepNorm({ norm: 0.5 })).toBe(UNCALIBRATED_STEP);
    expect(stepNorm({ norm: 0.5, min: 5, max: 5 })).toBe(UNCALIBRATED_STEP); // degenerate range
    expect(stepNorm({ norm: 0.5, min: 1, max: 0 })).toBe(UNCALIBRATED_STEP); // inverted range
  });
});

describe('paramNudge — continuous knobs', () => {
  it('moves the served value by exactly one unit', () => {
    const up = nudgeNamed(knob({ min: -20, max: 20, norm: 0.5 }), 1);
    expect(up?.kind).toBe('param');
    if (up?.kind === 'param') expect(up.norm).toBeCloseTo(0.525, 10);
    const down = nudgeNamed(knob({ min: -20, max: 20, norm: 0.5 }), -1);
    if (down?.kind === 'param') expect(down.norm).toBeCloseTo(0.475, 10);
  });

  it('gates at the ends (no next value → null)', () => {
    expect(nudgeNamed(knob({ min: -20, max: 20, norm: 1 }), 1)).toBeNull();
    expect(nudgeNamed(knob({ min: -20, max: 20, norm: 0 }), -1)).toBeNull();
    expect(nudgeNamed(knob({ norm: 1 }), 1)).toBeNull();
    expect(nudgeNamed(knob({ norm: 0 }), -1)).toBeNull();
  });

  it('refuses a knob with no device id', () => {
    expect(nudgeNamed(knob({ id: undefined, min: -20, max: 20 }), 1)).toBeNull();
  });

  it('uncalibrated knob steps by 0.1', () => {
    const up = nudgeNamed(knob({ norm: 0.5 }), 1);
    if (up?.kind === 'param') expect(up.norm).toBeCloseTo(0.6, 10);
  });
});

describe('paramNudge — discrete (enum) params', () => {
  it('steps to the adjacent served ordinal', () => {
    const up = nudgeEnum(enm(1, [0, 1, 2]), 1);
    expect(up).toEqual({ kind: 'enum', enum: expect.objectContaining({ id: 7 }), value: 2 });
    const down = nudgeEnum(enm(1, [0, 1, 2]), -1);
    if (down?.kind === 'enum') expect(down.value).toBe(0);
  });

  it('gates at the ends and on a single-option list', () => {
    expect(nudgeEnum(enm(2, [0, 1, 2]), 1)).toBeNull();
    expect(nudgeEnum(enm(0, [0, 1, 2]), -1)).toBeNull();
    expect(nudgeEnum(enm(0, [0]), 1)).toBeNull();
  });

  it('refuses a current value that is not in the served list', () => {
    expect(nudgeEnum(enm(9, [0, 1, 2]), 1)).toBeNull();
  });
});

describe('paramNudge — target resolution', () => {
  const p = knob({ id: 11, min: -20, max: 20 });
  const e = enm(1, [0, 1, 2]);

  it('prefers the explicitly selected id (param then enum)', () => {
    const rp = planNudge([p], [e], 11, 1);
    expect(rp?.kind).toBe('param');
    const re = planNudge([p], [e], 7, 1);
    expect(re?.kind).toBe('enum');
    if (re?.kind === 'enum') expect(re.value).toBe(2);
  });

  it('falls back to the primary control when nothing is selected', () => {
    expect(planNudge([p], [e], null, 1)?.kind).toBe('param');
    expect(planNudge([], [e], null, 1)?.kind).toBe('enum');
    expect(planNudge([p], [e], 999, 1)?.kind).toBe('param'); // unknown id → primary
  });

  it('does not fall back when the selected target itself is at its end', () => {
    expect(planNudge([knob({ id: 11, min: -20, max: 20, norm: 1 })], [e], 11, 1)).toBeNull();
  });

  it('returns null for an empty block', () => {
    expect(planNudge([], [], null, 1)).toBeNull();
  });
});
