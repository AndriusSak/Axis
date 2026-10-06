import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createAxisWorkbenchDefaultDocument } from '../axisWorkbenchDefaults';
import { AXIS_PAGE_SCENES, ensureAxisSceneManagerPanel, specForPage } from '../axisWorkbenchPages';

// Parity audit §2.1 — the Scenes page is now the real Scene Manager, not the placeholder. These guards
// pin the wiring (page spec + registry + panel component) and the persisted-document self-heal, because
// the panel itself (.svelte) cannot be mounted in this repo's node-env vitest.

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

describe('Scenes page → Scene Manager wiring', () => {
  it('the Scenes page spec docks the real scene-manager panel type', () => {
    const spec = specForPage(AXIS_PAGE_SCENES);
    expect(spec?.panelId).toBe('axis.scenes');
    expect(spec?.panelType).toBe('axis.sceneManager');
    // No placeholder copy left on the spec.
    expect(spec?.state).toBeUndefined();
  });

  it('the registry manifest declares the scene-manager panel type and the registry maps it', () => {
    const manifest = read('../axisWorkbenchRegistryManifest.ts');
    expect(manifest).toContain("'axis.sceneManager'");
    const registry = read('../axisWorkbenchRegistry.ts');
    expect(registry).toContain('AxisSceneManagerPanel');
    expect(registry).toMatch(/type === 'axis\.sceneManager'\s*\?\s*AxisSceneManagerPanel/);
  });

  it('the nav action opens the real panel, not the placeholder', () => {
    const registry = read('../axisWorkbenchRegistry.ts');
    const action = registry.slice(registry.indexOf("actionId: 'axis.openScenes'"));
    const block = action.slice(0, action.indexOf('})'));
    expect(block).toContain("panelType: 'axis.sceneManager'");
    expect(block).not.toContain('axis.placeholder');
  });

  it('the panel delegates its device work to sceneOps (no inline endpoint logic) and uses the editor store', () => {
    const src = read('../panels/AxisSceneManagerPanel.svelte');
    expect(src).toContain("from '../../sceneOps'");
    // Every device mutation goes through the tested sequences.
    for (const fn of ['scanSceneMatrix', 'applySceneTo', 'swapScenes', 'bulkBypass', 'captureScene', 'sceneCards']) {
      expect(src).toContain(fn);
    }
    expect(src).toContain('editor.selectScene');
    expect(src).toContain('editor.renameScene');
  });
});

describe('ensureAxisSceneManagerPanel self-heal', () => {
  it('retypes a persisted placeholder Scenes panel to the real Scene Manager (and drops its stub state)', () => {
    const doc = createAxisWorkbenchDefaultDocument();
    const layout = Object.values(doc.layouts)[0];
    layout.panels['axis.scenes'] = {
      id: 'axis.scenes',
      type: 'axis.placeholder',
      title: 'Scenes',
      singletonKey: 'axis.scenes',
      state: { glyph: '◪', heading: 'Scenes' }
    };

    ensureAxisSceneManagerPanel(doc);

    const panel = Object.values(doc.layouts)[0].panels['axis.scenes'];
    expect(panel.type).toBe('axis.sceneManager');
    expect(panel.title).toBe('Scene Manager');
    expect(panel.state).toBeUndefined();
  });

  it('leaves an already-migrated panel untouched (idempotent)', () => {
    const doc = createAxisWorkbenchDefaultDocument();
    const before = JSON.stringify(doc.layouts);
    ensureAxisSceneManagerPanel(doc);
    expect(JSON.stringify(doc.layouts)).toBe(before);
  });
});
