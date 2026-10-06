import type { AxisFcModelLike } from './fcWorkbenchData';

/**
 * FC-Edit parity capability derivation (audit `docs/axis-fm3edit-feature-parity-audit.md` §3.8).
 *
 * The FM3-Edit FC editor has areas Axis does not surface as dedicated screens: Per-Preset switches,
 * Layout Links, CS MIDI, and an FC Config/Devices tab. This module decides — from the SERVED
 * `/fc/model` alone, never from a device id or a hard-coded assumption — which of those are
 * expressible through the device-true `(eid 199, pid)` param space and which are not served at all.
 *
 * Device ground truth (forgefx-midi `gen3/fm3/footController.ts` + `fcFunctions.ts`):
 *   - The switch CATEGORY enum is served and includes `Layout` (ord 6) and `Per-Preset` (ord 9).
 *     So a switch can be assigned to change layout after press (Layout Links) and to reference a
 *     Per-Preset slot — both via the existing category/function/params fields.
 *   - The per-preset switch DEFINITIONS (what PP#1..PP#24 actually do) live in the preset binary,
 *     not in the FC param space (audit §5) → gated.
 *   - Control-switch MIDI assignment and external-FC startup/mirror settings are Setup→MIDI/Remote
 *     and FC-device tables; no FC (eid 199) param serves them → gated.
 *   - Layout import/export is a client-side serialization of the addressable fields → supported.
 */

export type AxisFcParityStatus = 'supported' | 'partial' | 'unsupported';

export interface AxisFcParityFeature {
  id: string;
  label: string;
  status: AxisFcParityStatus;
  /** Device-model evidence for the status (or the honest reason it is gated). */
  detail: string;
}

/** Switch-category ordinals the §3.8 sub-features depend on (FM3_FC_CATEGORIES). */
export const AXIS_FC_LAYOUT_CATEGORY = 6;
export const AXIS_FC_PER_PRESET_CATEGORY = 9;

const FEATURE_LABELS: Readonly<Record<string, string>> = {
  perPresetSwitch: 'Per-Preset switches',
  perPresetOverride: 'Per-Preset Override',
  layoutLinks: 'Layout Links',
  csMidi: 'CS MIDI',
  fcConfig: 'FC Config',
  fcDevices: 'FC Devices / mirroring',
  layoutImportExport: 'Layout import / export'
};

const FEATURE_ORDER = [
  'perPresetSwitch',
  'perPresetOverride',
  'layoutLinks',
  'csMidi',
  'fcConfig',
  'fcDevices',
  'layoutImportExport'
] as const;

const NO_MODEL = 'No FC model is served for this device.';

/** True when the served model exposes a switch category ordinal (name and/or its function list). */
function hasCategory(model: AxisFcModelLike | null, ordinal: number): boolean {
  if (!model) return false;
  return model.categories?.[String(ordinal)] != null || model.functions?.[String(ordinal)] != null;
}

function hasGeometry(model: AxisFcModelLike): boolean {
  return !!(model.layouts && model.switches && model.configsPerLayout) || model.liveState;
}

/**
 * Derive the §3.8 parity feature list from the served FC model. Order is stable so the UI and its
 * source-guard can rely on it. Every `unsupported` entry carries the reason it is gated.
 */
export function axisFcParity(model: AxisFcModelLike | null): AxisFcParityFeature[] {
  const layoutLinks = hasCategory(model, AXIS_FC_LAYOUT_CATEGORY);
  const perPreset = hasCategory(model, AXIS_FC_PER_PRESET_CATEGORY);
  const importExport = model ? hasGeometry(model) : false;

  const features: Record<string, AxisFcParityFeature> = {
    perPresetSwitch: {
      id: 'perPresetSwitch',
      label: FEATURE_LABELS.perPresetSwitch,
      status: perPreset ? 'supported' : 'unsupported',
      detail: perPreset
        ? 'Category “Per-Preset” (ord 9) is served: assign a switch to a PP slot via Category → Per-Preset and set the PP# operand.'
        : model
          ? 'This model does not serve the “Per-Preset” category (ord 9); switch assignment is unavailable.'
          : NO_MODEL
    },
    perPresetOverride: {
      id: 'perPresetOverride',
      label: FEATURE_LABELS.perPresetOverride,
      status: 'unsupported',
      detail: model
        ? 'The per-preset switch definitions (what PP#1..PP#24 do) live in the preset binary, not the FC (eid 199) param space — no served param exposes them (audit §5).'
        : NO_MODEL
    },
    layoutLinks: {
      id: 'layoutLinks',
      label: FEATURE_LABELS.layoutLinks,
      status: layoutLinks ? 'supported' : 'unsupported',
      detail: layoutLinks
        ? 'Category “Layout” (ord 6) is served: functions Select / Master Layout / Inc-Dec change layout after press. Set them via the per-switch Category → Layout fields.'
        : model
          ? 'This model does not serve the “Layout” category (ord 6); layout-link switches are unavailable.'
          : NO_MODEL
    },
    csMidi: {
      id: 'csMidi',
      label: FEATURE_LABELS.csMidi,
      status: 'unsupported',
      detail: model
        ? 'Control-switch MIDI assignment is a Setup → MIDI/Remote table; no FC (eid 199) param serves it (audit §2.8).'
        : NO_MODEL
    },
    fcConfig: {
      id: 'fcConfig',
      label: FEATURE_LABELS.fcConfig,
      status: 'unsupported',
      detail: model
        ? 'Startup layout/view and the 1:1 copy settings are external-FC device configuration; no served param exposes them.'
        : NO_MODEL
    },
    fcDevices: {
      id: 'fcDevices',
      label: FEATURE_LABELS.fcDevices,
      status: 'unsupported',
      detail: model
        ? 'Mirroring across connected FC units is a device-level FC setting; no served param exposes it.'
        : NO_MODEL
    },
    layoutImportExport: {
      id: 'layoutImportExport',
      label: FEATURE_LABELS.layoutImportExport,
      status: importExport ? 'supported' : 'unsupported',
      detail: !model
        ? NO_MODEL
        : importExport
          ? model.liveState
            ? 'Export reads the layout back from the unit via /fc/state; import writes each field back through the generic (eid 199, pid) path.'
            : 'Blind device (no live read): export captures this session’s written values; import writes each field back blind.'
          : 'No switch geometry (layouts × switches) is served, so a layout cannot be enumerated for export.'
    }
  };

  return FEATURE_ORDER.map((id) => features[id]);
}
