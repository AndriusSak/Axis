import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Source guard for the §3.7 FC field-honesty wiring. FcEditor.svelte mounts only in a real browser
// (runic $state, DOM file input), so the gate DECISION is unit-tested against served-model shapes in
// fcFieldGates.test.ts; this pins the thin bindings so a refactor can't silently go back to HIDING a
// metadata-driven control (the audit §3.7 defect) instead of rendering it gated with its reason.
const src = readFileSync(fileURLToPath(new URL('./FcEditor.svelte', import.meta.url)), 'utf8');

describe('FC editor §3.7 field gates wiring', () => {
  it('imports the field-gate module and derives from the served model', () => {
    expect(src).toMatch(/from '\.\/axis-workbench\/fc\/fcFieldGates'/);
    expect(src).toMatch(/axisFcFieldGate\(model,/);
    expect(src).toMatch(/axisFcGatedFields\(model\)/);
  });

  it('renders a gated field element that is disabled and names the missing metadata', () => {
    expect(src).toMatch(/\{#snippet gatedField\(/);
    // disabled affordance + the honest reason, both visible (title) and as text
    expect(src).toMatch(/aria-disabled="true"/);
    expect(src).toMatch(/gated: \$\{g\.reason\}/);
    expect(src).toMatch(/\{g\.reason\}/);
    expect(src).toMatch(/\{@render gatedField\(/);
  });

  it('gates the colour and custom-label controls instead of hiding them', () => {
    expect(src).toMatch(/\{#snippet colorField\(\)/);
    expect(src).toMatch(/\{#snippet customLabelField\(/);
    // each snippet falls back to the gate, never to nothing
    expect(src).toMatch(/gate\('colors'\)\.available/);
    expect(src).toMatch(/gate\('customLabel'\)\.available/);
    expect(src).toMatch(/\{@render colorField\(\)\}/);
    expect(src).toMatch(/\{@render customLabelField\(side\)\}/);
  });

  it('no longer hides the label-mode select (blind mode) when its vocabulary is absent', () => {
    // the old bare `{#if labelModeFallback.length}` drop is replaced by an if/else gate
    expect(src).toMatch(/\{#if labelModeFallback\.length\}[\s\S]*?\{:else\}[\s\S]*?gatedField\(gate\('labelModes'\)\)/);
    expect(src).toMatch(/\{#if labels\.length\}[\s\S]*?\{:else\}[\s\S]*?gatedField\(gate\('labelModes'\)\)/);
  });

  it('discloses the withheld-control count and drops the old "hidden" language', () => {
    expect(src).toMatch(/gatedCount/);
    expect(src).not.toMatch(/custom labels are hidden/);
  });
});
