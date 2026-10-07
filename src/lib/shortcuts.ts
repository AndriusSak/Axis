// Central keyboard-shortcut registry for the Axis editor.
//
// FM3-Edit is shortcut-rich (see docs/axis-fm3edit-feature-parity-audit.md §2.12). Before this module
// the only bindings lived inline in routes/+page.svelte (Cmd+K palette, Cmd+Z/Cmd+Y undo/redo,
// Escape) with no map. This file is the single source of truth: a data-driven list of chords that the
// page resolves and dispatches. It is deliberately a plain .ts module (no Svelte runes, no store
// imports) so the matching logic is unit-testable in this repo's node-env vitest — the .svelte hookup
// is pinned by a source-guard test (`shortcuts.test.ts`), the same pattern as `listCaps.test.ts`.
//
// STATUS DISCIPLINE: a binding is only `wired` when the editor/store action it needs ALREADY exists.
// Anything FM3-Edit does that Axis has no method for is still REGISTERED here as `not-yet-wired` (with
// a `reason`), so the gap is visible and the key can be filled in without re-inventing the map.
//
// TYPING GUARD: bare (modifier-less) chords must never hijack the keyboard while the user is typing.
// The page keeps the existing INPUT/TEXTAREA/contentEditable guard and passes it to `resolveShortcut`.

/** A single key+modifier combination. `mod` = Cmd on macOS, Ctrl elsewhere. */
export interface ShortcutMatch {
  /** Lower-cased `KeyboardEvent.key`; the space bar is normalised to the token `"space"`. */
  key: string;
  mod?: boolean;
  shift?: boolean;
  alt?: boolean;
}

export type ShortcutStatus = 'wired' | 'not-yet-wired';

export interface ShortcutDef {
  /** Stable, action-oriented id — the page switches on this. */
  id: string;
  /** Human-readable action name (for a future shortcuts help sheet). */
  label: string;
  /** Display chord, e.g. "⌘S" / "⇧Space" / "P". */
  chord: string;
  status: ShortcutStatus;
  /** Chords that trigger this action (aliases: Backspace+Delete, Cmd+Y+Shift+Cmd+Z). */
  matches: ShortcutMatch[];
  /** Chords that fire even while an input/textarea is focused (e.g. Cmd+K, Cmd+S). Default false. */
  allowWhileEditing?: boolean;
  /** Why the action isn't wired yet — only for `not-yet-wired`. */
  reason?: string;
}

/** The registry. FM3-Edit parity set; ordered so the exact-modifier match wins first. */
export const SHORTCUTS: readonly ShortcutDef[] = [
  // ── wired: existing editor/history actions ──
  {
    id: 'palette',
    label: 'Open command palette',
    chord: '⌘K',
    status: 'wired',
    allowWhileEditing: true, // the palette must be reachable from a search/rename field too
    matches: [{ key: 'k', mod: true }],
  },
  {
    id: 'undo',
    label: 'Undo',
    chord: '⌘Z',
    status: 'wired',
    matches: [{ key: 'z', mod: true }],
  },
  {
    id: 'redo',
    label: 'Redo',
    chord: '⌘⇧Z',
    status: 'wired',
    matches: [
      { key: 'z', mod: true, shift: true },
      { key: 'y', mod: true },
    ],
  },
  {
    id: 'save',
    label: 'Save preset',
    chord: '⌘S',
    status: 'wired',
    allowWhileEditing: true, // save should work from a rename field; the browser's save dialog is suppressed
    matches: [{ key: 's', mod: true }],
  },
  {
    id: 'presetPicker',
    label: 'Open preset picker',
    chord: 'P',
    status: 'wired',
    matches: [{ key: 'p' }],
  },
  {
    id: 'channelA',
    label: 'Select channel A',
    chord: 'A',
    status: 'wired',
    matches: [{ key: 'a' }],
  },
  {
    id: 'channelB',
    label: 'Select channel B',
    chord: 'B',
    status: 'wired',
    matches: [{ key: 'b' }],
  },
  {
    id: 'channelC',
    label: 'Select channel C',
    chord: 'C',
    status: 'wired',
    matches: [{ key: 'c' }],
  },
  {
    id: 'channelD',
    label: 'Select channel D',
    chord: 'D',
    status: 'wired',
    matches: [{ key: 'd' }],
  },
  {
    id: 'bypass',
    label: 'Bypass / engage selected block',
    chord: 'Space',
    status: 'wired',
    matches: [{ key: 'space' }],
  },
  {
    id: 'deleteBlock',
    label: 'Remove selected block',
    chord: 'Backspace',
    status: 'wired',
    matches: [{ key: 'backspace' }, { key: 'delete' }],
  },
  {
    id: 'dismiss',
    label: 'Close the topmost layer',
    chord: 'Esc',
    status: 'wired',
    matches: [{ key: 'escape' }],
  },
  {
    id: 'disconnectCable',
    label: 'Disconnect all cables from the selected block',
    chord: '⌘D',
    status: 'wired',
    matches: [{ key: 'd', mod: true }],
  },
  {
    id: 'insertShunt',
    label: 'Insert a shunt in the first empty cell',
    chord: '⌘U',
    status: 'wired',
    matches: [{ key: 'u', mod: true }],
  },
  {
    // FM3-Edit Quick Build (§2.9 remainder) — a curated one-click block PLACEMENT panel, docked by the
    // 'Q' chord. Placement reuses the existing grid op (editor.place → forgefx.placeCell); the panel
    // itself is registered as the workbench panel 'axis.quickBuild' / action 'axis.openQuickBuild'.
    id: 'quickBuild',
    label: 'Open Quick Build panel',
    chord: 'Q',
    status: 'wired',
    matches: [{ key: 'q' }],
  },
  {
    id: 'resetChannel',
    label: 'Reset the selected block to model defaults',
    chord: '⌘I',
    status: 'wired',
    matches: [{ key: 'i', mod: true }],
  },
  {
    id: 'copyBlock',
    label: 'Copy the selected block',
    chord: '⌘C',
    status: 'wired',
    matches: [{ key: 'c', mod: true }],
  },
  {
    id: 'pasteBlock',
    label: 'Paste the block into the selection',
    chord: '⌘V',
    status: 'wired',
    matches: [{ key: 'v', mod: true }],
  },

  // ── wired: FM3-Edit parity chords whose backing action now exists ──
  // ⌘M opens the Manage-Presets / preset-browser surface (the workbench Preset Browser page, else the
  // legacy library screen); ⇧Space engages every block in the current scene through the Scene Manager's
  // own bulk sequence (sceneOps.bulkBypass — no wire op); ↑/↓ nudge the selected/open parameter by one
  // step (paramNudge.ts over the served min/max/norm or enum ordinal list, applied via setParam/setEnum).
  {
    id: 'managePresets',
    label: 'Manage presets',
    chord: '⌘M',
    status: 'wired',
    matches: [{ key: 'm', mod: true }],
  },
  {
    id: 'engageAllScenes',
    label: 'Engage all scenes',
    chord: '⇧Space',
    status: 'wired',
    matches: [{ key: 'space', shift: true }],
  },
  {
    id: 'nudgeValueUp',
    label: 'Nudge value up',
    chord: '↑',
    status: 'wired',
    matches: [{ key: 'arrowup' }],
  },
  {
    id: 'nudgeValueDown',
    label: 'Nudge value down',
    chord: '↓',
    status: 'wired',
    matches: [{ key: 'arrowdown' }],
  },
] as const;

/** Normalise a raw `KeyboardEvent.key` to the registry's token vocabulary. */
export function normalizeKey(key: string): string {
  if (key === ' ' || key === 'Spacebar') return 'space';
  return key.toLowerCase();
}

/** True when the event target is a text field — the page must not hijack bare chords there. */
export function isEditingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || !el.tagName) return false;
  return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable === true;
}

export interface KeyLike {
  key: string;
  metaKey?: boolean;
  ctrlKey?: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
}

/**
 * Resolve a key event to its shortcut definition, or null.
 *
 * `mod` matches Cmd on macOS and Ctrl elsewhere (either physical modifier accepts the "mod" chord).
 * Modifiers must match exactly, so `⌘Z` (undo) and `⌘⇧Z` (redo) stay distinct and a bare `A` never
 * fires on `Ctrl+A`. When `editing` is true, chords without `allowWhileEditing` are skipped (typing guard).
 */
export function resolveShortcut(e: KeyLike, editing = false): ShortcutDef | null {
  const mod = !!(e.metaKey || e.ctrlKey);
  const key = normalizeKey(e.key);
  for (const def of SHORTCUTS) {
    if (editing && !def.allowWhileEditing) continue;
    for (const m of def.matches) {
      if (m.key !== key) continue;
      if (!!m.mod !== mod) continue;
      if (!!m.shift !== !!e.shiftKey) continue;
      if (!!m.alt !== !!e.altKey) continue;
      return def;
    }
  }
  return null;
}

/** All shortcut ids that the app currently wires. */
export const WIRED_IDS: readonly string[] = SHORTCUTS.filter((s) => s.status === 'wired').map((s) => s.id);
