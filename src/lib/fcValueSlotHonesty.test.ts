import { describe, expect, it } from 'vitest';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

// Source guard for the HONESTY half of the FC value-slot wiring (bool / enum / channel), mirroring
// fcBlockNameWiring.test.ts's scanBlockSlotHonesty. Kept as a SIBLING guard rather than folded into
// that scanner because scanBlockSlotHonesty keys on `slot.type === 'block'`; broadening it would make
// one function police two different slot families with two different placeholder sites, and the
// existing positive controls would stop describing the code they check.
//
// WHY: an UNREAD slot value (`curSlot(...) === null` — the read failed or the record is absent) was
// coerced with `?? 0`. For a 'channel' slot option index 0 is labelled with the FIRST channel
// (normally 'A'), so the panel showed a confident, WRONG answer for a value it never read; the bool
// slot rendered an unread value as 'Off' and the enum slot as option 0. The fix renders an explicit,
// DISABLED placeholder ('— no value read') and lets the value fall to the empty string so nothing is
// selected-but-writable.
//
// The guard reddens for THIS file only: the coercion pattern keys on the `curSlot(...)` helper, which
// only FcEditor.svelte uses — the sibling AxisFcPartPanel.svelte reads values through `slotNumber` /
// `readBoolSlot` and never coerces with a numeric `?? <digit>`, so the sibling cannot satisfy it.

const VALUE_SLOT = /slot\.type\s*===\s*'(channel|bool|enum)'/;
/** Every render branch that draws a select for a slot: bool/enum/channel plus the named block picker. */
const SLOT_BRANCH_G = /slot\.type\s*===\s*'(channel|bool|enum|block)'/g;
/** The pre-fix coercion: a value-slot read with a numeric `?? 0` fallback, so an UNREAD value silently
 *  became a real option (channel A / 'Off' / option 0). */
const COERCED_ZERO = /curSlot\([^)]*\)\s*\?\?\s*\d/;
/** The render-site placeholder for a slot value the unit did not supply. */
const UNREAD_PLACEHOLDER = /no value read/;
const UNREAD_PLACEHOLDER_G = /no value read/g;

function svelteFilesUnder(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...svelteFilesUnder(path));
    else if (entry.name.endsWith('.svelte')) out.push(path);
  }
  return out;
}

/** Every value-slot coercion violation under `root` (empty = clean). Exported so the positive control
 *  can run the SAME scanner over a planted-bad tree. */
export function scanValueSlotCoercion(root: string): string[] {
  const violations: string[] = [];
  for (const file of svelteFilesUnder(root)) {
    const src = readFileSync(file, 'utf8');
    if (!VALUE_SLOT.test(src)) continue;
    if (COERCED_ZERO.test(src)) {
      violations.push(
        `${file}: a bool/enum/channel slot coerces its value with \`?? 0\` — an unread value displays as a real option (channel A / Off / option 0)`
      );
    }
  }
  return violations;
}

const SRC_LIB = fileURLToPath(new URL('.', import.meta.url));
const FC_EDITOR = fileURLToPath(new URL('./FcEditor.svelte', import.meta.url));

describe('an UNREAD FC value slot renders an explicit gap, never a coerced option', () => {
  it('no .svelte under src/lib coerces a bool/enum/channel slot value with `?? 0`', () => {
    expect(scanValueSlotCoercion(SRC_LIB)).toEqual([]);
  });

  it('FcEditor.svelte renders a placeholder for EVERY slot-select branch (none silently absent)', () => {
    const src = readFileSync(FC_EDITOR, 'utf8');
    const branches = (src.match(SLOT_BRANCH_G) ?? []).length;
    const placeholders = (src.match(UNREAD_PLACEHOLDER_G) ?? []).length;
    // bool, enum, channel, block — not vacuous.
    expect(branches).toBeGreaterThanOrEqual(4);
    // every slot-select branch carries the unread placeholder; dropping one reddens.
    expect(placeholders).toBeGreaterThanOrEqual(branches);
  });

  it('the scan is not vacuous: a value-slot site actually exists and shows the placeholder', () => {
    const src = readFileSync(FC_EDITOR, 'utf8');
    expect(VALUE_SLOT.test(src)).toBe(true);
    expect(UNREAD_PLACEHOLDER.test(src)).toBe(true);
  });

  it('POSITIVE CONTROL: a planted `?? 0` coercion on a value slot makes the guard FAIL', () => {
    const dir = mkdtempSync(join(tmpdir(), 'fcvalue-guard-'));
    try {
      // The exact shape of the pre-fix channel render site.
      writeFileSync(
        join(dir, 'Bad.svelte'),
        `{#if slot.type === 'channel'}\n` +
          `  <select value={curSlot(side, slot.i) ?? 0} onchange={(e) => writeSlot(side, slot.i, +e.currentTarget.value)}></select>\n` +
          `{/if}\n`
      );
      const violations = scanValueSlotCoercion(dir);
      expect(violations.length).toBeGreaterThan(0);
      expect(violations.join('\n')).toContain('?? 0');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
