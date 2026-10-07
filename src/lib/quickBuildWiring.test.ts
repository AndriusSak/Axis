import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { SHORTCUTS, resolveShortcut, WIRED_IDS } from './shortcuts';
import { AXIS_WORKBENCH_ACTION_IDS, AXIS_WORKBENCH_BASE_PANEL_TYPES } from './axis-workbench/axisWorkbenchRegistryManifest';

// Parity audit §2.9 remainder — the Quick Build panel. The pure decision logic is unit-tested in
// quickBuild.test.ts; this guard pins the Svelte/registry wiring the node-env vitest cannot mount
// (the same *Wiring pattern the other workbench panels use): the panel is registered as a workbench
// panel + action, its placement REUSES the existing grid op (never a second path), and the 'Q' chord
// is wired through the central shortcut registry all the way to routes/+page.svelte.

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

const MANIFEST = './axis-workbench/axisWorkbenchRegistryManifest.ts';
const REGISTRY = './axis-workbench/axisWorkbenchRegistry.ts';
const PANEL = './axis-workbench/panels/AxisQuickBuildPanel.svelte';
const PAGE = '../routes/+page.svelte';

describe('Quick Build — workbench panel + action registration', () => {
  it('declares the panel type and the action id in the registry manifest', () => {
    const manifest = read(MANIFEST);
    expect(manifest).toContain("'axis.quickBuild'");
    expect(manifest).toContain("'axis.openQuickBuild'");
    expect(AXIS_WORKBENCH_BASE_PANEL_TYPES).toContain('axis.quickBuild');
    expect(AXIS_WORKBENCH_ACTION_IDS).toContain('axis.openQuickBuild');
  });

  it('maps the panel type to the Quick Build component in the registry', () => {
    const registry = read(REGISTRY);
    expect(registry).toContain('AxisQuickBuildPanel');
    expect(registry).toMatch(/type === 'axis\.quickBuild'\s*\?\s*AxisQuickBuildPanel/);
  });

  it('registers a docks-or-focuses action that opens the panel', () => {
    const registry = read(REGISTRY);
    const action = registry.slice(registry.indexOf("actionId: 'axis.openQuickBuild'"));
    const block = action.slice(0, action.indexOf('})'));
    expect(block).toContain("panelId: 'axis.quickBuild'");
    expect(block).toContain("panelType: 'axis.quickBuild'");
    expect(block).toContain("title: 'Quick Build'");
  });
});

describe('Quick Build — panel reuses the EXISTING grid placement op', () => {
  const src = read(PANEL);

  it('delegates curation + target decisions to the tested pure module', () => {
    expect(src).toMatch(/from '\.\.\/\.\.\/quickBuild'/);
    for (const fn of ['resolveQuickBuild', 'quickBuildTarget', 'isQuickBuildPlaced', 'QUICK_BUILD_BLOCKS']) {
      expect(src).toContain(fn);
    }
  });

  it('places through editor.place (the same op the palette uses) and invents no second path', () => {
    expect(src).toMatch(/editor\.place\(/);
    // No direct wire call / no alternative placement path in the panel.
    expect(src).not.toMatch(/forgefx\.placeCell\(/);
    expect(src).not.toMatch(/from '.*gridRouting'/);
  });

  it('surfaces a NAMED refusal instead of dropping the click silently', () => {
    expect(src).toMatch(/p\.reason/);
    expect(src).toContain('Cannot place');
  });
});

describe('Quick Build — the Q chord is wired end to end', () => {
  it("registers 'quickBuild' as a wired bare-Q binding", () => {
    const def = SHORTCUTS.find((s) => s.id === 'quickBuild');
    expect(def, 'quickBuild must be registered').toBeTruthy();
    expect(def!.status).toBe('wired');
    expect(def!.chord).toBe('Q');
    expect(def!.matches).toEqual([{ key: 'q' }]);
    expect(WIRED_IDS).toContain('quickBuild');
    // resolves a bare q, and is suppressed while typing (typing guard).
    expect(resolveShortcut({ key: 'q' })?.id).toBe('quickBuild');
    expect(resolveShortcut({ key: 'q' }, true)).toBeNull();
    // a modified q must not fire it (exact-modifier match).
    expect(resolveShortcut({ key: 'q', metaKey: true })?.id).not.toBe('quickBuild');
  });

  it('routes/+page.svelte dispatches the Q chord to the panel action', () => {
    const page = read(PAGE);
    expect(page).toMatch(/case 'quickBuild':/);
    expect(page).toMatch(/case 'quickBuild':[\s\S]*?axisWorkbenchRegistry\.runActionResult\(\s*'axis\.openQuickBuild'/);
  });
});
