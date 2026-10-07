import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Source-guard for the §2.9 Grid Navigation Mode (R25) wiring. The pure policy (gridNavMode.ts) is
// unit-tested in gridNavMode.test.ts; .svelte components can't be compiled by this repo's node-env
// vitest, so — exactly like gridShiftWiring.sourceguard.test.ts / shortcuts.test.ts — these guards
// pin the thin bindings: the tiny standalone toggle store (NOT an editor-store member), the Signal
// Grid consulting the policy for each action it dispatches, the explicit open still fetching, the
// named refusal surfacing instead of a silent edit, and the 'G' shortcut reaching the same state.
const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

describe('grid navigation mode (audit §2.9) wiring', () => {
  const grid = read('./SignalGrid.svelte');
  const store = read('./gridNavMode.svelte.ts');
  const pure = read('./gridNavMode.ts');
  const page = read('../routes/+page.svelte');
  const shortcuts = read('./shortcuts.ts');
  const surface = read('./editorSurface.ts');
  const editor = read('./editor.svelte.ts');

  it('the Signal Grid imports the pure policy + the tiny mode store', () => {
    expect(grid).toMatch(/import \{ shouldFetchOnGridAction \} from '\.\/gridNavMode';/);
    expect(grid).toMatch(/import \{ gridNavMode \} from '\.\/gridNavMode\.svelte';/);
  });

  it('the mode is a tiny STANDALONE switch — never a new editor-store member', () => {
    expect(store).toMatch(/let mode = \$state<GridNavMode>\('normal'\)/);
    expect(store).toMatch(/shouldFetchOnGridAction, type GridNavAction, type GridNavMode \} from '\.\/gridNavMode'/);
    // the EditorSurface seam + the editor store are untouched (self-contained, per the round's constraint)
    expect(surface).not.toMatch(/gridNav/i);
    expect(editor).not.toMatch(/gridNav/i);
  });

  it('renders the grid-header toggle with a visible on-state indicator', () => {
    expect(grid).toMatch(/class="gridnav-pill"/);
    expect(grid).toMatch(/class:on=\{gridNav === 'gridNav'\}/);
    expect(grid).toMatch(/gridNavMode\.toggle\(\)/);
    expect(grid).toMatch(/aria-pressed=\{gridNav === 'gridNav'\}/);
  });

  it('consults the policy on tap: grid-nav selection skips the fetch and never opens the editor', () => {
    expect(grid).toMatch(/shouldFetchOnGridAction\(gridNav, 'select'\)/);
    // single-tap navigation path: selection WITHOUT editor.openCell (the one per-block fetch trigger)
    expect(grid).toMatch(/navSelect\(cell\); \/\/ no editor, no fetch/);
  });

  it('the EXPLICIT open action still fetches (double tap in grid-nav)', () => {
    expect(grid).toMatch(/shouldFetchOnGridAction\(gridNav, 'openEditor'\)/);
    expect(grid).toMatch(/void editor\.openCell\(cell\); \/\/ explicit open → always fetches/);
  });

  it('navigation never leaves another block’s params under the new selection (no silent staleness)', () => {
    expect(grid).toMatch(/editor\.editorOpen && editor\.selKey !== key\) editor\.closeEditor\(\)/);
  });

  it('in-place param gestures consult the policy and surface the named refusal — never a silent edit', () => {
    expect(grid).toMatch(/shouldFetchOnGridAction\(gridNav, 'paramEdit'\)/);
    expect(grid).toMatch(/editor\.showToast\(d\.reason\)/);
    expect(pure).toMatch(/GRID_NAV_PARAM_REFUSAL/);
  });

  it("the shortcut registry wires the toggle and +page.svelte dispatches it to the store", () => {
    expect(shortcuts).toMatch(/id: 'gridNavMode'/);
    expect(shortcuts).toMatch(/\{ key: 'g' \}/);
    expect(page).toMatch(/import \{ gridNavMode \} from '\$lib\/gridNavMode\.svelte';/);
    expect(page).toMatch(/case 'gridNavMode':[\s\S]*?gridNavMode\.toggle\(\)/);
  });
});