import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  AXIS_BATCH_SET_NAV_ID,
  AXIS_BATCH_SET_NAV_LABEL,
  createAxisSeedNavigation,
  ensureAxisBatchSetNavEntry
} from '../axisWorkbenchPages';
import { AXIS_WORKBENCH_NAVIGATION_IDS } from '../axisWorkbenchRegistryManifest';
import { createAxisWorkbenchDefaultDocument } from '../axisWorkbenchDefaults';

// ── R22 — the §2.11 batch-set panel must be reachable from a visible rail/registry entry ───────────
// The registered `axis.batchSet` panel + `axis.openBatchSet` action shipped in the §2.11 round, but the
// panel had NO rail/menu entry: it was openable only through its action, so a user could not find it.
// R22 adds a discoverable rail entry (the workbench navigation) that fires the SAME action — additive,
// and without touching the panel or its destructive-by-design preview/confirm flow.
//
// The pure seed/self-heal logic is unit-tested directly; the .svelte wiring and the registry loop are
// pinned by source guards (the listCaps.test.ts / shortcuts.test.ts pattern — node-env vitest cannot
// mount .svelte components).

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

describe('R22 — §2.11 batch-set rail entry', () => {
  it('the seed navigation carries a batchSet ACTION entry wired to axis.openBatchSet', () => {
    const nav = createAxisSeedNavigation('side');
    const entry = nav.entries[AXIS_BATCH_SET_NAV_ID];
    expect(entry).toBeDefined();
    expect(entry.label).toBe(AXIS_BATCH_SET_NAV_LABEL);
    expect(entry.target?.command).toBe('axis.openBatchSet');
    // An ACTION entry — it owns no page (it opens/focuses the panel in `main` instead).
    expect(entry.pageId).toBeUndefined();
    expect(nav.order).toContain(AXIS_BATCH_SET_NAV_ID);
  });

  it('the registry manifest lists the entry id (so a rail renderer is registered for it)', () => {
    expect(AXIS_WORKBENCH_NAVIGATION_IDS).toContain(AXIS_BATCH_SET_NAV_ID);
  });

  it('the default document ships the entry on every layout', () => {
    const doc = createAxisWorkbenchDefaultDocument();
    for (const layout of Object.values(doc.layouts)) {
      expect(layout.navigation.entries[AXIS_BATCH_SET_NAV_ID]?.target?.command).toBe('axis.openBatchSet');
      expect(layout.navigation.order).toContain(AXIS_BATCH_SET_NAV_ID);
    }
  });

  it('the entry opens the REGISTERED axis.batchSet panel — no dead entry', () => {
    const registry = read('../axisWorkbenchRegistry.ts');
    // The action the rail entry fires maps to the batch-set panel type.
    const action = registry.slice(registry.indexOf("actionId: 'axis.openBatchSet'"));
    const block = action.slice(0, action.indexOf('})'));
    expect(block).toContain("panelType: 'axis.batchSet'");
    // The rail renderer for the entry id comes from the manifest loop — it covers batchSet too.
    expect(registry).toContain('AXIS_WORKBENCH_NAVIGATION_IDS.forEach');
  });

  it('the nav entry component gives batchSet its own glyph (not the generic fallback dot)', () => {
    const src = read('../widgets/AxisWorkbenchNavigationEntry.svelte');
    expect(src).toMatch(/batchSet:\s*'/);
  });

  it('normalization self-heals the entry onto a persisted doc that predates it (idempotent)', () => {
    const doc = createAxisWorkbenchDefaultDocument();
    // Simulate a document persisted BEFORE R22: the entry is entirely absent.
    for (const layout of Object.values(doc.layouts)) {
      delete layout.navigation.entries[AXIS_BATCH_SET_NAV_ID];
      layout.navigation.order = layout.navigation.order.filter((id) => id !== AXIS_BATCH_SET_NAV_ID);
    }

    const healed = ensureAxisBatchSetNavEntry(doc);
    for (const layout of Object.values(healed.layouts)) {
      expect(layout.navigation.entries[AXIS_BATCH_SET_NAV_ID]?.target?.command).toBe('axis.openBatchSet');
      expect(layout.navigation.order).toContain(AXIS_BATCH_SET_NAV_ID);
    }

    // A second pass changes nothing (idempotent).
    const before = JSON.stringify(healed.layouts);
    expect(JSON.stringify(ensureAxisBatchSetNavEntry(healed).layouts)).toBe(before);
  });

  it('never overrides a user who HID the entry (present-but-hidden stays hidden)', () => {
    const doc = createAxisWorkbenchDefaultDocument();
    for (const layout of Object.values(doc.layouts)) {
      const entry = layout.navigation.entries[AXIS_BATCH_SET_NAV_ID];
      if (entry) entry.hidden = true;
    }
    ensureAxisBatchSetNavEntry(doc);
    for (const layout of Object.values(doc.layouts)) {
      expect(layout.navigation.entries[AXIS_BATCH_SET_NAV_ID]?.hidden).toBe(true);
    }
  });

  it('the store normalization chain runs the self-heal', () => {
    expect(read('../axisWorkbenchStore.svelte.ts')).toContain('ensureAxisBatchSetNavEntry');
  });
});
