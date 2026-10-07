import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// R23: drag-and-drop reorder in the Manage Presets area. The pure planner/runner is unit-tested in
// slotReorderOps.test.ts and the button/confirm wiring in managePresetsWiring.test.ts. What neither can
// prove is that the DnD gesture feeds the SAME planner/runner (no second reorder path, no weakened
// same-slot-set guard). This guard scans the component source, the same pattern the other *Wiring tests
// use (vitest cannot mount .svelte in this repo's node-env setup).

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
const PANEL = '../panels/preset-browser/AxisPresetBrowserPartPanel.svelte';

describe('workbench preset browser — drag-and-drop reorder wiring (R23, audit §2.4)', () => {
  const src = read(PANEL);

  it('makes every reorder row draggable with a full HTML5 DnD gesture', () => {
    expect(src).toMatch(/class="mp-row"[\s\S]*?draggable="true"/);
    expect(src).toMatch(/ondragstart=\{\(e\)\s*=>\s*mpReorderDragStart\(e,\s*i\)\}/);
    expect(src).toMatch(/ondragover=\{\(e\)\s*=>\s*mpReorderDragOver\(e,\s*i\)\}/);
    expect(src).toMatch(/ondrop=\{\(e\)\s*=>\s*mpReorderDrop\(e,\s*i\)\}/);
    expect(src).toContain('mpReorderDragEnd');
  });

  it('routes a drop through the SAME planner + runner (no second reorder path)', () => {
    // exactly one plan call site and one run call site in the whole component
    expect(src.match(/planSlotReorder\(/g)?.length).toBe(1);
    expect(src.match(/runSlotReorder\(/g)?.length).toBe(1);
    expect(src).toMatch(/runSlotReorder\(mpReorderPreview,\s*mpReorderIo\)/);
    // the drop permutes the order then rebuilds the plan via the very same dry run
    expect(src).toMatch(/function mpReorderReorder\([\s\S]*?mpReorderDryRun\(\)/);
    // both the ↑/↓ buttons and the drag path share one order-setter (single source of the array)
    expect(src).toMatch(/function mpReorderMove\([\s\S]*?mpReorderSetOrder\(next\)/);
    expect(src).toMatch(/function mpReorderReorder\([\s\S]*?mpReorderSetOrder\(next\)/);
  });

  it('never weakens the same-slot-set permutation guard — drop only permutes the marked set', () => {
    // moves are still derived 1:1 from the marked slot set; the order array is only ever a permutation
    expect(src).toMatch(/return mpReorderOrder\.map\(\(src,\s*i\)\s*=>\s*\(\{\s*from:\s*src,\s*to:\s*slots\[i\]\s*\}\)\)/);
    // the drop reorders in place (splice) and cannot add or duplicate a slot
    expect(src).toMatch(/function mpReorderReorder\([\s\S]*?splice\(from,\s*1\)[\s\S]*?splice\(to,\s*0,\s*moved\)/);
    expect(src).not.toMatch(/mpReorderOrder\.push\(/);
    expect(src).not.toMatch(/mpReorderOrder\.concat\(/);
  });
});
