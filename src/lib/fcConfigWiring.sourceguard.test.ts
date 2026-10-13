import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// FC Config group wiring guard. The .svelte components can't be mounted in this repo's node-env
// vitest, so — like controlSwitchWiring.sourceguard.test.ts — we scan the component + model source to
// prove the Setup MIDI/Remote surface actually USES the pure layer in fcConfig.ts (whose served/gated
// mapping is unit-tested there).
const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
/** Strip comments so a guard cannot be satisfied (or defeated) by commented-out text. */
const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');

describe('fcConfig model — purity + no invented ids', () => {
  const src = stripComments(read('./fcConfig.ts'));

  it('is a pure module: no Svelte/editor-store import', () => {
    expect(src).not.toMatch(/from '\.\/editor\.svelte'/);
    expect(src).not.toMatch(/\$state|\$derived/);
  });

  it('carries no invented paramIds — every spec id is a served GLOBAL FC Config row, and no PFC4', () => {
    const ids = [...src.matchAll(/id: (\d+),/g)].map((m) => Number(m[1]));
    expect(ids.length).toBeGreaterThan(0);
    for (const id of ids) expect([3602, 3603, 3604, 3606, 3607, 3608]).toContain(id);
    // PFC4 (3605/3609) exists only in the Axe-Fx III layouts — the FM3 has three FC ports.
    expect(ids).not.toContain(3605);
    expect(ids).not.toContain(3609);
  });
});

describe('Setup MIDI/Remote section — FC Config group wiring', () => {
  const src = stripComments(read('./MidiRemoteSection.svelte'));
  // Script-level claims are scoped to the component's <script> block so a stray match in the markup
  // cannot satisfy them (the component-source analogue of a method body).
  const script = (src.match(/<script[\s\S]*?>([\s\S]*?)<\/script>/) ?? [, src])[1];
  // The FC Config group's markup slice — scoped so the CS and MIDI groups' IDENTICAL patterns (their
  // `enumParam.name` labels and their `onChange…setSel` / `no option labels served` text) cannot
  // satisfy — or defeat — an assertion about THIS group. Both markers live only in the FC group.
  const fcBlock = src.slice(
    src.indexOf('<div class="subhead">FC Config</div>'),
    src.indexOf('{#if MIDI_REMOTE_GAPS.length}')
  );

  it('imports the pure FC Config layer and builds its rows from the served GLOBAL params/enums', () => {
    expect(script).toMatch(/from '\.\/fcConfig'/);
    expect(script).toMatch(/buildFcConfigRows\(editor\.params, editor\.enums\)/);
  });

  it('renders a labelled FC Config group and its honest gaps', () => {
    expect(src).toMatch(/FC Config/);
    expect(src).toMatch(/\{#each fcRows as r/);
    expect(src).toMatch(/FC_CONFIG_GAPS/);
  });

  it('writes selections through the existing param-write path (editor.setEnum via setSel)', () => {
    expect(fcBlock).toMatch(/onChange=\{\(v\) => setSel\(r\.enumParam, v\)\}/);
    expect(script).toMatch(/const setSel = \(e: EnumParam, v: number\) => editor\.setEnum\(e, v\)/);
  });

  it('labels the control with the spec label, never the index-like served name ("1 1")', () => {
    // scoped to the FC block (above) so the CS/MIDI groups' legitimate `enumParam.name` labels cannot
    // make this negative assertion vacuous.
    expect(fcBlock).toMatch(/\{#each fcRows as r/);
    expect(fcBlock).toMatch(/label=\{r\.spec\.label\}/);
    expect(fcBlock).not.toMatch(/label=\{r\.enumParam\.name\}/);
  });

  it('renders an honest hint (not a fabricated label) when a selector serves no options', () => {
    expect(fcBlock).toMatch(/r\.ordinalOnly/);
    expect(fcBlock).toMatch(/no option labels served/);
  });
});
