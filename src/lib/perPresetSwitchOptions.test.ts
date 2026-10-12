import { describe, expect, it } from 'vitest';
import { PP_ACTION_CATEGORIES, PP_FUNCTION_NAMES, PP_TARGET_ANCHORS } from 'forgefx-midi/devices/gen3';
import {
  categoryHasFunctions,
  categoryOptionFor,
  categoryOptions,
  categoryOptionsIncluding,
  functionMenuNote,
  functionOptionFor,
  functionOptions,
  functionOptionsIncluding,
  namedTargetCount,
  switchEditOptions,
  targetCoverageNote,
  targetOptions
} from './perPresetSwitchOptions';

// The option lists are DERIVED from the codec tables, so the tests read the codec directly rather than
// hardcoding a count that would drift. A hand-kept list in the component was the thing being removed.

describe('categoryOptions (the TAP action-code picker)', () => {
  it('offers Unassigned plus EVERY codec category, all named, ascending', () => {
    const opts = categoryOptions();
    const named = opts.filter((o) => o.value !== 0);
    // Derived from PP_ACTION_CATEGORIES — adding a category to the codec grows the picker with no edit here.
    expect(named).toHaveLength(Object.keys(PP_ACTION_CATEGORIES).length);
    expect(opts[0]).toEqual({ value: 0, label: 'Unassigned', named: true });
    expect(named.every((o) => o.named)).toBe(true);
    expect([...opts].map((o) => o.value)).toEqual([...opts].map((o) => o.value).sort((a, b) => a - b));
    // Spot-check the two categories the panel used to expose as bare buttons.
    expect(opts.find((o) => o.value === 0x04)?.label).toBe('Effect');
    expect(opts.find((o) => o.value === 0x03)?.label).toBe('Scene');
  });

  it('is COMPLETE — never a truncated roster (the cap-disclosure rule)', () => {
    // The category list is the whole measured list, so there is no cap to disclose; assert it matches.
    expect(categoryOptions().length).toBe(Object.keys(PP_ACTION_CATEGORIES).length + 1);
  });

  it('names an unmeasured code explicitly instead of inventing a name', () => {
    const o = categoryOptionFor(0x99);
    expect(o.named).toBe(false);
    expect(o.label).toBe('code 0x99 (unmeasured)');
    // 0 is Unassigned, not "unnamed", and not a real category.
    expect(categoryOptionFor(0)).toEqual({ value: 0, label: 'Unassigned', named: true });
  });

  it('keeps the row’s current code in the list even when no option names it', () => {
    const opts = categoryOptionsIncluding(0x99);
    const current = opts.find((o) => o.value === 0x99);
    expect(current).toBeDefined();
    expect(current!.named).toBe(false);
    // …and a code already in the list is not duplicated.
    const withEffect = categoryOptionsIncluding(0x04);
    expect(withEffect.filter((o) => o.value === 0x04)).toHaveLength(1);
  });
});

describe('functionOptions (the per-category TAP menu)', () => {
  it('names every entry of a measured category, in index order', () => {
    const looper = functionOptions(0x08);
    expect(looper).toHaveLength(Object.keys(PP_FUNCTION_NAMES[0x08]!).length);
    expect(looper.map((o) => o.label)).toEqual(['Record', 'Play/Stop', 'Reverse', 'Once', 'Undo/Erase', 'Half Speed']);
    expect(looper.every((o) => o.named)).toBe(true);
    expect(looper.map((o) => o.value)).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it('returns NO options for a category the codec never named — not a fabricated list', () => {
    expect(functionOptions(0x99)).toEqual([]);
    expect(categoryHasFunctions(0x99)).toBe(false);
    expect(categoryHasFunctions(0x04)).toBe(true);
    expect(functionMenuNote(0x99)).toContain('has not been measured');
  });

  it('marks a function index past the list’s end as unnamed — never a bare 0', () => {
    // Looper has six entries; index 6 is past the end and the codec returns null for it.
    const o = functionOptionFor(0x08, 6);
    expect(o.named).toBe(false);
    expect(o.label).toBe('entry 6 (unnamed)');
    // index 0 IS named, so "unnamed" can never be confused with the first entry.
    expect(functionOptionFor(0x08, 0)).toEqual({ value: 0, label: 'Record', named: true });
  });

  it('keeps the row’s current function index in the options, marked when unnamed', () => {
    const opts = functionOptionsIncluding(0x08, 9);
    expect(opts.find((o) => o.value === 9)).toEqual({ value: 9, label: 'entry 9 (unnamed)', named: false });
    // a named current index is not duplicated
    expect(functionOptionsIncluding(0x08, 5).filter((o) => o.value === 5)).toHaveLength(1);
  });
});

describe('targetOptions (the FX-slot target picker)', () => {
  it('names every measured anchor, ascending', () => {
    const opts = targetOptions();
    expect(opts).toHaveLength(namedTargetCount());
    expect(opts.every((o) => o.named)).toBe(true);
    expect(opts.find((o) => o.value === 51)?.label).toBe('Reverb 1');
    expect(opts.find((o) => o.value === 0)?.label).toBe('Amp 1');
  });

  it('DISCLOSES the cap — the anchors are a measured subset, not the whole enumeration', () => {
    const note = targetCoverageNote();
    expect(note).toContain(String(namedTargetCount()));
    expect(note).toContain('unmeasured');
    // The disclosure names the real count rather than a hardcoded sentence.
    expect(namedTargetCount()).toBe(Object.keys(PP_TARGET_ANCHORS).length);
  });

  it('shows an unmeasured current index as a raw number MARKED unmeasured, never 0', () => {
    const opts = targetOptions(9); // 9 is not a measured anchor
    const current = opts.find((o) => o.value === 9);
    expect(current).toEqual({ value: 9, label: 'index 9 (unmeasured)', named: false });
    // …while index 0 keeps its measured name (0 is a real anchor here, not an "unassigned" marker).
    expect(opts.find((o) => o.value === 0)?.label).toBe('Amp 1');
  });

  it('does not duplicate a current index that is already named', () => {
    expect(targetOptions(51).filter((o) => o.value === 51)).toHaveLength(1);
  });
});

describe('switchEditOptions (what the component renders)', () => {
  it('hands the panel named lists plus the two disclosures, with the current function named', () => {
    const o = switchEditOptions(0x04, 2, 51);
    expect(o.categories.find((c) => c.value === 0x04)?.label).toBe('Effect');
    expect(o.targets.find((t) => t.value === 51)?.label).toBe('Reverb 1');
    expect(o.currentFunction).toEqual({ value: 2, label: 'Chan Toggle', named: true });
    expect(o.targetCoverage).toContain('unmeasured');
    expect(o.functionMenu).toContain('Effect');
  });

  it('surfaces an unnamed current function as an explicit state (the null survives)', () => {
    const o = switchEditOptions(0x08, 6, null);
    expect(o.currentFunction.named).toBe(false);
    expect(o.currentFunction.label).toBe('entry 6 (unnamed)');
  });
});
