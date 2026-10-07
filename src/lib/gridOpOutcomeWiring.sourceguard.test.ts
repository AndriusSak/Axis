import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Grid/routing undo fidelity — the store wiring.
//
// `editor.svelte.ts` is a runes module (`new EditorStore()` with `$state` at module load) and cannot
// be imported in this repo's node-env vitest, so its wiring is pinned by a source scan (the
// established pattern: refusedWrite.sourceguard.test.ts, gridShiftWiring.sourceguard.test.ts).
//
// The defect: the grid/routing ops (`place`, `removeAt`, `move`, `connect`, `replaceShunt`,
// `disconnect`, `#runPlan`) execute discrete writes that return `{ ok: boolean }`, but a device
// refusal is HTTP-200 `{ok:false}` and RESOLVES (forgefx `req()` only throws on non-2xx), so the old
// `for (…) await this.#runOp(op)` + unconditional `history.record*` recorded an undoable step for an
// operation the device never completed. The rule pinned here: every op settles its writes (via the
// shared `#writeSettlement`) and only records history when the pure decision (`gridOpOutcome.ts`)
// says every write landed; a refusal is surfaced instead of a false success toast.
const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

/** Strip comments so a guard cannot be satisfied by commented-out text. */
const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
/** The brace-matched body of the member whose signature starts with `sig` (comments stripped). */
function methodBody(src: string, sig: string): string {
  const i = src.indexOf(sig);
  if (i < 0) throw new Error(`source-guard: member not found: ${sig}`);
  const start = src.indexOf('{', i + sig.length);
  if (start < 0) throw new Error(`source-guard: no body for: ${sig}`);
  let depth = 0;
  for (let j = start; j < src.length; j++) {
    if (src[j] === '{') depth++;
    else if (src[j] === '}') { depth--; if (depth === 0) return src.slice(start, j + 1); }
  }
  return src.slice(start);
}

describe('grid/routing ops — undo fidelity wiring', () => {
  const editor = stripComments(read('./editor.svelte.ts'));

  it('imports the pure grid-op decision module', () => {
    expect(editor).toMatch(/import \{ decideGridOpOutcome \} from '\.\/gridOpOutcome'/);
  });

  it('#runOp returns each write SETTLEMENT (place/remove/cable) instead of discarding it', () => {
    const body = methodBody(editor, "#runOp = async (op: import('./history.svelte').HistoryOp): Promise<WriteSettlement>");
    expect(body).toMatch(/case 'place': return this\.#writeSettlement\(forgefx\.placeCell/);
    expect(body).toMatch(/case 'remove': return this\.#writeSettlement\(forgefx\.clearCell/);
    expect(body).toMatch(/case 'cable': return this\.#writeSettlement\(forgefx\.cable/);
  });

  it('#runOps collects settlements and aborts on a transport error (never finishes a partial step)', () => {
    const body = methodBody(editor, "#runOps = async (ops: import('./history.svelte').HistoryOp[]): Promise<WriteSettlement[]>");
    expect(body).toMatch(/if \(s\.status === 'error'\) break;/);
  });

  it('every grid/routing op settles through decideGridOpOutcome before recording', () => {
    const decisions = editor.match(/decideGridOpOutcome\(/g) ?? [];
    expect(decisions.length).toBeGreaterThanOrEqual(7); // place, removeAt, move, connect, replaceShunt, disconnect, #runPlan
  });

  it('records history ONLY when the pure decision says the op landed', () => {
    // place / disconnect / removeAt are single-write ops; the plans/move are composites
    expect(editor).toMatch(/if \(outcome\.recordHistory\) history\.record\(\{ kind: 'place', row, col, blockId, display \}\)/);
    expect(editor).toMatch(/if \(outcome\.recordHistory\) history\.record\(\{ kind: 'cable', srcRow, srcCol, destRow, connect: false \}\)/);
    expect(editor).toMatch(/if \(outcome\.recordHistory && gone\) history\.record\(\{ kind: 'remove', row, col,/);
    expect(editor).toMatch(/if \(outcome\.recordHistory\) history\.recordComposite\(label, ops\)/);
    const guardedComposite = editor.match(/if \(outcome\.recordHistory\) history\.recordComposite\(plan\.label, plan\.ops\)/g) ?? [];
    expect(guardedComposite.length).toBeGreaterThanOrEqual(3); // connect, replaceShunt, #runPlan
  });

  it('toasts the honest outcome (refusal/partial) instead of a false success', () => {
    // each op falls back to its success wording only when outcome.toast is null (all landed)
    expect(editor).toMatch(/outcome\.toast \? outcome\.toast\.text : 'Connected'/);
    expect(editor).toMatch(/outcome\.toast \? outcome\.toast\.text : 'Moved'/);
    expect(editor).toMatch(/outcome\.toast \? outcome\.toast\.text : 'Connection removed'/);
    expect(editor).toMatch(/outcome\.toast \? outcome\.toast\.text : plan\.label/);
    // removeSelected toasts success only for a removal that landed
    expect(editor).toMatch(/const landed = await this\.removeAt\(c\.row, c\.col\);\s*if \(landed\) this\.showToast\('Block removed'/);
  });

  it('no longer swallows the results of the single-write ops', () => {
    // the old bare awaits that recorded history regardless of the resolved `{ok}`
    expect(editor).not.toMatch(/await forgefx\.placeCell\(this\.#W\(row\), this\.#W\(col\), blockId\);/);
    expect(editor).not.toMatch(/await forgefx\.clearCell\(this\.#W\(row\), this\.#W\(col\)\);/);
    expect(editor).not.toMatch(/await forgefx\.cable\(this\.#W\(srcRow\), this\.#W\(srcCol\), this\.#W\(destRow\), false\);/);
  });
});
