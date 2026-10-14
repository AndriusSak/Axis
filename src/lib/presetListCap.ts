/**
 * Soft row cap for the preset-picker overlay — the `docs/axis-fm3edit-feature-parity-audit.md` §5.1
 * list-cap rule, applied to the picker.
 *
 * An FM3 has 512 preset slots and the picker lists every one of them, so the first paint is capped
 * (mounting 512 rows on open made the overlay slow). The cap alone was the `AxisHistoryDockPanel`
 * defect class in a milder form: the rows past the cap were reachable ONLY by typing a number or a
 * name into the search box, so browsing stopped dead at slot 299 and the UI said "type a number or
 * name to filter". This module pairs the cap with an expander so the tail stays REACHABLE:
 *
 *   - the caller renders `rows`;
 *   - when `capped` is true it also renders the "Show all {totalRows} presets" control, which flips
 *     `showAll` and re-runs this function to get every row.
 *
 * Kept as a pure module because the `.svelte` components in this repo cannot be mounted under the
 * node-env vitest — same reason `paletteRows.ts` and `presetBrowserWorkbenchLayout.ts` exist.
 */
export const PRESET_PICKER_SOFT_ROW_CAP = 300;

export interface PresetPickerRowCap<T> {
  /** Rows to render. */
  rows: T[];
  /** Rows the list actually holds (never the capped length — the header count must not be derived
   *  from `rows`). */
  totalRows: number;
  /** True when `rows` is a prefix of the list, i.e. an expander must be rendered. */
  capped: boolean;
  /** How many rows the expander would reveal. */
  hiddenCount: number;
}

/** Cap `list` unless `showAll`. `cap` is injectable so a test can exercise the boundary cheaply. */
export function applyPresetPickerRowCap<T>(
  list: T[],
  showAll: boolean,
  cap: number = PRESET_PICKER_SOFT_ROW_CAP,
): PresetPickerRowCap<T> {
  const totalRows = list.length;
  const capped = !showAll && totalRows > cap;
  const rows = capped ? list.slice(0, cap) : list;
  return { rows, totalRows, capped, hiddenCount: capped ? totalRows - rows.length : 0 };
}
