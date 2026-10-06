import type { AxisFcModelLike } from './fcWorkbenchData';

/**
 * FC-editor field honesty gates (audit `docs/axis-fm3edit-feature-parity-audit.md` §3.7).
 *
 * FcEditor renders several controls from metadata carried by the SERVED `/fc/model` — the LED
 * colour table + colour param base, the custom-label length + label param bases, and the
 * display-mode (label) vocabulary. When a device's served model omits that metadata the control
 * previously *disappeared* (or rendered as an empty/no-op row), so the editor silently got shorter
 * with no indication anything was withheld. This module derives, purely from the served model's
 * SHAPE (never a device id or model id), whether each such control is renderable, and — when it is
 * not — the honest reason to show on a disabled/gated element.
 *
 * This is the same shape as `fcParity.ts` (status derived from the served model, every unavailable
 * entry carrying its reason); it is a separate module because these are per-FIELD gates, not the
 * §3.8 whole-sub-feature parity list.
 */

export type AxisFcFieldGateId = 'colors' | 'customLabel' | 'labelModes';

export interface AxisFcFieldGate {
  id: AxisFcFieldGateId;
  /** Control/field label as it appears (or would appear) in the editor. */
  label: string;
  /** True when the served model carries the metadata this control renders from. */
  available: boolean;
  /** Honest, model-shape-derived reason shown on the gated element when `available` is false. */
  reason: string;
}

const LABELS: Readonly<Record<AxisFcFieldGateId, string>> = {
  colors: 'Color',
  customLabel: 'Custom Label',
  labelModes: 'Label'
};

const ORDER: readonly AxisFcFieldGateId[] = ['colors', 'customLabel', 'labelModes'];

const NO_MODEL = 'No FC model is served for this device (/fc/model returned nothing).';

/** True when a non-empty record/object of metadata is served. */
function hasEntries(rec: Record<string, unknown> | undefined): boolean {
  return !!rec && Object.keys(rec).length > 0;
}

function fieldBase(model: AxisFcModelLike, field: string): boolean {
  return model.fields?.[field] != null;
}

function derive(model: AxisFcModelLike | null, id: AxisFcFieldGateId): AxisFcFieldGate {
  if (!model) {
    return { id, label: LABELS[id], available: false, reason: NO_MODEL };
  }
  switch (id) {
    case 'colors': {
      const table = hasEntries(model.colors as Record<string, unknown> | undefined);
      const base = fieldBase(model, 'color');
      const available = table && base;
      return {
        id,
        label: LABELS.colors,
        available,
        reason: available
          ? 'LED colour table and colour param base are served.'
          : !table
            ? 'The served /fc/model carries no LED colour table (colors), so the colour swatches cannot be rendered.'
            : 'The served /fc/model carries no colour param base (fields.color), so a colour write cannot be addressed.'
      };
    }
    case 'customLabel': {
      const len = (model.labelLen ?? 0) > 0;
      const base = fieldBase(model, 'tapLabel') || fieldBase(model, 'holdLabel');
      const available = len && base;
      return {
        id,
        label: LABELS.customLabel,
        available,
        reason: available
          ? 'Custom-label length and label param bases are served.'
          : !len
            ? 'The served /fc/model carries no custom-label length (labelLen), so custom label text cannot be rendered.'
            : 'The served /fc/model carries no custom-label param base (fields.tapLabel / holdLabel), so label text cannot be addressed.'
      };
    }
    case 'labelModes': {
      const available = hasEntries(model.labelModes as Record<string, unknown> | undefined);
      return {
        id,
        label: LABELS.labelModes,
        available,
        reason: available
          ? 'Display-mode (label) vocabulary is served.'
          : 'The served /fc/model carries no display-mode (label) vocabulary (labelModes), so the label-mode control cannot be rendered.'
      };
    }
  }
}

/** Derive every field-level gate from the served FC model, in a stable order. */
export function axisFcFieldGates(model: AxisFcModelLike | null): AxisFcFieldGate[] {
  return ORDER.map((id) => derive(model, id));
}

/** Only the gates the served model cannot satisfy — i.e. the controls to render disabled + gated. */
export function axisFcGatedFields(model: AxisFcModelLike | null): AxisFcFieldGate[] {
  return axisFcFieldGates(model).filter((g) => !g.available);
}

/** One gate by id (component lookup convenience; always defined). */
export function axisFcFieldGate(model: AxisFcModelLike | null, id: AxisFcFieldGateId): AxisFcFieldGate {
  return derive(model, id);
}
