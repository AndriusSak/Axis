import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Source-guard for the §2.9 move-row/column wiring. The pure planner (gridShift.ts) is unit-tested
// in gridShift.test.ts; the .svelte component + the runes store can't be compiled by this repo's
// node-env vitest, so — exactly like blockLibraryWiring.sourceguard.test.ts / listCaps.test.ts —
// these guards pin the thin bindings: the Signal Grid border controls, the editor's exec methods,
// the device-shape bound, and that only the EXISTING grid endpoints are issued.
const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

describe('grid shift (move row / column) wiring', () => {
  const grid = read('./SignalGrid.svelte');
  const editor = read('./editor.svelte.ts');
  const planner = read('./gridShift.ts');

  it('the Signal Grid imports the pure row/column shift planners', () => {
    expect(grid).toMatch(/import \{ planGridShiftRow, planGridShiftColumn \} from '\.\/gridShift'/);
  });

  it('renders a border control per row and per column, each an up/down pair', () => {
    expect(grid).toMatch(/data-shift-row=\{r\}/);
    expect(grid).toMatch(/data-shift-col=\{c\}/);
    expect(grid).toMatch(/data-shift-dir="-1"/);
    expect(grid).toMatch(/data-shift-dir="1"/);
    expect(grid).toMatch(/aria-label=\{`Move row \$\{r \+ 1\} up`\}/);
    expect(grid).toMatch(/aria-label=\{`Move column \$\{c \+ 1\} down`\}/);
  });

  it('calls the editor exec methods from the controls', () => {
    expect(grid).toMatch(/editor\.shiftRow\(r, -1\)/);
    expect(grid).toMatch(/editor\.shiftRow\(r, 1\)/);
    expect(grid).toMatch(/editor\.shiftColumn\(c, -1\)/);
    expect(grid).toMatch(/editor\.shiftColumn\(c, 1\)/);
  });

  it('disables a control and names the reason from the planner result (no silent drop)', () => {
    // the planner's ok/error drives both the disabled state and the tooltip
    expect(grid).toMatch(/disabled=\{!shiftReady \|\| !ru\.ok\}/);
    expect(grid).toMatch(/disabled=\{!shiftReady \|\| !cd\.ok\}/);
    expect(grid).toMatch(/title=\{ru\.ok \? `Move row \$\{r \+ 1\} up` : `Move row \$\{r \+ 1\} up — \$\{ru\.error\}`\}/);
    expect(grid).toMatch(/title=\{cu\.ok \? `Move column \$\{c \+ 1\} up` : `Move column \$\{c \+ 1\} up — \$\{cu\.error\}`\}/);
  });

  it('the editor delegates both shifts to the pure planners over the shared #runPlan path', () => {
    expect(editor).toMatch(/import \{ planGridShiftRow, planGridShiftColumn \} from '\.\/gridShift'/);
    expect(editor).toMatch(/shiftRow = async \(row: number, dir: -1 \| 1\)/);
    expect(editor).toMatch(/shiftColumn = async \(col: number, dir: -1 \| 1\)/);
    expect(editor).toMatch(/planGridShiftRow\(this\.layout\.cells, this\.layout\.shunts, row, dir, this\.gridShape\)/);
    expect(editor).toMatch(/planGridShiftColumn\(this\.layout\.cells, this\.layout\.shunts, col, dir, this\.gridShape\)/);
    // #runPlan executes the ops forward + records ONE undoable composite → reuses the §2.9 undo path
    expect(editor).toMatch(/#runPlan\(planGridShiftRow/);
    expect(editor).toMatch(/#runPlan\(planGridShiftColumn/);
  });

  it('bounds every shift by the DEVICE grid shape read from the decoded layout (not hardcoded)', () => {
    expect(editor).toMatch(/get gridShape\(\): \{ rows: number; cols: number \}/);
    expect(editor).toMatch(/rows: this\.layout\.rows, cols: this\.layout\.cols/);
    // the component's shape is derived from the editor layout too
    expect(grid).toMatch(/const gridShape = \$derived\(\{ rows, cols \}\)/);
    expect(planner).not.toMatch(/\b12\b|\b14\b|\b4\b\s*\/\/\s*hardcode/); // no baked-in device shape
  });

  it('issues only the EXISTING grid endpoints (place/remove/cable → no new route)', () => {
    // the planner emits exactly the structural op kinds history already replays
    expect(planner).toMatch(/kind: 'place'/);
    expect(planner).toMatch(/kind: 'remove'/);
    expect(planner).toMatch(/kind: 'cable'/);
    // and no other op kind / no new network call is minted
    expect(planner).not.toMatch(/kind: '(param|bypass|channel|retype|scene|sceneName|presetName)'/);
    expect(planner).not.toMatch(/\bfetch\(|forgefx|req</);
    expect(planner).not.toMatch(/preset\/grid/);
    // the editor executes them through the shared #runOp (placeCell/clearCell/cable), which now
    // returns each write's SETTLEMENT so a refused write can't be recorded as an undoable step
    expect(editor).toMatch(/case 'place': return this\.#writeSettlement\(forgefx\.placeCell/);
    expect(editor).toMatch(/case 'cable': return this\.#writeSettlement\(forgefx\.cable/);
  });

  it('the planner is pure (no runes, DOM or network imports)', () => {
    expect(planner).not.toMatch(/from 'svelte'|from '\.\/editor|\$state|\$derived|document\.|window\./);
  });
});
