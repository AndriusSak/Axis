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
    expect(editor).toMatch(/import \{ settleEnumWrite, settleScalarWrite, settleWriteSet, type WriteSettlement, type WriteSetReport \} from '\.\/paramWriteOutcome'/);
  });

  it('setEnum is async and awaits the discrete write (continuous=false / AM4 value route)', () => {
    expect(editor).toMatch(/setEnum = async \(e: EnumParam, value: number\)/);
    // the discrete write (both routes) is captured as a settlement through the shared wrapper
    expect(editor).toMatch(/!this\.isV2 && this\.isAm4 \? forgefx\.am4SetParamValue\(c\.effectId, e\.id, value\) : forgefx\.setParam\(c\.effectId, e\.id, value, false\)/);
    expect(editor).toMatch(/const outcome = await this\.#writeSettlement\(/);
  });

  it('captures the write outcome (ok → rejected, thrown → error) via the shared wrapper, not by swallowing it', () => {
    // #writeSettlement is the single place the settlement is derived; setEnum now routes through it
    expect(editor).toMatch(/#writeSettlement = async \(p: Promise<\{ ok: boolean \}>\): Promise<WriteSettlement> => \{\s*try \{\s*const r = await p;\s*return r\.ok \? \{ status: 'ok' \} : \{ status: 'rejected' \}/);
    expect(editor).toMatch(/return \{ status: 'error' \}/);
  });

  it('applies the decision: revert value, drop the optimistic history entry, toast the refusal', () => {
    expect(editor).toMatch(/dropHistory: \(id\) => history\.drop\(id\)/);
    expect(editor).toMatch(/history\.drop\(/); // the store gained the drop method this calls
    // the order matters: the write result is fed in (with the sent value for the stale guard), not discarded
    expect(editor).toMatch(/settleEnumWrite\(\s*e,\s*from,\s*value,\s*historyId,\s*outcome/);
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

// P2.1 leftover — `setPinnedEnum` is the SAME defect class as P1.1's setEnum: a single DISCRETE
// (continuous=false) pinned write shown optimistically while its result was swallowed with
// `.catch(() => {})`. The device reject-watches a discrete write, so a refused value stayed on the
// pinned tile indefinitely. It must mirror setEnum: await → outcome → `settleEnumWrite` (revert the
// value, drop the optimistic history entry, toast the refusal). The pinned CONTINUOUS write
// (`setPinnedParam`) stays fire-and-forget BY DESIGN, exactly like `setParam`, and is pinned here.
describe('refused discrete writes — setPinnedEnum wiring (P2.1 leftover)', () => {
  const editor = read('./editor.svelte.ts');

  it('setPinnedEnum is async and awaits the discrete write (continuous=false) via the shared wrapper', () => {
    expect(editor).toMatch(/setPinnedEnum = async \(effectId: number, e: EnumParam, value: number\)/);
    expect(editor).toMatch(/const outcome = await this\.#writeSettlement\(forgefx\.setParam\(effectId, e\.id, value, false\)\)/);
  });

  it('captures the pinned write outcome (ok → rejected, thrown → error) via the shared wrapper', () => {
    // the pinned branch feeds the same settlement shape the setEnum branch does
    expect(editor).toMatch(/#writeSettlement = async \(p: Promise<\{ ok: boolean \}>\): Promise<WriteSettlement>/);
    expect(editor).toMatch(/return r\.ok \? \{ status: 'ok' \} : \{ status: 'rejected' \}/);
    expect(editor).toMatch(/return \{ status: 'error' \}/);
  });

  it('applies the decision on the pinned enum: revert, drop history, toast', () => {
    expect(editor).toMatch(/settleEnumWrite\(\s*e,\s*from,\s*value,\s*historyId,\s*outcome/);
    expect(editor).toMatch(/dropHistory: \(id\) => history\.drop\(id\)/);
  });

  it('no longer swallows the pinned discrete write result', () => {
    expect(editor).not.toMatch(/forgefx\.setParam\(effectId, e\.id, value, false\)\.catch\(\(\) => \{\}\)/);
  });

  it('keeps the pinned CONTINUOUS knob path fire-and-forget BY DESIGN', () => {
    expect(editor).toMatch(/forgefx\.setParam\(effectId, p\.id as number, v, true\)\.catch\(\(\) => \{\}\)/);
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

// P2.1 — a SET of writes (paste / recall / cab apply) reports what LANDED, not what was requested.
// The old idiom `for (const w of writes) await forgefx.setParam(...).catch(() => {})` then an
// unconditional `showToast(\`… ${writes.length} …\`)` over an already-fired history.checkpoint is
// gone: every batch site now captures each write's settlement and routes it through
// `paramWriteOutcome.settleWriteSet`, and only checkpoints when something actually landed.
describe('write-set reporting — paste/recall/cab wiring (P2.1)', () => {
  const editor = read('./editor.svelte.ts');

  it('imports the pure write-set aggregation', () => {
    expect(editor).toMatch(
      /import \{ settleEnumWrite, settleScalarWrite, settleWriteSet, type WriteSettlement, type WriteSetReport \} from '\.\/paramWriteOutcome'/
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
  const editor = read('./editor.svelte.ts');

  it('imports the pure scalar decision', () => {
    expect(editor).toMatch(
      /import \{ settleEnumWrite, settleScalarWrite, settleWriteSet, type WriteSettlement, type WriteSetReport \} from '\.\/paramWriteOutcome'/
    );
  });

  it('setBpm captures the tempo outcome (ok → rejected, thrown → error) instead of swallowing it', () => {
    expect(editor).toMatch(
      /const r = await forgefx\.setTempo\(n\);\s*outcome = r\.ok \? \{ status: 'ok' \} : \{ status: 'rejected' \}/
    );
    expect(editor).toMatch(/settleScalarWrite\(\{ set: \(v\) => \(this\.bpm = v\) \}, from, outcome/);
    // the old silent swallow + no-revert line is gone
    expect(editor).not.toMatch(/await forgefx\.setTempo\(n\)\.catch\(\(\) => \{\}\)/);
  });

  it('toggleTuner honours {ok:false}, not just thrown errors', () => {
    expect(editor).toMatch(
      /const r = await forgefx\.setTuner\(next\);\s*outcome = r\.ok \? \{ status: 'ok' \} : \{ status: 'rejected' \}/
    );
    expect(editor).toMatch(/settleScalarWrite\(\{ set: \(v\) => \(this\.tuner = \{ active: v \}\) \}, from, outcome/);
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
  const editor = read('./editor.svelte.ts');

  it('setEnum guards BEFORE the optimistic write (an unsent value must not stay on screen)', () => {
    const i = editor.indexOf('setEnum = async (e: EnumParam, value: number)');
    expect(i).toBeGreaterThan(-1);
    const body = editor.slice(i, i + 600);
    const guard = body.indexOf('if (!c || (!c.pack && !this.paramsWithoutPack)) return;');
    const optimistic = body.indexOf('e.value = value;');
    expect(guard).toBeGreaterThan(-1);
    expect(optimistic).toBeGreaterThan(guard); // guard first, THEN the optimistic set
  });

  it('toggleBypass honours {ok:false} (not just a throw) and gates the success toast', () => {
    expect(editor).toMatch(/#writeSettlement\(forgefx\.setBypass\(c\.effectId, next\)\)/);
    expect(editor).toMatch(/settleScalarWrite\(\{ set: \(v\) => \(c\.bypassed = v\) \}, from, outcome/);
    expect(editor).not.toMatch(/c\.bypassed = !next;/); // the old throw-only revert is gone
    // success history + toast are now behind the settlement decision
    expect(editor).toMatch(/if \(d\.keep\) \{\s*history\.record\(\{ kind: 'bypass'/);
  });

  it('setChannel honours {ok:false}, not just a throw', () => {
    expect(editor).toMatch(/#writeSettlement\(forgefx\.setChannel\(c\.effectId, ch\)\)/);
    expect(editor).toMatch(/settleScalarWrite\(\{ set: \(v\) => \(c\.channel = v\) \}, prev, outcome/);
    expect(editor).not.toMatch(/c\.channel = prev;/); // the old throw-only revert is gone
  });

  it('selectScene honours {ok:false}, not just a throw', () => {
    expect(editor).toMatch(
      /#writeSettlement\(!this\.isV2 && this\.isAm4 \? forgefx\.am4SetScene\(ui - 1\) : forgefx\.setScene\(ui - 1\)\)/
    );
    expect(editor).toMatch(/settleScalarWrite\(\{ set: \(v\) => \(this\.scene = v\) \}, prev, outcome/);
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
