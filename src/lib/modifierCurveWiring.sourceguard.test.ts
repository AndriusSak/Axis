import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Wiring guards for the §3.2 modifier remainder. The .svelte components cannot be mounted in this
// repo's node-env vitest, so — like listCaps.test.ts / modifierReadback.sourceguard.test.ts — we scan
// the component sources to pin the wiring. The pure logic lives in modifierCurve.ts and
// modifierAssignments.ts and is unit-tested there; this only proves the components USE it.
const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

describe('ModifierEditorCore — live CURVE read-back wiring', () => {
  const src = read('./ModifierEditorCore.svelte');

  it('reads the pure curve decoder + display helpers', () => {
    expect(src).toMatch(/import \{ decodeModifierCurve, curveReadbackCount, formatCurveField \} from '\.\/modifierCurve'/);
  });

  it('keeps the served raw block values and decodes them through the served model', () => {
    // liveValues is set from rawBlock()'s values and decoded with the model (mm) — never fabricated.
    expect(src).toMatch(/let liveValues = \$state<Record<string, number> \| null>\(null\)/);
    expect(src).toMatch(/liveValues = values;/);
    expect(src).toMatch(/const curveReadback = \$derived\(decodeModifierCurve\(liveValues, mm\)\)/);
  });

  it('gates the read-back on an addressable existing assignment (pre-chain slot)', () => {
    expect(src).toMatch(/const canReadAssignmentCurve = \$derived\(!!matchedMod && matchedMod\.slot != null\)/);
  });

  it('renders the CURVE READ-BACK section with an honest pending-decode state', () => {
    expect(src).toMatch(/CURVE READ-BACK/);
    expect(src).toMatch(/curveRead\.read === 0/);
    expect(src).toMatch(/pending decode/);
    expect(src).toMatch(/\{#each curveReadback as f \(f\.key\)\}/);
    expect(src).toMatch(/formatCurveField\(f\.key, f\.value\)/);
  });
});

describe('ModifierUsagePanel — Controllers usage wiring', () => {
  const src = read('./ModifierUsagePanel.svelte');

  it('reuses the existing modifierAssignments helpers', () => {
    expect(src).toMatch(/import \{ describeModifier, modifiersInUse \} from '\.\/modifierAssignments'/);
  });

  it('reads the decoded assignments through the existing endpoint client', () => {
    expect(src).toMatch(/forgefx\s*\.\s*presetModifiers\(\)/);
    expect(src).toMatch(/const inUse = \$derived\(modifiersInUse\(mods\)\)/);
  });

  it('renders every in-use modifier and an honest empty state', () => {
    expect(src).toMatch(/MODIFIERS IN USE/);
    expect(src).toMatch(/\{#each inUse as mi/);
    expect(src).toMatch(/No parameters have a modifier assigned in this preset\./);
    expect(src).toMatch(/Modifier read-back unavailable on this server/);
  });
});

describe('VirtualScreen — mounts the Controllers modifier usage panel', () => {
  const src = read('./VirtualScreen.svelte');

  it('imports and renders ModifierUsagePanel only on the controllers virtual screen', () => {
    expect(src).toMatch(/import ModifierUsagePanel from '\.\/ModifierUsagePanel\.svelte'/);
    expect(src).toMatch(/editor\.virtual\.slug === 'controllers'/);
    expect(src).toMatch(/<ModifierUsagePanel \/>/);
  });
});
