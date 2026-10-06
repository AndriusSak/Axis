import { describe, it, expect } from 'vitest';
import { MIDI_REMOTE_SPECS, MIDI_REMOTE_GAPS, buildMidiRemoteRows } from './midiRemote';
import type { NamedParam, EnumParam } from './types';

// The served FM3 GLOBAL MIDI/Remote params (catalog/fm3.json, family GLOBAL). PC Offset (pid 71) is
// the only continuous knob; the rest are discrete selectors.
const servedEnums: EnumParam[] = [
  { id: 68, name: 'MIDI Channel', value: 16, options: [{ value: 16, label: 'OMNI' }] },
  { id: 69, name: 'Program Change', value: 1, options: [{ value: 0, label: 'OFF' }, { value: 1, label: 'ON' }] },
  { id: 70, name: 'Ignore Redundant PC', value: 1, options: [] },
  { id: 73, name: 'Send MIDI PC', value: 0, options: [] },
  { id: 97, name: 'MIDI Mapping', value: 0, options: [] },
  { id: 104, name: 'CC Bypass Type', value: 0, options: [] },
  { id: 113, name: 'Send Realtime SysEx', value: 0, options: [] },
  { id: 14874, name: 'Rcv MIDI Clk', value: 0, options: [] },
  { id: 14875, name: 'Snd MIDI Clk', value: 0, options: [] },
];
const servedKnobs: NamedParam[] = [{ id: 71, name: 'MIDI PC Offset', value: 0, norm: 0, min: 0, max: 383 }];

describe('midiRemote model', () => {
  it('marks every served MIDI param as an editable row', () => {
    const rows = buildMidiRemoteRows(servedKnobs, servedEnums);
    expect(rows).toHaveLength(MIDI_REMOTE_SPECS.length);
    expect(rows.every((r) => r.status !== 'gated')).toBe(true);
    expect(rows.find((r) => r.spec.id === 71)?.status).toBe('knob');
    expect(rows.find((r) => r.spec.id === 68)?.status).toBe('select');
    // the served device-true label wins over the spec's static label
    const chan = rows.find((r) => r.spec.id === 68);
    expect(chan && chan.status === 'select' ? chan.enumParam.name : '').toBe('MIDI Channel');
  });

  it('gates a spec whose param the device does not serve', () => {
    const rows = buildMidiRemoteRows([], servedEnums.filter((e) => e.id !== 68));
    const chan = rows.find((r) => r.spec.id === 68);
    expect(chan?.status).toBe('gated');
  });

  it('never lists a param with no served range (Remote Mute, pid 114)', () => {
    expect(MIDI_REMOTE_SPECS.some((s) => s.id === 114)).toBe(false);
  });

  it('reports the honest impossible gaps (Scene MIDI block, mapping table)', () => {
    const labels = MIDI_REMOTE_GAPS.map((g) => g.label).join(' | ');
    expect(labels).toMatch(/Scene MIDI/i);
    expect(labels).toMatch(/mapping/i);
  });
});
