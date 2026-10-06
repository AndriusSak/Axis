import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// The preset-browser panels and the picker cannot be mounted in this repo's node-env vitest, so these
// guards scan the component SOURCE to pin the Recent-Presets wiring (audit §2.7) and the Snapshot
// button onto the shared store / the existing version-history export path. The pure logic itself is
// covered by recentPresets.test.ts and snapshotPreset.test.ts.

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

describe('Recent Presets — one shared MRU store across every preset surface', () => {
  it('the workbench preset-browser panel records + renders Recent from the shared store', () => {
    const src = read('./axis-workbench/panels/preset-browser/AxisPresetBrowserPartPanel.svelte');
    expect(src).toMatch(/from '\.\.\/\.\.\/\.\.\/recentPresets'/);
    expect(src).toMatch(/recordRecent\(/);
    expect(src).toMatch(/loadRecents\(/);
    expect(src).toMatch(/>Recent</); // the sidebar section header
  });

  it('the monolith Preset Browser records on load + renders Recent', () => {
    const src = read('./PresetBrowser.svelte');
    expect(src).toMatch(/from '\.\/recentPresets'/);
    expect(src).toMatch(/recordRecent\(/);
    expect(src).toMatch(/RECENT/);
  });

  it('the preset picker uses the shared store (not its own axs.presets recents)', () => {
    const src = read('./PresetPicker.svelte');
    expect(src).toMatch(/from '\.\/recentPresets'/);
    expect(src).toMatch(/recordRecent\(/);
    // the old duplicate recents field must be gone from the picker-local store
    expect(src).not.toMatch(/JSON\.stringify\(\{\s*rec:/);
  });
});

describe('Snapshot to folder — reuses the version-history / .syx export path', () => {
  it('the editor binds snapshotToFolder over snapshotPreset + versionSyx', () => {
    const src = read('./editor.svelte.ts');
    expect(src).toMatch(/snapshotToFolder = async/);
    expect(src).toMatch(/runSnapshotToFolder\(/);
    expect(src).toMatch(/forgefx\.snapshotPreset\(/); // version-history capture
    expect(src).toMatch(/forgefx\.versionSyx\(/); // existing .syx export
    expect(src).toMatch(/saveLocalPreset\(.*dir:\s*SNAPSHOT_DIR/s);
  });

  it('Device Tools surfaces the one-click Snapshot button', () => {
    const src = read('./DeviceTools.svelte');
    expect(src).toMatch(/editor\.snapshotToFolder\(\)/);
    expect(src).toMatch(/onclick=\{snapshot\}/);
    expect(src).toMatch(/Presets\/Snapshots\//);
  });
});

describe('Clear Preset — honestly absent (no wire op exists)', () => {
  it('Axis exposes no clearPreset/initPreset call', () => {
    const src = read('./forgefx.ts');
    expect(src).not.toMatch(/clearPreset|initPreset|newPreset|emptyPreset|erasePreset/);
  });
});
