import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// P1.1 source guard — `editor.svelte.ts` is a runes module (`new EditorStore()` with `$state` at
// module load) and cannot be imported in this repo's node-env vitest, so its wiring is pinned by
// source scan (the established pattern: shortcuts.test.ts, modifierReadback.sourceguard.test.ts).
//
// The rule: a device-confirmed discrete write (enum/model, continuous=false) is reject-watched by
// the server and may answer `{ok:false}` (or throw). The store's `setEnum` writes optimistically, so
// it MUST await the write and consult `paramWriteOutcome.settleEnumWrite` to revert the value, drop
// the optimistic history entry and surface the refusal. It must NOT swallow the answer with
// `.catch(() => {})` — the exact swallow that let a refused value stay on screen indefinitely.
//
// The CONTINUOUS knob path stays fire-and-forget BY DESIGN (gen3.ts:1391-1393 — high-frequency
// stream), so this guard also pins that `setParam` keeps its deferred, swallowed send.
const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

describe('refused discrete writes — setEnum wiring', () => {
  const editor = read('./editor.svelte.ts');

  it('imports the pure decision module', () => {
    expect(editor).toMatch(/import \{ settleEnumWrite, type WriteSettlement \} from '\.\/paramWriteOutcome'/);
  });

  it('setEnum is async and awaits the discrete write (continuous=false / AM4 value route)', () => {
    expect(editor).toMatch(/setEnum = async \(e: EnumParam, value: number\)/);
    // the awaited write, on the discrete branch
    expect(editor).toMatch(/await forgefx\.am4SetParamValue\(c\.effectId, e\.id, value\)/);
    expect(editor).toMatch(/await forgefx\.setParam\(c\.effectId, e\.id, value, false\)/);
  });

  it('captures the write outcome (ok → rejected, thrown → error) instead of swallowing it', () => {
    expect(editor).toMatch(/outcome = r\.ok \? \{ status: 'ok' \} : \{ status: 'rejected' \}/);
    expect(editor).toMatch(/outcome = \{ status: 'error' \}/);
  });

  it('applies the decision: revert value, drop the optimistic history entry, toast the refusal', () => {
    expect(editor).toMatch(/dropHistory: \(id\) => history\.drop\(id\)/);
    expect(editor).toMatch(/history\.drop\(/); // the store gained the drop method this calls
    // the order matters: the write result is fed in, not discarded
    expect(editor).toMatch(/settleEnumWrite\(\s*e,\s*from,\s*historyId,\s*outcome/);
  });

  it('no longer swallows the discrete write result', () => {
    // the old defect line: the enum write's promise ended in `.catch(() => {})` with nothing read
    expect(editor).not.toMatch(/forgefx\.setParam\(c\.effectId, e\.id, value, false\)\)\.catch\(\(\) => \{\}\)/);
  });

  it('keeps the CONTINUOUS knob path fire-and-forget (deferred + swallowed, NOT awaited in the send)', () => {
    // setParam's continuous send stays inside a deferred timer whose promise is swallowed
    expect(editor).toMatch(/forgefx\.setParam\(eid, pid, v, true\)\)\.catch\(\(\) => \{\}\)/);
  });
});

describe('refused discrete writes — history drop support', () => {
  const history = read('./history.svelte.ts');

  it('record() returns the entry id so the caller can drop it', () => {
    expect(history).toMatch(/record = \(op: HistoryOp\): string \| null =>/);
  });

  it('exposes a drop(id) that removes a recorded entry and fixes the cursor', () => {
    expect(history).toMatch(/drop = \(id: string \| null\) =>/);
    expect(history).toMatch(/findIndex\(\(e\) => e\.id === id\)/);
  });
});
