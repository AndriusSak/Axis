// Context-menu item building for the docked preset browser rows (§4.4 of
// docs/workbench-dc-parity/06-preset-browser.md). Pure logic: given an entry's shape + the live
// capabilities (rename allowed? cloud signed in?) + the current multi-select count, it returns the
// design's menu actions THAT HAVE REAL BACKING in the workbench today.
//
// Deliberately scoped to backed actions (task rule "no fantasy items"):
//   - load        → runtime.loadEntry            (all entries; "Load from cloud" for cloud-only rows)
//   - audition    → runtime.auditionEntry        (device slots only)
//   - favorite    → library.toggleFav            (toggles; label flips on entry.fav)
//   - rename      → editor.renameStoredPreset    (device slots, gated on canRenamePresets)
//   - cloudUpload → editor.backupPreset+cloudSync (signed in; "Back up"/"Upload"/"Re-upload" by sync state)
//   - cloudDownload → runtime cloud-version load  (signed in; outdated/cloudOnly rows)
// The design's Convert / Export-to-disk / Delete-everywhere are NOT emitted here — they are
// "Coming soon" or monolith-only flows with no workbench backing yet (see report/deferrals).
// Duplicate/Swap ARE emitted (audit §2.4) — the copy-by-store sequence (src/lib/presetSlotOps.ts,
// editor.duplicateStoredPreset/swapStoredPresets) backs them; Move/Delete stay honest DISABLED stubs
// (no slot-erase primitive exists in the FM3 protocol) so the menu never lies.
import type { WorkbenchMenuItem } from '../../workbench/svelte/contextMenu';

export type AxisPbMenuActionId =
  | 'load'
  | 'audition'
  | 'favorite'
  | 'rename'
  | 'duplicate'
  | 'swap'
  | 'move'
  | 'delete'
  | 'crossConvert'
  | 'openConverter'
  | 'deleteConverted'
  | 'cloudUpload'
  | 'cloudDownload';

/** Honest reason shared by Move and Delete everywhere: the wire protocol can't clear a slot. */
export const AXIS_PB_NO_ERASE_REASON =
  'Not available — the device protocol has no slot-erase op, so a preset can’t be cleared or moved off a slot from here.';
/** Reason shown on Duplicate/Swap when the device lacks the dump + edit-buffer-load + store primitives. */
export const AXIS_PB_NO_COPY_REASON =
  'Duplicate/swap unavailable — this server or device lacks the dump + edit-buffer-load + store primitives.';

// The subset of an entry the menu builder needs (keeps it decoupled from the full summary type).
export interface AxisPbMenuEntry {
  id: string;
  /** True for a synthesized cloud-only row (host id starts with `cloud:`). */
  cloudOnly: boolean;
  /** Is this a real device slot (source 'device' with a slot number ≥ 0)? Gates audition + rename. */
  deviceSlot: boolean;
  fav: boolean;
  /** Resolved cloud sync state — decides the cloud action label/direction. */
  syncState: string;
  /** A saved cross-device conversion (source 'converted') — gets its own reduced menu. */
  converted?: boolean;
}

export interface AxisPbMenuCaps {
  /** editor.canRenamePresets — device can rename+store a slot. */
  canRename: boolean;
  /** cloud enabled AND signed in — gates the cloud up/down actions. */
  cloudOn: boolean;
  /** editor.canCopySlots — device exposes dump + edit-buffer-load + store (src/lib/presetSlotOps). */
  canCopySlots: boolean;
}

export interface AxisPbMenuAction {
  id: AxisPbMenuActionId;
  label: string;
  hint?: string;
  danger?: boolean;
  /** Rendered disabled (no-op) with `reason` as its tooltip — an honest stub, never a silent lie. */
  disabled?: boolean;
  /** Human reason surfaced as the item tooltip when `disabled`. */
  reason?: string;
  separatorBefore?: boolean;
}

// The cloud action (label + direction) for a single entry by its sync state (§4.4 sync-state action).
function cloudActionFor(entry: AxisPbMenuEntry): AxisPbMenuAction | null {
  switch (entry.syncState) {
    case 'modified':
      return { id: 'cloudUpload', label: 'Upload changes', separatorBefore: true };
    case 'outdated':
      return { id: 'cloudDownload', label: 'Update from cloud', separatorBefore: true };
    case 'cloudOnly':
      return { id: 'cloudDownload', label: 'Download to device', separatorBefore: true };
    case 'deviceOnly':
    case 'unknown':
      return { id: 'cloudUpload', label: 'Back up to cloud', separatorBefore: true };
    case 'synced':
      return { id: 'cloudUpload', label: 'Re-upload to cloud', separatorBefore: true };
    default:
      return null;
  }
}

// Build the ordered action list (pre-render form) for one row's context menu (§4.4 single-row menu).
export function buildAxisPbMenuActions(entry: AxisPbMenuEntry, caps: AxisPbMenuCaps): AxisPbMenuAction[] {
  // Saved cross-device conversions are NOT device slots — they get their own reduced menu: re-open in the
  // converter, favorite, delete. (A true ".syx export" action is wired in the codec-authoring task — it
  // needs a codec endpoint, so it is deliberately omitted here rather than shipped as a no-op.)
  if (entry.converted) {
    return [
      { id: 'openConverter', label: 'Open in converter', hint: '↵' },
      { id: 'favorite', label: entry.fav ? 'Remove from favorites' : 'Add to favorites', separatorBefore: true },
      { id: 'deleteConverted', label: 'Delete', danger: true, separatorBefore: true }
    ];
  }
  const actions: AxisPbMenuAction[] = [
    { id: 'load', label: entry.cloudOnly ? 'Load from cloud' : 'Load preset', hint: '↵' }
  ];
  if (entry.deviceSlot && !entry.cloudOnly) {
    actions.push({ id: 'audition', label: 'Audition (edit buffer)' });
    if (caps.canRename) actions.push({ id: 'rename', label: 'Rename & save…' });
    // Device-slot librarian (audit §2.4). Duplicate/Swap are backed by the copy-by-store sequence
    // (presetSlotOps → editor.duplicateStoredPreset/swapStoredPresets); gated on the device exposing
    // the dump + edit-buffer-load + store primitives. Move/Delete need a slot-erase op the FM3 wire
    // protocol does NOT expose, so they render DISABLED carrying the honest reason.
    const slotGate = (): Pick<AxisPbMenuAction, 'disabled' | 'reason'> =>
      caps.canCopySlots ? {} : { disabled: true, reason: AXIS_PB_NO_COPY_REASON };
    actions.push({ id: 'duplicate', label: 'Duplicate to slot…', ...slotGate() });
    actions.push({ id: 'swap', label: 'Swap with slot…', ...slotGate() });
    actions.push({ id: 'move', label: 'Move to slot…', disabled: true, reason: AXIS_PB_NO_ERASE_REASON });
  }
  // Cross-device converter (M4): available for every entry — the flow reads the row's .syx and opens the
  // convert dialog seeded with it. Not gated on caps (the converter is best-effort + offline).
  actions.push({ id: 'crossConvert', label: 'Convert to another device…', separatorBefore: true });
  actions.push({
    id: 'favorite',
    label: entry.fav ? 'Remove from favorites' : 'Add to favorites',
    separatorBefore: true
  });
  if (caps.cloudOn) {
    const cloud = cloudActionFor(entry);
    if (cloud) actions.push(cloud);
  }
  // "Delete everywhere" would clear the device slot too → not provable (no erase op) for device rows.
  if (entry.deviceSlot && !entry.cloudOnly) {
    actions.push({
      id: 'delete',
      label: 'Delete everywhere',
      danger: true,
      disabled: true,
      reason: AXIS_PB_NO_ERASE_REASON,
      separatorBefore: true
    });
  }
  return actions;
}

// Adapt the pre-render actions into the generic ContextMenu's item shape, wiring each `run` to the
// supplied dispatcher (the Svelte panel owns the side-effecting handlers).
export function toWorkbenchMenuItems(
  actions: AxisPbMenuAction[],
  dispatch: (id: AxisPbMenuActionId) => void
): WorkbenchMenuItem[] {
  return actions.map((action) => ({
    id: action.id,
    label: action.label,
    hint: action.hint,
    title: action.reason,
    danger: action.danger,
    disabled: action.disabled,
    separatorBefore: action.separatorBefore,
    run: () => dispatch(action.id)
  }));
}
