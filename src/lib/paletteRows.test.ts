import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { matchPaletteTypes, matchPaletteFamilies, paletteTypeLabel } from './paletteRows';

// Regression: the Cmd+K palette is the ONLY route to a block's model list (there is no separate model
// dropdown), and its result set used to be capped with a bare `list.slice(0, 80)`. On an FM3 the amp
// roster is 331 models, so 251 — including every 5153, Blankenship and Deluxe variant after the first
// 80 — were unreachable, and the header count (`results.length`) read the *truncated* length, so the
// UI reported "80 results" as if that were the whole catalogue. The block list (line 147) carried the
// same cap, harmless only because FM3 has ~45 families.
//
// The component cannot be mounted in this repo's node-env vitest, so the row-building is a plain
// module (same pattern as `eventReload.ts`) and the source guard below pins the actual defect site.

const ampCount = 331; // FM3 amp roster, from forgefx-midi/catalog/fm3.json FM3_ROSTERS.amp

const amps = (n = ampCount) =>
  Array.from({ length: n }, (_, i) => ({
    value: i,
    name: `Amp Model ${i}`,
    manufacturer: i % 2 ? 'Fender' : 'Marshall',
    basedOn: i % 3 ? `Based ${i}` : null
  }));

describe('matchPaletteTypes', () => {
  it('returns EVERY model for an empty query (no silent cap)', () => {
    const rows = matchPaletteTypes(amps(), '', false);
    expect(rows).toHaveLength(ampCount);
    // the last model must be present — it is the one a cap drops
    expect(rows[ampCount - 1].value).toBe(ampCount - 1);
    expect(paletteTypeLabel({ value: 0, name: 'Deluxe 6G3', manufacturer: 'Fender', basedOn: null }, false)).toBe(
      'Deluxe 6G3'
    );
  });

  it('filters by name, manufacturer and basedOn', () => {
    const list = [
      { value: 1, name: 'Plexi 50W', manufacturer: 'Marshall', basedOn: '1967 50W Plexi' },
      { value: 2, name: 'Deluxe Verb', manufacturer: 'Fender', basedOn: null }
    ];
    expect(matchPaletteTypes(list, 'plex', false).map((r) => r.value)).toEqual([1]);
    expect(matchPaletteTypes(list, 'fender', false).map((r) => r.value)).toEqual([2]);
    expect(matchPaletteTypes(list, '1967', false).map((r) => r.value)).toEqual([1]);
  });

  it('maps a model to a stable row (key = ordinal, kind Model, sub = raw name)', () => {
    const [row] = matchPaletteTypes(amps(1), '', false);
    expect(row).toMatchObject({ key: '0', kind: 'Model', sub: 'Amp Model 0', value: 0, page: 0, mfr: 'Marshall' });
  });

  it('shows the real-name label only when realNames is on', () => {
    const t = { value: 7, name: 'Brit 800', manufacturer: 'Marshall', basedOn: 'JCM 800 2204' };
    expect(paletteTypeLabel(t, true)).toBe('Marshall JCM 800 2204');
    expect(paletteTypeLabel(t, false)).toBe('Brit 800');
    // no basedOn/manufacturer → falls back to the Fractal name even with realNames on
    expect(paletteTypeLabel({ value: 8, name: 'Tube Pre', manufacturer: null, basedOn: null }, true)).toBe('Tube Pre');
  });
});

describe('matchPaletteFamilies', () => {
  it('returns every block family for an empty query', () => {
    const fams = Array.from({ length: 45 }, (_, i) => ({ slug: `fam${i}`, name: `Family ${i}`, page: i + 10 }));
    expect(matchPaletteFamilies(fams, '')).toHaveLength(45);
  });

  it('filters on both display name and slug', () => {
    const fams = [
      { slug: 'amp', name: 'Amplifier', page: 1 },
      { slug: 'reverb', name: 'Reverb', page: 2 }
    ];
    expect(matchPaletteFamilies(fams, 'ampl').map((r) => r.key)).toEqual(['amp']);
    expect(matchPaletteFamilies(fams, 'rev').map((r) => r.key)).toEqual(['reverb']);
  });
});

describe('CommandPalette result path (source guard)', () => {
  const source = readFileSync(fileURLToPath(new URL('./CommandPalette.svelte', import.meta.url)), 'utf8');

  it('does not cap the result list', () => {
    // The defect: `list.slice(0, 80)`. Any numeric cap on the filtered result list silences part of
    // the catalogue without saying so; if a cap is ever genuinely needed, it must be disclosed in the
    // header the way CabPicker ("showing N of M") and PresetPicker ("+N more") do.
    expect(source).not.toMatch(/list\.slice\(\s*0\s*,\s*\d+\s*\)/);
  });

  it('builds its rows through the tested module', () => {
    expect(source).toMatch(/from '\.\/paletteRows'/);
  });
});
