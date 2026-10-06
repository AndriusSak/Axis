import { describe, expect, it, beforeEach } from 'vitest';

import {
  AXIS_PRESET_COLORS,
  AXIS_PRESET_COLOR_NONE,
  AXIS_PRESET_COLORS_KEY,
  isPresetColorId,
  isPresetColorFilter,
  presetColorHex,
  presetColorOf,
  setPresetColor,
  matchesPresetColorFilter,
  hasAnyPresetColor,
  presetColorCounts,
  sanitizePresetColors,
  loadPresetColors,
  persistPresetColorsLocal,
  type AxisPresetColorMap
} from './presetColors';

// Minimal in-memory localStorage stub (node test env has none).
function stubStorage(): void {
  const store = new Map<string, string>();
  (globalThis as { localStorage?: Storage }).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
    key: () => null,
    length: 0
  } as Storage;
}

describe('preset colour tags (parity §2.13)', () => {
  it('offers a small palette of 6 colours with stable ids and hexes', () => {
    expect(AXIS_PRESET_COLORS).toHaveLength(6);
    expect(AXIS_PRESET_COLORS.map((c) => c.id)).toEqual(['red', 'orange', 'amber', 'green', 'blue', 'violet']);
    for (const c of AXIS_PRESET_COLORS) expect(c.hex).toMatch(/^#[0-9a-f]{6}$/i);
    // the palette is distinct from block-family / CPU colours by construction (user-chosen ids).
    expect(new Set(AXIS_PRESET_COLORS.map((c) => c.hex)).size).toBe(6);
  });

  it('validates ids and the filter union', () => {
    expect(isPresetColorId('red')).toBe(true);
    expect(isPresetColorId('none')).toBe(false);
    expect(isPresetColorId('crimson')).toBe(false);
    expect(isPresetColorFilter('all')).toBe(true);
    expect(isPresetColorFilter('none')).toBe(true);
    expect(isPresetColorFilter('blue')).toBe(true);
    expect(isPresetColorFilter('chartreuse')).toBe(false);
  });

  it('resolves hexes (null for none/unknown) and labels', () => {
    expect(presetColorHex('red')).toMatch(/^#/);
    expect(presetColorHex('none')).toBeNull();
    expect(presetColorHex(null)).toBeNull();
    expect(presetColorHex(undefined)).toBeNull();
  });

  it('sets, overwrites and clears a colour without mutating the input map', () => {
    const base: AxisPresetColorMap = {};
    const red = setPresetColor(base, 'dev:1', 'red');
    expect(red).toEqual({ 'dev:1': 'red' });
    expect(base).toEqual({}); // input untouched (immutable update for $state)
    const blue = setPresetColor(red, 'dev:1', 'blue');
    expect(blue).toEqual({ 'dev:1': 'blue' });
    // 'none' clears the key entirely — no "dev:1":"none" noise in the serialized map.
    expect(setPresetColor(blue, 'dev:1', AXIS_PRESET_COLOR_NONE)).toEqual({});
    // an unknown value also clears (defensive; never persists garbage).
    expect(setPresetColor(blue, 'dev:1', 'chartreuse' as never)).toEqual({});
  });

  it('reads an entry colour, null when untagged/invalid', () => {
    expect(presetColorOf({ 'file:a': 'green' }, 'file:a')).toBe('green');
    expect(presetColorOf({}, 'file:a')).toBeNull();
    expect(presetColorOf({ 'x': 'nope' as never } as AxisPresetColorMap, 'x')).toBeNull();
  });

  it('filters by all / none / a specific colour across every entry identity kind', () => {
    const map: AxisPresetColorMap = { 'dev:1': 'red', 'file:a': 'green', 'local:p.syx': 'green', 'cloud:9': 'blue' };
    const ids = ['dev:1', 'file:a', 'local:p.syx', 'cloud:9', 'conv:d1'];
    expect(ids.filter((id) => matchesPresetColorFilter(map, id, 'all'))).toEqual(ids);
    expect(ids.filter((id) => matchesPresetColorFilter(map, id, 'none'))).toEqual(['conv:d1']);
    expect(ids.filter((id) => matchesPresetColorFilter(map, id, 'green'))).toEqual(['file:a', 'local:p.syx']);
    expect(ids.filter((id) => matchesPresetColorFilter(map, id, 'violet'))).toEqual([]);
  });

  it('reports whether any colour is set, and counts per filter over the given roster', () => {
    expect(hasAnyPresetColor({})).toBe(false);
    expect(hasAnyPresetColor({ 'x': 'nope' as never } as AxisPresetColorMap)).toBe(false);
    const map: AxisPresetColorMap = { 'dev:1': 'red', 'file:a': 'green', 'local:p.syx': 'green' };
    expect(hasAnyPresetColor(map)).toBe(true);
    const counts = presetColorCounts(map, ['dev:1', 'file:a', 'local:p.syx', 'cloud:9']);
    expect(counts.all).toBe(4);
    expect(counts.red).toBe(1);
    expect(counts.green).toBe(2);
    expect(counts.none).toBe(1);
    expect(counts.blue).toBe(0);
  });

  it('sanitizes a raw loaded value (drops non-object, arrays, bad ids)', () => {
    expect(sanitizePresetColors(null)).toEqual({});
    expect(sanitizePresetColors('x')).toEqual({});
    expect(sanitizePresetColors(['red'])).toEqual({});
    expect(sanitizePresetColors({ 'dev:1': 'red', 'dev:2': 'none', 'dev:3': 7 })).toEqual({ 'dev:1': 'red' });
  });
});

describe('preset colour persistence (local, keyed like tags/favs)', () => {
  beforeEach(() => stubStorage());

  it('round-trips through localStorage under the axs.lib.colors key', () => {
    persistPresetColorsLocal({ 'dev:3': 'amber' });
    expect(localStorage.getItem(AXIS_PRESET_COLORS_KEY)).toBe(JSON.stringify({ 'dev:3': 'amber' }));
    expect(loadPresetColors()).toEqual({ 'dev:3': 'amber' });
  });

  it('returns an empty map when unset, and survives corrupt JSON', () => {
    expect(loadPresetColors()).toEqual({});
    localStorage.setItem(AXIS_PRESET_COLORS_KEY, '{ not json');
    expect(loadPresetColors()).toEqual({});
    localStorage.setItem(AXIS_PRESET_COLORS_KEY, JSON.stringify({ 'x': 'bogus' }));
    expect(loadPresetColors()).toEqual({});
  });
});
