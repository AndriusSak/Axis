import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Source-guards for the P16 write-unit fixes. The runes store (editor.svelte.ts) and the .svelte
// component cannot be imported in this repo's node-env vitest, so — like the other *Wiring.sourceguard
// suites — these pin the thin wiring. The actual behaviour of the extracted decisions is proven
// directly in swipeWrite.test.ts / paramWriteDebounce.test.ts; this proves the store USES them.
const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

describe('editor.svelte.ts — swipe + debounce write units', () => {
  const editor = read('./editor.svelte.ts');

  it('routes the swipe decision through the pure planSwipe (no invented 0.5 fallback)', () => {
    expect(editor).toMatch(/import \{ planSwipe \} from '\.\/swipeWrite'/);
    expect(editor).toMatch(/const next = planSwipe\(m\?\.vals\[ctl\.id\], deltaNorm\)/);
    // no reading → refuse: the guard returns before any optimistic write or schedule
    expect(editor).toMatch(/if \(!next \|\| m == null\) return;/);
    // the old and-clauses fallbacks are gone for good
    expect(editor).not.toMatch(/prev\?\.norm \?\? 0\.5/);
    expect(editor).not.toMatch(/\?\?\s*0\.5\)\s*\+\s*deltaNorm/);
  });

  it('does not set p.norm on an UNRESOLVED open-block param (no fabricated position)', () => {
    expect(editor).toMatch(/if \(p && p\.unresolved == null\) p\.norm = next\.norm;/);
  });

  it('debounces continuous writes by BLOCK + param, never by pid alone', () => {
    expect(editor).toMatch(/import \{ ParamWriteDebouncer \} from '\.\/paramWriteDebounce'/);
    // every one of the three continuous write sites keys the block alongside the param
    expect(editor).toMatch(/#writeDebounce\.schedule\(cell\.effectId, ctl\.id, 50/);
    expect(editor).toMatch(/#writeDebounce\.schedule\(effectId, p\.id, 60/);
    expect(editor).toMatch(/#writeDebounce\.schedule\(eid, pid, 60/);
    // the pid-only timer map is gone
    expect(editor).not.toMatch(/#sendTimers/);
  });
});

describe('ModifierEditorCore.svelte — write-unit correctness + no swallowed rejection', () => {
  const src = read('./ModifierEditorCore.svelte');
  // the writeField body (from its signature to the next blank-line-terminated block)
  const body = (src.match(/function writeField\(key: string, ui: number\) \{[\s\S]*?\n  \}/) ?? [''])[0];

  it('writes a bipolar/norm knob on the CONTINUOUS path with ui/100 (never the discrete path)', () => {
    expect(body).toMatch(/void settleWrite\(forgefx\.setParam\(eid, f\.pid, clamp\(ui\) \/ 100, true\), name\)/);
    // the old (ui-50)/50-on-the-discrete-path bug is gone
    expect(body).not.toMatch(/\(clamp\(ui\) - 50\) \/ 50/);
    expect(body).not.toMatch(/, false\)\.catch/);
  });

  it('keeps ordinal/ref fields on the DISCRETE path with an integer', () => {
    expect(body).toMatch(/if \(f\.kind === 'ordinal' \|\| f\.kind === 'ref'\) void settleWrite\(forgefx\.setParam\(eid, f\.pid, Math\.round\(ui\), false\), name\)/);
  });

  it('surfaces the write outcome instead of swallowing it', () => {
    expect(src).toMatch(/import \{ decideWriteOutcome, type WriteSettlement \} from '\.\/paramWriteOutcome'/);
    expect(src).toMatch(/const d = decideWriteOutcome\(outcome, name\)/);
    expect(src).toMatch(/editor\.showToast\(d\.toast\.text, d\.toast\.accent\)/);
    // writeField itself never swallows with .catch(() => {})
    expect(body).not.toMatch(/\.catch\(\(\) => \{\}\)/);
  });

  it('the source-pick fallback write also goes through settleWrite (no silent drop)', () => {
    expect(src).toMatch(/void settleWrite\(forgefx\.setParam\(eid, f\.pid, ordinal, false\), f\.role \?\? 'Source'\)/);
  });
});
