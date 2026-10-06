// Per-entry COLOUR / FLAG tags for preset entries (parity audit §2.13 — FM3-Edit lets you colour a
// picker entry and filter by colour).
//
// SCOPE GUARD: this is a USER-CHOSEN flag stored per preset entry id. It is deliberately NOT the same
// thing as (a) the per-BLOCK-FAMILY category colours (catColor/BLOCK_COLOR — derived from a block's
// slug) or (b) the CPU-load colour ramp (cpuColor — derived from the estimated DSP load) that already
// live in PresetBrowser.svelte. Those are computed presentation; this is persisted user metadata.
//
// The whole module is pure except the two localStorage helpers at the bottom, so the tag store, the
// filter predicate and the palette are unit-testable without a DOM.
//
// Entry identity is the same stable `LibEntry.id` the tags/favourites stores key on ('dev:<n>',
// 'file:<name>', 'local:<relPath>', 'conv:<docId>', 'cloud:<n>') — so a colour follows an entry across
// every browser surface (device slot, local file, cloud, converted).
export type AxisPresetColorId = 'red' | 'orange' | 'amber' | 'green' | 'blue' | 'violet';

export interface AxisPresetColorDef {
  id: AxisPresetColorId;
  label: string;
  hex: string;
}

/** The small palette (audit asks for ~6 colours) + the implicit "none" used to clear a tag. */
export const AXIS_PRESET_COLORS: readonly AxisPresetColorDef[] = [
  { id: 'red', label: 'Red', hex: '#d6543f' },
  { id: 'orange', label: 'Orange', hex: '#f5a623' },
  { id: 'amber', label: 'Amber', hex: '#e0c33a' },
  { id: 'green', label: 'Green', hex: '#33c46b' },
  { id: 'blue', label: 'Blue', hex: '#4f6bed' },
  { id: 'violet', label: 'Violet', hex: '#9b8cf0' }
] as const;

/** The "clear the tag" sentinel used by the picker (there is no 7th swatch). */
export const AXIS_PRESET_COLOR_NONE = 'none';

/** Filter selector: show all, only untagged, or one colour. */
export type AxisPresetColorFilter = 'all' | 'none' | AxisPresetColorId;

/** entryId → colour. An absent key means "no colour" (never stores 'none'). */
export type AxisPresetColorMap = Record<string, AxisPresetColorId>;

/** localStorage key — same family as `axs.lib.tags` / `axs.lib.favs` (library.svelte.ts). */
export const AXIS_PRESET_COLORS_KEY = 'axs.lib.colors';

const COLOR_IDS: readonly string[] = AXIS_PRESET_COLORS.map((c) => c.id);

export function isPresetColorId(value: unknown): value is AxisPresetColorId {
  return typeof value === 'string' && COLOR_IDS.includes(value);
}

export function isPresetColorFilter(value: unknown): value is AxisPresetColorFilter {
  return value === 'all' || value === 'none' || isPresetColorId(value);
}

export function presetColorDef(id: AxisPresetColorId): AxisPresetColorDef | undefined {
  return AXIS_PRESET_COLORS.find((c) => c.id === id);
}

/** Hex for a colour id, or null for 'none'/unknown (callers render no dot). Accepts 'none' so filter
 *  values can be passed straight through. */
export function presetColorHex(id: AxisPresetColorId | 'none' | null | undefined): string | null {
  return id && id !== AXIS_PRESET_COLOR_NONE ? (presetColorDef(id)?.hex ?? null) : null;
}

export function presetColorLabel(id: AxisPresetColorId): string {
  return presetColorDef(id)?.label ?? id;
}

/** The colour of one entry, or null when untagged. */
export function presetColorOf(map: AxisPresetColorMap, entryId: string): AxisPresetColorId | null {
  const v = map[entryId];
  return isPresetColorId(v) ? v : null;
}

/**
 * Set (or clear) an entry's colour, returning a NEW map (never mutates the input — the store assigns
 * the result into `$state` so Svelte reactivity fires). Passing 'none' or an unknown value clears the
 * key entirely so serialized maps stay clean (no `"x": "none"` noise).
 */
export function setPresetColor(
  map: AxisPresetColorMap,
  entryId: string,
  color: AxisPresetColorFilter
): AxisPresetColorMap {
  const next: AxisPresetColorMap = { ...map };
  if (isPresetColorId(color)) next[entryId] = color;
  else delete next[entryId];
  return next;
}

/** Does an entry pass the active colour filter? `all` passes everything. */
export function matchesPresetColorFilter(
  map: AxisPresetColorMap,
  entryId: string,
  filter: AxisPresetColorFilter
): boolean {
  if (filter === 'all') return true;
  const c = presetColorOf(map, entryId);
  if (filter === 'none') return c === null;
  return c === filter;
}

export function hasAnyPresetColor(map: AxisPresetColorMap): boolean {
  return Object.values(map).some((v) => isPresetColorId(v));
}

/** Live per-colour counts (+ untagged) for the filter chips — reflects the whole library, not a slice. */
export function presetColorCounts(
  map: AxisPresetColorMap,
  entryIds: readonly string[]
): Record<AxisPresetColorFilter, number> {
  const out = { all: entryIds.length, none: 0 } as Record<AxisPresetColorFilter, number>;
  for (const c of AXIS_PRESET_COLORS) out[c.id] = 0;
  for (const id of entryIds) {
    const c = presetColorOf(map, id);
    if (c) out[c] += 1;
    else out.none += 1;
  }
  return out;
}

/** Validate/sanitize a value loaded from storage or a remote config doc into a clean map. */
export function sanitizePresetColors(raw: unknown): AxisPresetColorMap {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: AxisPresetColorMap = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (isPresetColorId(v)) out[k] = v;
  }
  return out;
}

// ── localStorage I/O (the only impure bits; kept thin so the logic above stays testable) ──

export function loadPresetColors(): AxisPresetColorMap {
  try {
    const raw = localStorage.getItem(AXIS_PRESET_COLORS_KEY);
    return raw ? sanitizePresetColors(JSON.parse(raw)) : {};
  } catch {
    return {};
  }
}

export function persistPresetColorsLocal(map: AxisPresetColorMap): void {
  try {
    localStorage.setItem(AXIS_PRESET_COLORS_KEY, JSON.stringify(map));
  } catch {
    /* quota / unavailable — localStorage stays best-effort, the config mirror still runs */
  }
}
