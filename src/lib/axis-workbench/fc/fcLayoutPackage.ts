import type { AxisFcModelLike, AxisFcSide } from './fcWorkbenchData';

/**
 * FC layout import/export (audit §3.8 "Import / export layouts (backup)").
 *
 * FM3-Edit can export an FC layout to a file and re-import it. There is no server endpoint for
 * this — it is a client-side serialization of the device-true, addressable FC fields (category,
 * function, display, the 6-wide param block, LED colour, custom label) for every switch of a
 * layout. This module is pure (no Svelte, no transport) so it is unit-tested directly; the editor
 * wires the reads (`/fc/state`) and the writes (generic `(eid 199, pid)` SET) around it.
 *
 * The format is Axis's own JSON (`.fclayout.json`), NOT Fractal's binary `.fclayout`; the fields
 * map 1:1 to the wire pids (see forgefx-midi `gen3/fm3/footController.ts`), so a round-trip is
 * device-faithful for everything the served model exposes.
 */

export const AXIS_FC_LAYOUT_FORMAT = 'axis-fc-layout';
export const AXIS_FC_LAYOUT_VERSION = 1;

export interface AxisFcLayoutSideData {
  category: number;
  function: number;
  display: number;
  /** The 6-wide PARAMS value block, index 0 = primary. */
  params: number[];
  /** LED colour ordinal. The served `color` field is per-config (shared by both sides); the tap
   *  side is authoritative on import. */
  color: number;
  label: string;
}

export interface AxisFcLayoutSwitchData {
  view: number;
  switch: number;
  /** Source config ordinal (layout*configsPerLayout + view*switches + switch). */
  config: number;
  tap: AxisFcLayoutSideData;
  hold: AxisFcLayoutSideData;
}

export interface AxisFcLayoutPackage {
  format: string;
  version: number;
  effectId: number;
  layout: number;
  layoutName: string;
  paramsWidth: number;
  switches: AxisFcLayoutSwitchData[];
}

export interface AxisFcLayoutSource {
  model: AxisFcModelLike;
  layout: number;
  /** scalar field reader keyed by FC field name (tapCategory, color, …) for a config. */
  value?: (field: string, config: number) => number | undefined;
  /** param-slot reader for one side/index of a config. */
  slot?: (side: AxisFcSide, index: number, config: number) => number | undefined;
  /** decoded custom-label reader for one side of a config. */
  label?: (side: AxisFcSide, config: number) => string | undefined;
}

export type AxisFcLayoutWrite =
  | { kind: 'field'; field: string; config: number; index: number; value: number }
  | { kind: 'label'; side: AxisFcSide; config: number; text: string };

/** Per-side width of the PARAMS block (falls back to the model's global paramsWidth). */
function sideWidth(model: AxisFcModelLike, side: AxisFcSide): number {
  return model.fields?.[`${side}Params`]?.width ?? model.paramsWidth ?? 0;
}

function geometryOf(model: AxisFcModelLike): { views: number; switches: number; perLayout: number } | null {
  const switches = model.switches ?? 0;
  if (!model.layouts || !switches) return null;
  const views = model.views ?? 1;
  const perLayout = model.configsPerLayout ?? views * switches;
  if (!perLayout) return null;
  return { views, switches, perLayout };
}

function configOf(geometry: { switches: number; perLayout: number }, layout: number, view: number, sw: number): number {
  return layout * geometry.perLayout + view * geometry.switches + sw;
}

/**
 * Assemble a layout package from a served model + value/slot/label readers. Throws when the model
 * has no switch geometry (nothing to enumerate).
 */
export function buildAxisFcLayoutPackage(src: AxisFcLayoutSource): AxisFcLayoutPackage {
  const geometry = geometryOf(src.model);
  if (!geometry) {
    throw new Error('Cannot export a layout: the served FC model has no switch geometry (layouts × switches).');
  }
  const { views, switches, perLayout } = geometry;
  const layout = Math.max(0, Math.floor(src.layout));
  const out: AxisFcLayoutSwitchData[] = [];
  for (let view = 0; view < views; view += 1) {
    for (let sw = 0; sw < switches; sw += 1) {
      const config = configOf(geometry, layout, view, sw);
      const side = (which: AxisFcSide): AxisFcLayoutSideData => {
        const width = sideWidth(src.model, which);
        return {
          category: src.value?.(`${which}Category`, config) ?? 0,
          function: src.value?.(`${which}Function`, config) ?? 0,
          display: src.value?.(`${which}Display`, config) ?? 0,
          params: Array.from({ length: width }, (_, i) => src.slot?.(which, i, config) ?? 0),
          color: src.value?.('color', config) ?? 0,
          label: src.label?.(which, config) ?? ''
        };
      };
      out.push({ view, switch: sw, config, tap: side('tap'), hold: side('hold') });
    }
  }
  return {
    format: AXIS_FC_LAYOUT_FORMAT,
    version: AXIS_FC_LAYOUT_VERSION,
    effectId: src.model.effectId,
    layout,
    layoutName: layout === 8 ? 'MASTER' : `LAYOUT ${layout + 1}`,
    paramsWidth: src.model.paramsWidth ?? sideWidth(src.model, 'tap'),
    switches: out
  };
}

export function serializeAxisFcLayoutPackage(pkg: AxisFcLayoutPackage): string {
  return JSON.stringify(pkg, null, 2);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function validSide(value: unknown): value is AxisFcLayoutSideData {
  if (typeof value !== 'object' || value === null) return false;
  const side = value as Record<string, unknown>;
  if (!isFiniteNumber(side.category) || !isFiniteNumber(side.function) || !isFiniteNumber(side.display)) return false;
  if (!isFiniteNumber(side.color)) return false;
  if (typeof side.label !== 'string') return false;
  if (!Array.isArray(side.params) || !side.params.every(isFiniteNumber)) return false;
  return true;
}

/**
 * Parse + validate an imported package. Returns a discriminated result so the caller never writes
 * a half-validated payload to the device.
 */
export function parseAxisFcLayoutPackage(
  text: string
): { ok: true; pkg: AxisFcLayoutPackage } | { ok: false; error: string } {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, error: 'Not a valid FC layout file (invalid JSON).' };
  }
  if (typeof raw !== 'object' || raw === null) return { ok: false, error: 'Not a valid FC layout file (expected an object).' };
  const pkg = raw as Record<string, unknown>;
  if (pkg.format !== AXIS_FC_LAYOUT_FORMAT) {
    return { ok: false, error: `Unrecognized FC layout format (expected “${AXIS_FC_LAYOUT_FORMAT}”).` };
  }
  if (pkg.version !== AXIS_FC_LAYOUT_VERSION) {
    return { ok: false, error: `Unsupported FC layout version ${String(pkg.version)} (expected ${AXIS_FC_LAYOUT_VERSION}).` };
  }
  if (!isFiniteNumber(pkg.effectId) || !isFiniteNumber(pkg.layout)) {
    return { ok: false, error: 'Invalid FC layout package: effectId / layout must be numbers.' };
  }
  if (!Array.isArray(pkg.switches) || pkg.switches.length === 0) {
    return { ok: false, error: 'Invalid FC layout package: no switches.' };
  }
  for (const [index, entry] of pkg.switches.entries()) {
    if (typeof entry !== 'object' || entry === null) {
      return { ok: false, error: `Invalid FC layout package: switch ${index} is not an object.` };
    }
    const sw = entry as Record<string, unknown>;
    if (!isFiniteNumber(sw.view) || !isFiniteNumber(sw.switch) || !isFiniteNumber(sw.config)) {
      return { ok: false, error: `Invalid FC layout package: switch ${index} is missing view/switch/config.` };
    }
    if (!validSide(sw.tap) || !validSide(sw.hold)) {
      return { ok: false, error: `Invalid FC layout package: switch ${index} has an invalid tap/hold side.` };
    }
  }
  return { ok: true, pkg: pkg as unknown as AxisFcLayoutPackage };
}

/**
 * Flatten a package into the ordered writes that apply it to `targetLayout` (configs are remapped
 * to the target layout's range so a layout can be pasted onto any other). Labels are emitted for
 * every side — including empty ones — so an import deterministically clears stale custom labels.
 */
export function axisFcLayoutPackageWrites(
  pkg: AxisFcLayoutPackage,
  targetLayout: number,
  model: AxisFcModelLike
): AxisFcLayoutWrite[] {
  const geometry = geometryOf(model);
  if (!geometry) {
    throw new Error('Cannot import a layout: the served FC model has no switch geometry (layouts × switches).');
  }
  const layout = Math.max(0, Math.floor(targetLayout));
  const writes: AxisFcLayoutWrite[] = [];
  for (const sw of pkg.switches) {
    const config = configOf(geometry, layout, sw.view, sw.switch);
    for (const side of ['tap', 'hold'] as const) {
      const data = sw[side];
      writes.push({ kind: 'field', field: `${side}Category`, config, index: 0, value: data.category });
      writes.push({ kind: 'field', field: `${side}Function`, config, index: 0, value: data.function });
      writes.push({ kind: 'field', field: `${side}Display`, config, index: 0, value: data.display });
      data.params.forEach((value, index) => {
        writes.push({ kind: 'field', field: `${side}Params`, config, index, value });
      });
      writes.push({ kind: 'label', side, config, text: data.label });
    }
    // the served `color` field is per-config (shared by both sides); tap is authoritative
    writes.push({ kind: 'field', field: 'color', config, index: 0, value: sw.tap.color });
  }
  return writes;
}
