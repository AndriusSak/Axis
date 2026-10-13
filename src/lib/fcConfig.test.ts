import { describe, it, expect } from 'vitest';
import { FC_CONFIG_SPECS, FC_CONFIG_GAPS, buildFcConfigRows } from './fcConfig';
import type { NamedParam, EnumParam } from './types';

// The served FM3 GLOBAL FC Config params (values read live from GET /preset/blocks/1/params,
// preset 410, 2026-10-13). Every one is a discrete selector; option labels are device-true.
// NOTE the served `name` is a row/column index ("1 1" / "1 2"), not a usable label — the spec's own
// label wins, which the wiring test pins.
const servedEnums: EnumParam[] = [
  { id: 3602, name: '1 1', value: 1, options: ['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((label, i) => ({ value: i + 1, label })) },
  { id: 3603, name: '2 1', value: 2, options: ['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((label, i) => ({ value: i + 1, label })) },
  { id: 3604, name: '3 1', value: 3, options: ['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((label, i) => ({ value: i + 1, label })) },
  { id: 3606, name: '1 2', value: 0, options: ['--', 'FC #1', 'FC #2'].map((label, value) => ({ value, label })) },
  { id: 3607, name: '2 2', value: 0, options: ['--', 'FM3', 'FC #2'].map((label, value) => ({ value, label })) },
  { id: 3608, name: '3 2', value: 0, options: ['--', 'FM3', 'FC #1'].map((label, value) => ({ value, label })) }
];
const servedKnobs: NamedParam[] = [];

describe('fcConfig model', () => {
  it('lists exactly the six served FC Config params (three startup layouts + three clone selectors)', () => {
    expect(FC_CONFIG_SPECS.map((s) => s.id)).toEqual([3602, 3603, 3604, 3606, 3607, 3608]);
    expect(FC_CONFIG_SPECS.filter((s) => s.part === 'startup')).toHaveLength(3);
    expect(FC_CONFIG_SPECS.filter((s) => s.part === 'clone')).toHaveLength(3);
  });

  it('carries a numeric port 1..3 per row and no invented port 4 (FM3 has three FC ports)', () => {
    expect([...new Set(FC_CONFIG_SPECS.map((s) => s.port))].sort()).toEqual([1, 2, 3]);
    expect(FC_CONFIG_SPECS.some((s) => s.id === 3605 || s.id === 3609)).toBe(false);
  });

  it('marks every served FC Config param as an editable selector row', () => {
    const rows = buildFcConfigRows(servedKnobs, servedEnums);
    expect(rows).toHaveLength(FC_CONFIG_SPECS.length);
    expect(rows.every((r) => r.status === 'select')).toBe(true);
    expect(rows.every((r) => r.status !== 'select' || r.ordinalOnly === false)).toBe(true);
  });

  it('renders each row with its SERVED options, not an invented set', () => {
    const rows = buildFcConfigRows(servedKnobs, servedEnums);
    const sel = (id: number) => {
      const r = rows.find((x) => x.spec.id === id);
      return r && r.status === 'select' ? r.enumParam : undefined;
    };
    expect(sel(3602)?.options.map((o) => o.label)).toEqual(['1', '2', '3', '4', '5', '6', '7', '8', '9']);
    expect(sel(3606)?.options.map((o) => o.label)).toEqual(['--', 'FC #1', 'FC #2']);
    expect(sel(3607)?.options.map((o) => o.label)).toEqual(['--', 'FM3', 'FC #2']);
    expect(sel(3608)?.options.map((o) => o.label)).toEqual(['--', 'FM3', 'FC #1']);
  });

  it('gates an FC Config spec the device does not serve, with the exact reason (no silent drop)', () => {
    const rows = buildFcConfigRows(servedKnobs, servedEnums.filter((e) => e.id !== 3602));
    const startup1 = rows.find((r) => r.spec.id === 3602);
    expect(startup1?.status).toBe('gated');
    expect(startup1 && startup1.status === 'gated' ? startup1.reason : '').toMatch(/does not serve/);
  });

  it('flags a served selector whose option labels are absent with ordinalOnly (honest path)', () => {
    const noLabels: EnumParam[] = [{ id: 3606, name: '1 2', value: 0, options: [] }];
    const rows = buildFcConfigRows(servedKnobs, noLabels);
    const clone1 = rows.find((r) => r.spec.id === 3606);
    expect(clone1?.status).toBe('select');
    expect(clone1 && clone1.status === 'select' ? clone1.ordinalOnly : false).toBe(true);
  });

  it('reports the honest impossible gaps (FC device roster; current layout/view are eid 199)', () => {
    expect(FC_CONFIG_GAPS.length).toBeGreaterThan(0);
    const joined = FC_CONFIG_GAPS.map((g) => `${g.label} ${g.addressing}`).join(' | ');
    expect(joined).toMatch(/FC Devices/);
    expect(joined).toMatch(/FC_PARAM_CUR_LAYOUT_FC1/);
  });
});
