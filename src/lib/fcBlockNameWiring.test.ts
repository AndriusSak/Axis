import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Source guard for the FC "Effect" block picker wiring. FcEditor.svelte mounts only in a real browser, so
// the naming logic is unit-tested in fcBlockOptions.test.ts and this guard pins the thin binding: the
// 'block'-typed value slot must render the NAMED options (derived from the preset's placed blocks), and
// the old bare "<span class="hint">block id</span>" number field must be gone. Both assertions FAIL on the
// pre-fix source — the first because the symbols do not exist there, the second because the string does.
const src = readFileSync(fileURLToPath(new URL('./FcEditor.svelte', import.meta.url)), 'utf8');

describe('FC block-typed value slot is named, not a bare block id', () => {
  it('imports and renders the named block options module', () => {
    expect(src).toMatch(/from '\.\/fcBlockOptions'/);
    expect(src).toMatch(/fcBlockOptionsIncluding/);
    expect(src).toMatch(/fcBlockRawHint/);
    expect(src).toMatch(/fcBlockRosterNote/);
    // the roster is fetched from the placed blocks, never hand-kept in the component
    expect(src).toMatch(/forgefx\.grid\(\)/);
    expect(src).toMatch(/placed\s*=\s*g\.cells/);
  });

  it('has a dedicated block branch that SELECTS a name (the raw id only secondary)', () => {
    expect(src).toMatch(/\{:else if slot\.type === 'block'\}/);
    // the raw id stays available as a hint, but under the named select
    expect(src).toMatch(/fcBlockRawHint\(blockVal\)/);
    // the roster cap is disclosed on the control itself
    expect(src).toMatch(/title=\{blockRosterNote\}/);
  });

  it('no longer renders the OLD bare "block id" number field (the defect this fixes)', () => {
    expect(src).not.toMatch(/<span class="hint">block id<\/span>/);
    // the old inline conditional that printed the hint inside the number field's {:else} is gone too
    expect(src).not.toMatch(/\{#if slot\.type === 'block'\}/);
  });
});
