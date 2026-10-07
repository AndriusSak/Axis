import { describe, it, expect } from 'vitest';
import {
  CONTROL_SWITCH_SPECS,
  CONTROL_SWITCH_GAPS,
  buildControlSwitchRows
} from './controlSwitch';
import type { NamedParam, EnumParam } from './types';

// The served FM3 GLOBAL Control-Switch params. Every one is a discrete selector (gen3.ts enumDefs);
// option labels are the device-true FM3 overrides (fm3/enumOverrides.ts, read by #enumOptions).
const servedEnums: EnumParam[] = [
  { id: 6979, name: 'CS1 ENABLE', value: 0, options: [{ value: 0, label: 'YES' }, { value: 1, label: 'NO' }] },
  { id: 6985, name: 'CS EDIT NUMBER', value: 0, options: ['CS1', 'CS2', 'CS3', 'CS4', 'CS5', 'CS6'].map((label, value) => ({ value, label })) },
  { id: 6986, name: 'CS COMMAND BEGIN', value: 0, options: ['--', 'CC', 'PC'].map((label, value) => ({ value, label })) },
  { id: 7107, name: 'CS1 Exclusive', value: 0, options: [{ value: 0, label: 'Not Exclusive' }, { value: 1, label: 'Exclusive' }] },
  { id: 7108, name: 'CS2 Exclusive', value: 0, options: [{ value: 0, label: 'Not Exclusive' }, { value: 1, label: 'Exclusive' }] },
  { id: 7109, name: 'CS3 Exclusive', value: 0, options: [{ value: 0, label: 'Not Exclusive' }, { value: 1, label: 'Exclusive' }] },
  { id: 7110, name: 'CS4 Exclusive', value: 0, options: [{ value: 0, label: 'Not Exclusive' }, { value: 1, label: 'Exclusive' }] },
  { id: 7111, name: 'CS5 Exclusive', value: 0, options: [{ value: 0, label: 'Not Exclusive' }, { value: 1, label: 'Exclusive' }] },
  { id: 7112, name: 'CS6 Exclusive', value: 0, options: [{ value: 0, label: 'Not Exclusive' }, { value: 1, label: 'Exclusive' }] }
];
const servedKnobs: NamedParam[] = [];

describe('controlSwitch model', () => {
  it('lists exactly the nine served CS params (three group settings + six exclusives)', () => {
    const ids = CONTROL_SWITCH_SPECS.map((s) => s.id).sort((a, b) => a - b);
    expect(ids).toEqual([6979, 6985, 6986, 7107, 7108, 7109, 7110, 7111, 7112]);
    expect(CONTROL_SWITCH_SPECS.filter((s) => s.part === 'exclusive')).toHaveLength(6);
  });

  it('marks every served CS param as an editable selector row', () => {
    const rows = buildControlSwitchRows(servedKnobs, servedEnums);
    expect(rows).toHaveLength(CONTROL_SWITCH_SPECS.length);
    expect(rows.every((r) => r.status === 'select')).toBe(true);
    expect(rows.every((r) => r.status !== 'select' || r.ordinalOnly === false)).toBe(true);
  });

  it('renders each row with its SERVED options/labels, not an invented set', () => {
    const rows = buildControlSwitchRows(servedKnobs, servedEnums);
    const sel = (id: number) => {
      const r = rows.find((x) => x.spec.id === id);
      return r && r.status === 'select' ? r.enumParam : undefined;
    };
    expect(sel(6979)?.options.map((o) => o.label)).toEqual(['YES', 'NO']);
    expect(sel(6985)?.options.map((o) => o.label)).toEqual(['CS1', 'CS2', 'CS3', 'CS4', 'CS5', 'CS6']);
    expect(sel(6986)?.options.map((o) => o.label)).toEqual(['--', 'CC', 'PC']);
    expect(sel(7107)?.options.map((o) => o.label)).toEqual(['Not Exclusive', 'Exclusive']);
    // the served device-true label wins over the spec's static fallback
    expect(sel(7107)?.name).toBe('CS1 Exclusive');
  });

  it('gates a CS spec the device does not serve, with the exact reason (no silent drop)', () => {
    const rows = buildControlSwitchRows(servedKnobs, servedEnums.filter((e) => e.id !== 6979));
    const enable = rows.find((r) => r.spec.id === 6979);
    expect(enable?.status).toBe('gated');
    expect(enable && enable.status === 'gated' ? enable.reason : '').toMatch(/does not serve/);
  });

  it('flags a served selector whose option labels are absent with ordinalOnly (honest path)', () => {
    const noLabels: EnumParam[] = [{ id: 6986, name: 'CS COMMAND BEGIN', value: 0, options: [] }];
    const rows = buildControlSwitchRows(servedKnobs, noLabels);
    const cmd = rows.find((r) => r.spec.id === 6986);
    expect(cmd?.status).toBe('select');
    expect(cmd && cmd.status === 'select' ? cmd.ordinalOnly : false).toBe(true);
  });

  it('never lists the unserved per-switch array params as specs', () => {
    for (const id of [7010, 7034, 7058, 7082]) {
      expect(CONTROL_SWITCH_SPECS.some((s) => s.id === id)).toBe(false);
    }
  });

  it('reports the honest impossible gap (per-switch message values)', () => {
    expect(CONTROL_SWITCH_GAPS.length).toBeGreaterThan(0);
    expect(CONTROL_SWITCH_GAPS.map((g) => g.addressing).join(' | ')).toMatch(/GLOBAL_CS_CHAN_BEGIN/);
  });
});
