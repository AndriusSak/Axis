import { describe, expect, it } from 'vitest';
import {
  MOD_WIRE_MAX,
  MODIFIER_CURVE_FIELDS,
  curveReadbackCount,
  decodeModifierCurve,
  formatCurveField,
  hasCurveReadback
} from './modifierCurve';
import type { ModModel } from './types';

// The served modifier model exposes each curve field as a paramId + kind (FM3: min pid1, max pid2,
// start pid3, mid pid4, end pid5, slope pid6, scale pid13, offset pid14 — all verified). The live
// values come from the slot's raw block. A field the model does NOT expose must stay "pending decode"
// — never an invented pid or value (parity audit §3.2).
const model: ModModel = {
  effectId: 3,
  slotCount: 32,
  fields: {
    source: { pid: 0, kind: 'ordinal', verified: true, role: 'Source' },
    min: { pid: 1, kind: 'norm', verified: true, role: 'Range Min' },
    max: { pid: 2, kind: 'norm', verified: true, role: 'Range Max' },
    start: { pid: 3, kind: 'norm', verified: true, role: 'Mapping Start' },
    mid: { pid: 4, kind: 'norm', verified: true, role: 'Mapping Mid' },
    end: { pid: 5, kind: 'norm', verified: true, role: 'Mapping End' },
    slope: { pid: 6, kind: 'norm', verified: true, role: 'Mapping Slope' },
    scale: { pid: 13, kind: 'norm', verified: true, role: 'Mapping Scale' },
    offset: { pid: 14, kind: 'bipolar', verified: true, role: 'Mapping Offset' }
  }
};

// A raw block carrying the full curve at known wire values: norm 0..65534 → 0..100 UI.
const fullValues: Record<string, number> = {
  1: 0, // min 0%
  2: MOD_WIRE_MAX, // max 100%
  3: Math.round(MOD_WIRE_MAX * 0.25), // start 25%
  4: Math.round(MOD_WIRE_MAX * 0.5), // mid 50%
  5: Math.round(MOD_WIRE_MAX * 0.75), // end 75%
  6: Math.round(MOD_WIRE_MAX * 0.5), // slope 50 → 0.0
  13: Math.round(MOD_WIRE_MAX * 0.5), // scale 50 → 50%
  14: Math.round(MOD_WIRE_MAX * 0.5) // offset 50 → +0
};

describe('decodeModifierCurve — honest per-field read-back', () => {
  it('decodes every exposed curve field from the served raw values', () => {
    const fields = decodeModifierCurve(fullValues, model);
    expect(fields.map((f) => f.key)).toEqual([...MODIFIER_CURVE_FIELDS]);
    expect(fields.map((f) => f.value)).toEqual([0, 100, 25, 50, 75, 50, 50, 50]);
    expect(fields.every((f) => !f.pending)).toBe(true);
    expect(hasCurveReadback(fields)).toBe(true);
    expect(curveReadbackCount(fields)).toEqual({ read: 8, total: 8 });
  });

  it('returns ALL fields pending with null pid + null value when no model is served', () => {
    const fields = decodeModifierCurve(fullValues, null);
    expect(fields).toHaveLength(8);
    expect(fields.every((f) => f.pending && f.pid === null && f.value === null)).toBe(true);
    expect(hasCurveReadback(fields)).toBe(false);
    expect(curveReadbackCount(fields)).toEqual({ read: 0, total: 8 });
  });

  it('keeps a field pending (with its known pid) when the model exposes it but no value was served', () => {
    const partial: Record<string, number> = { 1: MOD_WIRE_MAX }; // only min
    const fields = decodeModifierCurve(partial, model);
    const byKey = Object.fromEntries(fields.map((f) => [f.key, f]));
    expect(byKey.min).toEqual({ key: 'min', value: 100, pid: 1, pending: false });
    expect(byKey.max).toEqual({ key: 'max', value: null, pid: 2, pending: true });
    expect(byKey.offset).toEqual({ key: 'offset', value: null, pid: 14, pending: true });
    expect(curveReadbackCount(fields)).toEqual({ read: 1, total: 8 });
  });

  it('keeps a field pending with a null pid when the model does not expose it', () => {
    const sparse: ModModel = { effectId: 3, fields: { min: { pid: 1, kind: 'norm', verified: true } } };
    const fields = decodeModifierCurve(fullValues, sparse);
    const byKey = Object.fromEntries(fields.map((f) => [f.key, f]));
    expect(byKey.min).toEqual({ key: 'min', value: 0, pid: 1, pending: false });
    expect(byKey.max).toEqual({ key: 'max', value: null, pid: null, pending: true });
    expect(byKey.scale).toEqual({ key: 'scale', value: null, pid: null, pending: true });
  });

  it('decodes ordinal/ref fields as raw integers, not percentages', () => {
    const ordinalModel: ModModel = {
      effectId: 3,
      fields: { min: { pid: 1, kind: 'ordinal', verified: true }, max: { pid: 2, kind: 'ref', verified: true } }
    };
    const fields = decodeModifierCurve({ 1: 7, 2: 42 }, ordinalModel);
    const byKey = Object.fromEntries(fields.map((f) => [f.key, f]));
    expect(byKey.min).toEqual({ key: 'min', value: 7, pid: 1, pending: false });
    expect(byKey.max).toEqual({ key: 'max', value: 42, pid: 2, pending: false });
  });

  it('tolerates a null/undefined values map without throwing', () => {
    expect(decodeModifierCurve(null, model).every((f) => f.pending)).toBe(true);
    expect(decodeModifierCurve(undefined, model).every((f) => f.pending)).toBe(true);
  });
});

describe('formatCurveField — honest display', () => {
  it('renders "pending decode" for a not-exposed value', () => {
    expect(formatCurveField('min', null)).toBe('pending decode');
  });
  it('renders norm/bipolar fields as percentages', () => {
    expect(formatCurveField('min', 25)).toBe('25%');
    expect(formatCurveField('offset', 50)).toBe('0');
    expect(formatCurveField('offset', 62)).toBe('+12');
  });
  it('renders slope as a signed decimal like the editor knob', () => {
    expect(formatCurveField('slope', 50)).toBe('0.0');
    expect(formatCurveField('slope', 62.5)).toBe('1.0');
  });
});
