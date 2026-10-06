import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createAxisWorkbenchDefaultDocument } from '../axisWorkbenchDefaults';
import { AXIS_PAGE_LIVE, ensureAxisLivePanel, specForPage } from '../axisWorkbenchPages';

// Parity audit §2.2 — the Live page is now the real Performance / Live page, not the placeholder.
// These guards pin the wiring (page spec + registry + panel component) and the persisted-document
// self-heal, because the panel itself (.svelte) cannot be mounted in this repo's node-env vitest.

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

describe('Live page → Performance panel wiring', () => {
  it('the Live page spec docks the real live panel type (no placeholder state)', () => {
    const spec = specForPage(AXIS_PAGE_LIVE);
    expect(spec?.panelId).toBe('axis.live');
    expect(spec?.panelType).toBe('axis.live');
    expect(spec?.state).toBeUndefined();
  });

  it('the registry manifest declares the live panel type and the registry maps it', () => {
    const manifest = read('../axisWorkbenchRegistryManifest.ts');
    expect(manifest).toContain("'axis.live'");
    const registry = read('../axisWorkbenchRegistry.ts');
    expect(registry).toContain('AxisLivePanel');
    expect(registry).toMatch(/type === 'axis\.live'\s*\?\s*AxisLivePanel/);
  });

  it('the nav action opens the real panel, not the placeholder', () => {
    const registry = read('../axisWorkbenchRegistry.ts');
    const action = registry.slice(registry.indexOf("actionId: 'axis.openLive'"));
    const block = action.slice(0, action.indexOf('})'));
    expect(block).toContain("panelType: 'axis.live'");
    expect(block).not.toContain('axis.placeholder');
  });

  it('the panel delegates its page model to performancePage (no inline persistence) and wires the editor store', () => {
    const src = read('../panels/AxisLivePanel.svelte');
    expect(src).toContain("from '../../performancePage'");
    for (const fn of ['loadPerformancePage', 'savePerformancePage', 'addPerformanceBinding', 'removePerformanceBinding', 'movePerformanceBinding', 'bindingsFromParams']) {
      expect(src).toContain(fn);
    }
    // Quick access: scenes / presets / tuner / tempo.
    expect(src).toContain('editor.selectScene');
    expect(src).toContain('editor.stepPreset');
    expect(src).toContain('editor.toggleTuner');
    expect(src).toContain('editor.tapTempo');
  });

  it('the panel states the page is stored locally and makes NO device-persistence claim', () => {
    const src = read('../panels/AxisLivePanel.svelte');
    expect(src.toLowerCase()).toContain('stored locally');
    expect(src.toLowerCase()).toContain('not written to the fm3');
  });

  it('the tile resolves its block by family and writes through the pinned-control path', () => {
    const src = read('../panels/PerformanceTile.svelte');
    expect(src).toContain('resolvePerformanceEffectId');
    expect(src).toContain('editor.registerPinnedBlock');
    expect(src).toContain('editor.setPinnedParam');
    expect(src).toContain('editor.setPinnedEnum');
  });
});

describe('ensureAxisLivePanel self-heal', () => {
  it('retypes a persisted placeholder Live panel to the real live panel (and drops its stub state)', () => {
    const doc = createAxisWorkbenchDefaultDocument();
    const layout = Object.values(doc.layouts)[0];
    layout.panels['axis.live'] = {
      id: 'axis.live',
      type: 'axis.placeholder',
      title: 'Live',
      singletonKey: 'axis.live',
      state: { glyph: '⏺', heading: 'Live' }
    };

    ensureAxisLivePanel(doc);

    const panel = Object.values(doc.layouts)[0].panels['axis.live'];
    expect(panel.type).toBe('axis.live');
    expect(panel.title).toBe('Live');
    expect(panel.state).toBeUndefined();
  });

  it('leaves an already-migrated panel untouched (idempotent)', () => {
    const doc = createAxisWorkbenchDefaultDocument();
    const before = JSON.stringify(doc.layouts);
    ensureAxisLivePanel(doc);
    expect(JSON.stringify(doc.layouts)).toBe(before);
  });
});
