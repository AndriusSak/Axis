// THE LAYOUT-SCOPE DISCLOSURE — the sentence the per-preset panel was missing.
//
// MEASURED 2026-10-13, reported by the owner: he was on the unit's LOOPER layout while `PerPresetSwitchesPanel`
// showed the preset's per-preset rows, and read that as "the app's switch labels are wrong". They were not —
// the decode was later confirmed against the unit's own screen on the layout that actually displays those
// switches (`Filter 4` / `FB Rtn 2` / `Chorus 1` = our PP#1/#2/#3, in order). The defect was the panel saying
// nothing about WHICH layout puts those switches under the player's feet, while nothing in the app can read
// the unit's current layout or view.
//
// Two things are asserted here, and they fail differently on purpose:
//   • the NOTE says the four load-bearing things (what the rows are, which layout displays them, that the app
//     cannot know the current layout, and where a layout's own switches CAN be seen);
//   • the PANEL actually RENDERS it — deleting the call is the realistic way this disclosure dies, and a unit
//     test on the function alone would stay green while the UI went silent again.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PP_DISPLAY_LAYOUT_API_INDEX, PP_DISPLAY_LAYOUT_UNIT_LABEL, layoutScopeNote } from './perPresetSwitchView';

describe('per-preset panel — which layout displays these switches', () => {
  const note = layoutScopeNote();

  it('says WHAT the rows are: the preset\'s definitions, not the live board', () => {
    // Case-insensitive: the note capitalises PRESET for emphasis, and pinning the case would make an
    // emphasis-only edit a red suite.
    expect(note).toMatch(/preset's per-preset switch definitions/i);
    expect(note).toMatch(/NOT necessarily what is under your feet/);
  });

  it('says the unit uses them ONLY on a layout whose switches are assigned to Per-Preset', () => {
    expect(note).toContain('only while it is displaying a layout whose switches are assigned to Per-Preset');
  });

  it('names the layout on BOTH numbering systems (the unit is 1-based, the API 0-based)', () => {
    expect(PP_DISPLAY_LAYOUT_UNIT_LABEL).toBe('Layout 6');
    expect(PP_DISPLAY_LAYOUT_API_INDEX).toBe(5);
    expect(note).toContain(PP_DISPLAY_LAYOUT_UNIT_LABEL);
    expect(note).toContain(`index ${PP_DISPLAY_LAYOUT_API_INDEX} in this app's API`);
    expect(note).toMatch(/unit numbers\s+layouts from 1, the API from 0/);
  });

  it('admits the app CANNOT read the unit\'s current layout or view (the claim that must never be implied away)', () => {
    expect(note).toContain('cannot read which layout or view the unit is currently showing');
  });

  it('points at the tool that CAN show a layout — the FC editor, which reads the unit per layout', () => {
    expect(note).toMatch(/open the FC editor/);
    expect(note).toMatch(/reads the unit's own configuration per layout/);
  });

  it('is not vacuous: the note is a real sentence, not an empty string', () => {
    expect(note.length).toBeGreaterThan(200);
  });
});

describe('per-preset panel — the disclosure is actually RENDERED', () => {
  const root = fileURLToPath(new URL('./', import.meta.url)); // the panel sits beside this test
  const panel = readFileSync(join(root, 'PerPresetSwitchesPanel.svelte'), 'utf8');

  it('renders layoutScopeNote() (removing this call is how the disclosure would silently die)', () => {
    expect(panel).toMatch(/\{layoutScopeNote\(\)\}/);
    expect(panel).toMatch(/import\s*\{[^}]*layoutScopeNote[^}]*\}\s*from\s*'\.\/perPresetSwitchView'/);
  });

  it('the panel header does not present the rows as the live footswitch state', () => {
    // The old header said "Footswitch assignments stored in the current preset", with nothing to say they may
    // not be what the switches currently show. That phrasing must not come back.
    expect(panel).not.toContain('Footswitch assignments stored in the current preset');
    expect(panel).toMatch(/DEFINITIONS stored in the current preset/);
  });
});
