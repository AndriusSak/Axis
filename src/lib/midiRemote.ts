// Setup → MIDI/Remote section model (parity audit §2.8).
//
// GROUND TRUTH (verified against the trees, not assumed):
//   • The FM3 has NO placeable MIDI block. `GET /blocks` (gen3.ts `blocksCatalog`) enumerates
//     `effectRoster()` over the grid `EFFECT_BASES` table; the MIDI block is not in it. MIDIBLOCK is
//     `addressing: 'virtual'` (forgefx-midi/src/gen3/fm3/effectIds.ts, firstId 190, name "Scene MIDI"),
//     so it can never be dropped on the grid.
//   • MIDIBLOCK IS addressable as a virtual effect — ForgeFX maps eid 190 → 'MIDIBLOCK'
//     (devices.ts `VIRTUAL_EID_FAMILY`) — BUT the FM3 catalogue carries ZERO ranges and ZERO enum
//     vocab for the family (catalog/fm3.json has no FM3_RANGES.MIDIBLOCK / FM3_ENUM_OVERRIDES.MIDIBLOCK;
//     CATALOG-COVERAGE.md lists MIDIBLOCK under "Ranges — zero-calib utility families"). With no range
//     row every param is dropped by the server's serve filters → `blockParams(190)` returns no controls.
//     A Scene-MIDI screen would therefore be an empty dead end. It is NOT offered as a rail screen.
//   • The device MIDI settings that ARE served live on the GLOBAL block (eid 1, the Setup rail screen).
//     These are the specs below: non-placeable, real device paramIds from catalog/fm3.json family GLOBAL.
//   • GLOBAL_REMOTE_MUTE (pid 114) is unit 'unverified' with NO catalogue range row → the server drops
//     it (see gen3.ts `blockParams` rangeFor + the knobs/enums filters). It is deliberately NOT listed
//     here as an editable control; it is reported as a gap instead.
//
// This module is pure (no Svelte): the component renders whatever it returns and the vitest suite
// exercises the served/gated mapping directly.
import type { NamedParam, EnumParam } from './types';

export interface MidiRemoteSpec {
  /** Device paramId in family GLOBAL (forgefx-midi catalog/fm3.json). */
  id: number;
  /** Device param name — the stable identity. */
  name: string;
  /** Fallback display label; the served param's own label wins when present. */
  label: string;
}

// The served FM3 "Setup → MIDI/Remote" params, in a sensible order. Every id below is a real GLOBAL
// catalogue row that the server actually serves (verified via the catalogue serve-filter trace).
export const MIDI_REMOTE_SPECS: readonly MidiRemoteSpec[] = [
  { id: 68, name: 'GLOBAL_MIDI_CHAN', label: 'MIDI Channel' },
  { id: 69, name: 'GLOBAL_MIDI_PROG_CHANGE', label: 'Program Change' },
  { id: 70, name: 'GLOBAL_NO_REDUNDANT_PC', label: 'Ignore Redundant PC' },
  { id: 71, name: 'GLOBAL_PC_OFFSET', label: 'MIDI PC Offset' },
  { id: 73, name: 'GLOBAL_SEND_MIDIPC', label: 'Send MIDI PC' },
  { id: 97, name: 'GLOBAL_MIDI_MAPPING', label: 'MIDI Mapping' },
  { id: 104, name: 'GLOBAL_CC_BYPASS_TYPE', label: 'CC Bypass Type' },
  { id: 113, name: 'GLOBAL_SEND_REALTIME_SYSEX', label: 'Send Realtime SysEx' },
  { id: 14874, name: 'GLOBAL_RCV_MIDI_CLOCK', label: 'Receive MIDI Clock' },
  { id: 14875, name: 'GLOBAL_SEND_MIDI_CLOCK', label: 'Send MIDI Clock' },
];

export type MidiRemoteRow =
  | { status: 'knob'; spec: MidiRemoteSpec; param: NamedParam }
  | { status: 'select'; spec: MidiRemoteSpec; enumParam: EnumParam }
  | { status: 'gated'; spec: MidiRemoteSpec; reason: string };

/**
 * Map the live served params/enums of the open GLOBAL block onto the MIDI/Remote specs. A spec is
 * served when the device read included its paramId; otherwise it is a GATED row (the control is shown
 * disabled with the reason) — never silently dropped, never wired to an invented id.
 */
export function buildMidiRemoteRows(params: NamedParam[], enums: EnumParam[]): MidiRemoteRow[] {
  const knobById = new Map(params.filter((p) => p.id != null).map((p) => [p.id as number, p]));
  const enumById = new Map(enums.map((e) => [e.id, e]));
  const gatedReason = 'this firmware/device does not serve it';
  return MIDI_REMOTE_SPECS.map((spec): MidiRemoteRow => {
    const e = enumById.get(spec.id);
    if (e) return { status: 'select', spec, enumParam: e };
    const p = knobById.get(spec.id);
    if (p) return { status: 'knob', spec, param: p };
    return { status: 'gated', spec, reason: gatedReason };
  });
}

/** Features FM3-Edit's Setup → MIDI/Remote exposes that the served param set genuinely cannot
 *  represent. Rendered as honest disabled rows (tooltip = addressing + reason), never faked. */
export interface MidiRemoteGap {
  label: string;
  addressing: string;
  reason: string;
}

export const MIDI_REMOTE_GAPS: readonly MidiRemoteGap[] = [
  {
    label: 'Program Change / CC mapping tables (per-slot PC table)',
    addressing: 'GLOBAL_MIDI_MAPPING (pid 97)',
    reason: 'pid 97 is only an OFF/ON enable; the per-slot table itself is a structured array with no wire param in the catalogue',
  },
  {
    label: 'Scene MIDI block (per-scene MIDI messages)',
    addressing: 'MIDIBLOCK — virtual effect eid 190 ("Scene MIDI")',
    reason: 'addressable as a virtual effect, but the FM3 catalogue carries zero ranges/enum vocab for MIDIBLOCK, so no control is served (blockParams(190) is empty)',
  },
  {
    label: 'Remote Mute',
    addressing: 'GLOBAL_REMOTE_MUTE (pid 114)',
    reason: "unit: 'unverified' with no served range row — dropped by the server's blockParams filters",
  },
];
