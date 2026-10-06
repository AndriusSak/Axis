import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  SHORTCUTS,
  WIRED_IDS,
  resolveShortcut,
  normalizeKey,
  isEditingTarget,
  type KeyLike,
} from './shortcuts';

const ev = (key: string, mods: Partial<Pick<KeyLike, 'metaKey' | 'ctrlKey' | 'shiftKey' | 'altKey'>> = {}): KeyLike => ({
  key,
  ...mods,
});

const idOf = (e: KeyLike, editing = false) => resolveShortcut(e, editing)?.id ?? null;

describe('shortcut registry — FM3-Edit parity map', () => {
  it('resolves the wired chords', () => {
    expect(idOf(ev('k', { metaKey: true }))).toBe('palette');
    expect(idOf(ev('k', { ctrlKey: true }))).toBe('palette');
    expect(idOf(ev('z', { metaKey: true }))).toBe('undo');
    expect(idOf(ev('z', { metaKey: true, shiftKey: true }))).toBe('redo');
    expect(idOf(ev('y', { metaKey: true }))).toBe('redo');
    expect(idOf(ev('s', { metaKey: true }))).toBe('save');
    expect(idOf(ev('p'))).toBe('presetPicker');
    expect(idOf(ev('a'))).toBe('channelA');
    expect(idOf(ev('b'))).toBe('channelB');
    expect(idOf(ev('c'))).toBe('channelC');
    expect(idOf(ev('d'))).toBe('channelD');
    expect(idOf(ev(' '))).toBe('bypass');
    expect(idOf(ev('Backspace'))).toBe('deleteBlock');
    expect(idOf(ev('Delete'))).toBe('deleteBlock');
    expect(idOf(ev('Escape'))).toBe('dismiss');
  });

  it('modifiers must match exactly — a bare key never fires on a modified one', () => {
    expect(idOf(ev('a', { ctrlKey: true }))).toBeNull(); // no ⌘A binding; must not select channel A
    expect(idOf(ev('p', { metaKey: true }))).toBeNull();
    expect(idOf(ev('k'))).toBeNull(); // palette needs ⌘
    expect(idOf(ev('z'))).toBeNull(); // undo needs ⌘
  });

  it('typing guard: bare chords are skipped while editing, meta chords with allowWhileEditing survive', () => {
    // Editing suppresses undo/redo (unchanged from the old inline handler)…
    expect(idOf(ev('z', { metaKey: true }), true)).toBeNull();
    expect(idOf(ev('z', { metaKey: true, shiftKey: true }), true)).toBeNull();
    // …and every bare chord, so the user can type A/B/C/D/P/Space normally.
    expect(idOf(ev('a'), true)).toBeNull();
    expect(idOf(ev('p'), true)).toBeNull();
    expect(idOf(ev(' '), true)).toBeNull();
    expect(idOf(ev('Backspace'), true)).toBeNull();
    // Cmd+K (palette) and Cmd+S (save) are explicitly allowed from a field.
    expect(idOf(ev('k', { metaKey: true }), true)).toBe('palette');
    expect(idOf(ev('s', { metaKey: true }), true)).toBe('save');
  });

  it('normalises the space bar token', () => {
    expect(normalizeKey(' ')).toBe('space');
    expect(normalizeKey('Spacebar')).toBe('space');
    expect(normalizeKey('K')).toBe('k');
    expect(normalizeKey('ArrowUp')).toBe('arrowup');
  });

  it('detects editable targets', () => {
    expect(isEditingTarget(null)).toBe(false);
    expect(isEditingTarget({ tagName: 'DIV' } as unknown as HTMLElement)).toBe(false);
    expect(isEditingTarget({ tagName: 'INPUT' } as unknown as HTMLElement)).toBe(true);
    expect(isEditingTarget({ tagName: 'TEXTAREA' } as unknown as HTMLElement)).toBe(true);
    expect(isEditingTarget({ tagName: 'DIV', isContentEditable: true } as unknown as HTMLElement)).toBe(true);
  });
});

describe('shortcut registry — registered-but-not-yet-wired gaps', () => {
  it('still maps each FM3-Edit chord that has no backing action', () => {
    expect(idOf(ev('m', { metaKey: true }))).toBe('managePresets');
    expect(idOf(ev('d', { metaKey: true }))).toBe('disconnectCable');
    expect(idOf(ev('u', { metaKey: true }))).toBe('insertShunt');
    expect(idOf(ev(' ', { shiftKey: true }))).toBe('engageAllScenes');
    expect(idOf(ev('i', { metaKey: true }))).toBe('resetChannel');
    expect(idOf(ev('ArrowUp'))).toBe('nudgeValueUp');
    expect(idOf(ev('ArrowDown'))).toBe('nudgeValueDown');
  });

  it('every not-yet-wired entry documents why', () => {
    for (const s of SHORTCUTS.filter((s) => s.status === 'not-yet-wired')) {
      expect(s.reason, `${s.id} needs a reason`).toBeTruthy();
    }
  });
});

// The page cannot be mounted in this repo's node-env vitest (see listCaps.test.ts), so the .svelte
// hookup is pinned by scanning its source: it must import the registry, keep the typing guard, and
// dispatch EVERY wired id. A new wired shortcut without a page case now fails here.
describe('routes/+page.svelte — shortcut registry hookup (source guard)', () => {
  const page = readFileSync(fileURLToPath(new URL('../routes/+page.svelte', import.meta.url)), 'utf8');

  it('imports the registry resolver', () => {
    expect(page).toMatch(/from '\$lib\/shortcuts'/);
    expect(page).toMatch(/resolveShortcut/);
    expect(page).toMatch(/isEditingTarget/);
  });

  it('dispatches every wired shortcut id', () => {
    for (const id of WIRED_IDS) {
      expect(page, `+page.svelte is missing a case for '${id}'`).toMatch(new RegExp(`case '${id}':`));
    }
  });

  it('does not dispatch the not-yet-wired ids', () => {
    for (const s of SHORTCUTS.filter((s) => s.status === 'not-yet-wired')) {
      expect(page, `+page.svelte must not dispatch unwired '${s.id}'`).not.toMatch(new RegExp(`case '${s.id}':`));
    }
  });

  it('keeps the typing guard', () => {
    expect(page).toMatch(/isEditingTarget\(/);
  });
});
