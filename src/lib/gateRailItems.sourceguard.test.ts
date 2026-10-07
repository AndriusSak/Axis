import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Source guard for the §3.5 rail capability gate. ToolRail.svelte mounts only in a real browser (runic
// $derived, the editor store), so the gate DECISION is unit-tested against served-capability shapes in
// gateRailItems.test.ts; this pins the thin bindings so a refactor cannot go back to HIDING Setup /
// Controllers (the audit §3.5 defect) instead of rendering them disabled with their reason.
const src = readFileSync(fileURLToPath(new URL('./ToolRail.svelte', import.meta.url)), 'utf8');

describe('ToolRail §3.5 capability-gate wiring', () => {
  it('derives rail state from the capability gate module', () => {
    expect(src).toMatch(/from '\.\/gateRailItems'/);
    expect(src).toMatch(/gateRailItem\(input, r\.id\)/);
    expect(src).toMatch(/\.filter\(\(r\) => r\.visible\)/);
  });

  it('renders a gated entry DISABLED with the capability reason in its tooltip — never removed', () => {
    // disabled affordance + the honest reason in the tooltip
    expect(src).toMatch(/disabled=\{!r\.enabled\}/);
    expect(src).toMatch(/title=\{r\.enabled \? r\.label : r\.reason\}/);
    // BOTH surfaces: the desktop rail and the mobile drawer
    expect((src.match(/disabled=\{!r\.enabled\}/g) ?? []).length).toBe(2);
    expect((src.match(/title=\{r\.enabled \? r\.label : r\.reason\}/g) ?? []).length).toBe(2);
    // a visible disabled style exists for both surfaces
    expect(src).toMatch(/\.item:disabled/);
    expect(src).toMatch(/\.d-item:disabled/);
  });

  it('no longer silently filters Setup / Controllers out of the rail', () => {
    // the old capability filter dropped the entries outright; that branch is gone
    expect(src).not.toMatch(/ve\.has\('global'\)/);
    expect(src).not.toMatch(/ve\.has\('controllers'\)/);
    expect(src).not.toMatch(/RAIL\.filter\(/);
  });

  it('keeps the rail ids + user-visible labels unchanged', () => {
    // the labels are user-visible strings — this guard fails loudly if one is renamed
    for (const label of ['Build', 'Preset Browser', 'Controllers', 'Footswitches', 'Scene Mgr', 'Perform', 'Sets & Songs', 'Settings']) {
      expect(src).toContain(`label: '${label}'`);
    }
  });

  // ── R28: the legacy rail no longer lies about unavailable screens (no-dead-nav rule, 01-shell §9). ──
  it('no longer emits a misleading "coming soon" toast for an unavailable rail screen', () => {
    expect(src).not.toMatch(/coming soon/i);
    expect(src).not.toMatch(/showToast/); // the rail has no toast fallthrough at all
  });

  it('routes every unwired id through the capability gate (perform/sets/scenes disabled-with-reason)', () => {
    // the pick handler takes only the id — no label-toast fallthrough branch survives
    expect(src).toMatch(/function pick\(id: string\)/);
    expect(src).toMatch(/gateRailItem\(input, r\.id\)/);
    // the disabled entry renders its reason in the tooltip on BOTH surfaces
    expect(src).toMatch(/disabled=\{!r\.enabled\}/);
    expect(src).toMatch(/title=\{r\.enabled \? r\.label : r\.reason\}/);
  });
});
