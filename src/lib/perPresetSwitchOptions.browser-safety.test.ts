// BROWSER-SAFETY GUARD for the codec import this module makes — plus the positive control for the
// FX-slot target withholding below it.
//
// WHY A SOURCE GUARD AND NOT A BEHAVIOURAL TEST: the failure this guards against CANNOT be observed from a
// vitest suite, because vitest runs in Node and Node defines `process`. Measured 2026-10-12: importing
// `forgefx-midi/devices/gen3` (the barrel) from this module pulled `factory.js` → `writer.js`, whose
// top-level `Number(process.env.MCP_APPLY_BUDGET_MS)` threw `ReferenceError: process is not defined` in the
// browser, the whole module graph died, `.aw-root` never rendered and ALL 144 Playwright specs timed out —
// while 1944 vitest cases, svelte-check and `npm run build` were all green. A guard that runs in Node must
// therefore inspect the SOURCE, not the runtime.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { targetCoverageForRow, targetDomain, targetOptionsForRow } from './perPresetSwitchOptions';

const read = (p: string): string => readFileSync(p, 'utf8');

const OPTIONS_MODULE = 'src/lib/perPresetSwitchOptions.ts';
const CODEC_MODULE = 'node_modules/forgefx-midi/dist/devices/gen3/perPresetSwitches.js';

describe('the codec import stays browser-safe', () => {
  it('imports the self-contained perPresetSwitches subpath, NOT the gen3 barrel', () => {
    const src = read(OPTIONS_MODULE);
    expect(src).toContain("from 'forgefx-midi/devices/gen3/perPresetSwitches'");
    // The barrel re-exports factory.js → writer.js, which touches `process` at module scope. Any bare barrel
    // import here (with or without a subpath after it) re-introduces the boot failure.
    expect(src).not.toMatch(/from 'forgefx-midi\/devices\/gen3'/);
    expect(src).not.toMatch(/from 'forgefx-midi'/);
  });

  it('the imported module itself touches no Node global and imports nothing', () => {
    const codec = read(CODEC_MODULE);
    expect(codec).not.toMatch(/\bprocess\b/);
    expect(codec).not.toMatch(/from ['"]node:/);
    expect(codec).not.toMatch(/\brequire\(/);
    // It is a pure table module: no imports at all, which is exactly why it is safe to ship to the browser.
    expect(codec).not.toMatch(/^\s*import\s/m);
  });

  it('the CONTRAST case holds: the barrel this guard forbids is genuinely unsafe', () => {
    // If this ever stops being true the guard above is theatre — assert the hazard is real, in the same
    // failure shape the browser saw (writer.js's top-level process read).
    const writer = read('node_modules/forgefx-midi/dist/devices/gen3/writer.js');
    expect(writer).toMatch(/process\.env\./);
  });
});

describe('the target byte is named only where the FX-slot table actually applies', () => {
  it('withholds every anchor name for a row whose target byte is not an FX slot', () => {
    // MEASURED domains: PP#14 (Scene: Select) record+0 = 3 is a scene number; PP#19 (Preset: Select) = 28 a
    // preset number; PP#23 = 3 a zero-based Control Switch number. The 0x03 category code is Scene.
    const scene = targetOptionsForRow(0x03, 0, 3);
    expect(scene).toHaveLength(1);
    expect(scene[0]!.value).toBe(3);
    expect(scene[0]!.named).toBe(false);
    // "Chorus 2" is what 3 is called in the FX-slot anchor table: offering it for a Scene row would be a
    // false name, and this is the assertion that catches it coming back.
    expect(scene.some((o) => o.label === 'Chorus 2')).toBe(false);
    expect(scene[0]!.label).toContain('not an FX slot');

    expect(targetCoverageForRow(0x03, 0)).toContain('a scene number');
    expect(targetDomain(0x03)).toBe('a scene number');
  });

  it('POSITIVE CONTROL: still offers the measured anchors for an Effect row', () => {
    // 0x04 = Effect; function 0 (Bypass) and 1 (Chan Select) are the two whose byte was measured as an
    // FX-slot index. Without this arm the test above would pass for a function that always returns [].
    const effect = targetOptionsForRow(0x04, 0, 51);
    expect(effect.some((o) => o.named && o.label === 'Reverb 1' && o.value === 51)).toBe(true);
    expect(effect.length).toBeGreaterThan(1);
    expect(targetCoverageForRow(0x04, 0)).toContain('FX-slot indices have been measured');
  });

  it('offers nothing when the offset was never located, rather than padding the list', () => {
    expect(targetOptionsForRow(0x05, 1, null)).toEqual([]); // Utility row, record+0 never located
  });
});
