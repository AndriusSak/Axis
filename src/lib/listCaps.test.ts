import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Silent list truncation is a defect class in this app — see
// docs/axis-fm3edit-feature-parity-audit.md §5.1. The rule:
//
//   A rendered list is either COMPLETE, or its cap is DISCLOSED in the UI.
//
// The rosters are large (FM3: 331 amp models, 1024 factory IRs, 512 preset slots, 200 history
// entries), so a bare `slice(0, N)` both hides entries and, when the header count is derived from the
// capped array, makes the UI report the truncated length as the total. `CommandPalette` was fixed on
// this rule (guard lives in `paletteRows.test.ts` next to the module it covers).
//
// These guards scan the component source because the components cannot be mounted in this repo's
// node-env vitest. Each pins one of the audited surfaces to the side of the rule it must stay on.

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

describe('list caps — complete lists (no cap)', () => {
  it('the history panel renders every recorded edit', () => {
    // The row itself is the only way to jump back (`history.revertTo(i)` is the row's click handler),
    // so a cap does not just hide entries — it makes older history unreachable. `history.svelte.ts`
    // already bounds the store (MAX_ENTRIES = 200), which is the one cap that belongs here.
    const src = read('./axis-workbench/panels/AxisHistoryDockPanel.svelte');
    expect(src).not.toMatch(/\.slice\(\s*0\s*,\s*\d+\s*\)/);
  });
});

describe('list caps — capped lists must disclose the total', () => {
  it('CabPicker: "showing {CAP} of {total}, search to narrow"', () => {
    const src = read('./CabPicker.svelte');
    expect(src).toMatch(/showing \{CAP\} of \{view\.total\}/);
  });

  it('PresetPicker: "Show all {total} presets" expander when the soft cap applies', () => {
    // A cap that only HIDES rows is the defect class this file guards (see the history-panel guard
    // above), and the picker used to be the mild version of it: slots past 299 were reachable only by
    // searching for them. The cap itself is `applyPresetPickerRowCap`'s job and is unit-tested
    // (presetListCap.test.ts); what this pins is that the caller RENDERS the expander, and that the
    // rows come from the cap helper rather than a bare `slice` with a dead-end hint.
    const src = read('./PresetPicker.svelte');
    expect(src).toMatch(/Show all \{shown\.totalRows\} presets/);
    expect(src).toMatch(/shown\.capped/);
    expect(src).toMatch(/\{#each shown\.rows as r/);
    expect(src).not.toMatch(/mainList\.slice\(/);
    expect(src).not.toMatch(/more — type a number or name to filter/);
  });

  it('AxisFcPartPanel: "+N more" hint when the flat config strip is capped', () => {
    const src = read('./axis-workbench/panels/fc/AxisFcPartPanel.svelte');
    expect(src).toMatch(/\+{data\.configs\.length - 64\} more/);
  });

  it('AxisPresetBrowserPartPanel: a "Show all {total} presets" expander when the soft cap applies', () => {
    // The cap itself is applyRowCap's job and is unit-tested (presetBrowserWorkbenchLayout.test.ts);
    // what this pins is that the caller actually RENDERS the disclosure.
    const src = read('./axis-workbench/panels/preset-browser/AxisPresetBrowserPartPanel.svelte');
    expect(src).toMatch(/Show all \{rowCap\.totalRows\} presets/);
    expect(src).toMatch(/rowCap\.capped/);
  });
});
