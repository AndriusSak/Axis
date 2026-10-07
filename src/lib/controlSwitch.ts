// Setup → MIDI/Remote → Control Switches (CS) group model.
//
// GROUND TRUTH (verified against the trees, not assumed):
//   • The FM3 GLOBAL family ("Setup" rail screen, eid 1) carries the Control-Switch params:
//       GLOBAL_CS1_ENABLE       pid 6979  — fm3/ranges.generated.ts:967  kind 'enum', enumCount 2
//       GLOBAL_CS_EDIT_NUMBER   pid 6985  — fm3/ranges.generated.ts:968  kind 'enum', enumCount 6
//       GLOBAL_CS_COMMAND_BEGIN pid 6986  — fm3/ranges.generated.ts:969  kind 'enum', enumCount 3
//       GLOBAL_CS1..6_EXCLUSIVE pid 7107-7112 — fm3/ranges.generated.ts:971-976 kind 'enum', enumCount 2
//     All nine are SERVED as enum selectors by the driver: blockParams' enumDefs filter serves any
//     param whose rangeFor() is a non-empty 'enum' row (gen3.ts:654 rangeFor + :681 the enumDefs
//     filter — "a device layout 'dropdown' is selector evidence", but a plain enum range row needs no
//     layout). Their option labels come from the FM3 device-true override table (fm3/enumOverrides.ts,
//     read by gen3.ts:1254 #enumOptions via enumLabelsFor → blockParams.ts:274):
//       6979 → YES, NO ;  6985 → CS1..CS6 ;  6986 → --, CC, PC ;  7107-7112 → Not Exclusive, Exclusive.
//   • THE LAYOUT GAP (why this module exists): 6979/6985/6986 have ZERO layout refs in the FM3 editor
//     layouts (fm3/layouts.generated.ts). The GLOBAL family block starts at layouts.generated.ts:16044
//     and references no CS param at all, so the device-authentic ControlSurface draws nothing for them.
//     The six exclusives DO carry 2 layout refs each — but both are in the FC family's "Config" pages
//     (layouts.generated.ts:7974 / :8012, the "CONTROL SWITCH LINK" row) i.e. the Foot Controller
//     screen, NOT GLOBAL. So on the Setup screen no CS control is drawn anywhere; this group fills
//     that layout gap strictly from served data (no invented paramIds or labels).
//   • NOT served (honest gaps): the per-switch array params GLOBAL_CS_CHAN_BEGIN (7010 — a float 1..16
//     row whose unit is 'unverified' with no layout 'knob' ref, so blockParams' knob filter drops it)
//     and GLOBAL_CS_CC_NUM_BEGIN / _ON_VAL_BEGIN / _OFF_VAL_BEGIN (7034/7058/7082 — no catalogue range
//     row at all, so no served control). They carry the per-switch channel / CC# / on / off message
//     values, reported as an honest disabled gap, never faked.
//
// This module is pure (no Svelte): the component renders whatever it returns and the vitest suite
// exercises the served/gated mapping directly. Same shape as midiRemote.ts on purpose — one mechanism.
import type { NamedParam, EnumParam } from './types';

export type ControlSwitchPart = 'enable' | 'edit' | 'command' | 'exclusive';

export interface ControlSwitchSpec {
  /** Device paramId in family GLOBAL (forgefx-midi catalog/gen3/fm3/params.ts). */
  id: number;
  /** Device param name — the stable identity. */
  name: string;
  /** Fallback display label; the served param's own label wins when present. */
  label: string;
  /** Which part of the CS group this row is. */
  part: ControlSwitchPart;
}

// The served FM3 Control-Switch params, in FM3-Edit page order: the group's own settings, then the
// six per-switch exclusives. Every id is a real GLOBAL catalogue row the server actually serves.
export const CONTROL_SWITCH_SPECS: readonly ControlSwitchSpec[] = [
  { id: 6979, name: 'GLOBAL_CS1_ENABLE', label: 'CS1 Enable', part: 'enable' },
  { id: 6985, name: 'GLOBAL_CS_EDIT_NUMBER', label: 'CS Edit Number', part: 'edit' },
  { id: 6986, name: 'GLOBAL_CS_COMMAND_BEGIN', label: 'CS Command', part: 'command' },
  { id: 7107, name: 'GLOBAL_CS1_EXCLUSIVE', label: 'CS1 Exclusive', part: 'exclusive' },
  { id: 7108, name: 'GLOBAL_CS2_EXCLUSIVE', label: 'CS2 Exclusive', part: 'exclusive' },
  { id: 7109, name: 'GLOBAL_CS3_EXCLUSIVE', label: 'CS3 Exclusive', part: 'exclusive' },
  { id: 7110, name: 'GLOBAL_CS4_EXCLUSIVE', label: 'CS4 Exclusive', part: 'exclusive' },
  { id: 7111, name: 'GLOBAL_CS5_EXCLUSIVE', label: 'CS5 Exclusive', part: 'exclusive' },
  { id: 7112, name: 'GLOBAL_CS6_EXCLUSIVE', label: 'CS6 Exclusive', part: 'exclusive' }
];

export type ControlSwitchRow =
  | { status: 'select'; spec: ControlSwitchSpec; enumParam: EnumParam; ordinalOnly: boolean }
  | { status: 'knob'; spec: ControlSwitchSpec; param: NamedParam }
  | { status: 'gated'; spec: ControlSwitchSpec; reason: string };

/**
 * Map the live served params/enums of the open GLOBAL block onto the CS specs. A spec is served when
 * the device read included its paramId; otherwise it is a GATED row (shown disabled with the reason)
 * — never silently dropped, never wired to an invented id.
 *
 * `ordinalOnly` marks a served selector whose option labels the device did NOT supply (empty options
 * array): the control still renders, but the UI must show the raw ordinal with an honest hint rather
 * than a fabricated label. See MidiRemoteSection.svelte.
 */
export function buildControlSwitchRows(params: NamedParam[], enums: EnumParam[]): ControlSwitchRow[] {
  const knobById = new Map(params.filter((p) => p.id != null).map((p) => [p.id as number, p]));
  const enumById = new Map(enums.map((e) => [e.id, e]));
  const gatedReason = 'this firmware/device does not serve it';
  return CONTROL_SWITCH_SPECS.map((spec): ControlSwitchRow => {
    const e = enumById.get(spec.id);
    if (e) return { status: 'select', spec, enumParam: e, ordinalOnly: e.options.length === 0 };
    const p = knobById.get(spec.id);
    if (p) return { status: 'knob', spec, param: p };
    return { status: 'gated', spec, reason: gatedReason };
  });
}

/** The part of the FM3-Edit Control Switch page the served param set genuinely cannot represent.
 *  Rendered as an honest disabled row (tooltip = addressing + reason), never faked. */
export interface ControlSwitchGap {
  label: string;
  addressing: string;
  reason: string;
}

export const CONTROL_SWITCH_GAPS: readonly ControlSwitchGap[] = [
  {
    label: 'Per-switch message values (Channel, CC#, On Value, Off Value)',
    addressing:
      'GLOBAL_CS_CHAN_BEGIN (pid 7010) · GLOBAL_CS_CC_NUM_BEGIN (7034) · GLOBAL_CS_ON_VAL_BEGIN (7058) · GLOBAL_CS_OFF_VAL_BEGIN (7082)',
    reason:
      "the array-base params for the six switches' MIDI message data are not served: 7010 is a float 1..16 row with unit 'unverified' and no layout 'knob' ref (dropped by blockParams' knob filter), 7034/7058/7082 have no catalogue range row at all"
  }
];
