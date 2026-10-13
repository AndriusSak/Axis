// Setup → MIDI/Remote → FC Config group model.
//
// GROUND TRUTH (verified against the SERVED payload and the trees, not assumed):
//   • The FM3 GLOBAL family (the Setup rail screen, eid 1) SERVES the FC-device startup/clone
//     params as enum selectors. Measured live — `GET /preset/blocks/1/params` returns them in its
//     `enums` list (values read 2026-10-13, preset 410):
//       GLOBAL_FC_DEFAULT_LAYOUT_PFC1/2/3  pid 3602/3603/3604  options "1".."9"          (startup layout)
//       GLOBAL_FC_CLONE_PFC1/2/3           pid 3606/3607/3608  options "--","FC #1","FC #2" (mirror FC)
//     Their range rows are fm3/ranges.generated.ts:950-955 (3602-3604 mined float 1..9; 3606-3608
//     enumCount 3), and their option labels come from fm3/enumOverrides.ts:7889+ (3606-3608).
//   • The six params' ONLY layout refs live in the FC family layout's "Devices" page
//     (fm3/layouts.generated.ts ~7893-7944, each a `dropdown` with crossBlock.family "GLOBAL") — the
//     GLOBAL family layout does NOT reference them, so the device-authentic GLOBAL board draws nothing
//     for them on the Setup screen. This group fills that layout gap strictly from served data.
//   • The served `name` is NOT a usable label: the device answers these rows as "1 1" / "1 2" — a
//     row/column index, not a name — so the UI uses the spec's own device-true label ("Startup
//     Layout (PFC1)" …). Never print the served "1 1" as a control name.
//   • PFC4 exists only in the Axe-Fx III layouts; the FM3 has THREE FC ports (the FM3 itself + FC #1 +
//     FC #2), so no PFC4 row is offered (fm3/params.ts still carries 3605/3609 as III-inferred rows).
//   • NOT served (honest gaps): the FC Devices roster itself (the connected FC units and their
//     STATUS / VERSION columns) has no GLOBAL param; and the per-port CURRENT LAYOUT / CURRENT VIEW
//     (FC_PARAM_CUR_LAYOUT_FC1 2237 / FC_PARAM_CUR_WINDOW_FC1 5640, family FC eid 199) are not carried
//     by the GLOBAL block read — the FM3 serves no block-param list for eid 199. Both are reported as
//     honest disabled rows, never faked.
//
// This module is pure (no Svelte): the component renders whatever it returns and the vitest suite
// exercises the served/gated mapping directly. Same shape as controlSwitch.ts on purpose — one mechanism.
import type { NamedParam, EnumParam } from './types';

export type FcConfigPart = 'startup' | 'clone';

export interface FcConfigSpec {
  /** Device paramId in family GLOBAL (forgefx-midi gen3/fm3/params.ts). */
  id: number;
  /** Device param name — the stable identity. */
  name: string;
  /** Device-true display label; the served `name` for these rows is a row/column index, not a name. */
  label: string;
  /** Which part of the FC Config group this row is. */
  part: FcConfigPart;
  /** 1-based FC port the row configures (FM3 + FC #1 + FC #2; no port 4 on the FM3). */
  port: number;
}

// The served FM3 FC Config params, in device (FC "Devices" page) order: the three startup layouts,
// then the three mirror/clone selectors. Every id is a real GLOBAL catalogue row the server serves.
export const FC_CONFIG_SPECS: readonly FcConfigSpec[] = [
  { id: 3602, name: 'GLOBAL_FC_DEFAULT_LAYOUT_PFC1', label: 'Startup Layout (PFC1)', part: 'startup', port: 1 },
  { id: 3603, name: 'GLOBAL_FC_DEFAULT_LAYOUT_PFC2', label: 'Startup Layout (PFC2)', part: 'startup', port: 2 },
  { id: 3604, name: 'GLOBAL_FC_DEFAULT_LAYOUT_PFC3', label: 'Startup Layout (PFC3)', part: 'startup', port: 3 },
  { id: 3606, name: 'GLOBAL_FC_CLONE_PFC1', label: 'Mirror FC (PFC1)', part: 'clone', port: 1 },
  { id: 3607, name: 'GLOBAL_FC_CLONE_PFC2', label: 'Mirror FC (PFC2)', part: 'clone', port: 2 },
  { id: 3608, name: 'GLOBAL_FC_CLONE_PFC3', label: 'Mirror FC (PFC3)', part: 'clone', port: 3 }
];

export type FcConfigRow =
  | { status: 'select'; spec: FcConfigSpec; enumParam: EnumParam; ordinalOnly: boolean }
  | { status: 'knob'; spec: FcConfigSpec; param: NamedParam }
  | { status: 'gated'; spec: FcConfigSpec; reason: string };

/**
 * Map the live served params/enums of the open GLOBAL block onto the FC Config specs. A spec is
 * served when the device read included its paramId; otherwise it is a GATED row (shown disabled with
 * the reason) — never silently dropped, never wired to an invented id.
 *
 * `ordinalOnly` marks a served selector whose option labels the device did NOT supply (empty options
 * array): the control still renders, but the UI must show the raw ordinal with an honest hint rather
 * than a fabricated label. See MidiRemoteSection.svelte.
 */
export function buildFcConfigRows(params: NamedParam[], enums: EnumParam[]): FcConfigRow[] {
  const knobById = new Map(params.filter((p) => p.id != null).map((p) => [p.id as number, p]));
  const enumById = new Map(enums.map((e) => [e.id, e]));
  const gatedReason = 'this firmware/device does not serve it';
  return FC_CONFIG_SPECS.map((spec): FcConfigRow => {
    const e = enumById.get(spec.id);
    if (e) return { status: 'select', spec, enumParam: e, ordinalOnly: e.options.length === 0 };
    const p = knobById.get(spec.id);
    if (p) return { status: 'knob', spec, param: p };
    return { status: 'gated', spec, reason: gatedReason };
  });
}

/** The part of the FC "Devices" page the served param set genuinely cannot represent. Rendered as
 *  honest disabled rows (tooltip = addressing + reason), never faked. */
export interface FcConfigGap {
  label: string;
  addressing: string;
  reason: string;
}

export const FC_CONFIG_GAPS: readonly FcConfigGap[] = [
  {
    label: 'FC Devices / mirroring (connected FC-unit roster & status/version)',
    addressing:
      'FC family “Devices” page — device rows FM3 / FC #1 / FC #2 and the STATUS / VERSION columns',
    reason:
      'the connected FC units and each unit’s firmware status are device-level state; no GLOBAL param exposes the device roster, so the list itself is unavailable. (The per-port Mirror FC dropdowns above ARE served — this row is the device roster, which is not.)'
  },
  {
    label: 'Current layout / current view per FC port',
    addressing:
      'FC_PARAM_CUR_LAYOUT_FC1 (pid 2237) · FC_PARAM_CUR_WINDOW_FC1 (pid 5640) — family FC (eid 199)',
    reason:
      'the per-port CURRENT LAYOUT / CURRENT VIEW are FC-family (eid 199) params; the GLOBAL block read does not carry eid 199, and the FM3 serves no block-param list for it (GET /preset/blocks/199/params → 404)'
  }
];
