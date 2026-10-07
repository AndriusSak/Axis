import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Source guard for the Revert Preset wiring. The editor store runs runic `$state` and the components
// mount only in a real browser, so neither can execute under this repo's node-env vitest (see
// editorSurface.test.ts / listCaps.test.ts). The decision + flow are unit-tested in
// revertPreset.test.ts; these guards pin the thin bindings so a refactor can't silently unwire the
// action from the store or the UI.
const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

describe('revert preset wiring', () => {
  it('editor.svelte.ts routes the action through runRevertPreset and marks the buffer replaced', () => {
    const src = read('./editor.svelte.ts');
    expect(src).toMatch(/import \{ runRevertPreset \} from '\.\/revertPreset'/);
    expect(src).toMatch(/revertPreset = \(\) =>/);
    expect(src).toMatch(/runRevertPreset\(/);
    // bank-letter devices (AM4) label the barrier/toast as A01..D04 via the existing caps gate
    expect(src).toMatch(/bankLetter: this\.bankLetterAddressing/);
    // a successful revert must insert a history barrier (drop the stale local-file link too)
    expect(src).toMatch(/noteBufferReplaced: \(label\) => this\.noteBufferReplaced\(label\)/);
    // same-slot reload: selectPreset (unified for every device, AM4 included)
    expect(src).toMatch(/forgefx\.selectPreset\(slot\)/);
  });

  it('the History panel offers Revert on the dirty buffer banner', () => {
    const src = read('./HistoryPanel.svelte');
    expect(src).toMatch(/editor\.revertPreset\(\)/);
    expect(src).toMatch(/Revert preset/);
  });

  it('the Save dialog offers Revert as the discard alternative to Save', () => {
    const src = read('./SaveDialog.svelte');
    expect(src).toMatch(/editor\.revertPreset\(\)/);
    expect(src).toMatch(/Revert to stored preset/);
  });
});
