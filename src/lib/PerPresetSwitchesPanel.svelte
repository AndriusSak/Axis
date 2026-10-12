<script lang="ts">
  // PER-PRESET SWITCH definitions (§3.8) — the per-preset footswitch assignments stored in the CURRENT
  // preset, read from the edit buffer (`forgefx.perPresetSwitches()` → GET /preset/switches). Read lazily
  // on the button, never on mount, so opening Device Tools fires no device traffic.
  //
  // THREE HONESTY RULES, all enforced in `perPresetSwitchView`:
  //   • CONFIDENCE IS PER FIELD, FROM AN OBSERVED-OFFSET TABLE. A row is `measured` only when every field's
  //     offset was read off the wire, `partial` when only some were, `unknown` when none — and a field whose
  //     offset was never located renders as `—`, never as a value.
  //   • AN UNLABELLED TARGET SHOWS ITS INDEX, and an FX-slot NAME appears only where the unit was measured to
  //     store a slot index at that byte (Effect: Bypass and Effect: Chan Select — the server's
  //     `targetIsFxSlot`). Elsewhere the row says WHY: a scene number, a layout, an unmeasured effect function.
  //   • A HOLD that reads Unassigned is marked when nobody ever exercised a HOLD on the unit — the zero is the
  //     same convention an unassigned TAP row uses, and it is labelled as a convention, not an observation.
  //
  // WRITE: per FIELD, bounded by the offsets the decoder has actually observed (all 24 action codes, 20 target
  // bytes, and the HOLD code — a second action-code array located on 2026-10-11). It targets the unit's EDIT
  // BUFFER — nothing is saved, and reloading the preset discards it. The answer is a read-back verdict, so
  // `ok:false` is a normal outcome and is shown as one.
  import { forgefx } from './forgefx';
  import {
    evidenceNote, switchPatchFromFields, switchRows, switchWriteVerdict,
    type SwitchFields, type SwitchRow
  } from './perPresetSwitchView';
  // The NAMED picker options, derived from the codec's measured tables (categories / function menus /
  // FX-slot anchors) — never a hand-kept list in this component. See perPresetSwitchOptions.ts.
  import { switchEditOptions } from './perPresetSwitchOptions';
  import type { PerPresetSwitches } from './types';

  const EMPTY: SwitchFields = { actionCode: '', targetIndex: '', holdActionCode: '' };

  let page = $state<PerPresetSwitches | null>(null);
  let rows = $state<SwitchRow[]>([]);
  let loading = $state(false);
  let loaded = $state(false);
  let error = $state('');

  let editing = $state(false);
  /** The row being edited — the write targets THIS index, never a hardcoded PP#1. */
  let editRow = $state<SwitchRow | null>(null);
  let fields = $state<SwitchFields>({ ...EMPTY });
  let writing = $state(false);
  let verdict = $state('');
  let verdictOk = $state(false);

  async function load() {
    loading = true;
    error = '';
    try {
      const p = await forgefx.perPresetSwitches();
      page = p;
      rows = switchRows(p);
      loaded = true;
    } catch (e) {
      error = (e as Error).message;
    } finally {
      loading = false;
    }
  }

  function read() {
    editing = false;
    verdict = '';
    void load();
  }

  function startEdit(r: SwitchRow) {
    verdict = '';
    verdictOk = false;
    editing = true;
    editRow = r;
    // The NAMED picker PRESELECTS what the device reports so the row reads as a name, not a 0.
    // The category select is always editable (every row offered for editing has an observed code offset),
    // so its value rides the write. The target select is only preselected when the byte is writable — an
    // index whose offset was never located starts EMPTY and stays disabled, so `switchPatchFromFields`
    // never sends a field the server would refuse. The HOLD field keeps its "empty = leave alone" rule.
    fields = {
      actionCode: String(r.actionCode ?? 0),
      targetIndex: r.canWriteTarget && r.targetIndex !== null ? String(r.targetIndex) : '',
      holdActionCode: r.holdActionCode === null || r.holdActionCode === 0 ? '' : String(r.holdActionCode)
    };
  }

  async function write() {
    if (!editRow) return;
    const target = editRow;
    const patch = switchPatchFromFields(fields);
    if (!patch) {
      verdictOk = false;
      verdict = 'Nothing to write — enter an action code or a target index.';
      return;
    }
    writing = true;
    try {
      const res = await forgefx.setPerPresetSwitch(target.index, patch);
      await load();
      verdictOk = res.ok;
      verdict = `PP#${target.index}: ` + switchWriteVerdict(res);
      editing = false;
      editRow = null;
    } catch (e) {
      verdictOk = false;
      verdict = (e as Error).message;
    } finally {
      writing = false;
    }
  }
</script>

<section>
  <h3>Per-preset switches</h3>
  <div class="line">
    <span>Footswitch assignments stored in the current preset (decoded from the edit buffer)</span>
    <button onclick={read} disabled={loading}>{loading ? 'Reading…' : 'Read switches'}</button>
  </div>
  {#if error}<p class="note err">{error}</p>{/if}
  {#if verdict}<p class="note" class:err={!verdictOk}>{verdict}</p>{/if}
  {#if loaded}
    {#if !rows.length}
      <p class="note">No per-preset switch block in this preset.</p>
    {:else}
      <p class="note">
        Block found at body offset <span class="mono">{page?.at}</span>.
        {#if page && !page.populated}
          <b>No switch is configured in this preset</b> among the fields this build can READ — PP#1 and
          PP#2's action code are zero. The other bytes of the block are not read, so this is not a claim
          that they are zero.
        {/if}
      </p>
      <p class="note caveat">
        {evidenceNote(page)}
        An FX-slot name appears only where the unit was measured to store a slot index there (Effect: Bypass
        and Effect: Chan Select); every other row shows its raw byte plus the reason. A row marked
        <span class="mono">unassigned*</span> has a HOLD that was never exercised on this unit.
      </p>
      <div class="list">
        <div class="prow head">
          <span class="slot mono">switch</span>
          <span class="nm">action · function</span>
          <span class="ids mono">target</span>
          <span class="ids mono">hold</span>
          <span class="conf">confidence</span>
          <span class="act"></span>
        </div>
        {#each rows as r (r.index)}
          <div class="prow" class:off={!r.known}>
            <span class="slot mono">PP#{r.index}</span>
            <span class="nm">
              {#if r.known && r.assigned}
                <b>{r.actionLabel.split(' (')[0]}</b>
                {#if r.functionLabel}<span class="fn">{r.functionLabel}</span>{/if}
              {:else if r.known}
                <span class="un">{r.actionLabel}</span>
              {:else}
                <span class="un" title="No byte offset for this index has been observed — nothing is read for it.">—</span>
              {/if}
            </span>
            <span class="ids mono">{r.known ? r.targetLabel : '—'}</span>
            <span class="ids mono">
              {#if !r.known}—{:else if r.holdUnexercised}<span class="un" title="No HOLD was ever exercised on this unit, so this Unassigned is the codec's zero convention rather than an observation.">{r.holdLabel}*</span>{:else}{r.holdLabel}{/if}
            </span>
            <span class="conf" class:inferred={r.confidence !== 'measured'} title={r.confidence === 'measured' ? 'every field read from an observed offset' : r.confidence === 'partial' ? 'only some fields have an observed offset' : 'no field of this row has an observed offset'}>{r.confidence}</span>
            <span class="act">
              {#if r.canWriteAction || r.canWriteTarget}
                <button class="mini" onclick={() => startEdit(r)} disabled={writing || (editing && editRow?.index === r.index)}>Edit</button>
              {/if}
            </span>
          </div>
          {#if editing && editRow && editRow.index === r.index}
            {@const opts = switchEditOptions(r.actionCode, r.functionIndex, r.targetIndex)}
            <div class="edit">
              <label title="The TAP category (the action-code array). Names come from the codec's measured PP_ACTION_CATEGORIES — all thirteen are named.">
                tap category
                <select bind:value={fields.actionCode} disabled={writing}>
                  {#each opts.categories as o (o.value)}
                    <option value={String(o.value)}>{o.label}</option>
                  {/each}
                </select>
              </label>
              <div class="field" title={opts.functionMenu}>
                tap function<span class="ro">read-only</span>
                <span class="fnval" class:unnamed={!opts.currentFunction.named}>{opts.currentFunction.label}</span>
              </div>
              <label
                title={r.canWriteTarget
                  ? `The FX-slot target byte for PP#${r.index}. Names come from the codec's measured anchors; ${opts.targetCoverage}`
                  : `PP#${r.index}'s target-byte offset has never been located, so it cannot be written — the server refuses it too.`}
              >
                target
                <select bind:value={fields.targetIndex} disabled={writing || !r.canWriteTarget}>
                  {#if !r.canWriteTarget}
                    <option value="">not located</option>
                  {/if}
                  {#each opts.targets as o (o.value)}
                    <option value={String(o.value)}>{o.label}</option>
                  {/each}
                </select>
              </label>
              <label
                title={`Write the HOLD action code for PP#${r.index}. The HOLD half is a second action-code array (marker+436 + 2·(index−1)), located on 2026-10-11 — three HOLDs read back 8/5/7 there. 0 = Unassigned; leave it empty to change only the TAP side.`}
              >
                hold action code<input bind:value={fields.holdActionCode} inputmode="numeric" placeholder={r.canWriteHold ? 'e.g. 8 = Looper' : 'not located'} disabled={writing || !r.canWriteHold} />
              </label>
              <div class="actions">
                <button class="mini go" onclick={write} disabled={writing}>{writing ? 'Writing…' : `Write PP#${r.index}`}</button>
                <button class="mini" onclick={() => { editing = false; editRow = null; }} disabled={writing}>Cancel</button>
              </div>
              <p class="warn">
                Writes the unit's EDIT BUFFER — not saved; reloading the preset discards it. The category and
                target are chosen by NAME from the codec's measured tables; a value with no measured name is
                shown as its raw number and marked unmeasured.
                {#if !opts.currentFunction.named}
                  <b>This row's function index has no measured name</b> ({opts.currentFunction.label}) — it is
                  shown as a number rather than guessed at.
                {/if}
                {#if !r.canWriteTarget}
                  <b>The target is disabled because this switch's target byte has never been located</b> —
                  a one-byte-per-switch array was measured and refuted, so its position is unknown.
                {/if}
              </p>
            </div>
          {/if}
        {/each}
      </div>
    {/if}
  {/if}
</section>

<style>
  section { margin-top: 14px; }
  h3 { margin: 0 0 8px; font-size: 13px; }
  .line { display: flex; align-items: center; gap: 10px; margin-bottom: 6px; }
  .line > span { flex: 1; min-width: 0; font-size: 12px; opacity: 0.85; }
  button {
    border: 1px solid var(--line, #33343a);
    background: var(--panel2, #24252b);
    color: inherit;
    border-radius: 7px;
    padding: 6px 10px;
    font-size: 12px;
    cursor: pointer;
  }
  button:disabled { opacity: 0.5; cursor: default; }
  button.mini { padding: 3px 8px; font-size: 11px; }
  button.go { border-color: #4b7; }
  .note { margin: 6px 0; font-size: 12px; opacity: 0.8; }
  .note.err { color: #ff6b6b; }
  .note.caveat { font-size: 11px; opacity: 0.65; }
  .list { display: flex; flex-direction: column; gap: 2px; }
  .prow { display: grid; grid-template-columns: 56px 1.1fr 1fr 0.8fr 74px 52px; align-items: center; gap: 8px;
    padding: 4px 6px; border-radius: 6px; font-size: 12px; }
  .fn { margin-left: 6px; font-size: 11px; opacity: 0.7; }
  .prow.head { opacity: 0.55; text-transform: uppercase; letter-spacing: 0.05em; font-size: 10px; }
  .prow.off { opacity: 0.5; }
  .slot { text-align: right; }
  .nm { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .un { font-style: italic; opacity: 0.75; }
  .ids { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .conf { font-size: 10px; text-transform: uppercase; letter-spacing: 0.04em; opacity: 0.8; }
  .conf.inferred { opacity: 0.5; font-style: italic; }
  .act { text-align: right; }
  .mono { font-family: var(--font-mono, ui-monospace, monospace); }
  .edit { display: flex; flex-wrap: wrap; align-items: flex-end; gap: 8px; margin: 2px 0 8px 62px;
    padding: 8px; border: 1px solid var(--line, #33343a); border-radius: 7px; }
  .edit label, .edit .field { display: flex; flex-direction: column; gap: 3px; font-size: 10px;
    text-transform: uppercase; letter-spacing: 0.05em; opacity: 0.8; }
  .edit label input, .edit label select { width: 150px; font-size: 12px; padding: 4px 6px; border-radius: 5px;
    border: 1px solid var(--line, #33343a); background: var(--panel2, #24252b); color: inherit; }
  .edit .ro { margin-left: 4px; font-size: 9px; opacity: 0.5; letter-spacing: 0; text-transform: none; }
  .edit .fnval { width: 150px; font-size: 12px; padding: 4px 6px; border-radius: 5px; display: inline-block;
    border: 1px dashed var(--line, #33343a); opacity: 0.9; }
  .edit .fnval.unnamed { font-style: italic; opacity: 0.7; }
  .edit .actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; flex: 1 1 100%; }
  .edit .warn { flex: 1 1 100%; font-size: 11px; opacity: 0.7; margin: 0; }
</style>
