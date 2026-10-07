// Pure builder for the parameter-value menu items (parity audit §2.11) — the "Copy value" / "Paste
// value" entries added to an EXISTING control context menu (the ControlSurface pin menu). Keeping the
// item shapes here makes them unit-testable without mounting the component (node-env vitest cannot
// compile .svelte), the same pattern as axis-workbench/pinMenu.ts.

import type { WorkbenchMenuItem } from './workbench';

/** The control the menu was opened on. `kind` 'cont' = a knob (continuous); 'toggle'/'select' = enum. */
export interface ParamMenuControl {
  label: string;
  kind: string;
}

/** Clipboard state the menu reflects. `clipName` is the copied param's display label, or null. */
export interface ParamMenuState {
  hasClip: boolean;
  clipName: string | null;
}

/** The two value items, in order. Copy is always available on an addressable control; Paste is
 *  enabled only once a value has been copied (the store reports a drop when the target block does not
 *  expose the copied paramId — it is never written blindly). */
export function buildParamValueMenuItems(
  ctl: ParamMenuControl,
  state: ParamMenuState,
  onCopy: () => void,
  onPaste: () => void
): WorkbenchMenuItem[] {
  const continuous = ctl.kind === 'cont';
  return [
    {
      id: 'param.copyValue',
      label: `Copy “${ctl.label}” value`,
      title: continuous
        ? 'Copy this knob’s value (normalized 0..1) to paste onto another block'
        : 'Copy this parameter’s ordinal to paste onto another block',
      run: onCopy
    },
    {
      id: 'param.pasteValue',
      label: state.clipName ? `Paste “${state.clipName}” value` : 'Paste value',
      title: state.hasClip
        ? 'Write the copied value onto this parameter (ids this block does not expose are dropped, not guessed)'
        : 'No parameter value copied yet',
      disabled: !state.hasClip,
      separatorBefore: true,
      run: onPaste
    }
  ];
}
