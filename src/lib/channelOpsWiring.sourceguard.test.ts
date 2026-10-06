import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Source-guard for the channel operations wiring (parity audit §2.10 remainder). The pure planners +
// injectable IO live in channelOps.ts and are unit-tested in channelOps.test.ts; this repo's node-env
// vitest cannot compile .svelte / runes, so this guard pins the thin bindings in the store + the Block
// Editor footer as text — exactly as blockLibraryWiring.sourceguard.test.ts does.
const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

describe('channel ops wiring', () => {
  const editor = read('./editor.svelte.ts');
  const blockEditor = read('./BlockEditor.svelte');

  it('the store binds both operations to the pure channelOps planners/appliers', () => {
    expect(editor).toMatch(/from '\.\/channelOps'/);
    expect(editor).toMatch(/planSetChannelAcrossScenes\(/);
    expect(editor).toMatch(/applySetChannelAcrossScenes\(/);
    expect(editor).toMatch(/planCopyChannelAcrossBlocks\(/);
    expect(editor).toMatch(/applyCopyChannelAcrossBlocks\(/);
  });

  it('the store drives them through the EXISTING endpoints only (no new route)', () => {
    // across scenes: POST /scene + POST /preset/blocks/:eid/channel
    expect(editor).toMatch(/setScene:\s*\(i\)\s*=>\s*forgefx\.setScene\(/);
    expect(editor).toMatch(/setChannel:\s*\(eid, ch\)\s*=>\s*forgefx\.setChannel\(/);
    // across blocks: PUT /preset/blocks/:eid/params/:paramId
    expect(editor).toMatch(/setParam:\s*\(eid, paramId, value, continuous\)\s*=>\s*forgefx\.setParam\(/);
  });

  it('the store records the clipboard source block so the across-blocks paste needs a DIFFERENT block', () => {
    expect(editor).toMatch(/channelClipFrom\s*=/);
    expect(editor).toMatch(/canPasteChannelAcrossBlocks/);
    expect(editor).toMatch(/effectId\s*!==\s*c\.effectId/);
  });

  it('the Block Editor footer exposes both operations', () => {
    expect(blockEditor).toMatch(/editor\.setChannelAcrossScenes\(\)/);
    expect(blockEditor).toMatch(/editor\.pasteChannelAcrossBlocks\(\)/);
  });

  it('never renames the existing footer labels (gated by e2e / structure)', () => {
    for (const label of ['Copy CH', 'Paste CH', 'Reset CH', 'Reset Block', 'Scene Ignore', 'Block Editor']) {
      if (label === 'Block Editor') continue; // that label is the tab, asserted in e2e/03-dock + e2e/06
      expect(blockEditor).toContain(label);
    }
  });
});
