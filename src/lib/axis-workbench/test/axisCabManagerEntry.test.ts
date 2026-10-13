import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  AXIS_CAB_MANAGER_NAV_ID,
  AXIS_CAB_MANAGER_NAV_LABEL,
  createAxisSeedNavigation,
  ensureAxisCabManagerNavEntry
} from '../axisWorkbenchPages';
import { AXIS_WORKBENCH_ACTION_IDS, AXIS_WORKBENCH_BASE_PANEL_TYPES, AXIS_WORKBENCH_NAVIGATION_IDS } from '../axisWorkbenchRegistryManifest';
import { createAxisWorkbenchDefaultDocument } from '../axisWorkbenchDefaults';

// Manage Cabs must be reachable from a visible rail entry that opens a REGISTERED panel — the no-dead-nav
// rule. Same shape as the R22 batch-set guard: pure seed/self-heal logic tested directly, the .svelte and
// registry wiring pinned by source guards (node-env vitest cannot mount components).
const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

describe('Manage Cabs rail entry', () => {
  it('the seed navigation carries a cabManager ACTION entry wired to axis.openCabManager', () => {
    const nav = createAxisSeedNavigation('side');
    const e = nav.entries[AXIS_CAB_MANAGER_NAV_ID];
    expect(e?.label).toBe(AXIS_CAB_MANAGER_NAV_LABEL);
    expect(e?.target?.command).toBe('axis.openCabManager');
    expect(e?.pageId).toBeUndefined();
    expect(nav.order).toContain(AXIS_CAB_MANAGER_NAV_ID);
  });
  it('the manifest lists the panel type, the nav id and the action id', () => {
    expect(AXIS_WORKBENCH_BASE_PANEL_TYPES).toContain('axis.cabManager');
    expect(AXIS_WORKBENCH_NAVIGATION_IDS).toContain(AXIS_CAB_MANAGER_NAV_ID);
    expect(AXIS_WORKBENCH_ACTION_IDS).toContain('axis.openCabManager');
  });
  it('the default document ships the entry on every layout', () => {
    for (const layout of Object.values(createAxisWorkbenchDefaultDocument().layouts)) {
      expect(layout.navigation.entries[AXIS_CAB_MANAGER_NAV_ID]?.target?.command).toBe('axis.openCabManager');
    }
  });
  it('the entry opens the REGISTERED axis.cabManager panel, rendered by the real component — no dead entry', () => {
    const registry = read('../axisWorkbenchRegistry.ts');
    const block = registry.slice(registry.indexOf("actionId: 'axis.openCabManager'"));
    expect(block.slice(0, block.indexOf('})'))).toContain("panelType: 'axis.cabManager'");
    expect(registry).toMatch(/type === 'axis\.cabManager' \? AxisCabManagerPanel/);
    expect(read('../panels/AxisCabManagerPanel.svelte')).toContain("import CabManager from '../../CabManager.svelte'");
    expect(read('../widgets/AxisWorkbenchNavigationEntry.svelte')).toMatch(/cabManager:\s*'/);
  });
  it('normalization self-heals the entry onto a persisted doc that predates it (idempotent, never overrides a hidden one)', () => {
    const doc = createAxisWorkbenchDefaultDocument();
    for (const layout of Object.values(doc.layouts)) {
      delete layout.navigation.entries[AXIS_CAB_MANAGER_NAV_ID];
      layout.navigation.order = layout.navigation.order.filter((id) => id !== AXIS_CAB_MANAGER_NAV_ID);
    }
    const healed = ensureAxisCabManagerNavEntry(doc);
    for (const layout of Object.values(healed.layouts)) {
      expect(layout.navigation.entries[AXIS_CAB_MANAGER_NAV_ID]?.target?.command).toBe('axis.openCabManager');
      expect(layout.navigation.order).toContain(AXIS_CAB_MANAGER_NAV_ID);
    }
    const before = JSON.stringify(healed.layouts);
    expect(JSON.stringify(ensureAxisCabManagerNavEntry(healed).layouts)).toBe(before);
    for (const layout of Object.values(healed.layouts)) layout.navigation.entries[AXIS_CAB_MANAGER_NAV_ID]!.hidden = true;
    ensureAxisCabManagerNavEntry(healed);
    for (const layout of Object.values(healed.layouts)) expect(layout.navigation.entries[AXIS_CAB_MANAGER_NAV_ID]?.hidden).toBe(true);
  });
  it('the store normalization chain runs the self-heal', () => {
    expect(read('../axisWorkbenchStore.svelte.ts')).toContain('ensureAxisCabManagerNavEntry');
  });
});
