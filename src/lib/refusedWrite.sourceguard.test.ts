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

/** Strip line + block comments so a guard cannot be satisfied (or defeated) by commented-out text. */
const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');

/**
 * The body `{ … }` of the member whose signature starts with `sig` (brace-matched, comments already
 * stripped). Scoping a positive check to the method that must contain it means a COMMENT or an
 * unrelated (dead) method elsewhere in the file can no longer satisfy the guard — the weakness the
 * whole-file scan had. `sig` must end before the body's opening brace (include a trailing `=>` when
 * the member is an arrow property, so a `{` inside its return type is not mistaken for the body).
 */
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

describe('refused discrete writes — setEnum wiring', () => {
  const editor = stripComments(read('./editor.svelte.ts'));

  it('imports the pure decision module', () => {
    expect(editor).toMatch(/import \{ beginWrite, settleEnumWrite, settleScalarWrite, settleWriteSet, type WriteSettlement, type WriteSetReport \} from '\.\/paramWriteOutcome'/);
  });

  it('setEnum is async and awaits the discrete write (continuous=false)', () => {
    expect(editor).toMatch(/setEnum = async \(e: EnumParam, value: number\)/);
    // SCOPED to setEnum's own body — a comment or a dead method elsewhere cannot satisfy it.
    const body = methodBody(editor, 'setEnum = async (e: EnumParam, value: number)');
    expect(body).toMatch(/forgefx\.setParam\(c\.effectId, e\.id, value, false\)/);
    expect(body).toMatch(/const outcome = await this\.#writeSettlement\(/);
    // …and the discrete write is NOT swallowed inside setEnum (the exact old defect, any wording).
    expect(body).not.toMatch(/\.catch\(\(\) => \{\}\)/);
  });

  it('captures the write outcome (ok → rejected, thrown → error) via the shared wrapper, not by swallowing it', () => {
    // #writeSettlement is the single place the settlement is derived; the check is scoped to its body.
    const body = methodBody(editor, '#writeSettlement = async (p: Promise<{ ok: boolean }>): Promise<WriteSettlement> =>');
    expect(body).toMatch(/try \{\s*const r = await p;\s*return r\.ok \? \{ status: 'ok' \} : \{ status: 'rejected' \}/);
    expect(body).toMatch(/return \{ status: 'error' \}/);
  });

  it('applies the decision: revert value, drop the optimistic history entry, toast the refusal', () => {
    expect(editor).toMatch(/dropHistory: \(id\) => history\.drop\(id\)/);
    expect(editor).toMatch(/history\.drop\(/); // the store gained the drop method this calls
    // the order matters: the write result is fed in (with the write-initiation token for the stale guard), not discarded
    expect(editor).toMatch(/settleEnumWrite\(\s*e,\s*token,\s*value,\s*historyId,\s*outcome/);
  });

  it('no longer swallows the discrete write result', () => {
    // the old defect line: the enum write's promise ended in `.catch(() => {})` with nothing read
    expect(editor).not.toMatch(/forgefx\.setParam\(c\.effectId, e\.id, value, false\)\)\.catch\(\(\) => \{\}\)/);
  });

  it('keeps the CONTINUOUS knob path fire-and-forget (deferred + swallowed, NOT awaited in the send)', () => {
    // setParam's continuous send stays inside a deferred timer whose promise is swallowed
    const body = methodBody(editor, 'setParam = (p: NamedParam, v: number)');
    expect(body).toMatch(/forgefx\.setParam\(eid, pid, v, true\)\.catch\(\(\) => \{\}\)/);
  });
});

// P2.1 leftover — `setPinnedEnum` is the SAME defect class as P1.1's setEnum: a single DISCRETE
// (continuous=false) pinned write shown optimistically while its result was swallowed with
// `.catch(() => {})`. The device reject-watches a discrete write, so a refused value stayed on the
// pinned tile indefinitely. It must mirror setEnum: await → outcome → `settleEnumWrite` (revert the
// value, drop the optimistic history entry, toast the refusal). The pinned CONTINUOUS write
// (`setPinnedParam`) stays fire-and-forget BY DESIGN, exactly like `setParam`, and is pinned here.
describe('refused discrete writes — setPinnedEnum wiring (P2.1 leftover)', () => {
  const editor = stripComments(read('./editor.svelte.ts'));

  it('setPinnedEnum is async and awaits the discrete write (continuous=false) via the shared wrapper', () => {
    expect(editor).toMatch(/setPinnedEnum = async \(effectId: number, e: EnumParam, value: number\)/);
    const body = methodBody(editor, 'setPinnedEnum = async (effectId: number, e: EnumParam, value: number)');
    expect(body).toMatch(/const outcome = await this\.#writeSettlement\(forgefx\.setParam\(effectId, e\.id, value, false\)\)/);
    expect(body).not.toMatch(/\.catch\(\(\) => \{\}\)/); // the pinned discrete write is not swallowed
  });

  it('captures the pinned write outcome (ok → rejected, thrown → error) via the shared wrapper', () => {
    // the pinned branch feeds the same settlement shape the setEnum branch does
    expect(editor).toMatch(/#writeSettlement = async \(p: Promise<\{ ok: boolean \}>\): Promise<WriteSettlement>/);
    expect(editor).toMatch(/return r\.ok \? \{ status: 'ok' \} : \{ status: 'rejected' \}/);
    expect(editor).toMatch(/return \{ status: 'error' \}/);
  });

  it('applies the decision on the pinned enum: revert, drop history, toast', () => {
    expect(editor).toMatch(/settleEnumWrite\(\s*e,\s*token,\s*value,\s*historyId,\s*outcome/);
    expect(editor).toMatch(/dropHistory: \(id\) => history\.drop\(id\)/);
  });

  it('no longer swallows the pinned discrete write result', () => {
    expect(editor).not.toMatch(/forgefx\.setParam\(effectId, e\.id, value, false\)\.catch\(\(\) => \{\}\)/);
  });

  it('keeps the pinned CONTINUOUS knob path fire-and-forget BY DESIGN', () => {
    const body = methodBody(editor, 'setPinnedParam = (effectId: number, p: NamedParam, v: number)');
    expect(body).toMatch(/forgefx\.setParam\(effectId, p\.id as number, v, true\)\.catch\(\(\) => \{\}\)/);
  });
});

describe('refused discrete writes — history drop support', () => {
  const history = stripComments(read('./history.svelte.ts'));

  it('record() returns the entry id so the caller can drop it', () => {
    expect(history).toMatch(/record = \(op: HistoryOp\): string \| null =>/);
  });

  it('exposes a drop(id) that removes a recorded entry and fixes the cursor', () => {
    expect(history).toMatch(/drop = \(id: string \| null\) =>/);
    expect(history).toMatch(/findIndex\(\(e\) => e\.id === id\)/);
  });
});

// P2.1 — a SET of writes (paste / recall / cab apply) reports what LANDED, not what was requested.
// The old idiom `for (const w of writes) await forgefx.setParam(...).catch(() => {})` then an
// unconditional `showToast(\`… ${writes.length} …\`)` over an already-fired history.checkpoint is
// gone: every batch site now captures each write's settlement and routes it through
// `paramWriteOutcome.settleWriteSet`, and only checkpoints when something actually landed.
describe('write-set reporting — paste/recall/cab wiring (P2.1)', () => {
  const editor = stripComments(read('./editor.svelte.ts'));

  it('imports the pure write-set aggregation', () => {
    expect(editor).toMatch(
      /import \{ beginWrite, settleEnumWrite, settleScalarWrite, settleWriteSet, type WriteSettlement, type WriteSetReport \} from '\.\/paramWriteOutcome'/
    );
  });

  it('captures each write settlement instead of swallowing it (one private helper)', () => {
    expect(editor).toMatch(/#writeSettlement = async \(p: Promise<\{ ok: boolean \}>\): Promise<WriteSettlement>/);
    expect(editor).toMatch(/return r\.ok \? \{ status: 'ok' \} : \{ status: 'rejected' \}/);
    expect(editor).toMatch(/return \{ status: 'error' \}/);
    // fed by every batch site: pasteChannel, applyCab, #applyClip (type+named+enums+channel), recall
    const feeds = editor.match(/this\.#writeSettlement\(/g) ?? [];
    expect(feeds.length).toBeGreaterThanOrEqual(8);
  });

  it('routes pasteChannel / applyCab / recall results through settleWriteSet', () => {
    expect(editor).toMatch(/settleWriteSet\(results, \{ subject: `Pasted channel \$\{clip\.channel/);
    expect(editor).toMatch(/settleWriteSet\(results, \{ subject: `\$\{c\.display\} cab changed`, successToast: false \}\)/);
    expect(editor).toMatch(/settleWriteSet\(results, \{ subject: `Recalled “\$\{entry\.name\}”`, noun: 'setting' \}\)/);
  });

  it('#applyClip returns a WriteSetReport (model type + params + channel = one write set)', () => {
    expect(editor).toMatch(/#applyClip = async \(eid: number, clip: BlockClipboard, subject: string\): Promise<WriteSetReport>/);
    expect(editor).toMatch(/return settleWriteSet\(results, \{ subject, noun: 'setting', successToast: false \}\)/);
  });

  it('checkpoints ONLY when a write actually landed', () => {
    expect(editor).toMatch(/if \(report\.checkpoint\) history\.checkpoint\(`Pasted channel/);
    expect(editor).toMatch(/if \(report\.checkpoint\) history\.checkpoint\(`Recalled/);
    expect(editor).toMatch(/if \(r\.checkpoint\) history\.checkpoint\(`Pasted settings onto/);
    expect(editor).toMatch(/if \(r\.checkpoint\) history\.checkpoint\(`Pasted \$\{clip\.display\} settings/);
  });

  it('toasts the helper outcome, not the requested count', () => {
    expect(editor).toMatch(/if \(report\.toast\) this\.showToast\(report\.toast\.text, report\.toast\.accent\)/);
    // the old "requested as landed" lines are gone
    expect(editor).not.toMatch(/Pasted \$\{writes\.length\} values from channel/);
    expect(editor).not.toMatch(/Recalled “\$\{entry\.name\}” — \$\{writes\.length\} values/);
  });

  it('no longer swallows the batch writes', () => {
    // pasteChannel / recallBlockEntry batch loops (identical old line)
    expect(editor).not.toMatch(
      /for \(const w of writes\) await forgefx\.setParam\(c\.effectId, w\.paramId, w\.value, w\.continuous\)\.catch\(\(\) => \{\}\)/
    );
    // applyCab loop
    expect(editor).not.toMatch(
      /for \(const w of writes\) await forgefx\.setParam\(c\.effectId, w\.paramId, w\.value, false\)\.catch\(\(\) => \{\}\)/
    );
    // #applyClip's four swallowed writes
    expect(editor).not.toMatch(/if \(clip\.type\) await forgefx\.setType\(eid, clip\.type\.value\)\.catch\(\(\) => \{\}\)/);
    expect(editor).not.toMatch(
      /for \(const p of clip\.named\) if \(p\.id != null\) await forgefx\.setParam\(eid, p\.id, p\.norm \?\? 0, true\)\.catch\(\(\) => \{\}\)/
    );
    expect(editor).not.toMatch(/if \(clip\.channel\) await forgefx\.setChannel\(eid, clip\.channel\)\.catch\(\(\) => \{\}\)/);
    // recallBlockEntry's swallowed setType
    expect(editor).not.toMatch(/if \(entry\.type\) await forgefx\.setType\(c\.effectId, entry\.type\.value\)\.catch\(\(\) => \{\}\)/);
  });
});

// P4 follow-ups — setBpm / toggleTuner: a device-REFUSED SCALAR (tempo / tuner) write must not stay
// on screen. Both write optimistically BEFORE the round-trip and both used to swallow the answer —
// `setBpm` ended in `.catch(() => {})` with no revert at all (a refused tempo stayed displayed), and
// `toggleTuner` reverted only in its `.catch` (a THROW), so an HTTP-200 `{ok:false}` refusal survived
// on screen, silently. Both now AWAIT the write, capture the settlement (ok → rejected, throw →
// error) and route it through the pure `paramWriteOutcome.settleScalarWrite` (revert to the captured
// `from` + toast the refusal), exactly as the discrete-write helpers do.
//
// `tapTempo` stays fire-and-forget BY DESIGN — it is NOT an optimistic value write: the tap POST is a
// device gesture we do not predict, and the code PULLS the resulting tempo back from the device
// (`getTempo`), so the displayed bpm reflects reality rather than a swallowed local guess. It must
// keep re-reading; this guard pins that.
describe('refused scalar writes — setBpm / toggleTuner wiring (P4 follow-ups)', () => {
  const editor = stripComments(read('./editor.svelte.ts'));

  it('imports the pure scalar decision', () => {
    expect(editor).toMatch(
      /import \{ beginWrite, settleEnumWrite, settleScalarWrite, settleWriteSet, type WriteSettlement, type WriteSetReport \} from '\.\/paramWriteOutcome'/
    );
  });

  it('setBpm captures the tempo outcome (ok → rejected, thrown → error) instead of swallowing it', () => {
    expect(editor).toMatch(
      /const r = await forgefx\.setTempo\(n\);\s*outcome = r\.ok \? \{ status: 'ok' \} : \{ status: 'rejected' \}/
    );
    expect(editor).toMatch(/settleScalarWrite\(\{ get: \(\) => this\.bpm, set: \(v\) => \(this\.bpm = v\) \}, token, n, outcome/);
    // the old silent swallow + no-revert line is gone
    expect(editor).not.toMatch(/await forgefx\.setTempo\(n\)\.catch\(\(\) => \{\}\)/);
  });

  it('toggleTuner honours {ok:false}, not just thrown errors', () => {
    expect(editor).toMatch(
      /const r = await forgefx\.setTuner\(next\);\s*outcome = r\.ok \? \{ status: 'ok' \} : \{ status: 'rejected' \}/
    );
    expect(editor).toMatch(/settleScalarWrite\(\{ get: \(\) => this\.tuner\.active, set: \(v\) => \(this\.tuner = \{ active: v \}\) \}, token, next, outcome/);
    // the throw-only catch that ignored {ok:false} is gone
    expect(editor).not.toMatch(/forgefx\.setTuner\(next\)\.catch\(/);
  });

  it('tapTempo stays fire-and-forget BY DESIGN but re-reads the tempo so its value reflects reality', () => {
    // the tap POST itself is fire-and-forget (a device gesture, not a value we write)…
    expect(editor).toMatch(/await forgefx\.tapTempo\(\)\.catch\(\(\) => \{\}\)/);
    // …but the bpm shown afterwards is PULLED FROM THE DEVICE, not a swallowed local guess
    expect(editor).toMatch(/this\.bpm = \(await forgefx\.getTempo\(\)\)\.bpm/);
  });
});

// The Opus A/B (2026-10-07) sweep — the same optimistic-write class at the sites P4 left unfixed:
// setEnum set the optimistic value BEFORE its guard; toggleBypass/setChannel/selectScene ignored a
// 200 {ok:false} with a throw-only catch (and toggleBypass toasted a success that may not have
// happened); retype false-succeeded on a refusal; and save()'s post-save poll shared the save try
// (a poll error toasted 'Save failed' after 'Saved to preset N'). All now route their discrete-write
// outcome through paramWriteOutcome's settlements.
describe('optimistic-write sweep — guard/settle/retype/save wiring (Opus A/B)', () => {
  const editor = stripComments(read('./editor.svelte.ts'));

  it('setEnum guards BEFORE the optimistic write (an unsent value must not stay on screen)', () => {
    // Scoped to setEnum's own body (was a 600-char window — a comment/dead code could satisfy it).
    const body = methodBody(editor, 'setEnum = async (e: EnumParam, value: number)');
    const guard = body.indexOf('if (!c || (!c.pack && !this.paramsWithoutPack)) return;');
    const optimistic = body.indexOf('e.value = value;');
    expect(guard).toBeGreaterThan(-1);
    expect(optimistic).toBeGreaterThan(guard); // guard first, THEN the optimistic set
  });

  it('toggleBypass honours {ok:false} (not just a throw) and gates the success toast', () => {
    expect(editor).toMatch(/#writeSettlement\(forgefx\.setBypass\(c\.effectId, next\)\)/);
    expect(editor).toMatch(/settleScalarWrite\(\{ get: \(\) => c\.bypassed \?\? false, set: \(v\) => \(c\.bypassed = v\) \}, token, next, outcome/);
    expect(editor).not.toMatch(/c\.bypassed = !next;/); // the old throw-only revert is gone
    // success history + toast are now behind the settlement decision
    expect(editor).toMatch(/if \(d\.keep\) \{\s*history\.record\(\{ kind: 'bypass'/);
  });

  it('setChannel honours {ok:false}, not just a throw', () => {
    expect(editor).toMatch(/#writeSettlement\(forgefx\.setChannel\(c\.effectId, ch\)\)/);
    expect(editor).toMatch(/settleScalarWrite\(\{ get: \(\) => c\.channel, set: \(v\) => \(c\.channel = v\) \}, token, ch, outcome/);
    expect(editor).not.toMatch(/c\.channel = prev;/); // the old throw-only revert is gone
  });

  it('selectScene honours {ok:false}, not just a throw', () => {
    expect(editor).toMatch(
      /#writeSettlement\(forgefx\.setScene\(ui - 1\)\)/
    );
    expect(editor).toMatch(/settleScalarWrite\(\{ get: \(\) => this\.scene, set: \(v\) => \(this\.scene = v\) \}, token, ui, outcome/);
    expect(editor).not.toMatch(/this\.scene = prev;/); // the old throw-only revert is gone
  });

  it('retype no longer toasts success on a refusal', () => {
    const i = editor.indexOf('retype = async (value: number)');
    const body = editor.slice(i, i + 1600);
    const gate = body.indexOf(`if (outcome.status !== 'ok')`);
    expect(gate).toBeGreaterThan(-1);
    // the success toast sits strictly AFTER the outcome gate
    expect(body.indexOf(`this.showToast('Type changed'`)).toBeGreaterThan(gate);
    expect(body).toMatch(/const outcome = await this\.#writeSettlement\(forgefx\.setType\(c\.effectId, value\)\)/);
  });

  it('save() gives the post-save poll/refresh their own catch (a poll error is not a failed save)', () => {
    const i = editor.indexOf('save = async (n: number)');
    const body = editor.slice(i, i + 1100);
    const pollAt = body.indexOf('await this.poll()');
    expect(pollAt).toBeGreaterThan(-1);
    // 'Saved to preset' is toasted before the poll...
    expect(body.indexOf('Saved to preset')).toBeLessThan(pollAt);
    // ...and the poll sits in a SECOND try — the save try already returned via its 'Save failed' catch
    expect(body.slice(0, pollAt)).toMatch(/catch \{\s*this\.showToast\('Save failed', '#d6543f'\);\s*return;/);
  });
});

// P6 — the two write-outcome items P5 left open.
//
// (1) `settleScalarWrite` gained the same STALE-SETTLEMENT GUARD `settleEnumWrite` has: every scalar
// call site must supply the READER (`get`) and the value THIS write SENT, so a late refusal of an
// earlier write cannot wipe a newer value on screen. The pure guard is proven in
// paramWriteOutcome.scalar.test.ts; this pins the five store call sites that feed it.
//
// (2) `pasteBlock`'s empty-cell branch ran its placement ops inline (`for (const op of plan.ops) await
// this.#runOp(op)`) and discarded every result, so a device-refused placement was still recorded as an
// undoable composite step. It now routes through the SAME decision the routing ops use (`#runOps` +
// `decideGridOpOutcome`) — the composite record is gated on every op landing, and the refusal toast is
// surfaced (the placement toast wins over the settings toast because it is the more fundamental
// failure). No second mechanism is introduced.
describe('P6 — scalar stale guard wiring + pasteBlock routes through the grid-op decision', () => {
  const editor = stripComments(read('./editor.svelte.ts'));

  it('every scalar call site supplies the reader + the sent value (get + sent)', () => {
    // bypass, channel, scene, tempo, tuner — all five, in the settleScalarWrite target+args shape
    expect(editor).toMatch(/settleScalarWrite\(\{ get: \(\) => c\.bypassed \?\? false, set: \(v\) => \(c\.bypassed = v\) \}, token, next, outcome/);
    expect(editor).toMatch(/settleScalarWrite\(\{ get: \(\) => c\.channel, set: \(v\) => \(c\.channel = v\) \}, token, ch, outcome/);
    expect(editor).toMatch(/settleScalarWrite\(\{ get: \(\) => this\.scene, set: \(v\) => \(this\.scene = v\) \}, token, ui, outcome/);
    expect(editor).toMatch(/settleScalarWrite\(\{ get: \(\) => this\.bpm, set: \(v\) => \(this\.bpm = v\) \}, token, n, outcome/);
    expect(editor).toMatch(/settleScalarWrite\(\{ get: \(\) => this\.tuner\.active, set: \(v\) => \(this\.tuner = \{ active: v \}\) \}, token, next, outcome/);
    // no call site is left SETTER-ONLY — a target without `get` would silently skip the guard
    expect(editor).not.toMatch(/settleScalarWrite\(\{ set: \(v\) =>/);
  });

  it('pasteBlock runs its placement ops through #runOps + decideGridOpOutcome (result not discarded)', () => {
    expect(editor).toMatch(/decideGridOpOutcome\(await this\.#runOps\(plan\.ops\), plan\.label\)/);
    // the composite step is recorded ONLY when every op landed
    expect(editor).toMatch(/if \(outcome\.recordHistory\) history\.recordComposite\(plan\.label, plan\.ops\)/);
    // the old inline loop that discarded every result is gone
    expect(editor).not.toMatch(/for \(const op of plan\.ops\) await this\.#runOp\(op\);/);
    // and the placement refusal toast is surfaced (it wins over the settings toast)
    expect(editor).toMatch(/const toast = outcome\.toast \?\? r\.toast;/);
  });
});

// P11 — write-initiation sequencing. The stale guard is only correct with a per-control write token:
// every optimistic-write site mints one with `beginWrite(key, current)` BEFORE it awaits the write,
// and passes that token to the settle helper (the call-shape regexes above pin the token argument).
// Without this wiring the settle helpers cannot tell an ABA burst from a live value, nor revert to a
// device-confirmed value. Keys are the enum param OBJECT for enums (stable identity) and a stable
// string for scalars (`bypass:<eid>` / `channel:<eid>` / `scene` / `tempo` / `tuner`).
describe('P11 — optimistic-write sites mint a sequencing token before the await', () => {
  const editor = stripComments(read('./editor.svelte.ts'));

  it('imports beginWrite from the pure module', () => {
    expect(editor).toMatch(
      /import \{ beginWrite, settleEnumWrite, settleScalarWrite, settleWriteSet, type WriteSettlement, type WriteSetReport \} from '\.\/paramWriteOutcome'/
    );
  });

  it('setEnum mints the token on the enum param object BEFORE it awaits the write', () => {
    const body = methodBody(editor, 'setEnum = async (e: EnumParam, value: number)');
    const mint = body.indexOf('beginWrite(e, from)');
    const awaited = body.indexOf('const outcome = await this.#writeSettlement(');
    expect(mint).toBeGreaterThan(-1);
    expect(awaited).toBeGreaterThan(mint); // mint BEFORE the await
  });

  it('setPinnedEnum mints the token on the enum param object BEFORE the await', () => {
    const body = methodBody(editor, 'setPinnedEnum = async (effectId: number, e: EnumParam, value: number)');
    const mint = body.indexOf('beginWrite(e, from)');
    const awaited = body.indexOf('const outcome = await this.#writeSettlement(');
    expect(mint).toBeGreaterThan(-1);
    expect(awaited).toBeGreaterThan(mint);
  });

  it('every scalar site mints a token on a stable string key', () => {
    expect(editor).toMatch(/beginWrite\(`bypass:\$\{c\.effectId\}`, from\)/);
    expect(editor).toMatch(/beginWrite\(`channel:\$\{c\.effectId\}`, prev\)/);
    expect(editor).toMatch(/beginWrite\('scene', prev\)/);
    expect(editor).toMatch(/beginWrite\('tempo', from\)/);
    expect(editor).toMatch(/beginWrite\('tuner', from\)/);
  });
});
