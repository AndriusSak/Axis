import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Source-guard for the Preset Templates wiring (audit §2.7 remainder). The pure format + save flow live
// in presetTemplate.ts and are unit-tested in presetTemplate.test.ts; the components/store here cannot be
// compiled by this repo's node-env vitest, so these guards pin the thin bindings — exactly as
// blockLibraryWiring.sourceguard.test.ts does for the Block Library.
const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

describe('Preset Templates wiring', () => {
  const panel = read('./PresetTemplatesPanel.svelte');
  const editor = read('./editor.svelte.ts');
  const store = read('./presetTemplates.svelte.ts');
  const deviceTools = read('./DeviceTools.svelte');
  const app = read('../routes/+page.svelte');
  const module = read('./presetTemplate.ts');

  it('mounts the panel in the app shell', () => {
    expect(app).toContain('PresetTemplatesPanel');
    expect(app).toMatch(/<PresetTemplatesPanel\s*\/>/);
  });

  it('Device Tools opens the templates modal', () => {
    expect(deviceTools).toMatch(/editor\.openPresetTemplates\(\)/);
    expect(deviceTools).toMatch(/Templates…/);
  });

  it('the editor offers Save-as-Template and New-from-Template', () => {
    expect(editor).toMatch(/presetTemplatesOpen\s*=\s*\$state\(false\)/);
    expect(editor).toMatch(/openPresetTemplates\s*=/);
    expect(editor).toMatch(/saveAsTemplate\s*=/);
    expect(editor).toMatch(/loadPresetTemplate\s*=/);
    expect(editor).toMatch(/runSaveAsTemplate\(/); // the pure flow owns the decisions
  });

  it('Save-as-Template captures via the existing export pair and mirrors via the existing local route', () => {
    expect(editor).toMatch(/forgefx\.snapshotPreset\(/); // version-history capture (same as Snapshot)
    expect(editor).toMatch(/forgefx\.versionSyx\(/); // existing .syx export
    expect(editor).toMatch(/forgefx\.saveLocalPreset\([^)]*TEMPLATE_DIR/); // existing local write route
  });

  it('New-from-Template loads through the EXISTING imported-file buffer path (no new endpoint)', () => {
    expect(editor).toMatch(/forgefx\.loadBytes\(/);
    expect(editor).toMatch(/templateBytes\(/);
    expect(editor).toMatch(/noteBufferReplaced\(/); // history barrier on the buffer swap
  });

  it('persists entries in localStorage only — local-only, no /store mirror', () => {
    expect(store).toMatch(/localStorage\.setItem\(LS_KEY/);
    expect(store).not.toMatch(/forgefx\.putDoc\(/);
    expect(store).not.toMatch(/forgefx\.listDocs/);
  });

  it('the panel supports save, search, rename, delete, load, export and import', () => {
    expect(panel).toMatch(/editor\.saveAsTemplate\(/);
    expect(panel).toMatch(/presetTemplates\.query/);
    expect(panel).toMatch(/presetTemplates\.rename\(/);
    expect(panel).toMatch(/presetTemplates\.remove\(/);
    expect(panel).toMatch(/editor\.loadPresetTemplate\(/);
    expect(panel).toMatch(/presetTemplates\.exportText\(/);
    expect(panel).toMatch(/presetTemplates\.importText\(/);
  });

  it('discloses the Axis-local format + local-only, never-to-device behaviour in the UI and module', () => {
    expect(panel).toMatch(/not byte-compatible with FM3-Edit/i);
    expect(panel).toMatch(/never written to the device/i);
    expect(module).toMatch(/NOT[^]{0,20}byte-compatible with FM3-Edit/i);
    expect(module).toMatch(/never written to the device/i);
  });

  it('says which persistence path was taken when no Presets folder is configured', () => {
    expect(panel).toMatch(/No Presets folder is configured/i);
    expect(panel).toMatch(/exports an[\s\S]{0,80}download/i);
    expect(module).toMatch(/no Presets folder configured/i);
  });
});
