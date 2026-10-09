<script lang="ts">
  // PER-PRESET SWITCH definitions (§3.8) — the per-preset footswitch assignments stored in the CURRENT
  // preset, read from the edit buffer (`forgefx.perPresetSwitches()` → GET /preset/switches). Read lazily
  // on the button, never on mount, so opening Device Tools fires no device traffic.
  //
  // TWO HONESTY RULES, both enforced in `perPresetSwitchView`:
  //   • CONFIDENCE IS PER FIELD, FROM AN OBSERVED-OFFSET TABLE. A row is `measured` only when every field's
  //     offset was read off the wire, `partial` when only some were, `unknown` when none — and a field whose
  //     offset was never located renders as `—`, never as a value. Twelve confident-looking rows built on
  //     one measurement would be a lie.
  //   • AN UNLABELLED TARGET SHOWS ITS INDEX. 14 target indices have measured names; the rest (including
  //     the 8–16 band the docs bound only by dichotomising) show the raw number rather than a guess.
  //
  // WRITE: per FIELD, bounded by the offsets the decoder has actually observed (today: PP#1 fully, PP#2's
  // action code only). It targets the unit's EDIT BUFFER — nothing is saved, and reloading the preset
  // discards it. The answer is a read-back verdict, so `ok:false` is a normal outcome and is shown as one.
  import { forgefx } from './forgefx';
  import {
    evidenceNote, switchPatchFromFields, switchRows, switchWriteVerdict,
    type SwitchFields, type SwitchRow
  } from './perPresetSwitchView';
  import type { PerPresetSwitches } from './types';

  const EMPTY: SwitchFields = { actionCode: '', targetIndex: '' };

  /** The two action codes that have been observed, offered as buttons so a caller need not recall them. */
  const KNOWN_ACTIONS: Array<{ code: number; label: string }> = [
    { code: 0x04, label: 'Effect: Bypass' },
    { code: 0x03, label: 'Scene: Select' }
  ];

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
    // Start from what the device reports, but leave an UNASSIGNED row's fields blank rather than "0" — an
    // empty field means "leave it alone", and a bare 0 is easy to send by accident. An UNOBSERVED field
    // starts empty and stays disabled: there is no offset to write to.
    fields = {
      actionCode: r.actionCode === null || r.actionCode === 0 ? '' : String(r.actionCode),
      targetIndex: r.targetIndex === null || r.targetIndex === 0 ? '' : String(r.targetIndex)
    };
  }

  function setAction(code: number) {
    fields = { ...fields, actionCode: String(code) };
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
        Target names exist only for the 14 indices measured so far; anything else shows its raw index on
        purpose.
      </p>
      <div class="list">
        <div class="prow head">
          <span class="slot mono">switch</span>
          <span class="nm">action</span>
          <span class="ids mono">target</span>
          <span class="conf">confidence</span>
          <span class="act"></span>
        </div>
        {#each rows as r (r.index)}
          <div class="prow" class:off={!r.known}>
            <span class="slot mono">PP#{r.index}</span>
            <span class="nm">
              {#if r.known && r.assigned}
                <b>{r.actionLabel}</b>
              {:else if r.known}
                <span class="un">{r.actionLabel}</span>
              {:else}
                <span class="un" title="No byte offset for this index has been observed — nothing is read for it.">—</span>
              {/if}
            </span>
            <span class="ids mono">{r.known ? r.targetLabel : '—'}</span>
            <span class="conf" class:inferred={r.confidence !== 'measured'} title={r.confidence === 'measured' ? 'every field read from an observed offset' : r.confidence === 'partial' ? 'only some fields have an observed offset' : 'no field of this row has an observed offset'}>{r.confidence}</span>
            <span class="act">
              {#if r.canWriteAction || r.canWriteTarget}
                <button class="mini" onclick={() => startEdit(r)} disabled={writing || (editing && editRow?.index === r.index)}>Edit</button>
              {/if}
            </span>
          </div>
          {#if editing && editRow && editRow.index === r.index}
            <div class="edit">
              <label>action code<input bind:value={fields.actionCode} inputmode="numeric" placeholder="e.g. 4" disabled={writing} /></label>
              <label
                title={r.canWriteTarget
                  ? `Write the target byte for PP#${r.index}.`
                  : `PP#${r.index}'s target-byte offset has never been located, so it cannot be written — the server refuses it too.`}
              >
                target index<input bind:value={fields.targetIndex} inputmode="numeric" placeholder={r.canWriteTarget ? 'e.g. 51' : 'not located'} disabled={writing || !r.canWriteTarget} />
              </label>
              <div class="actions">
                {#each KNOWN_ACTIONS as a (a.code)}
                  <button class="mini" onclick={() => setAction(a.code)} disabled={writing}>{a.label} ({a.code})</button>
                {/each}
                <button class="mini go" onclick={write} disabled={writing}>{writing ? 'Writing…' : `Write PP#${r.index}`}</button>
                <button class="mini" onclick={() => { editing = false; editRow = null; }} disabled={writing}>Cancel</button>
              </div>
              <p class="warn">
                Writes the unit's EDIT BUFFER — not saved; reloading the preset discards it. The action codes
                offered above are the two that have been observed (0x04, 0x03); a code typed here is sent
                as-is and read back, not validated against a function list.
                {#if !r.canWriteTarget}
                  <b>The target index is disabled because this switch's target byte has never been located</b> —
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
  .prow { display: grid; grid-template-columns: 56px 1fr 1fr 74px 52px; align-items: center; gap: 8px;
    padding: 4px 6px; border-radius: 6px; font-size: 12px; }
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
  .edit label { display: flex; flex-direction: column; gap: 3px; font-size: 10px;
    text-transform: uppercase; letter-spacing: 0.05em; opacity: 0.8; }
  .edit label input { width: 110px; font-size: 12px; padding: 4px 6px; border-radius: 5px;
    border: 1px solid var(--line, #33343a); background: var(--panel2, #24252b); color: inherit; }
  .edit .actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; flex: 1 1 100%; }
  .edit .warn { flex: 1 1 100%; font-size: 11px; opacity: 0.7; margin: 0; }
</style>
