import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// The workbench preset browser's context-menu BUILDER is unit-tested in
// presetBrowserWorkbenchMenu.test.ts. What that cannot prove is that the Svelte panel — which vitest
// cannot mount in this repo's node-env setup — actually WIRES the new device-slot librarian entries
// (audit §2.4 follow-up): passes the capability, routes the dispatch to the inline slot picker, and
// runs the real editor ops. This guard scans the component source, the same pattern listCaps.test.ts
// uses for un-mountable components.

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
const PANEL = '../../axis-workbench/panels/preset-browser/AxisPresetBrowserPartPanel.svelte';
const CONTEXT_MENU = '../../workbench/svelte/ContextMenu.svelte';

describe('workbench preset browser — device-slot librarian wiring (§2.4)', () => {
  it('feeds the capability check into the menu builder (reuses canCopySlots, no duplicated logic)', () => {
    const src = read(PANEL);
    expect(src).toMatch(/canCopySlots:\s*editor\.canCopySlots/);
  });

  it('routes the Duplicate/Swap menu ids into the inline slot picker', () => {
    const src = read(PANEL);
    expect(src).toMatch(/case 'duplicate':\s*openSlotOp\('duplicate'/);
    expect(src).toMatch(/case 'swap':\s*openSlotOp\('swap'/);
  });

  it('commits the picker through the real editor ops (no re-implementation)', () => {
    const src = read(PANEL);
    expect(src).toMatch(/editor\.duplicateStoredPreset\(/);
    expect(src).toMatch(/editor\.swapStoredPresets\(/);
  });

  it('uses an inline popover, not window.prompt (dead in the Electron shell)', () => {
    const src = read(PANEL);
    expect(src).toMatch(/slotop-pop/);
    expect(src).not.toMatch(/window\.prompt\(/);
  });

  it('renders the honest disabled stubs with their reason as a native tooltip', () => {
    const src = read(CONTEXT_MENU);
    expect(src).toMatch(/title=\{item\.title/);
  });
});
