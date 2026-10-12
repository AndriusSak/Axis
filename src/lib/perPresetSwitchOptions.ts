// NAMED PICKER OPTIONS FOR THE PER-PRESET SWITCH WRITE FIELDS (§3.8).
//
// The panel used to expose the TAP action code and the target as bare numeric inputs — the owner
// reported "per-preset switches display numbers, not names — 0 instead of a picker for Amp 1". The
// numbers are correct but unreadable; this module turns them into NAMED option lists.
//
// IT IS NOT A HAND-KEPT LIST. Every option is DERIVED from the codec's measured tables, imported from
// the same package the server bundles (`forgefx-midi/devices/gen3`):
//   • categories  —— `PP_ACTION_CATEGORIES` (all thirteen codes measured; 0 = Unassigned)
//   • functions   —— `PP_FUNCTION_NAMES[category]` (the per-category TAP menu, in index order)
//   • targets     —— `PP_TARGET_ANCHORS` (the FX-slot indices whose name was measured on the unit)
//
// HONESTY RULES (same three the view module enforces), all unit-tested without mounting the component:
//   • WHERE A NAME IS NOT MEASURED, SHOW THE RAW INDEX AND MARK IT. `ppFunctionName` / `ppTargetLabel`
//     return null for an index (or a whole category) nobody named; that null survives here as a
//     `named:false` option whose label is the raw number plus "(unnamed)" / "(unmeasured)" — never a
//     blank, and never a `0` that reads like a real first entry.
//   • A CAPPED ROSTER DISCLOSES ITS CAP. `PP_TARGET_ANCHORS` names only the FX-slot indices that were
//     measured — an unknown subset of the device's list. `targetCoverageNote()` states how many are
//     named and that the rest are raw numbers, so the select is never a silently truncated roster
//     (the repo rule: `paletteRows.ts` / `listCaps.test.ts`).
//   • NEVER INVENT A NAME. An option for a value the codec cannot name says so; the label is not a
//     guess at the nearest plausible block or function.
// NOTE THE SPECIFIER — it is the SELF-CONTAINED `perPresetSwitches` module, NOT the `forgefx-midi/devices/gen3`
// barrel. The barrel re-exports `factory.js` → `writer.js`, and `writer.js` reads
// `process.env.MCP_APPLY_BUDGET_MS` at module top level, so importing the barrel from browser code throws
// `ReferenceError: process is not defined` and the ENTIRE app fails to boot (measured 2026-10-12: all 144
// Playwright specs timed out waiting for `.aw-root`, while 1944 vitest cases and svelte-check stayed green —
// Node HAS `process`, so no unit suite can see this). `perPresetSwitches.js` imports nothing and touches no
// Node global. `perPresetSwitchOptions.browser-safety.test.ts` guards the specifier.
import {
  PP_ACTION_CATEGORIES,
  PP_FUNCTION_NAMES,
  PP_TARGET_ANCHORS,
  ppTargetIsFxSlot
} from 'forgefx-midi/devices/gen3/perPresetSwitches';

/** One choice in a picker. `value` is the exact number written; `label` what the user reads. */
export interface SwitchOption {
  value: number;
  label: string;
  /** True when the codec has a MEASURED name for this value. False = the option shows the raw number,
   *  marked unmeasured; picking it still writes the number, it just is not named. */
  named: boolean;
}

/** The category list: Unassigned (0) followed by the thirteen measured category codes, ascending. */
export function categoryOptions(): SwitchOption[] {
  const out: SwitchOption[] = [{ value: 0, label: 'Unassigned', named: true }];
  for (const code of Object.keys(PP_ACTION_CATEGORIES)) {
    out.push({ value: Number(code), label: PP_ACTION_CATEGORIES[Number(code)]!, named: true });
  }
  return out.sort((a, b) => a.value - b.value);
}

/** Hex form for an unmeasured code, so the label is identifiable rather than a bare decimal. */
const hex16 = (v: number): string => `0x${v.toString(16).padStart(2, '0')}`;

/**
 * The option for the row's CURRENT action code, even when no option list contains it. 0 is Unassigned;
 * a measured code is its category; a code the codec never named renders as `code 0xNN (unmeasured)` —
 * the null from `PP_ACTION_CATEGORIES` surfacing as an explicit unmeasured state, never a made-up name.
 */
export function categoryOptionFor(code: number | null): SwitchOption {
  if (code === null) return { value: 0, label: '—', named: false };
  if (code === 0) return { value: 0, label: 'Unassigned', named: true };
  const name = PP_ACTION_CATEGORIES[code];
  return name
    ? { value: code, label: name, named: true }
    : { value: code, label: `code ${hex16(code)} (unmeasured)`, named: false };
}

/** The category options WITH the row's current code guaranteed present (unmeasured codes included). */
export function categoryOptionsIncluding(code: number | null): SwitchOption[] {
  const list = categoryOptions();
  if (code !== null && !list.some((o) => o.value === code)) {
    list.push(categoryOptionFor(code));
    list.sort((a, b) => a.value - b.value);
  }
  return list;
}

/**
 * The TAP function list for a category, in index order. EMPTY when the codec has no table for the
 * category (no measured list) — the caller then shows the category as unnamed rather than a list of
 * fabricated entries. A whole category being unnamed is a real state (`PP_FUNCTION_NAMES[code]` is
 * absent), and it must not be confused with a category whose list is simply empty.
 */
export function functionOptions(actionCode: number | null): SwitchOption[] {
  if (actionCode === null) return [];
  const table = PP_FUNCTION_NAMES[actionCode];
  if (!table) return [];
  return Object.keys(table)
    .map((i) => ({ value: Number(i), label: table[Number(i)]!, named: true }))
    .sort((a, b) => a.value - b.value);
}

/** True when the codec carries a measured function menu for this category. */
export function categoryHasFunctions(actionCode: number | null): boolean {
  return actionCode !== null && !!PP_FUNCTION_NAMES[actionCode];
}

/**
 * The option for a specific (category, function) pair. `PP_FUNCTION_NAMES` returns null for an index
 * past a list's end — or for a category with no list — and that null becomes an explicit
 * `entry N (unnamed)` option here rather than a blank or a `0`.
 */
export function functionOptionFor(actionCode: number | null, functionIndex: number | null): SwitchOption {
  if (functionIndex === null) return { value: 0, label: '—', named: false };
  const name = actionCode === null ? undefined : PP_FUNCTION_NAMES[actionCode]?.[functionIndex];
  return name
    ? { value: functionIndex, label: name, named: true }
    : { value: functionIndex, label: `entry ${functionIndex} (unnamed)`, named: false };
}

/** The TAP function options WITH the row's current index guaranteed present (unnamed ones included). */
export function functionOptionsIncluding(actionCode: number | null, currentIndex: number | null): SwitchOption[] {
  const list = functionOptions(actionCode);
  if (currentIndex !== null && !list.some((o) => o.value === currentIndex)) {
    list.push(functionOptionFor(actionCode, currentIndex));
    list.sort((a, b) => a.value - b.value);
  }
  return list;
}

/** The named FX-slot target indices, ascending — the measured anchors. */
export function targetOptions(currentIndex: number | null = null): SwitchOption[] {
  const list: SwitchOption[] = Object.keys(PP_TARGET_ANCHORS)
    .map((i) => ({ value: Number(i), label: PP_TARGET_ANCHORS[Number(i)]!, named: true }))
    .sort((a, b) => a.value - b.value);
  // The row's own index is ALWAYS representable, even when no anchor names it — as a raw number marked
  // unmeasured. Without this a preset whose target byte is an unmeasured index could not display (or
  // re-write) its own value without a bare number field.
  if (currentIndex !== null && !list.some((o) => o.value === currentIndex)) {
    list.push({ value: currentIndex, label: `index ${currentIndex} (unmeasured)`, named: false });
    list.sort((a, b) => a.value - b.value);
  }
  return list;
}

/** How many FX-slot target indices the anchor table actually names. */
export function namedTargetCount(): number {
  return Object.keys(PP_TARGET_ANCHORS).length;
}

/**
 * The cap disclosure for the target select. `PP_TARGET_ANCHORS` is a measured SUBSET of the device's
 * alphabetical FX-slot enumeration (its full size is not served), so the picker must say how many are
 * named and that everything else is a raw number — a silently short roster is the defect this states.
 */
export function targetCoverageNote(): string {
  const n = namedTargetCount();
  return `${n} FX-slot indices have been measured and are shown by name; any other index is picked and ` +
    `written as a raw number and marked unmeasured.`;
}

/** The category's function menu, or null when the codec has no measured list for it. */
export function functionMenuNote(actionCode: number | null): string {
  if (actionCode === null) return 'This row’s action code has no observed offset — nothing to name.';
  if (actionCode === 0) return 'Unassigned — pick a category to name its function menu.';
  if (!categoryHasFunctions(actionCode)) {
    return `The function menu for ${categoryOptionFor(actionCode).label} has not been measured — the ` +
      `function index is shown as a raw number.`;
  }
  return `Functions come from ${categoryOptionFor(actionCode).label}’s measured TAP menu, in index order.`;
}

/**
 * What a row's target byte MEANS when it is not an FX-slot index. Only the domains this project has MEASURED
 * are named; anything else says so rather than guessing at the nearest plausible thing.
 *   Scene — PP#14 (Scene: Select) `record+0` read 3, a scene number.
 *   Preset — PP#19 (Preset: Select) `record+0` read 28, a preset number.
 *   Control Switch — PP#23 `record+0` read 3 for switch number 4: a ZERO-BASED Control Switch number.
 */
export function targetDomain(actionCode: number | null): string | null {
  if (actionCode === null) return null;
  const category = PP_ACTION_CATEGORIES[actionCode] ?? null;
  if (category === 'Scene') return 'a scene number';
  if (category === 'Preset') return 'a preset number';
  if (category === 'Control Switch') return 'a zero-based Control Switch number';
  return null;
}

/**
 * The target options for ONE ROW, gated on whether this row's target byte is an FX-slot index at all.
 *
 * `PP_TARGET_ANCHORS` is an FX-SLOT table measured with Effect actions: its names are a CLAIM about a byte,
 * and the codec states that a caller printing one without checking `ppTargetIsFxSlot` claims a name nobody
 * measured (`perPresetSwitches.ts:474`). A Scene row's `3` is a scene number and a Control Switch row's `3`
 * is a Control Switch number, so offering "Chorus 2" for either is a FALSE name. Where the flag is false the
 * anchor roster is WITHHELD and the byte is shown as a raw number; `nowhere` is nothing to offer when the
 * offset was never located, so the list is empty rather than padded.
 */
export function targetOptionsForRow(
  actionCode: number | null,
  functionIndex: number | null,
  currentIndex: number | null = null
): SwitchOption[] {
  if (ppTargetIsFxSlot(actionCode, functionIndex)) return targetOptions(currentIndex);
  if (currentIndex === null) return [];
  return [{ value: currentIndex, label: `index ${currentIndex} (raw — not an FX slot)`, named: false }];
}

/** The note under one row's target select: the FX-slot cap, or WHY the FX-slot names are withheld here. */
export function targetCoverageForRow(actionCode: number | null, functionIndex: number | null): string {
  if (ppTargetIsFxSlot(actionCode, functionIndex)) return targetCoverageNote();
  const domain = targetDomain(actionCode);
  return `This row's TAP category does not store an FX-slot index in the target byte — it holds ${domain ?? 'a number for this category, whose meaning has not been decoded'}. The FX-slot names are NOT offered here (they were measured on Effect actions only), so the byte is shown and written as a raw number.`;
}

/** Everything the thin component needs to render the three selects for one row. */
export interface SwitchEditOptions {
  categories: SwitchOption[];
  functions: SwitchOption[];
  targets: SwitchOption[];
  /** The row's current function, named or explicitly unnamed. */
  currentFunction: SwitchOption;
  targetCoverage: string;
  functionMenu: string;
}

export function switchEditOptions(
  actionCode: number | null,
  functionIndex: number | null,
  targetIndex: number | null
): SwitchEditOptions {
  return {
    categories: categoryOptionsIncluding(actionCode),
    functions: functionOptionsIncluding(actionCode, functionIndex),
    targets: targetOptionsForRow(actionCode, functionIndex, targetIndex),
    currentFunction: functionOptionFor(actionCode, functionIndex),
    targetCoverage: targetCoverageForRow(actionCode, functionIndex),
    functionMenu: functionMenuNote(actionCode)
  };
}
