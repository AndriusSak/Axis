import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Modifier READ-BACK wiring guard (parity audit §3.2). ModifierEditorCore.svelte cannot be mounted in
// this repo's node-env vitest, so — like listCaps.test.ts — we scan the component source to pin the
// behaviour that turns the decoded modifier list into the "already modulated by X" UI. The pure logic
// lives in modifierAssignments.ts and is unit-tested there; this only proves the component USES it.
const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

describe('ModifierEditorCore — read-back wiring', () => {
  const src = read('./ModifierEditorCore.svelte');

  it('accepts a modifiers prop and reads the helpers', () => {
    expect(src).toMatch(/import \{ findModifierForTarget, modifiersInUse \} from '\.\/modifierAssignments'/);
    expect(src).toMatch(/modifiers\?: PresetModifier\[\] \| null/);
  });

  it('fetches the decoded assignments when none are passed in', () => {
    expect(src).toMatch(/forgefx\s*\.\s*presetModifiers\(\)/);
    expect(src).toMatch(/modifiers === undefined/);
  });

  it('resolves the target param to an existing assignment and its slot', () => {
    expect(src).toMatch(/findModifierForTarget\(mods, targetEffectId, targetParam\)/);
    expect(src).toMatch(/const effectiveSlot = \$derived\(matchedMod\?\.slot \?\? Math\.max\(1, slot\)\)/);
    expect(src).toMatch(/const eid = \$derived\(\(mm\?\.effectId \?\? 3\) \+ \(effectiveSlot - 1\)\)/);
  });

  it('prefills the source from the decoded assignment instead of the None default', () => {
    expect(src).toMatch(/if \(matchedMod\) \{/);
    expect(src).toMatch(/SOURCES\.find\(\(s\) => s\.name === matchedMod\.source\)/);
  });

  it('renders the existing-assignment notice and the "modifiers in use" list', () => {
    expect(src).toMatch(/Already modulated by/);
    expect(src).toMatch(/MODIFIERS IN USE/);
    expect(src).toMatch(/\{#each modsInUse as mi/);
  });
});
