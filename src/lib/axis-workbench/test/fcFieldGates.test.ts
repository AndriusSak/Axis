import { describe, expect, it } from 'vitest';
import {
  axisFcFieldGate,
  axisFcFieldGates,
  axisFcGatedFields
} from '../fc/fcFieldGates';
import type { AxisFcModelLike } from '../fc/fcWorkbenchData';

// Field-level honesty gates (audit §3.7). A control the editor renders from served metadata (the LED
// colour table, custom-label length/base, the display-mode vocabulary) must be GATED with the honest
// reason when that metadata is absent from /fc/model — never silently dropped. The decision is
// derived purely from the served model SHAPE (never a device or model id), so these fixtures are the
// real device shapes: FM3 carries every table; FM9 carries categories/labelModes but no
// colour/label-length/function metadata; the III carries only the address model.

const fm3Like: AxisFcModelLike = {
  effectId: 199,
  paramsWidth: 6,
  configs: 108,
  liveState: true,
  layouts: 9,
  views: 4,
  switches: 3,
  configsPerLayout: 12,
  labelLen: 11,
  fields: {
    tapParams: { width: 6, stride: 6 },
    holdParams: { width: 6, stride: 6 },
    color: { base: 4618, width: 1, stride: 1 },
    tapLabel: { base: 2241, width: 11, stride: 11 },
    holdLabel: { base: 3429, width: 11, stride: 11 }
  },
  categories: { '0': 'Unassigned', '4': 'Effect' },
  labelModes: { '0': 'Auto', '2': 'Custom' },
  colors: { '0': { name: 'Red', hex: '#f00' }, '1': { name: 'Blue', hex: '#00f' } },
  functions: { '4': [{ ord: 0, name: 'Bypass', slots: [], labels: [] }] }
};

// FM9 shape: geometry + categories/labelModes, but NO colors / labelLen / label bases.
const fm9Like: AxisFcModelLike = {
  effectId: 199,
  paramsWidth: 6,
  configs: 108,
  liveState: false,
  layouts: 9,
  switches: 12,
  configsPerLayout: 12,
  fields: { tapParams: { width: 6, stride: 6 }, holdParams: { width: 6, stride: 6 } },
  categories: { '0': 'Unassigned', '4': 'Effect' },
  labelModes: { '0': 'Auto' }
};

// Axe-Fx III shape: address model only, no categories / labelModes / colors / labelLen.
const iiiLike: AxisFcModelLike = {
  effectId: 199,
  paramsWidth: 6,
  configs: 108,
  liveState: false,
  fields: { tapParams: { width: 6, stride: 6 } }
};

describe('axisFcFieldGates — served-metadata honesty gates (§3.7)', () => {
  it('reports the gated field families in a stable order', () => {
    expect(axisFcFieldGates(fm3Like).map((g) => g.id)).toEqual(['colors', 'customLabel', 'labelModes']);
  });

  it('gates nothing when the served model carries every table (FM3)', () => {
    expect(axisFcGatedFields(fm3Like)).toHaveLength(0);
    for (const g of axisFcFieldGates(fm3Like)) expect(g.available).toBe(true);
  });

  it('gates the colour + custom-label controls when FM9 carries no colour/label metadata', () => {
    const gated = axisFcGatedFields(fm9Like).map((g) => g.id);
    expect(gated).toEqual(['colors', 'customLabel']);
    // labelModes IS served on FM9, so its control is available
    expect(axisFcFieldGate(fm9Like, 'labelModes').available).toBe(true);
  });

  it('gates colour, custom label and the label-mode vocabulary on the III shape', () => {
    expect(axisFcGatedFields(iiiLike).map((g) => g.id)).toEqual(['colors', 'customLabel', 'labelModes']);
  });

  it('every gate states the SERVED metadata it is missing (never a device id)', () => {
    for (const g of axisFcGatedFields(iiiLike)) {
      expect(g.available).toBe(false);
      expect(g.reason.length).toBeGreaterThan(20);
      expect(g.reason).toMatch(/served|\/fc\/model/i);
    }
    expect(axisFcFieldGate(iiiLike, 'colors').reason).toMatch(/colour|color/i);
    expect(axisFcFieldGate(iiiLike, 'customLabel').reason).toMatch(/label/i);
  });

  it('gates a control whose param base is absent even when its vocabulary is served', () => {
    // colours table present but no `fields.color` base → cannot write honestly → gated
    const noBase: AxisFcModelLike = { ...fm3Like, fields: { ...fm3Like.fields } };
    delete (noBase.fields as Record<string, unknown>).color;
    expect(axisFcFieldGate(noBase, 'colors').available).toBe(false);
    // labelLen present but no label field base → gated
    const noLabelBase: AxisFcModelLike = { ...fm3Like, fields: { ...fm3Like.fields } };
    delete (noLabelBase.fields as Record<string, unknown>).tapLabel;
    delete (noLabelBase.fields as Record<string, unknown>).holdLabel;
    expect(axisFcFieldGate(noLabelBase, 'customLabel').available).toBe(false);
  });

  it('degrades honestly when no FC model is served', () => {
    const gated = axisFcGatedFields(null).map((g) => g.id);
    expect(gated).toEqual(['colors', 'customLabel', 'labelModes']);
    for (const g of axisFcGatedFields(null)) expect(g.reason).toMatch(/no fc model/i);
  });
});
