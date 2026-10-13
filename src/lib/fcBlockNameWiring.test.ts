import { describe, expect, it } from 'vitest';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

// Source guard for the FC "Effect" block picker wiring, across EVERY .svelte under src/lib.
//
// WHY the scan is repo-wide, not a single file: the naming logic is unit-tested in
// fcBlockOptions.test.ts, but the *binding* — a `'block'`-typed value slot must render the NAMED
// options from the preset's placed blocks, never a bare id — lived in TWO render sites. The first
// (FcEditor.svelte) was fixed and a regex over that file alone then went GREEN while the identification
// defect stayed live in the workbench part panel (AxisFcPartPanel.svelte). A guard pinned to one file
// cannot see the other; this one walks the tree.
//
// It flags two things, either of which is the defect:
//   1. a `.svelte` that detects a `'block'`-typed slot but does NOT route it through the
//      fcBlockOption* helpers, and
//   2. any `.svelte` that renders the literal `(block id)` next to a slot.
// A positive control (a throwaway tree with a bad component) proves the guard fails when it should.

const BLOCK_SLOT = /slot\.type\s*===\s*'block'/;
const BARE_ID = /\(block id\)/;
const NAMED_HELPER = /fcBlockOptionsIncluding/;
/** The render-site placeholder for a block value the unit did not supply. */
const UNREAD_GAP = /no value read/;
/** The pre-fix coercion: the block value read with a `?? 0` (or any numeric) fallback, so an UNREAD
 *  value silently became block 0 and was displayed as "the first block's name". */
const COERCED_ZERO = /blockVal\s*=\s*[^;\n]*\?\?\s*\d/;

function svelteFilesUnder(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...svelteFilesUnder(path));
    else if (entry.name.endsWith('.svelte')) out.push(path);
  }
  return out;
}

/** Every block-slot wiring violation under `root` (empty = clean). Exported so the positive control
 *  can run the SAME scanner over a planted-bad tree. */
export function scanBlockSlotRouting(root: string): string[] {
  const violations: string[] = [];
  for (const file of svelteFilesUnder(root)) {
    const src = readFileSync(file, 'utf8');
    if (BARE_ID.test(src)) {
      violations.push(`${file}: renders a bare "(block id)" instead of a block name`);
    }
    if (BLOCK_SLOT.test(src) && !NAMED_HELPER.test(src)) {
      violations.push(`${file}: detects a 'block' slot but does not route it through the fcBlockOption* helpers`);
    }
  }
  return violations;
}

/**
 * The HONESTY half of the same wiring: a block-typed site must render an UNKNOWN/unread value as an
 * explicit gap, never as another block's name. Two ways it can regress without tripping the routing
 * check above:
 *   1. the value is read with a `?? 0` fallback, so "unread" becomes the real block 0; and
 *   2. the explicit placeholder for the unread case is dropped.
 * Exported so the positive control runs the SAME scanner over a planted-bad tree.
 */
export function scanBlockSlotHonesty(root: string): string[] {
  const violations: string[] = [];
  for (const file of svelteFilesUnder(root)) {
    const src = readFileSync(file, 'utf8');
    if (!BLOCK_SLOT.test(src)) continue;
    if (COERCED_ZERO.test(src)) {
      violations.push(`${file}: a 'block' slot coerces its value with \`?? 0\` — an unread block displays as block 0`);
    }
    if (!UNREAD_GAP.test(src)) {
      violations.push(`${file}: a 'block' slot has no explicit placeholder for an unread value`);
    }
  }
  return violations;
}

const SRC_LIB = fileURLToPath(new URL('.', import.meta.url));

describe('every FC block-typed value slot is named, not a bare block id', () => {
  it('no .svelte under src/lib renders a bare "(block id)" or an unrouted block slot', () => {
    expect(scanBlockSlotRouting(SRC_LIB)).toEqual([]);
  });

  it('the router helper still exists and is imported where a block slot is detected', () => {
    // a negated sanity check: the scan is not vacuously empty because nothing matches BLOCK_SLOT
    const sites = svelteFilesUnder(SRC_LIB).filter((f) => BLOCK_SLOT.test(readFileSync(f, 'utf8')));
    expect(sites.length).toBeGreaterThan(0);
    for (const f of sites) expect(readFileSync(f, 'utf8')).toMatch(NAMED_HELPER);
  });

  it('POSITIVE CONTROL: a planted bare "(block id)" component makes the guard FAIL', () => {
    const dir = mkdtempSync(join(tmpdir(), 'fcblock-guard-'));
    try {
      // The exact shape of the pre-fix panel render site.
      writeFileSync(
        join(dir, 'Bad.svelte'),
        `<span>{slot.role}{slot.type === 'block' ? ' (block id)' : ''}</span>\n`
      );
      const violations = scanBlockSlotRouting(dir);
      expect(violations.length).toBeGreaterThan(0);
      expect(violations.join('\n')).toContain('(block id)');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('an UNKNOWN block value renders an explicit gap, never another block’s name', () => {
  it('every block-slot site reads the value uncoerced and renders the unread placeholder', () => {
    expect(scanBlockSlotHonesty(SRC_LIB)).toEqual([]);
  });

  it('the scan is not vacuous: it actually sees the block-slot sites', () => {
    const sites = svelteFilesUnder(SRC_LIB).filter((f) => BLOCK_SLOT.test(readFileSync(f, 'utf8')));
    expect(sites.length).toBeGreaterThan(0);
  });

  it('POSITIVE CONTROL: a planted `?? 0` coercion makes the honesty guard FAIL', () => {
    const dir = mkdtempSync(join(tmpdir(), 'fcblock-honesty-'));
    try {
      // The exact shape of the pre-fix panel: the value read WITH a `?? 0` fallback.
      writeFileSync(
        join(dir, 'Bad.svelte'),
        `{#if slot.type === 'block'}\n` +
          `  {@const blockVal = curSlot(side, slot.i) ?? 0}\n` +
          `  <span>{blockVal}</span>\n` +
          `{/if}\n`
      );
      const violations = scanBlockSlotHonesty(dir);
      expect(violations.join('\n')).toContain('?? 0');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('POSITIVE CONTROL: dropping the unread placeholder makes the honesty guard FAIL', () => {
    const dir = mkdtempSync(join(tmpdir(), 'fcblock-honesty2-'));
    try {
      writeFileSync(
        join(dir, 'Bad.svelte'),
        `{#if slot.type === 'block'}{@const blockVal = curSlot(side, slot.i) ?? null}<span>{blockVal}</span>{/if}\n`
      );
      const violations = scanBlockSlotHonesty(dir);
      expect(violations.join('\n')).toContain('no explicit placeholder');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
