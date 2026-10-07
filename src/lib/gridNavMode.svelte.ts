// Grid Navigation Mode (audit §2.9, R25) — the reactive switch.
//
// A user toggle that keeps the Signal Grid snappy by SUPPRESSING the automatic per-block parameter
// fetch that selecting a block normally triggers (editor.openCell → #loadParams). While ON the grid
// keeps rendering the chain/state it already holds; the per-block read happens only on the EXPLICIT
// open-block-editor action.
//
// This file is deliberately a tiny STANDALONE runes switch, NOT a new editor-store member — the
// EditorSurface seam (editorSurface.ts / convertEditor.svelte.ts) stays untouched. The pure policy
// lives in gridNavMode.ts (shouldFetchOnGridAction, unit-tested); the Signal Grid consults it for
// every action it dispatches. Both the grid-header toggle (SignalGrid.svelte) and the 'G' shortcut
// (shortcuts.ts → routes/+page.svelte) route through this one state. Mode is session-only (not
// persisted) — a grid-interaction preference, not a device setting.
import { shouldFetchOnGridAction, type GridNavAction, type GridNavMode } from './gridNavMode';

let mode = $state<GridNavMode>('normal');

export const gridNavMode = {
  /** Reactive mode value — read inside $derived to track (default 'normal'). */
  get value(): GridNavMode {
    return mode;
  },
  /** Flip the mode (the grid-header pill and the 'G' shortcut both call this). */
  toggle: (): void => {
    mode = mode === 'gridNav' ? 'normal' : 'gridNav';
  }
};