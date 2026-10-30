import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Source guards for Manage Cabs: node-env vitest cannot mount .svelte, so — like cabMoveWiring — these pin
// the bindings that carry the honesty rules (no names off the unit, the cap and scope disclosed, the
// unvalidated gate, the unit's own verdict) and the browser-safety of the codec import.
const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

describe('Manage Cabs wiring', () => {
  const ui = read('./CabManager.svelte');
  const ops = read('./cabManagerOps.ts');
  const imp = read('./cabImport.ts');

  it('the pure modules import no runes, DOM or network layer', () => {
    for (const src of [ops, imp]) {
      expect(src).not.toMatch(/\$state|\$derived|\$effect/);
      expect(src).not.toMatch(/from '\.\/forgefx'|from '\.\/editor/);
      expect(src).not.toMatch(/\bdocument\.|\bwindow\./);
    }
  });

  it('the codec is imported from the self-contained subpath only — never the barrel', () => {
    expect(imp).toContain("from 'forgefx-midi/devices/gen3/cabIrConvert'");
    expect(imp).not.toMatch(/from 'forgefx-midi'/);
    expect(imp).not.toMatch(/from 'forgefx-midi\/devices\/gen3'/);
    expect(ui).not.toMatch(/from 'forgefx-midi/);
  });

  it('the grid is driven by GET /cab/slots one 128-slot bank at a time, and discloses that cap', () => {
    expect(ui).toMatch(/forgefx\.cabSlots\(\{ page: b\.page, from: 0, to: 127 \}\)/);
    expect(ui).toContain('CAB_GRID_DISCLOSURE');
    expect(ui).toContain('data-testid="cab-coverage"');
  });

  it('the slot name read off the unit is never rendered (only populated/empty state)', () => {
    expect(ui).not.toMatch(/\.nameRegion/);
    expect(ui).not.toMatch(/row\.name|r\.name|\.decodedName/);
  });

  it('the library scope line is rendered from the server response with the fallback constant', () => {
    expect(ui).toMatch(/library\?\.scope \?\? CAB_LIBRARY_SCOPE_FALLBACK/);
    expect(ops).toContain('IRs uploaded through Axis');
  });

  it('a converted import needs an explicit unvalidated acknowledgement before Upload is enabled', () => {
    expect(ui).toMatch(/staged\.kind !== 'wav' \|\| ackUnvalidated/);
    expect(ui).toContain('CAB_CONVERSION_UNVALIDATED_BADGE');
    expect(ui).toMatch(/the unit ACCEPTS these bytes and the slot reads POPULATED/);
  });

  it('every write goes through uploadAndVerify / runMove / runClear / runRename (the unit-verdict path)', () => {
    expect(ui).toMatch(/uploadAndVerify\(io, staged\.container, user\)/);
    expect(ui).toMatch(/runMove\(movePlan\.runnable, io\)/);
    expect(ui).toMatch(/runClear\(clearPlan\.users, io\)/);
    expect(ui).toMatch(/runRename\(bytes, renameSlot\.user, renameTo, io, rewriteName, held\)/);
    // the only network calls in the component are the three existing cab routes + the read-only library
    expect(ui.match(/forgefx\.\w+/g)!.filter((v, i, a) => a.indexOf(v) === i).sort()).toEqual(
      ['forgefx.cabLibrary', 'forgefx.cabLibraryBytes', 'forgefx.cabSlots', 'forgefx.clearCabSlot', 'forgefx.uploadCabIr']
    );
  });

  it('disabled controls surface their reason in the title AND as visible text (no-dead-nav rule)', () => {
    expect(ui).toMatch(/title=\{actions\.rename\.reason\}/);
    expect(ui).toContain('data-testid="cab-disabled-reasons"');
    expect(ui).toMatch(/title=\{f\.reason\}/); // unavailable output formats
  });

  it('destructive actions need an explicit confirm and use no window.confirm', () => {
    expect(ui).not.toMatch(/\bconfirm\(/);
    // the four panels (clear/move/rename/import) share the single `confirmed` flag
    expect((ui.match(/bind:checked=\{confirmed\}/g) ?? []).length).toBeGreaterThanOrEqual(4);
  });

  it('Restore carries its OWN confirm gate, and doRestore must consult it (#9)', () => {
    // the per-entry confirm binding exists in the markup…
    expect(ui).toMatch(/bind:checked=\{restoreConfirmed\[[^\]]+\]\}/);
    // …and the destructive sequencer it arms is scoped, so no other function can satisfy the guard.
    const doRestore = ui.match(/async function doRestore\([\s\S]*?\n  \}/)?.[0] ?? '';
    expect(doRestore).not.toBe('');
    expect(doRestore).toMatch(/if \(!restoreArmed\(e\)\) return;/);
  });

  it('every destination write is three-state (populated / empty / UNKNOWN), never a bare boolean (#10)', () => {
    // the warning helper is used for move, import and restore destinations
    expect(ui).toMatch(/destWarning\(it\.destState, it\.to\)/);
    expect(ui).toMatch(/destWarning\(destState, Number\(importDest\)\)/);
    expect(ui).toMatch(/destWarning\(restoreDestState\(e\), Number\(destFor\(e\)\)\)/);
    // the boolean "is the destination populated?" shortcut is gone
    expect(ui).not.toMatch(/destPopulated/);
    expect(ops).toMatch(/export type DestState = 'populated' \| 'empty' \| 'unknown'/);
    // the refusal is real: an unscanned destination warns rather than reporting "not populated"
    expect(ops).toMatch(/has not been scanned — it may hold an IR/);
  });
});
