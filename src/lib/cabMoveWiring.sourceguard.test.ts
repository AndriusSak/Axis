import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Source-guard for the §2.7 cab-MOVE-from-library wiring. The pure planner (cabMove.ts) is unit-tested
// in cabMove.test.ts; the .svelte component can't be compiled by this repo's node-env vitest, so — like
// gridShiftWiring.sourceguard.test.ts — these guards pin the thin bindings: the component prefers the
// stored bytes without a file, falls back with a named reason, and issues only the two EXISTING routes.
const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

describe('cab move from library (§2.7) wiring', () => {
  const picker = read('./CabPicker.svelte');
  const client = read('./forgefx.ts');
  const planner = read('./cabMove.ts');

  it('the picker imports the pure move planner + scope note', () => {
    expect(picker).toMatch(/import \{ planLibraryMove, libraryCanMove, CAB_LIBRARY_NOTE \} from '\.\/cabMove'/);
  });

  it('a move with no file is planned from the library and fetches the stored bytes', () => {
    expect(picker).toMatch(/const plan = planLibraryMove\(irLib, from, slot\)/);
    expect(picker).toMatch(/forgefx\.cabLibraryBytes\(plan\.entry\.id\)/);
    // the library is loaded when the picker opens (best-effort)
    expect(picker).toMatch(/forgefx\s*\n?\s*\.cabLibrary\(\)/);
  });

  it('a source NOT in the library falls back with a NAMED reason, never silently', () => {
    // the planner's reason is surfaced verbatim; the UI does not swallow it
    expect(picker).toMatch(/irMsg = plan\.reason/);
    expect(picker).toMatch(/NOT in the Axis library/);
  });

  it('the scope line is rendered from the SERVER response (not re-invented client-side)', () => {
    expect(picker).toMatch(/\{irLibScope \|\| CAB_LIBRARY_NOTE\}/);
    expect(client).toMatch(/cabLibrary: \(\) => req<CabLibraryListResult>\('\/cab\/library'\)/);
  });

  it('issues only the two EXISTING read routes — no new endpoint is minted', () => {
    expect(client).toMatch(/\/cab\/library\b/);
    expect(client).toMatch(/\/cab\/library\/\$\{encodeURIComponent\(id\)\}\/bytes/);
    // the planner itself does no network
    expect(planner).not.toMatch(/\bfetch\(|forgefx|req</);
    expect(planner).not.toMatch(/from 'svelte'|\$state|\$derived|document\.|window\./);
  });
});
