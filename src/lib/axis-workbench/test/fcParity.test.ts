import { describe, expect, it } from 'vitest';
import { axisFcParity, type AxisFcParityFeature } from '../fc/fcParity';
import type { AxisFcModelLike } from '../fc/fcWorkbenchData';

// A minimal FM3-shaped served model: geometry + the two categories the §3.8 features depend on
// (Layout = 6, Per-Preset = 9), matching FM3_FC_CATEGORIES / FM3_FC_FUNCTIONS in forgefx-midi.
const fm3Model: AxisFcModelLike = {
  effectId: 199,
  paramsWidth: 6,
  configs: 108,
  liveState: true,
  layouts: 9,
  views: 4,
  switches: 3,
  configsPerLayout: 12,
  labelLen: 11,
  fields: { tapParams: { width: 6, stride: 6 }, holdParams: { width: 6, stride: 6 } },
  categories: {
    '0': 'Unassigned',
    '4': 'Effect',
    '6': 'Layout',
    '7': 'Control Switch',
    '9': 'Per-Preset'
  },
  functions: {
    '6': [{ ord: 0, name: 'Select', slots: [{ i: 0, role: 'Layout', type: 'int', min: 1, max: 9 }], labels: [] }],
    '9': [{ ord: 0, name: 'Placeholder', slots: [{ i: 0, role: 'Preset Switch', type: 'int', min: 1, max: 24 }], labels: [] }]
  }
};

const byId = (features: AxisFcParityFeature[], id: string) => features.find((f) => f.id === id)!;

describe('FC parity (§3.8) capability derivation', () => {
  it('reports every §3.8 sub-feature, in a stable order', () => {
    const ids = axisFcParity(fm3Model).map((f) => f.id);
    expect(ids).toEqual([
      'perPresetSwitch',
      'perPresetOverride',
      'layoutLinks',
      'csMidi',
      'fcConfig',
      'fcDevices',
      'layoutImportExport'
    ]);
  });

  it('marks Layout Links supported when the served model carries the Layout category (6)', () => {
    const f = byId(axisFcParity(fm3Model), 'layoutLinks');
    expect(f.status).toBe('supported');
    // the evidence must name the device-true mechanism (category Layout, not a made-up param)
    expect(f.detail).toMatch(/Layout/i);
    expect(f.detail).toMatch(/category/i);
  });

  it('marks Per-Preset switch assignment supported but the override definition unsupported', () => {
    const features = axisFcParity(fm3Model);
    expect(byId(features, 'perPresetSwitch').status).toBe('supported');
    const override = byId(features, 'perPresetOverride');
    expect(override.status).toBe('unsupported');
    // the honest reason: the definition lives in the preset binary, not the FC param space
    expect(override.detail).toMatch(/preset binary/i);
  });

  it('gates CS MIDI and FC config/devices as unsupported (no served param)', () => {
    const features = axisFcParity(fm3Model);
    for (const id of ['csMidi', 'fcConfig', 'fcDevices']) {
      const f = byId(features, id);
      expect(f.status).toBe('unsupported');
      expect(f.detail.length).toBeGreaterThan(10);
    }
  });

  it('offers layout import/export when the model has geometry (live or blind)', () => {
    expect(byId(axisFcParity(fm3Model), 'layoutImportExport').status).toBe('supported');
    const blind = byId(axisFcParity({ ...fm3Model, liveState: false }), 'layoutImportExport');
    expect(blind.status).toBe('supported');
    expect(blind.detail).toMatch(/blind|session/i);
  });

  it('degrades honestly when no FC model is served', () => {
    const features = axisFcParity(null);
    expect(features).toHaveLength(7);
    for (const f of features) expect(f.status).toBe('unsupported');
    expect(byId(features, 'layoutImportExport').detail).toMatch(/no fc model|no decoded/i);
  });

  it('does not claim Layout Links / Per-Preset on a model that lacks those categories', () => {
    const bare: AxisFcModelLike = {
      effectId: 199,
      paramsWidth: 6,
      configs: 108,
      liveState: false,
      categories: { '0': 'Unassigned', '4': 'Effect' },
      functions: { '4': [{ ord: 0, name: 'Bypass', slots: [], labels: [] }] }
    };
    const features = axisFcParity(bare);
    expect(byId(features, 'layoutLinks').status).toBe('unsupported');
    expect(byId(features, 'perPresetSwitch').status).toBe('unsupported');
    // and import/export is unavailable without geometry to enumerate
    expect(byId(features, 'layoutImportExport').status).toBe('unsupported');
  });
});
