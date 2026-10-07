import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Control Switch (CS) group wiring guard. The .svelte components can't be mounted in this repo's
// node-env vitest, so — like presetColorsWiring.sourceguard.test.ts / modifierReadback.sourceguard.test.ts
// — we scan the component + model source to prove the Setup MIDI/Remote surface actually USES the pure
// layer in controlSwitch.ts (whose served/gated mapping is unit-tested there).
const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
/** Strip comments so a guard cannot be satisfied (or defeated) by commented-out text. */
const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');

describe('controlSwitch model — purity', () => {
  const src = stripComments(read('./controlSwitch.ts'));

  it('is a pure module: no Svelte/editor-store import', () => {
    expect(src).not.toMatch(/from '\.\/editor\.svelte'/);
    expect(src).not.toMatch(/\$state|\$derived/);
  });

  it('carries no invented paramIds — every spec id is a GLOBAL CS catalogue row', () => {
    const ids = [...src.matchAll(/id: (\d+),/g)].map((m) => Number(m[1]));
    expect(ids.length).toBeGreaterThan(0);
    for (const id of ids) expect([6979, 6985, 6986, 7107, 7108, 7109, 7110, 7111, 7112]).toContain(id);
  });
});

describe('Setup MIDI/Remote section — CS group wiring', () => {
  const src = stripComments(read('./MidiRemoteSection.svelte'));
  // Script-level claims are scoped to the component's <script> block so a stray match in the markup
  // cannot satisfy them (the component-source analogue of a method body).
  const script = (src.match(/<script[\s\S]*?>([\s\S]*?)<\/script>/) ?? [, src])[1];

  it('imports the pure CS layer and builds its rows from the served GLOBAL params/enums', () => {
    expect(script).toMatch(/from '\.\/controlSwitch'/);
    expect(script).toMatch(/buildControlSwitchRows\(editor\.params, editor\.enums\)/);
  });

  it('renders a labelled Control Switches group and its honest gaps', () => {
    expect(src).toMatch(/Control Switches/);
    expect(src).toMatch(/\{#each csRows as r/);
    expect(src).toMatch(/CONTROL_SWITCH_GAPS/);
  });

  it('writes selections through the existing param-write path (editor.setEnum via setSel)', () => {
    expect(src).toMatch(/onChange=\{\(v\) => setSel\(r\.enumParam, v\)\}/);
    expect(script).toMatch(/const setSel = \(e: EnumParam, v: number\) => editor\.setEnum\(e, v\)/);
  });

  it('renders an honest hint (not a fabricated label) when a selector serves no options', () => {
    expect(src).toMatch(/r\.ordinalOnly/);
    expect(src).toMatch(/no option labels served/);
  });
});
