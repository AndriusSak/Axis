import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// The workbench preset browser's REORDER + Reset-AMP planners are unit-tested in
// slotReorderOps.test.ts / resetAmpOps.test.ts. What those cannot prove is that the Svelte panel —
// which vitest cannot mount in this repo's node-env setup — actually WIRES them (audit §2.4 remainder):
// builds the IO over forgefx, previews (dry run), gates on an explicit confirm, and runs the real ops.
// This guard scans the component source, the same pattern the other *Wiring tests use.

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
const PANEL = '../panels/preset-browser/AxisPresetBrowserPartPanel.svelte';

describe('workbench preset browser — Manage Presets reorder + reset-AMP wiring (§2.4 remainder)', () => {
  const src = read(PANEL);

  it('imports the two pure planner modules (no inline device logic)', () => {
    expect(src).toMatch(/from '\.\.\/\.\.\/\.\.\/slotReorderOps'/);
    expect(src).toMatch(/from '\.\.\/\.\.\/\.\.\/resetAmpOps'/);
    for (const fn of ['planSlotReorder', 'runSlotReorder', 'planResetAmp', 'runResetAmp']) {
      expect(src).toContain(fn);
    }
  });

  it('binds the reorder IO to the EXISTING copy-by-store endpoints (dump → load → store + select)', () => {
    expect(src).toMatch(/dump:\s*\(n\)\s*=>\s*forgefx\.presetBackup\(n\)/);
    expect(src).toMatch(/load:\s*\(bytes\)\s*=>\s*forgefx\.loadBytes\(bytes\)/);
    expect(src).toMatch(/select:\s*\(n\)\s*=>\s*forgefx\.selectPreset\(n\)/);
    expect(src).toContain('SlotReorderIo');
  });

  it('binds the reset IO to scan → select → find AMP → re-select model → store', () => {
    expect(src).toMatch(/locations:\s*\(\)\s*=>\s*forgefx\.presetLocations\(\)/);
    expect(src).toContain('ampBlocks: async () =>');
    expect(src).toMatch(/resetAmpBlock:\s*\(eid,\s*typeValue\)\s*=>\s*forgefx\.setType\(eid,\s*typeValue\)/);
    expect(src).toContain('ResetAmpIo');
  });

  it('re-selects the model ordinal the DEVICE serves (reads blockParams; never invents a default)', () => {
    expect(src).toMatch(/forgefx\.blockParams\(b\.effectId\)/);
    expect(src).toMatch(/p\.type\?\.value/);
  });

  it('shows a dry-run preview before applying (no auto-run)', () => {
    expect(src).toContain('mpReorderDryRun');
    expect(src).toContain('mpResetDryRun');
    expect(src).toMatch(/mpReorderPreview\s*=\s*planSlotReorder\(/);
    expect(src).toMatch(/mpResetPreview\s*=\s*planResetAmp\(/);
    expect(src).toMatch(/Preview \(dry run\)/);
  });

  it('requires an explicit confirm before applying (both ops)', () => {
    expect(src).toMatch(/bind:checked=\{mpReorderConfirmed\}/);
    expect(src).toMatch(/bind:checked=\{mpResetConfirmed\}/);
    expect(src).toMatch(/disabled=\{!mpReorderPreview[^}]*!mpReorderConfirmed/);
    expect(src).toMatch(/disabled=\{!mpResetPreview[^}]*!mpResetConfirmed/);
  });

  it('runs the tested planners against the injected IO', () => {
    expect(src).toMatch(/runSlotReorder\(mpReorderPreview,\s*mpReorderIo\)/);
    expect(src).toMatch(/runResetAmp\(mpResetPreview,\s*mpResetIo\)/);
  });

  it('restores the origin preset through the editor store', () => {
    expect(src).toMatch(/mpRestoreTo/);
    expect(src).toMatch(/editor\.preset\?\.number/);
  });

  it('gates the toolbar actions on the device capabilities', () => {
    expect(src).toMatch(/mpOpenReorder/);
    expect(src).toMatch(/mpOpenReset/);
    expect(src).toMatch(/disabled=\{!editor\.canCopySlots\}/);
    expect(src).toMatch(/mpCanResetAmp/);
  });

  it('uses inline popovers, not window.prompt (dead in the Electron shell)', () => {
    expect(src).toMatch(/mp-pop/);
    expect(src).not.toMatch(/window\.prompt\(/);
  });

  it('surfaces the planner’s honest refusal (a non-permutation reorder)', () => {
    expect(src).toMatch(/mpReorderPreview\.blocked/);
  });
});
