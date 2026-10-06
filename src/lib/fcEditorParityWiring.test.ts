import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Source guard for the §3.8 FC parity wiring. FcEditor.svelte mounts only in a real browser (runic
// $state, DOM file input), so the logic is unit-tested in fcParity.test.ts / fcLayoutPackage.test.ts
// and these guards pin the thin bindings so a refactor can't silently unwire the panel, the import/
// export actions, or the honest gating of the features the device does not serve.
const src = readFileSync(fileURLToPath(new URL('./FcEditor.svelte', import.meta.url)), 'utf8');

describe('FC editor §3.8 parity wiring', () => {
  it('imports the parity + layout-package modules', () => {
    expect(src).toMatch(/from '\.\/axis-workbench\/fc\/fcParity'/);
    expect(src).toMatch(/axisFcParity/);
    expect(src).toMatch(/from '\.\/axis-workbench\/fc\/fcLayoutPackage'/);
    expect(src).toMatch(/buildAxisFcLayoutPackage/);
    expect(src).toMatch(/serializeAxisFcLayoutPackage/);
    expect(src).toMatch(/parseAxisFcLayoutPackage/);
    expect(src).toMatch(/axisFcLayoutPackageWrites/);
  });

  it('derives the feature list from the served model and renders it', () => {
    expect(src).toMatch(/axisFcParity\(model\)/);
    expect(src).toMatch(/\{@render parityPanel\(\)\}/);
    // the parity row shows the honest status + reason, not a fabricated control
    expect(src).toMatch(/f\.status/);
    expect(src).toMatch(/f\.detail/);
  });

  it('wires export (live read-back) and import (validated parse → remapped writes)', () => {
    // export reads every view's switches on a live device before building the package
    expect(src).toMatch(/forgefx\.fcState\(layout, v, i\)/);
    expect(src).toMatch(/buildAxisFcLayoutPackage\(\{/);
    // import validates before writing and remaps configs into the selected layout
    expect(src).toMatch(/parseAxisFcLayoutPackage\(await file\.text\(\)\)/);
    expect(src).toMatch(/axisFcLayoutPackageWrites\(res\.pkg, layout, model\)/);
    expect(src).toMatch(/forgefx\.setParam\(model\.effectId, pidOf\(w\.field, w\.config, w\.index\)/);
  });

  it('gates import/export behind the served geometry', () => {
    expect(src).toMatch(/importExportReady/);
    expect(src).toMatch(/disabled=\{ioBusy \|\| !importExportReady\}/);
  });

  it('hints the two device-true categories that map to Layout Links / Per-Preset', () => {
    expect(src).toMatch(/AXIS_FC_LAYOUT_CATEGORY/);
    expect(src).toMatch(/AXIS_FC_PER_PRESET_CATEGORY/);
    expect(src).toMatch(/categoryNote\(side\)/);
  });
});
