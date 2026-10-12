import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// SOURCE GUARD for Finder #1 on the FC workbench part panel.
//
// The panel is a .svelte component vitest cannot mount, so the WRITE-REFUSAL behaviour is pinned
// where it is testable:
//   • unit-tested end-to-end in fcSlotEdit.test.ts (a spy writer proves the write is never called
//     while the value is unread);
//   • wired here, against the real component source, so the panel cannot silently go back to
//     reading `?? 0` and writing a delta from the guess.
//
// Every assertion below FAILS on the pre-fix panel (which read `?? 0`, defaulted the slot fallback
// to 0, and flipped `slotNumber(...) === 1 ? 0 : 1`).
const panelPath = fileURLToPath(new URL('../panels/fc/AxisFcPartPanel.svelte', import.meta.url));
const panel = readFileSync(panelPath, 'utf8');

describe('AxisFcPartPanel routes unread values through the refusal helpers', () => {
  it('imports the unread-safe read + apply helpers (no local `?? 0`)', () => {
    expect(panel).toMatch(/from '\.\.\/\.\.\/fc\/fcSlotEdit'/);
    expect(panel).toMatch(/applySlotStep/);
    expect(panel).toMatch(/applyBoolToggle/);
    expect(panel).toMatch(/readSlotValue|slotNumber/);
  });

  it('fieldNumber / slotNumber do NOT fabricate a 0 fallback', () => {
    // the pre-fix fieldNumber: `return Number(runtimeSnapshot.edits[`${field}:${cfg}`] ?? 0);`
    expect(panel).not.toMatch(/function fieldNumber\([^)]*\)[^]*?return Number\([^;]*\?\?\s*0\)/);
    // the pre-fix slotNumber: `function slotNumber(side, slotIndex, fallback = 0)`
    expect(panel).not.toMatch(/function slotNumber\([^)]*fallback\s*=\s*0/);
    expect(panel).not.toMatch(/function slotNumber\([^)]*\)[^]*?return Number\([^;]*\?\?\s*fallback\)/);
  });

  it('the bool pill never writes a value computed from a fabricated "off"', () => {
    // the pre-fix toggle: `writeSlot(..., slotNumber(which, slot.i) === 1 ? 0 : 1, ...)`
    expect(panel).not.toMatch(/slotNumber\([^)]*\)\s*===\s*1\s*\?\s*0\s*:\s*1/);
    // and the pill's click goes through the refusing wrapper
    expect(panel).toMatch(/applyBoolToggle\(/);
    // the pill is disabled while the slot is unread
    expect(panel).toMatch(/disabled=\{bool\w*\s*==\s*null\}/);
  });

  it('the stepper writes through applySlotStep and is disabled while unread', () => {
    expect(panel).toMatch(/applySlotStep\(/);
    expect(panel).toMatch(/function stepSlot\([^)]*\)[^]*?applySlotStep\(/);
    // an explicit unread marker replaces the guessed value; the step buttons are disabled
    expect(panel).toMatch(/FC_UNREAD_MARKER|'—'/);
    expect(panel).toMatch(/disabled=\{unread\b/);
  });
});
