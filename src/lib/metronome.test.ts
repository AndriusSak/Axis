// Controllers → METRONOME section model.
//
// The fixture is the REAL served shape: these are the five params/enums the ForgeFX server returns for
// eid 1 (GET /global/params) when replayed against a captured FM3 GLOBAL body (2026-10-30, 14 880
// records) — values, ranges and labels included. The METRONOME CC option list is trimmed to the entries
// the assertions touch (the device serves all 148); everything else is verbatim.
import { describe, it, expect } from 'vitest';
import {
  buildMetronomeRows,
  metronomeServed,
  metronomeSpecs,
  METRONOME_EID,
  MODEL_AXE_FX_III,
  MODEL_FM3,
  MODEL_FM9
} from './metronome';
import type { NamedParam, EnumParam } from './types';

const SERVED_PARAMS: NamedParam[] = [
  { id: 119, name: 'Output 1', value: -5, norm: 0.5833307901242103, min: -40, max: 20 },
  { id: 120, name: 'Output 2', value: 0, norm: 0.6666615802484207, min: -40, max: 20 },
  { id: 121, name: 'USB / Digital', value: 0, norm: 0.6666615802484207, min: -40, max: 20 }
];

const SERVED_ENUMS: EnumParam[] = [
  { id: 14878, name: 'Metronome', value: 0, options: [{ value: 0, label: 'OFF' }, { value: 1, label: 'ON' }] },
  {
    id: 14879,
    name: 'METRONOME CC',
    value: 128,
    options: [
      { value: 1, label: 'CC #1' },
      { value: 127, label: 'CC #127' },
      { value: 128, label: 'NONE' },
      { value: 129, label: 'PEDAL 1 (EXP/SW TIP)' }
    ]
  }
];

describe('metronome section model', () => {
  it('addresses the GLOBAL block, not the Controllers block the screen has open', () => {
    expect(METRONOME_EID).toBe(1);
  });

  it('maps every spec onto the served param or enum by its device paramId', () => {
    const rows = buildMetronomeRows(SERVED_PARAMS, SERVED_ENUMS, MODEL_FM3);
    expect(rows.map((r) => r.spec.id)).toEqual([14878, 119, 120, 121, 14879]);
    expect(rows.every((r) => r.status !== 'gated')).toBe(true);
    expect(rows.map((r) => r.status)).toEqual(['select', 'knob', 'knob', 'knob', 'select']);
  });

  it("keeps the editor's own order and labels (toggle first, then the three output levels)", () => {
    const rows = buildMetronomeRows(SERVED_PARAMS, SERVED_ENUMS, MODEL_FM3);
    expect(rows.map((r) => r.spec.label)).toEqual(['Metronome', 'Output 1', 'Output 2', 'USB / Digital', 'Metronome CC']);
    expect(rows[0]!.spec.widget).toBe('toggle');
  });

  it('carries the captured values through untouched (OFF, -5.0 dB, 0.0, 0.0, CC 128 = NONE)', () => {
    const rows = buildMetronomeRows(SERVED_PARAMS, SERVED_ENUMS, MODEL_FM3);
    const toggle = rows[0]!;
    expect(toggle.status).toBe('select');
    if (toggle.status === 'select') {
      expect(toggle.enumParam.value).toBe(0);
      expect(toggle.enumParam.options.find((o) => o.value === toggle.enumParam.value)?.label).toBe('OFF');
    }
    const lvl1 = rows[1]!;
    expect(lvl1.status).toBe('knob');
    if (lvl1.status === 'knob') {
      expect(lvl1.param.value).toBe(-5);
      expect(lvl1.param.min).toBe(-40);
      expect(lvl1.param.max).toBe(20);
    }
    const cc = rows[4]!;
    expect(cc.status).toBe('select');
    if (cc.status === 'select') {
      expect(cc.enumParam.value).toBe(128);
      expect(cc.enumParam.options.find((o) => o.value === 128)?.label).toBe('NONE');
    }
  });

  it('gates a spec the device did not serve instead of inventing an id', () => {
    // A unit below fw 12.00 has no metronome toggle: the server simply does not serve pid 14878.
    const rows = buildMetronomeRows(SERVED_PARAMS, SERVED_ENUMS.filter((e) => e.id !== 14878), MODEL_FM3);
    const toggle = rows[0]!;
    expect(toggle.status).toBe('gated');
    if (toggle.status === 'gated') expect(toggle.reason).toContain('14878');
    expect(metronomeServed(rows)).toBe(false);
  });

  it('reports the section as served only when the toggle itself is addressable', () => {
    expect(metronomeServed(buildMetronomeRows(SERVED_PARAMS, SERVED_ENUMS, MODEL_FM3))).toBe(true);
    // Levels alone are not a metronome: without the toggle the section says so rather than showing
    // three knobs that control nothing.
    expect(metronomeServed(buildMetronomeRows(SERVED_PARAMS, [], MODEL_FM3))).toBe(false);
  });

  it('never wires a spec to a paramId the device did not send', () => {
    const rows = buildMetronomeRows([], [], MODEL_FM3);
    expect(rows).toHaveLength(metronomeSpecs(MODEL_FM3).length);
    expect(rows.every((r) => r.status === 'gated')).toBe(true);
  });

  // The pids are per-device (each from that unit's own generated layout/range tables). Using the FM3
  // numbers on an FM9 or III would address the wrong parameters — a write to a wrong pid is a real
  // edit to the user's unit, so this is the case that matters most.
  it('uses each model\'s own pids, not the FM3 numbers copied across', () => {
    expect(metronomeSpecs(MODEL_FM3).map((s) => s.id)).toEqual([14878, 119, 120, 121, 14879]);
    expect(metronomeSpecs(MODEL_FM9).map((s) => s.id)).toEqual([14907, 133, 134, 135, 14908]);
    expect(metronomeSpecs(MODEL_AXE_FX_III).map((s) => s.id)).toEqual([14655, 119, 120, 121, 14656]);
  });

  it('gates every row on a model it has no table for, rather than borrowing another unit\'s pids', () => {
    // 0x15 = AM4: not a gen-3 unit, and GET /global/params is a gen-3 read. Nothing may be written.
    const rows = buildMetronomeRows(SERVED_PARAMS, SERVED_ENUMS, 0x15);
    expect(rows).toHaveLength(0);
    expect(metronomeServed(rows)).toBe(false);
  });

  it('falls back to the FM3 table before a device has answered', () => {
    expect(metronomeSpecs(null).map((s) => s.id)).toEqual(metronomeSpecs(MODEL_FM3).map((s) => s.id));
    expect(metronomeSpecs(undefined).map((s) => s.id)).toEqual(metronomeSpecs(MODEL_FM3).map((s) => s.id));
  });
});
