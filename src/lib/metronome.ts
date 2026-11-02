// Controllers → METRONOME section model.
//
// GROUND TRUTH (each step verified against a tree or a capture, not assumed):
//   • PLACEMENT comes from the editors' own layout XML, extracted and generated into
//     forgefx-midi/src/gen3/<device>/layouts.generated.ts. The METRONOME section sits on the
//     CONTROLLERS block's "Tempo/Pitch" page (pageNum 0) and its controls are `crossBlock` refs to
//     family GLOBAL — i.e. the values live in the GLOBAL settings block (eid 1), not in Controllers.
//     On the FM3 the toggle is firmware-gated `gtet 12,00`; the level knobs exist on both sides of it.
//   • ADDRESSING: the eid-1 fn-0x1F body is pid-indexed (measured 2026-10-07, see
//     ForgeFX/server/test/drivers/global-bulk-read.test.ts — three front-panel values match by
//     proportion at body[7115]/[7116]/[110]), so a GLOBAL param's record IS its catalog paramId.
//     Writes are pid-addressed SETs on eid 1 (measured 2026-10-30, the GLOBAL perform page).
//   • PIDS PER DEVICE come from each device's own generated tables, not from one device's numbers
//     copied across:
//       FM3  (0x11) layouts.generated.ts:1880-1888 + ranges.generated.ts — toggle 14878,
//                   levels 119/120/121, CC 14879 (enum 1..148, 128 = NONE).
//       FM9  (0x12) fm9/layouts.generated.ts + fm9/ranges.generated.ts:1094-1095 — toggle 14907,
//                   levels 133/134/135, CC 14908.
//       III  (0x10) axe-fx-iii/layouts.generated.ts + ranges.generated.ts:1193-1194 — toggle 14655,
//                   levels 119/120/121, CC 14656.
//     The AM4 is deliberately absent: it is not a gen-3 unit and GET /global/params (eid 1) is a gen-3
//     read, so there is no honest pid table to offer it here.
//   • VALUES from a real captured FM3 eid-1 body (2026-10-30, /tmp/global-body.json, 14 880 records):
//     body[119] = 38228 (-5.0 dB), body[120] = 43689 (0.0), body[121] = 43689 (0.0),
//     body[14878] = 0 (OFF), body[14879] = 128 (NONE).
//
// WHY THIS MODULE EXISTS: the server already serves all five params on eid 1 (GET /global/params), but
// Axis's Controllers screen renders only the params served for eid 2, and the GLOBAL layout does not
// reference them — so without this section they are reachable only as unplaced controls on Setup.
//
// This module is pure (no Svelte): the component renders whatever it returns and the vitest suite
// exercises the served/gated mapping directly.
import type { NamedParam, EnumParam } from './types';

/** The GLOBAL effect id — the block these controls actually live in. */
export const METRONOME_EID = 1;

/** Model ids as the units report them (ForgeFX/server/src/devices.ts). */
export const MODEL_AXE_FX_III = 0x10;
export const MODEL_FM3 = 0x11;
export const MODEL_FM9 = 0x12;

export interface MetronomeSpec {
  /** Device paramId in family GLOBAL. */
  id: number;
  /** Device param name — the stable identity. */
  name: string;
  /** Fallback display label; the served param's own label wins when present. */
  label: string;
  /** How the editor draws it. */
  widget: 'toggle' | 'knob' | 'select';
}

interface MetronomeLayout {
  toggle: number;
  levels: readonly number[];
  cc: number | null;
}

/** Per-device pids, each from that device's own generated layout/range tables (see header). */
const LAYOUTS: Record<number, MetronomeLayout> = {
  [MODEL_FM3]: { toggle: 14878, levels: [119, 120, 121], cc: 14879 },
  [MODEL_FM9]: { toggle: 14907, levels: [133, 134, 135], cc: 14908 },
  [MODEL_AXE_FX_III]: { toggle: 14655, levels: [119, 120, 121], cc: 14656 }
};

/** Axis's primary unit; also the fallback when the model is not known yet (nothing is served before
 *  a device answers, so a wrong guess can only ever produce gated rows, never a write). */
export const DEFAULT_METRONOME_MODEL = MODEL_FM3;

/** The metronome controls for a device, in the editor's own order: the toggle, then the output
 *  levels, then the CC selector. The CC selector is appended because it is a metronome control the
 *  unit serves and Axis otherwise cannot reach — no editor layout page references it (the editor
 *  draws it in code). */
export function metronomeSpecs(modelId?: number | null): MetronomeSpec[] {
  // No model yet (null/undefined) or no device (-1): use the primary unit's table. Nothing is served
  // before a unit answers, so this can only ever produce gated rows.
  // A model we DO know but have no table for (the AM4) gets NO specs at all: borrowing the FM3's pids
  // would address different parameters on that unit, and a write to a wrong pid is a real edit.
  const known = modelId != null && modelId >= 0;
  if (known && !LAYOUTS[modelId]) return [];
  const l = LAYOUTS[modelId ?? DEFAULT_METRONOME_MODEL] ?? LAYOUTS[DEFAULT_METRONOME_MODEL]!;
  const specs: MetronomeSpec[] = [
    { id: l.toggle, name: 'GLOBAL_METRONOME', label: 'Metronome', widget: 'toggle' }
  ];
  l.levels.forEach((id, i) => {
    specs.push({
      id,
      name: `GLOBAL_METLEVEL${i + 1}`,
      label: ['Output 1', 'Output 2', 'USB / Digital'][i] ?? `Level ${i + 1}`,
      widget: 'knob'
    });
  });
  if (l.cc != null) specs.push({ id: l.cc, name: 'GLOBAL_METRONOME_CC', label: 'Metronome CC', widget: 'select' });
  return specs;
}

export type MetronomeRow =
  | { status: 'knob'; spec: MetronomeSpec; param: NamedParam }
  | { status: 'select'; spec: MetronomeSpec; enumParam: EnumParam }
  | { status: 'gated'; spec: MetronomeSpec; reason: string };

/**
 * Map the live served params/enums of the GLOBAL block onto the metronome specs. A spec is served when
 * the device read included its paramId; otherwise it is a GATED row (shown disabled with the reason) —
 * never silently dropped, never wired to an invented id. A unit below fw 12.00 genuinely has no
 * metronome toggle, and that is exactly what a gated row reports.
 */
export function buildMetronomeRows(
  params: NamedParam[],
  enums: EnumParam[],
  modelId?: number | null
): MetronomeRow[] {
  const knobById = new Map(params.filter((p) => p.id != null).map((p) => [p.id as number, p]));
  const enumById = new Map(enums.map((e) => [e.id, e]));
  return metronomeSpecs(modelId).map((spec): MetronomeRow => {
    const e = enumById.get(spec.id);
    if (e) return { status: 'select', spec, enumParam: e };
    const p = knobById.get(spec.id);
    if (p) return { status: 'knob', spec, param: p };
    // Factual, not a guess at why: the unit's read simply did not include this pid.
    return { status: 'gated', spec, reason: `the unit did not serve pid ${spec.id}` };
  });
}

/** True when the served set carries the metronome toggle — the section's own "is this unit's
 *  metronome addressable at all" test. */
export function metronomeServed(rows: MetronomeRow[]): boolean {
  return rows.some((r) => r.spec.widget === 'toggle' && r.status !== 'gated');
}
