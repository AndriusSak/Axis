// Command-palette (Cmd+K) row building — pure, so the result set is unit-testable without mounting a
// Svelte component (this repo's vitest is node-env; same extraction pattern as `eventReload.ts`).
//
// CONTRACT: **never truncate.** The palette is the only route to a block's model list, and the rosters
// are big (FM3: 331 amp models, 86 drives, 79 reverbs). A cap here hides models with no indication —
// and because the header count is derived from these rows, a cap also makes the UI *report the
// truncated length as the total* ("80 results" for a 331-model roster). If a cap is ever genuinely
// required for performance, it must be applied at render time AND disclosed in the header the way
// `CabPicker.svelte` ("showing 250 of 1024, search to narrow") and `PresetPicker.svelte` ("+N more")
// already do — never silently here.

export interface PaletteTypeOpt {
  value: number;
  name: string;
  manufacturer: string | null;
  basedOn: string | null;
}

export interface PaletteFamily {
  slug: string;
  name: string;
  page: number;
}

export interface PaletteRow {
  key: string;
  name: string;
  sub: string;
  kind: 'Model' | 'Block';
  value: number;
  page: number;
  mfr: string;
}

/** Display label for a model: the real-world name when available *and* requested, else the Fractal name. */
export function paletteTypeLabel(t: PaletteTypeOpt, realNames: boolean): string {
  return realNames && (t.basedOn || t.manufacturer) ? `${t.manufacturer ?? ''} ${t.basedOn ?? ''}`.trim() : t.name;
}

const typeHaystack = (t: PaletteTypeOpt): string =>
  `${t.name} ${t.manufacturer ?? ''} ${t.basedOn ?? ''}`.toLowerCase();

/** Model rows for retype mode. `query` is the already-lowercased, trimmed search text ('' = all). */
export function matchPaletteTypes(types: readonly PaletteTypeOpt[], query: string, realNames: boolean): PaletteRow[] {
  const list = query ? types.filter((t) => typeHaystack(t).includes(query)) : types;
  return list.map((t) => ({
    key: String(t.value),
    name: paletteTypeLabel(t, realNames),
    sub: t.name,
    kind: 'Model',
    value: t.value,
    page: 0,
    mfr: t.manufacturer ?? ''
  }));
}

/** Block rows for place mode. Matches the display name and the slug. */
export function matchPaletteFamilies(families: readonly PaletteFamily[], query: string): PaletteRow[] {
  const list = query ? families.filter((f) => `${f.name} ${f.slug}`.toLowerCase().includes(query)) : families;
  return list.map((f) => ({ key: f.slug, name: f.name, sub: f.slug, kind: 'Block', value: 0, page: f.page, mfr: '' }));
}
