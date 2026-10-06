import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Preset colour-tag wiring guard (parity audit §2.13). The .svelte components cannot be mounted in this
// repo's node-env vitest, so — like listCaps.test.ts / modifierReadback.sourceguard.test.ts — we scan the
// component + store source to prove the user-facing surfaces actually USE the pure layer in
// presetColors.ts (whose store/predicate/palette are unit-tested there).
const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

describe('library store — colour dimension wiring', () => {
  const src = read('./library.svelte.ts');

  it('persists the colour map under its own key and mirrors it to the config store', () => {
    expect(src).toMatch(/colors: 'axs\.lib\.colors'/);
    expect(src).toMatch(/forgefx\.putDoc\('config', 'colors'/);
  });

  it('exposes the colour filter + setColor/colorOf and threads the filter into `filtered`', () => {
    expect(src).toMatch(/colorFilter = \$state<AxisPresetColorFilter>\('all'\)/);
    expect(src).toMatch(/setColor\(id: string, color: AxisPresetColorFilter\)/);
    expect(src).toMatch(/colorOf = \(id: string\): AxisPresetColorId \| null => presetColorOf\(this\.colors, id\)/);
    expect(src).toMatch(/matchesPresetColorFilter\(this\.colors, e\.id, this\.colorFilter\)/);
  });

  it('hydrates colours from the remote config (parity with tags/favs)', () => {
    expect(src).toMatch(/cfg\.colors/);
  });
});

describe('data layer — colour flows into the workbench summary', () => {
  const src = read('./axis-workbench/presetBrowser/presetBrowserWorkbenchData.ts');

  it('declares a colorHex on the entry summary and a colorOf input resolver', () => {
    expect(src).toMatch(/colorHex\?: string \| null/);
    expect(src).toMatch(/colorOf\?: \(entryId: string\) => AxisPresetColorId \| null/);
    expect(src).toMatch(/colorHex: presetColorHex\(colorOf\?\.\(entry\.id\)/);
  });
});

describe('monolith PresetBrowser — row dot, picker and colour filter', () => {
  const src = read('./PresetBrowser.svelte');

  it('imports the pure colour layer', () => {
    expect(src).toMatch(/from '\.\/presetColors'/);
  });

  it('renders a per-row colour dot from the shared store', () => {
    expect(src).toMatch(/library\.colorOf\(e\.id\)/);
  });

  it('offers a picker that sets/clears the colour on the row', () => {
    expect(src).toMatch(/library\.setColor\(/);
  });

  it('renders a colour filter alongside the saved filters', () => {
    expect(src).toMatch(/library\.colorFilter = /);
  });
});

describe('workbench preset browser — colour dot + filter chips', () => {
  const src = read('./axis-workbench/panels/preset-browser/AxisPresetBrowserPartPanel.svelte');

  it('imports the pure colour layer and reads library colors', () => {
    expect(src).toMatch(/from '\.\.\/\.\.\/\.\.\/presetColors'/);
    expect(src).toMatch(/library\.colorOf|colorHex/);
  });

  it('passes colorOf into the data view and renders the filter chips', () => {
    expect(src).toMatch(/colorOf: library\.colorOf/);
    expect(src).toMatch(/library\.colorFilter = /);
  });
});
