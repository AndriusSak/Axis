import { describe, expect, it } from 'vitest';
import {
  AXIS_FC_LAYOUT_FORMAT,
  AXIS_FC_LAYOUT_VERSION,
  axisFcLayoutPackageWrites,
  buildAxisFcLayoutPackage,
  parseAxisFcLayoutPackage,
  serializeAxisFcLayoutPackage,
  type AxisFcLayoutPackage
} from '../fc/fcLayoutPackage';
import type { AxisFcModelLike } from '../fc/fcWorkbenchData';

// FM3-shaped served model: 9 layouts × 4 views × 3 switches = 108 configs.
const model: AxisFcModelLike = {
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
    holdParams: { width: 6, stride: 6 }
  },
  categories: { '0': 'Unassigned', '2': 'Preset', '3': 'Scene' },
  labelModes: { '0': 'Name', '2': 'Custom' }
};

describe('FC layout import/export package', () => {
  it('builds a package for every switch of a layout, config-major', () => {
    const value = (field: string, config: number) => (field === 'tapCategory' && config === 25 ? 2 : 0);
    const pkg = buildAxisFcLayoutPackage({ model, layout: 2, value });

    expect(pkg.format).toBe(AXIS_FC_LAYOUT_FORMAT);
    expect(pkg.version).toBe(AXIS_FC_LAYOUT_VERSION);
    expect(pkg.effectId).toBe(199);
    expect(pkg.layout).toBe(2);
    // 4 views × 3 switches
    expect(pkg.switches).toHaveLength(12);
    // config = layout*configsPerLayout + view*switches + switch → first of layout 2 is 24
    expect(pkg.switches[0]).toMatchObject({ view: 0, switch: 0, config: 24 });
    expect(pkg.switches[1]).toMatchObject({ view: 0, switch: 1, config: 25 });
    expect(pkg.switches[3]).toMatchObject({ view: 1, switch: 0, config: 27 });
    // the value callback is addressed with the right config
    const cat1 = pkg.switches.find((s) => s.config === 25)!;
    expect(cat1.tap.category).toBe(2);
    // params arrays are sized to the served width
    expect(pkg.switches[0].tap.params).toHaveLength(6);
  });

  it('captures slot values, colors and labels via the callbacks', () => {
    const pkg = buildAxisFcLayoutPackage({
      model,
      layout: 0,
      value: (field, config) => (field === 'color' && config === 0 ? 5 : 0),
      slot: (side, index, config) => (side === 'tap' && index === 0 && config === 0 ? 42 : undefined),
      label: (side, config) => (side === 'tap' && config === 0 ? 'Rhythm' : undefined)
    });
    expect(pkg.switches[0].tap.color).toBe(5);
    expect(pkg.switches[0].tap.params[0]).toBe(42);
    expect(pkg.switches[0].tap.label).toBe('Rhythm');
  });

  it('round-trips through serialize → parse', () => {
    const pkg = buildAxisFcLayoutPackage({ model, layout: 1 });
    const parsed = parseAxisFcLayoutPackage(serializeAxisFcLayoutPackage(pkg));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.pkg).toEqual(pkg);
  });

  it('rejects malformed / foreign packages with a reason', () => {
    expect(parseAxisFcLayoutPackage('not json').ok).toBe(false);
    const base = buildAxisFcLayoutPackage({ model, layout: 0 });
    const wrongFormat = { ...base, format: 'fractal-fclayout' };
    expect(parseAxisFcLayoutPackage(JSON.stringify(wrongFormat)).ok).toBe(false);
    const wrongVersion = { ...base, version: 99 };
    expect(parseAxisFcLayoutPackage(JSON.stringify(wrongVersion)).ok).toBe(false);
    const badSwitches = { ...base, switches: [{ view: 0 }] };
    const res = parseAxisFcLayoutPackage(JSON.stringify(badSwitches));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/switch/i);
  });

  it('emits config-remapped writes when importing into a different layout', () => {
    const pkg = buildAxisFcLayoutPackage({
      model,
      layout: 0,
      value: (field, config) => (field === 'tapCategory' && config === 0 ? 2 : 0),
      slot: (side, index, config) => (side === 'tap' && index === 0 && config === 0 ? 7 : 0),
      label: (side, config) => (side === 'tap' && config === 0 ? 'Lead' : '')
    });
    const writes = axisFcLayoutPackageWrites(pkg, 3, model);

    // remapped: view 0 / switch 0 of layout 3 → config 36
    const catWrite = writes.find((w) => w.kind === 'field' && w.field === 'tapCategory');
    expect(catWrite).toMatchObject({ kind: 'field', field: 'tapCategory', config: 36, value: 2 });
    const slotWrite = writes.find((w) => w.kind === 'field' && w.field === 'tapParams' && w.index === 0);
    expect(slotWrite).toMatchObject({ field: 'tapParams', config: 36, index: 0, value: 7 });
    const labelWrite = writes.find((w) => w.kind === 'label');
    expect(labelWrite).toMatchObject({ kind: 'label', side: 'tap', config: 36, text: 'Lead' });
    // an empty label still produces a (clear) write so import is deterministic
    expect(writes.filter((w) => w.kind === 'label')).toHaveLength(24);
  });

  it('refuses to build when the model has no switch geometry', () => {
    const flat: AxisFcModelLike = { effectId: 199, paramsWidth: 6, configs: 4, liveState: false };
    expect(() => buildAxisFcLayoutPackage({ model: flat, layout: 0 })).toThrow(/geometry|layout/i);
  });
});
